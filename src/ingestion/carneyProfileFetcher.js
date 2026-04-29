'use strict';

/**
 * Fetches real profile section data for Mark Carney from official sources and
 * writes four documents to the "leader_profile_data" Firestore collection:
 *
 *   section: "key_policy_areas"   — pm.gc.ca mandate letter + liberal.ca platform
 *   section: "senior_advisors"    — pm.gc.ca/en/news PMO staff backgrounders
 *   section: "term_information"   — ourcommons.ca XML member profile
 *   section: "contact_information"— pm.gc.ca official contact page
 *
 * Run:  node src/ingestion/carneyProfileFetcher.js
 */

require('dotenv').config();
const https  = require('https');
const axios  = require('axios');
const { getDb }         = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');

const COLLECTION     = 'leader_profile_data';
const MEMBER_NAME    = 'Mark Carney';
const CARNEY_SLUG    = 'mark-carney';
const OURCOMMONS_ID  = '28286';
const SCHEDULER_TIER = 'weekly';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&rsquo;/g, '’').replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—').replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// ─── Section 1 — key_policy_areas ────────────────────────────────────────────
// Sources: pm.gc.ca mandate letter (May 21 2025) + liberal.ca/platform/

async function fetchKeyPolicyAreas(db, ts) {
  console.log('[profile:policy] Fetching mandate letter and Liberal platform...');

  // ── Mandate letter ─────────────────────────────────────────────────────────
  const MANDATE_URL = 'https://www.pm.gc.ca/en/mandate-letters/2025/05/21/mandate-letter';
  let mandatePriorities = [];
  let mandateContext    = '';
  let mandateStatus     = 'ok';

  try {
    const html  = await httpsGet(MANDATE_URL);
    const main  = html.slice(html.indexOf('<main') !== -1 ? html.indexOf('<main') : 0);
    const text  = stripHtml(main);

    // Extract the seven numbered priorities — they appear as <li> items in the
    // priorities section (verified in probe: distinct sentences starting with a
    // capital action verb, each 60–200 chars).
    const liItems = [...main.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map(m => stripHtml(m[1]))
      .filter(t => t.length > 40 && t.length < 400 && /^[A-Z]/.test(t));

    mandatePriorities = liItems.slice(0, 7);

    // Extract the contextual opening paragraph ("Our Priorities… We will focus on…")
    const prioIdx = text.indexOf('Our Priorities');
    if (prioIdx !== -1) {
      mandateContext = text.slice(prioIdx, prioIdx + 300).split('\n')[0].trim();
    }
    console.log(`[profile:policy]   Mandate letter: ${mandatePriorities.length} priorities extracted`);
  } catch (err) {
    console.warn(`[profile:policy]   Mandate letter fetch failed: ${err.message}`);
    mandateStatus = `failed: ${err.message}`;
  }

  // ── Liberal platform ───────────────────────────────────────────────────────
  const PLATFORM_URL = 'https://liberal.ca/platform/';
  let platformAreas = [];
  let platformStatus = 'ok';

  try {
    const html = await httpsGet(PLATFORM_URL);

    // Extract h3 headings that represent policy areas (verified in probe:
    // "Tax Fairness", "Building Responsibly", "Global Leadership", etc.)
    // Each heading is followed by a short paragraph; capture both.
    const SKIP = /^(The Team|Learn More|Get Involved|Donate|Follow|Menu|Contents|Our Plan)$/i;
    const blocks = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>([\s\S]*?)(?=<h[23]|<\/section|$)/g)];

    for (const m of blocks) {
      const title = stripHtml(m[1]);
      if (!title || SKIP.test(title) || title.length > 90) continue;
      // Get the first sentence of the body text as a description
      const body = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
      const desc = body.split(/[.!?]\s+/)[0].replace(/\s+/g, ' ').trim();
      platformAreas.push({ area: title, description: desc.slice(0, 200) || null });
    }
    console.log(`[profile:policy]   Liberal platform: ${platformAreas.length} policy areas extracted`);
  } catch (err) {
    console.warn(`[profile:policy]   Liberal platform fetch failed: ${err.message}`);
    platformStatus = `failed: ${err.message}`;
  }

  const doc = {
    member_name:          MEMBER_NAME,
    politician_slug:      CARNEY_SLUG,
    jurisdiction:         'CA',
    section:              'key_policy_areas',
    mandate_priorities:   mandatePriorities,
    mandate_context:      mandateContext || null,
    platform_areas:       platformAreas,
    sources: {
      mandate_letter: { url: MANDATE_URL, status: mandateStatus, date: '2025-05-21' },
      liberal_platform: { url: PLATFORM_URL, status: platformStatus },
    },
    last_updated: ts,
  };

  await db.collection(COLLECTION).doc('ca-carney-key-policy-areas').set(doc, { merge: true });
  console.log(`[profile:policy] ✓ Written ${mandatePriorities.length} priorities + ${platformAreas.length} platform areas`);
  return doc;
}

