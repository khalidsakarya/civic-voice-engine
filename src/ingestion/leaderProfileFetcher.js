'use strict';

/**
 * Fetches real profile section data for Trump (US), Albanese (AU), and
 * Starmer (UK) from official government sources and writes to Firestore
 * collection "leader_profile_data".
 *
 * Each leader gets three documents:
 *   section: "key_policy_areas"   – official priorities / missions pages
 *   section: "term_information"   – official biography / parliament sources
 *   section: "contact_information"– official contact pages
 *
 * Sources:
 *   Trump    – whitehouse.gov/priorities + /administration/donald-j-trump
 *   Albanese – pm.gov.au/our-work + aph.gov.au member profile
 *   Starmer  – gov.uk/missions + gov.uk/government/people/keir-starmer
 *
 * Run:  node src/ingestion/leaderProfileFetcher.js
 */

require('dotenv').config();
const axios          = require('axios');
const https          = require('https');
const { getDb }         = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');

const COLLECTION     = 'leader_profile_data';
const SCHEDULER_TIER = 'weekly';
const BROWSER_UA     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
      timeout: 25000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function axiosGet(url) {
  return axios.get(url, {
    timeout: 25000,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,*/*' },
    maxRedirects: 5,
  }).then(r => r.data);
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘').replace(/&#8230;/g, '...')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function metaDesc(html) {
  return (
    html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i) ||
    html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i) ||
    html.match(/<meta[^>]+content="([^"]+)"[^>]+name="description"/i) ||
    []
  )[1] || null;
}

function safeWrite(db, docId, data) {
  return db.collection(COLLECTION).doc(docId).set(data, { merge: true });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUMP — US
// ═══════════════════════════════════════════════════════════════════════════════

const WH_PRIORITY_PAGES = [
  { key: 'economy',           url: 'https://www.whitehouse.gov/priorities/economy/',           label: 'Grow the Economy' },
  { key: 'national_security', url: 'https://www.whitehouse.gov/priorities/national-security/', label: 'Strengthen National Security' },
  { key: 'border',            url: 'https://www.whitehouse.gov/priorities/border-immigration/', label: 'Secure the Border' },
  { key: 'energy',            url: 'https://www.whitehouse.gov/priorities/energy/',            label: 'Unleash American Energy' },
  { key: 'tech_ai',           url: 'https://www.whitehouse.gov/priorities/tech-innovation/',   label: 'Lead the World in AI' },
  { key: 'doge',              url: 'https://www.whitehouse.gov/priorities/doge/',              label: 'Reform Government (DOGE)' },
  { key: 'maha',              url: 'https://www.whitehouse.gov/priorities/maha/',              label: 'Make America Healthy Again' },
  { key: 'safe_communities',  url: 'https://www.whitehouse.gov/priorities/safe-communities/',  label: 'Support Public Safety' },
  { key: 'faith',             url: 'https://www.whitehouse.gov/priorities/faith/',             label: 'Protect Religious Liberty' },
];

async function fetchTrumpPolicies(db, ts) {
  console.log('[profile:US:policy] Fetching whitehouse.gov priority pages...');
  const priorities = [];

  for (const { key, url, label } of WH_PRIORITY_PAGES) {
    try {
      const html = await httpsGet(url);
      // og:description carries a 2–3 sentence summary for each priority page
      const desc = metaDesc(html);
      // Fallback: first substantive paragraph (skip nav dump)
      let description = desc ? stripHtml(desc) : null;
      if (!description) {
        const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
          .map(m => stripHtml(m[1]))
          .filter(t => t.length > 80 && !/^Menu|^Search|^Skip/i.test(t));
        description = paras[0] || null;
      }
      priorities.push({ key, label, description, source_url: url });
      console.log(`[profile:US:policy]   ${label}: ${description ? description.slice(0, 60) + '…' : 'no desc'}`);
    } catch (err) {
      console.warn(`[profile:US:policy]   ${label}: fetch failed — ${err.message}`);
      priorities.push({ key, label, description: null, source_url: url, error: err.message });
    }
  }

  const doc = {
    member_name:     'Donald Trump',
    politician_slug: 'donald-trump',
    jurisdiction:    'US',
    section:         'key_policy_areas',
    priorities,
    source: { url: 'https://www.whitehouse.gov/priorities/', name: 'The White House — Priorities', status: 'ok' },
    last_updated: ts,
  };
  await safeWrite(db, 'us-trump-key-policy-areas', doc);
  console.log(`[profile:US:policy] ✓ Written (${priorities.length} priorities)`);
  return doc;
}

async function fetchTrumpTerm(db, ts) {
  console.log('[profile:US:term] Fetching whitehouse.gov/administration/donald-j-trump...');
  const BIO_URL = 'https://www.whitehouse.gov/administration/donald-j-trump/';

  let bioParagraphs = [];
  let bioStatus     = 'ok';

  try {
    const html = await httpsGet(BIO_URL);
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    // Extract paragraphs that follow the h1/h2 admin block
    const paras = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map(m => stripHtml(m[1]))
      .filter(t => t.length > 60 && !/^Menu|^Search|^Skip|^Follow/i.test(t));
    bioParagraphs = paras.slice(0, 4);
    console.log(`[profile:US:term]   Bio paragraphs: ${bioParagraphs.length}`);
  } catch (err) {
    console.warn(`[profile:US:term]   Bio fetch failed: ${err.message}`);
    bioStatus = `failed: ${err.message}`;
  }

  const doc = {
    member_name:        'Donald Trump',
    politician_slug:    'donald-trump',
    jurisdiction:       'US',
    section:            'term_information',
    // 47th President, inaugurated January 20, 2025 (second term)
    term_number:        47,
    previous_term:      45,
    date_inaugurated:   '2025-01-20',
    term_start:         '2025-01-20',
    term_end_scheduled: '2029-01-20',
    term_status:        'current',
    party:              'Republican Party',
    office:             'President of the United States',
    vice_president:     'JD Vance',
    bio_summary:        bioParagraphs,
    source: { url: BIO_URL, name: 'The White House — Administration', status: bioStatus },
    last_updated: ts,
  };
  await safeWrite(db, 'us-trump-term-information', doc);
  console.log('[profile:US:term] ✓ Written');
  return doc;
}

async function fetchTrumpContact(db, ts) {
  console.log('[profile:US:contact] Writing White House contact information...');
  // The whitehouse.gov/contact/ page is a form rendered by React; the address
  // and phone numbers are in the static shell and are a matter of permanent
  // public record.
  const doc = {
    member_name:     'Donald Trump',
    politician_slug: 'donald-trump',
    jurisdiction:    'US',
    section:         'contact_information',
    office_name:     'The White House',
    mailing_address: {
      street:  '1600 Pennsylvania Avenue NW',
      city:    'Washington',
      state:   'DC',
      postal:  '20500',
      country: 'United States',
    },
    phone_comment_line: '202-456-1111',
    phone_visitors:     '202-456-1414',
    website:            'https://www.whitehouse.gov',
    contact_form:       'https://www.whitehouse.gov/contact/',
    social_media: {
      x:         'https://x.com/WhiteHouse',
      facebook:  'https://www.facebook.com/WhiteHouse',
      instagram: 'https://www.instagram.com/whitehouse',
      youtube:   'https://www.youtube.com/@WhiteHouse',
    },
    source: { url: 'https://www.whitehouse.gov/contact/', name: 'The White House — Contact', status: 'ok' },
    last_updated: ts,
  };
  await safeWrite(db, 'us-trump-contact-information', doc);
  console.log('[profile:US:contact] ✓ Written');
  return doc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALBANESE — AU
// ═══════════════════════════════════════════════════════════════════════════════

const AU_WORK_AREAS = [
  { key: 'cost_of_living',  path: '/our-work/help-cost-living',                   label: 'Help with the cost of living' },
  { key: 'fuel_security',   path: '/our-work/fuel-security-for-australians',       label: 'Fuel security for Australians' },
  { key: 'medicare',        path: '/our-work/stronger-medicare-and-better-aged-care', label: 'Stronger Medicare and better aged care' },
  { key: 'opportunities',   path: '/our-work/opportunities-australians',            label: 'Opportunities for Australians' },
  { key: 'housing',         path: '/our-work/home-your-own',                        label: 'A home of your own' },
  { key: 'building_future', path: '/our-work/building-australias-future',           label: "Building Australia's future" },
];

const AU_INDEX_URL = 'https://www.pm.gov.au/our-work';

// pm.gov.au is behind Cloudflare bot-detection: all URLs return a ~852-byte
// challenge iframe regardless of HTTP client. Wayback Machine is used as
// fallback when the challenge page is detected.
async function waybackFallback(originalUrl) {
  try {
    const api = `https://archive.org/wayback/available?url=${encodeURIComponent(originalUrl)}`;
    const r   = await axios.get(api, { timeout: 12000, headers: { 'User-Agent': BROWSER_UA } });
    const snap = r.data && r.data.archived_snapshots && r.data.archived_snapshots.closest;
    return (snap && snap.available) ? snap.url : null;
  } catch { return null; }
}

function isCloudflarePage(html) {
  return html.length < 5000 && /NOINDEX,\s*NOFOLLOW/i.test(html);
}

function extractPageDesc(html) {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const desc  = metaDesc(html);
  if (desc && !/^On this page/i.test(desc)) return stripHtml(desc).slice(0, 300);
  // Text between h1 and first h2
  const h1End = clean.search(/<\/h1>/i);
  const h2Idx = clean.search(/<h2/i);
  if (h1End !== -1 && h2Idx > h1End) {
    const between = stripHtml(clean.slice(h1End + 5, h2Idx)).replace(/^Listen\s*/i, '').trim();
    if (between.length > 30) return between.slice(0, 300);
  }
  // First substantive paragraph
  const paras = [...clean.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map(m => stripHtml(m[1]))
    .filter(t => t.length > 60 && !/^(?:On this page|Skip|Listen|Back to top)/i.test(t));
  return paras[0] ? paras[0].slice(0, 300) : null;
}

async function fetchAlbanesePolicies(db, ts) {
  console.log('[profile:AU:policy] Fetching pm.gov.au/our-work pages (with Wayback fallback)...');
  const policies = [];

  for (const { key, path, label } of AU_WORK_AREAS) {
    const url = 'https://www.pm.gov.au' + path;
    try {
      let html       = await axiosGet(url);
      let sourceNote = 'live';

      if (isCloudflarePage(html)) {
        // Direct access blocked by Cloudflare — try Wayback Machine snapshot
        const archiveUrl = await waybackFallback(url);
        if (archiveUrl) {
          html       = await axiosGet(archiveUrl);
          sourceNote = 'wayback';
          console.log(`[profile:AU:policy]   ${label}: Cloudflare blocked → using Wayback snapshot`);
        } else {
          console.log(`[profile:AU:policy]   ${label}: Cloudflare blocked, no Wayback snapshot`);
          policies.push({ key, label, description: null, source_url: url, data_status: 'source_unavailable_cloudflare' });
          continue;
        }
      }

      const desc = extractPageDesc(html);
      policies.push({ key, label, description: desc, source_url: url, ...(sourceNote === 'wayback' && { source_note: 'Wayback Machine archive' }) });
      console.log(`[profile:AU:policy]   ${label}: ${desc ? desc.slice(0, 60) + '…' : 'no desc'} [${sourceNote}]`);
    } catch (err) {
      console.warn(`[profile:AU:policy]   ${label}: fetch failed — ${err.message}`);
      policies.push({ key, label, description: null, source_url: url, error: err.message });
    }
  }

  const doc = {
    member_name:     'Anthony Albanese',
    politician_slug: 'anthony-albanese',
    jurisdiction:    'AU',
    section:         'key_policy_areas',
    policies,
    source: { url: AU_INDEX_URL, name: 'Prime Minister of Australia — Our Work', status: 'ok' },
    last_updated: ts,
  };
  await safeWrite(db, 'au-albanese-key-policy-areas', doc);
  console.log(`[profile:AU:policy] ✓ Written (${policies.length} policy areas)`);
  return doc;
}

async function fetchAlbaneseTerm(db, ts) {
  console.log('[profile:AU:term] Fetching aph.gov.au member profile for Albanese...');
  // APH member ID R36 — confirmed from probe
  const APH_URL = 'https://www.aph.gov.au/Senators_and_Members/Parliamentarian?MPID=R36';

  let electorate    = null;
  let state         = null;
  let dateElected   = null;
  let dateReelected = null;
  let datePM        = null;
  let bioStatus     = 'ok';

  try {
    const html = await httpsGet(APH_URL);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // "Elected to the House of Representatives for Grayndler, New South Wales, 1996."
    const electedM = text.match(/Elected to the House of Representatives for ([^,]+),\s*([^,]+),\s*(\d{4})/i);
    if (electedM) {
      electorate  = electedM[1].trim();
      state       = electedM[2].trim();
      dateElected = electedM[3];
    }
    // "Re-elected 1998, 2001, ... 2025"
    const reM = text.match(/Re-elected\s+([\d,\s]+)/i);
    if (reM) dateReelected = reM[1].trim().split(/[,\s]+/).filter(Boolean).pop();

    // "Prime Minister from 23.5.2022" — exclude "Deputy Prime Minister from …"
    const pmMatches = [...text.matchAll(/Prime Minister from\s+([\d.]+)/gi)];
    const pmM = pmMatches.find(m => {
      const before = text.slice(Math.max(0, m.index - 8), m.index);
      return !/Deputy\s*$/i.test(before);
    });
    if (pmM) {
      const raw   = pmM[1].replace(/\.$/, '');   // strip trailing period
      const parts = raw.split('.');
      datePM = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}` : raw;
    }
    console.log(`[profile:AU:term]   Electorate: ${electorate}, ${state} | First elected: ${dateElected} | PM since: ${datePM}`);
  } catch (err) {
    console.warn(`[profile:AU:term]   APH fetch failed: ${err.message}`);
    bioStatus = `failed: ${err.message}`;
  }

  const doc = {
    member_name:      'Anthony Albanese',
    politician_slug:  'anthony-albanese',
    jurisdiction:     'AU',
    section:          'term_information',
    office:           'Prime Minister of Australia',
    party:            'Australian Labor Party',
    electorate,
    state,
    chamber:          'House of Representatives',
    date_first_elected: dateElected ? `${dateElected}-01-01` : null,
    date_last_elected:  dateReelected ? `${dateReelected}-05-03` : null,
    date_sworn_pm:    datePM,
    term_start:       datePM,
    term_status:      'current',
    source: { url: APH_URL, name: 'Australian Parliament House — Member Profile', status: bioStatus },
    last_updated: ts,
  };
  await safeWrite(db, 'au-albanese-term-information', doc);
  console.log('[profile:AU:term] ✓ Written');
  return doc;
}

async function fetchAlbaneseContact(db, ts) {
  console.log('[profile:AU:contact] Fetching pm.gov.au contact page...');
  const CONTACT_URL = 'https://www.pm.gov.au/contact-pm';

  let contactStatus = 'ok';
  try {
    const html = await httpsGet(CONTACT_URL);
    if (html.length < 5000 || html.toLowerCase().includes('not found')) {
      contactStatus = 'page_not_found';
    }
    console.log(`[profile:AU:contact]   Contact page: ${html.length} bytes`);
  } catch (err) {
    contactStatus = `failed: ${err.message}`;
    console.warn(`[profile:AU:contact]   ${err.message}`);
  }

  const doc = {
    member_name:     'Anthony Albanese',
    politician_slug: 'anthony-albanese',
    jurisdiction:    'AU',
    section:         'contact_information',
    office_name:     'Office of the Prime Minister',
    mailing_address: {
      // PM&C's official address; correspondence to the PM is directed here
      street:   'PO Box 6500',
      city:     'Canberra',
      state:    'ACT',
      postal:   '2600',
      country:  'Australia',
    },
    phone:       '+61 2 6277 7700',
    website:     'https://www.pm.gov.au',
    contact_form: CONTACT_URL,
    social_media: {
      facebook:  'https://www.facebook.com/AlboMP',
      x:         'https://x.com/AlboMP',
      instagram: 'https://www.instagram.com/albomp',
      youtube:   'https://www.youtube.com/@PrimeMinisterofAustralia',
    },
    source: { url: CONTACT_URL, name: 'Prime Minister of Australia — Contact', status: contactStatus },
    last_updated: ts,
  };
  await safeWrite(db, 'au-albanese-contact-information', doc);
  console.log('[profile:AU:contact] ✓ Written');
  return doc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARMER — UK
// ═══════════════════════════════════════════════════════════════════════════════

const UK_MISSION_PAGES = [
  { key: 'economic_growth', url: 'https://www.gov.uk/missions/economic-growth', label: 'Kickstarting Economic Growth' },
  { key: 'nhs',             url: 'https://www.gov.uk/missions/nhs',             label: 'An NHS Fit for the Future' },
  { key: 'safer_streets',   url: 'https://www.gov.uk/missions/safer-streets',   label: 'Safer Streets' },
  { key: 'opportunity',     url: 'https://www.gov.uk/missions/opportunity',     label: 'Break Down Barriers to Opportunity' },
  { key: 'clean_energy',    url: 'https://www.gov.uk/missions/clean-energy',    label: 'Make Britain a Clean Energy Superpower' },
  { key: 'foundations',     url: 'https://www.gov.uk/missions/strong-foundations', label: 'Strong Foundations' },
];

async function fetchStarmerPolicies(db, ts) {
  console.log('[profile:UK:policy] Fetching gov.uk/missions pages...');
  const missions = [];

  for (const { key, url, label } of UK_MISSION_PAGES) {
    try {
      const html = await axiosGet(url);
      const desc = metaDesc(html);
      // Fallback: first substantive paragraph in the main content
      let description = desc ? stripHtml(desc) : null;
      if (!description) {
        const paras = [...html.matchAll(/<p[^>]*class="[^"]*lead[^"]*"[^>]*>([\s\S]*?)<\/p>/g),
                       ...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
          .map(m => stripHtml(m[1]))
          .filter(t => t.length > 60 && !/^Cookies|^Skip|^Navigation/i.test(t));
        description = paras[0] || null;
      }
      missions.push({ key, label, description, source_url: url });
      console.log(`[profile:UK:policy]   ${label}: ${description ? description.slice(0, 60) + '…' : 'no desc'}`);
    } catch (err) {
      console.warn(`[profile:UK:policy]   ${label}: fetch failed — ${err.message}`);
      missions.push({ key, label, description: null, source_url: url, error: err.message });
    }
  }

  const doc = {
    member_name:     'Keir Starmer',
    politician_slug: 'keir-starmer',
    jurisdiction:    'UK',
    section:         'key_policy_areas',
    missions,
    source: {
      url:  'https://www.gov.uk/missions',
      name: 'GOV.UK — Plan for Change: Missions',
      status: 'ok',
    },
    last_updated: ts,
  };
  await safeWrite(db, 'uk-starmer-key-policy-areas', doc);
  console.log(`[profile:UK:policy] ✓ Written (${missions.length} missions)`);
  return doc;
}

async function fetchStarmerTerm(db, ts) {
  console.log('[profile:UK:term] Fetching gov.uk/government/people/keir-starmer...');
  const BIO_URL = 'https://www.gov.uk/government/people/keir-starmer';

  let bioText   = null;
  let bioStatus = 'ok';

  try {
    const html = await httpsGet(BIO_URL);
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');

    // Extract text between the <h2>Biography</h2> heading and the
    // "current-roles" div (confirmed in probe: all sub-sections sit in
    // between — Education, Political Career, Career before politics, etc.)
    const bioSectionM = stripped.match(
      /<h2[^>]*>\s*Biography\s*<\/h2>([\s\S]*?)(?=<div[^>]*id="current-roles"|<\/main)/i
    );
    if (bioSectionM) {
      bioText = stripHtml(bioSectionM[1]).trim().slice(0, 1200);
    }
    console.log(`[profile:UK:term]   Bio extracted: ${bioText ? bioText.length + ' chars' : 'none'}`);
  } catch (err) {
    console.warn(`[profile:UK:term]   Bio fetch failed: ${err.message}`);
    bioStatus = `failed: ${err.message}`;
  }

  const doc = {
    member_name:       'Keir Starmer',
    politician_slug:   'keir-starmer',
    jurisdiction:      'UK',
    section:           'term_information',
    office:            'Prime Minister, First Lord of the Treasury, Minister for the Civil Service, and Minister for the Union',
    party:             'Labour Party',
    constituency:      'Holborn and St Pancras',
    date_elected_mp:   '2015-05-07',   // May 2015 general election
    date_party_leader: '2020-04-04',   // elected Labour leader April 2020
    date_sworn_pm:     '2024-07-05',   // 5 July 2024 per gov.uk bio
    term_start:        '2024-07-05',
    term_status:       'current',
    bio_summary:       bioText,
    source: { url: BIO_URL, name: 'GOV.UK — People: Keir Starmer', status: bioStatus },
    last_updated: ts,
  };
  await safeWrite(db, 'uk-starmer-term-information', doc);
  console.log('[profile:UK:term] ✓ Written');
  return doc;
}

async function fetchStarmerContact(db, ts) {
  console.log('[profile:UK:contact] Writing 10 Downing Street contact information...');
  // 10 Downing Street's public contact details are a matter of permanent record.
  // The org page at gov.uk is the canonical contact reference (confirmed reachable).
  const CONTACT_URL = 'https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street';
  let contactStatus = 'ok';
  try {
    const html = await axiosGet(CONTACT_URL);
    console.log(`[profile:UK:contact]   Contact page: ${html.length} bytes`);
  } catch (err) {
    contactStatus = `failed: ${err.message}`;
    console.warn(`[profile:UK:contact]   ${err.message}`);
  }

  const doc = {
    member_name:     'Keir Starmer',
    politician_slug: 'keir-starmer',
    jurisdiction:    'UK',
    section:         'contact_information',
    office_name:     '10 Downing Street',
    mailing_address: {
      street:  '10 Downing Street',
      city:    'London',
      postal:  'SW1A 2AA',
      country: 'United Kingdom',
    },
    phone:       '+44 20 7925 0918',
    website:      CONTACT_URL,
    contact_form: 'https://www.gov.uk/contact/govuk',
    social_media: {
      x:         'https://x.com/10DowningStreet',
      facebook:  'https://www.facebook.com/10DowningStreet',
      instagram: 'https://www.instagram.com/10downingstreet',
      youtube:   'https://www.youtube.com/@10DowningStreet',
    },
    source: { url: CONTACT_URL, name: 'GOV.UK — Contact 10 Downing Street', status: contactStatus },
    last_updated: ts,
  };
  await safeWrite(db, 'uk-starmer-contact-information', doc);
  console.log('[profile:UK:contact] ✓ Written');
  return doc;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchAllLeaderProfiles() {
  const db = getDb();
  const ts = new Date().toISOString();
  console.log(`\n[leader-profile] Fetching profiles for Trump, Albanese, Starmer — ${ts}\n`);

  const results = {};
  const run = async (label, fn) => {
    try { results[label] = await fn(db, ts); }
    catch (err) { console.error(`[leader-profile] ${label} FAILED:`, err.message); results[label] = null; }
  };

  // US — Trump
  await run('us_policy',  fetchTrumpPolicies);
  await run('us_term',    fetchTrumpTerm);
  await run('us_contact', fetchTrumpContact);

  // AU — Albanese
  await run('au_policy',  fetchAlbanesePolicies);
  await run('au_term',    fetchAlbaneseTerm);
  await run('au_contact', fetchAlbaneseContact);

  // UK — Starmer
  await run('uk_policy',  fetchStarmerPolicies);
  await run('uk_term',    fetchStarmerTerm);
  await run('uk_contact', fetchStarmerContact);

  const successes = Object.values(results).filter(Boolean).length;

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'US,AU,UK',
    data_pull_timestamp: ts,
    source_endpoint:     'leader-profile-fetcher',
    record_count:        9,
    import_status:       successes === 9 ? 'success' : 'partial',
    scheduler_tier:      SCHEDULER_TIER,
  });

  console.log(`\n[leader-profile] Done — ${successes}/9 sections written to "${COLLECTION}"`);
  return results;
}

module.exports = { fetchAllLeaderProfiles };

if (require.main === module) {
  fetchAllLeaderProfiles()
    .then(() => process.exit(0))
    .catch(err => { console.error('[leader-profile] Fatal:', err.message); process.exit(1); });
}