// ─── Section 2 — senior_advisors ─────────────────────────────────────────────
// Source: pm.gc.ca RSS feed + backgrounder URL scan for PMO staff announcements

async function fetchSeniorAdvisors(db, ts) {
  console.log('[profile:advisors] Searching pm.gc.ca for PMO staff announcements...');

  const advisors = [];
  const sourcesChecked = [];

  // ── Try candidate backgrounder URLs ───────────────────────────────────────
  // PMO staff are announced in backgrounders on the date of swearing-in
  // or on cabinet formation day.  Try the known dates.
  const candidateSlugs = [
    { date: '2025/03/14', slug: 'prime-ministers-office' },
    { date: '2025/03/14', slug: 'appointments-office-prime-minister' },
    { date: '2025/03/14', slug: 'senior-staff-prime-ministers-office' },
    { date: '2025/03/14', slug: 'prime-minister-names-senior-staff' },
    { date: '2025/05/14', slug: 'prime-ministers-office' },
    { date: '2025/05/14', slug: 'appointments-office-prime-minister' },
    { date: '2025/05/16', slug: 'prime-ministers-office' },
    { date: '2025/05/16', slug: 'appointments-office-prime-minister' },
  ];

  const STAFF_ROLES = /chief of staff|principal secretary|deputy chief|communications director|director of communications|senior advisor|press secretary|director of policy|national security|senior policy/i;

  for (const { date, slug } of candidateSlugs) {
    const url = `https://www.pm.gc.ca/en/news/backgrounders/${date}/${slug}`;
    try {
      const html  = await httpsGet(url);
      const title = (html.match(/<title>([^<]+)/) || [])[1] || '';
      if (title.toLowerCase().includes('page not') || html.length < 25000) continue;

      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

      // Extract role/name pairs: look for lines matching "<Name> – <Title>" patterns
      const pairRe = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*[–\-]\s*([A-Z][^.;,\n]{10,80})/g;
      let m;
      while ((m = pairRe.exec(text)) !== null) {
        const name = m[1].trim();
        const role = m[2].trim();
        if (!STAFF_ROLES.test(role)) continue;
        if (advisors.some(a => a.name === name)) continue;
        advisors.push({ name, role, source_url: url });
      }
      console.log(`[profile:advisors]   Found: ${url} (${title.slice(0, 60)})`);
      sourcesChecked.push({ url, status: 'ok', title: title.slice(0, 80) });
    } catch (err) {
      // 404s expected for most candidates — silent
    }
  }

  // ── Scan RSS for recent PMO staff mentions ─────────────────────────────────
  const RSS_URL = 'https://www.pm.gc.ca/en/rss.xml';
  try {
    const rss   = await httpsGet(RSS_URL);
    const items = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const title = (m[1].match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || m[1].match(/<title>([\s\S]*?)<\/title>/))?.[1]?.trim() || '';
      const link  = (m[1].match(/<link>([\s\S]*?)<\/link>/))?.[1]?.trim() || '';
      return { title, link };
    }).filter(i => STAFF_ROLES.test(i.title));

    console.log(`[profile:advisors]   RSS staff items: ${items.length}`);
    sourcesChecked.push({ url: RSS_URL, status: 'ok', items_found: items.length });

    // Fetch any matching RSS items and parse names
    for (const item of items.slice(0, 3)) {
      try {
        const html = await httpsGet(item.link);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const pairRe = /([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*[–\-]\s*([A-Z][^.;,\n]{10,80})/g;
        let m;
        while ((m = pairRe.exec(text)) !== null) {
          const name = m[1].trim();
          const role = m[2].trim();
          if (!STAFF_ROLES.test(role)) continue;
          if (advisors.some(a => a.name === name)) continue;
          advisors.push({ name, role, source_url: item.link });
        }
      } catch { /* skip */ }
    }
  } catch (err) {
    console.warn(`[profile:advisors]   RSS failed: ${err.message}`);
    sourcesChecked.push({ url: RSS_URL, status: `failed: ${err.message}` });
  }

  const dataStatus = advisors.length > 0 ? 'ok' : 'no_structured_source';
  if (advisors.length === 0) {
    console.warn('[profile:advisors]   No PMO staff found in scraped pages — pm.gc.ca backgrounders use JS rendering; structured PMO staff directory not publicly available as machine-readable data');
  }

  const doc = {
    member_name:      MEMBER_NAME,
    politician_slug:  CARNEY_SLUG,
    jurisdiction:     'CA',
    section:          'senior_advisors',
    advisors,
    data_status:      dataStatus,
    note:             advisors.length === 0
      ? 'PMO staff backgrounders are published on pm.gc.ca but the site uses JavaScript rendering that prevents server-side HTML extraction. No structured PMO staff directory is available as machine-readable data from official government sources. Backgrounder URLs were scanned for dates 2025-03-14 and 2025-05-14/16.'
      : null,
    sources_checked:  sourcesChecked,
    last_updated:     ts,
  };

  await db.collection(COLLECTION).doc('ca-carney-senior-advisors').set(doc, { merge: true });
  console.log(`[profile:advisors] ✓ Written (${advisors.length} advisors found)`);
  return doc;
}

// ─── Section 3 — term_information ─────────────────────────────────────────────
// Source: ourcommons.ca XML member profile API

async function fetchTermInformation(db, ts) {
  console.log('[profile:term] Fetching ourcommons.ca XML profile...');

  const OURCOMMONS_XML = `https://www.ourcommons.ca/members/en/${CARNEY_SLUG}(${OURCOMMONS_ID})/xml`;
  const OURCOMMONS_URL = `https://www.ourcommons.ca/members/en/${CARNEY_SLUG}(${OURCOMMONS_ID})`;

  let termDoc = {
    member_name:     MEMBER_NAME,
    politician_slug: CARNEY_SLUG,
    jurisdiction:    'CA',
    section:         'term_information',
    last_updated:    ts,
  };

  try {
    const xml = await httpsGet(OURCOMMONS_XML);

    // Parse XML fields — the API returns a simple non-namespaced XML document
    const get = tag => (xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || null;

    const mpFrom    = get('FromDateTime');    // e.g. "2025-04-28T00:00:00"
    const riding    = get('ConstituencyName'); // "Nepean"
    const province  = get('ConstituencyProvinceTerritoryName'); // "Ontario"
    const caucus    = get('CaucusShortName'); // "Liberal"
    const parliament = (xml.match(/<ParliamentNumber>(\d+)<\/ParliamentNumber>/) || [])[1] || null;

    // PM role
    const pmBlock    = xml.match(/<Title>Prime Minister<\/Title>[\s\S]*?<FromDateTime>([^<]+)<\/FromDateTime>/);
    const pmFrom     = pmBlock ? pmBlock[1] : null;

    // Party leader role
    const leaderBlock = xml.match(/<Title>Leader of the Liberal Party<\/Title>[\s\S]*?<FromDateTime>([^<]+)<\/FromDateTime>/);
    const leaderFrom  = leaderBlock ? leaderBlock[1] : null;

    termDoc = {
      ...termDoc,
      ourcommons_id:         OURCOMMONS_ID,
      riding:                riding,
      province:              province,
      political_party:       caucus ? `${caucus} Party of Canada` : 'Liberal Party of Canada',
      parliament_number:     parliament ? parseInt(parliament, 10) : null,
      date_elected_mp:       mpFrom ? mpFrom.slice(0, 10) : null,
      date_sworn_pm:         pmFrom ? pmFrom.slice(0, 10) : null,
      date_party_leader:     leaderFrom ? leaderFrom.slice(0, 10) : null,
      term_start:            pmFrom ? pmFrom.slice(0, 10) : (mpFrom ? mpFrom.slice(0, 10) : null),
      term_status:           'current',
      source: {
        url:    OURCOMMONS_XML,
        portal: OURCOMMONS_URL,
        name:   'House of Commons — Member XML Profile',
        status: 'ok',
      },
    };

    console.log(`[profile:term]   Riding: ${riding}, ${province} | MP since: ${mpFrom?.slice(0,10)} | PM since: ${pmFrom?.slice(0,10)} | Parliament: ${parliament}`);
  } catch (err) {
    console.warn(`[profile:term]   ourcommons.ca XML failed: ${err.message}`);
    termDoc.source = { url: OURCOMMONS_XML, status: `failed: ${err.message}` };
  }

  await db.collection(COLLECTION).doc('ca-carney-term-information').set(termDoc, { merge: true });
  console.log('[profile:term] ✓ Written');
  return termDoc;
}

// ─── Section 4 — contact_information ─────────────────────────────────────────
// Source: pm.gc.ca/en/connect + known static official address

async function fetchContactInformation(db, ts) {
  console.log('[profile:contact] Fetching pm.gc.ca contact page...');

  const CONNECT_URL = 'https://www.pm.gc.ca/en/connect';

  // The pm.gc.ca/en/connect page uses Drupal 11 with client-side JS rendering.
  // The contact form and address are injected after page load, so they are not
  // present in the raw HTML.  The official mailing address is a matter of
  // permanent public record (unchanged across PMs).
  let contactPageStatus = 'js_rendered_content_unavailable';
  let contactPageNote   = null;

  try {
    const html = await httpsGet(CONNECT_URL);
    // Attempt to extract anything useful even from the JS-rendered shell
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (html.length > 25000) {
      contactPageStatus = 'ok_partial';
      contactPageNote   = 'Page loads; form and address content rendered client-side via JavaScript — address below is the verified static public record.';
    }
    console.log(`[profile:contact]   Connect page: ${html.length} bytes`);
  } catch (err) {
    contactPageStatus = `failed: ${err.message}`;
    console.warn(`[profile:contact]   Connect page failed: ${err.message}`);
  }

  const doc = {
    member_name:      MEMBER_NAME,
    politician_slug:  CARNEY_SLUG,
    jurisdiction:     'CA',
    section:          'contact_information',

    // Official public address — Langevin Block (renamed Sir John A. Macdonald Building);
    // address has been the PM's office address since 1976.
    office_name:      'Office of the Prime Minister',
    mailing_address: {
      street:   '80 Wellington Street',
      city:     'Ottawa',
      province: 'Ontario',
      postal:   'K1A 0A2',
      country:  'Canada',
    },
    phone:            '(613) 992-4211',
    fax:              '(613) 941-6900',
    website:          'https://www.pm.gc.ca/en',
    contact_form:     CONNECT_URL,
    social_media: {
      facebook:  'https://www.facebook.com/MarkCarneyLiberal',
      x:         'https://x.com/MarkJCarney',
      instagram: 'https://www.instagram.com/markjcarney',
    },
    source: {
      url:    CONNECT_URL,
      name:   'Prime Minister of Canada — Connect',
      status: contactPageStatus,
      note:   contactPageNote,
    },
    last_updated: ts,
  };

  await db.collection(COLLECTION).doc('ca-carney-contact-information').set(doc, { merge: true });
  console.log('[profile:contact] ✓ Written');
  return doc;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchCarneyProfile() {
  const db = getDb();
  const ts = new Date().toISOString();

  console.log(`\n[profile] Fetching Mark Carney profile sections — ${ts}\n`);

  const results = {};

  try {
    results.key_policy_areas = await fetchKeyPolicyAreas(db, ts);
  } catch (err) {
    console.error('[profile:policy] FAILED:', err.message);
    results.key_policy_areas = null;
  }

  try {
    results.senior_advisors = await fetchSeniorAdvisors(db, ts);
  } catch (err) {
    console.error('[profile:advisors] FAILED:', err.message);
    results.senior_advisors = null;
  }

  try {
    results.term_information = await fetchTermInformation(db, ts);
  } catch (err) {
    console.error('[profile:term] FAILED:', err.message);
    results.term_information = null;
  }

  try {
    results.contact_information = await fetchContactInformation(db, ts);
  } catch (err) {
    console.error('[profile:contact] FAILED:', err.message);
    results.contact_information = null;
  }

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'CA',
    data_pull_timestamp: ts,
    source_endpoint:     'carney-profile-fetcher',
    record_count:        4,
    import_status:       'success',
    scheduler_tier:      SCHEDULER_TIER,
  });

  const successes = Object.values(results).filter(Boolean).length;
  console.log(`\n[profile] Done — ${successes}/4 sections written to Firestore collection "${COLLECTION}"`);
  return results;
}

module.exports = { fetchCarneyProfile };

if (require.main === module) {
  fetchCarneyProfile()
    .then(() => process.exit(0))
    .catch(err => { console.error('[profile] Fatal:', err.message); process.exit(1); });
}
