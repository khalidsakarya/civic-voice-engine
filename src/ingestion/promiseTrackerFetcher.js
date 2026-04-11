'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/promises');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) { return (v == null) ? null : String(v).trim() || null; }

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'").replace(/&mdash;/g, '—')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function saveRecords(jurisdiction, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `promises_${jurisdiction}_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ jurisdiction, fetchedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[promises:${jurisdiction}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

function inferCategory(text) {
  const t = (text || '').toLowerCase();
  if (/mental health|wellbeing|wellness/.test(t))              return 'Mental Health';
  if (/housing|home buyer|rent|mortgage|build homes/.test(t))  return 'Housing';
  if (/health|medicare|dental|pharma|hospital|nhs/.test(t))    return 'Healthcare';
  if (/defence|defense|military|nato|armed forces/.test(t))    return 'Defence & Security';
  if (/border|immigration|asylum|migrat/.test(t))              return 'Immigration & Border';
  if (/climate|environment|emission|clean energy|net zero/.test(t)) return 'Environment & Climate';
  if (/energy|oil|gas|nuclear|renewabl/.test(t))               return 'Energy';
  if (/child|family|parent|childcare|education|school/.test(t)) return 'Families & Education';
  if (/indigenous|first nation|aboriginal|reconcil/.test(t))   return 'Indigenous Affairs';
  if (/infrastructure|transport|road|rail|transit/.test(t))    return 'Infrastructure & Transport';
  if (/trade|tariff|export|import|supply chain/.test(t))       return 'Trade & Economy';
  if (/tax|income|cost of living|afford|gst|benefit/.test(t))  return 'Economy & Taxes';
  if (/job|worker|employ|wage|pension|retirement/.test(t))     return 'Jobs & Workers';
  if (/crime|police|justice|law|court|safety/.test(t))         return 'Public Safety & Justice';
  if (/ai|technology|digital|cyber/.test(t))                   return 'Technology & AI';
  return 'Government Policy';
}

// ─── Canada — Liberal Party Platform (liberal.ca) + PM Mandate Letter ─────────

const LIBERAL_PLATFORM_SECTIONS = ['unite', 'secure', 'protect', 'build'];

async function fetchCanadaPromises() {
  const records = [];

  // ── 1. Liberal Party Platform (liberal.ca) ────────────────────────────────
  try {
    console.log('[promises:CA] Fetching Liberal Party platform sections...');
    for (const section of LIBERAL_PLATFORM_SECTIONS) {
      try {
        const resp = await axios.get(`https://liberal.ca/platform/${section}/`, {
          timeout: 25000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
          maxRedirects: 5,
        });
        const html = resp.data;

        // <strong> tags are the specific actionable commitments on this platform
        const seen = new Set();
        const strongs = [...html.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)]
          .map(m => stripHtml(m[1]))
          .filter(t => {
            if (t.length < 25 || t.length > 450) return false;
            // Skip nav/label strongs that aren't promises
            if (/^(Fiscal|Gender|Platform|Learn More|Get Involved|Donate|Follow)/i.test(t)) return false;
            if (seen.has(t)) return false;
            seen.add(t);
            return true;
          });

        for (const commitment of strongs) {
          records.push({
            id:           `ca-lib-${slug(commitment)}`,
            jurisdiction: 'CA',
            leader_name:  'Mark Carney',
            party:        'Liberal Party of Canada',
            promise_text: commitment,
            category:     inferCategory(commitment),
            date_made:    '2025-04-28', // 2025 federal election date
            source_url:   `https://liberal.ca/platform/${section}/`,
            status:       'committed',
            source:       'Liberal Party Platform 2025',
          });
        }
        console.log(`[promises:CA] liberal.ca/platform/${section}/: ${strongs.length} commitments`);
      } catch (err) {
        console.warn(`[promises:CA] liberal.ca platform/${section} error: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[promises:CA] Liberal platform error: ${err.message}`);
  }

  // ── 2. PM Mandate Letter (pm.gc.ca) ─────────────────────────────────────
  try {
    console.log('[promises:CA] Fetching PM mandate letter from pm.gc.ca...');
    const resp = await axios.get(
      'https://www.pm.gc.ca/en/mandate-letters/2025/05/21/mandate-letter',
      {
        timeout: 25000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
        maxRedirects: 5,
      }
    );
    const html = resp.data;

    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
      .map(m => stripHtml(m[1]))
      .filter(p => {
        if (p.length < 80 || p.length > 800) return false;
        // Must contain at least one government commitment signal
        return /\b(government|canada|minister|priority|commit|deliver|must|will build|ensure|protect|invest|reform)\b/i.test(p);
      })
      .slice(0, 20);

    for (const para of paragraphs) {
      records.push({
        id:           `ca-mandate-${slug(para.slice(0, 60))}`,
        jurisdiction: 'CA',
        leader_name:  'Mark Carney',
        party:        'Liberal Party of Canada',
        promise_text: para,
        category:     inferCategory(para),
        date_made:    '2025-05-21',
        source_url:   'https://www.pm.gc.ca/en/mandate-letters/2025/05/21/mandate-letter',
        status:       'in_progress',
        source:       'PM Mandate Letter — May 2025',
      });
    }
    console.log(`[promises:CA] Mandate letter: ${paragraphs.length} commitments`);
  } catch (err) {
    console.warn(`[promises:CA] PM mandate letter error: ${err.message}`);
  }

  return saveRecords('CA', records);
}

// ─── United States — White House Priorities + Federal Register Executive Orders ─

const WH_PRIORITIES = [
  { slug: 'economy',            title: 'Grow The Economy' },
  { slug: 'border-immigration', title: 'Secure the Border' },
  { slug: 'national-security',  title: 'Strengthen National Security' },
  { slug: 'energy',             title: 'Unleash American Energy' },
  { slug: 'tech-innovation',    title: 'Lead the World in AI' },
  { slug: 'doge',               title: 'Reform Government (DOGE)' },
  { slug: 'maha',               title: 'Make America Healthy Again' },
  { slug: 'safe-communities',   title: 'Support Public Safety' },
  { slug: 'faith',              title: 'Protect Religious Liberty' },
];

// Federal Register — EO endpoint (URL-encoded array params)
const FEDERAL_REGISTER_EO_URL =
  'https://www.federalregister.gov/api/v1/documents.json' +
  '?per_page=50&order=newest' +
  '&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order' +
  '&fields%5B%5D=title' +
  '&fields%5B%5D=signing_date' +
  '&fields%5B%5D=html_url' +
  '&fields%5B%5D=executive_order_number' +
  '&fields%5B%5D=abstract' +
  '&fields%5B%5D=agencies';

async function fetchUSPromises() {
  const records = [];

  // ── 1. White House stated priorities ─────────────────────────────────────
  try {
    console.log('[promises:US] Fetching White House priority pages...');
    for (const priority of WH_PRIORITIES) {
      try {
        const resp = await axios.get(
          `https://www.whitehouse.gov/priorities/${priority.slug}/`,
          {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
            maxRedirects: 5,
          }
        );
        const html = resp.data;

        // og:description is the best summary
        const ogDesc = stripHtml(html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] || '');

        // Fallback: first substantive paragraph from the page body
        const mainParas = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
          .map(m => stripHtml(m[1]))
          .filter(p => p.length > 80 && !/menu|search|contact|subscribe|newsletter|privacy/i.test(p));

        const promiseText = ogDesc.length > 50 ? ogDesc : (mainParas[0] || priority.title);

        records.push({
          id:           `us-wh-priority-${slug(priority.slug)}`,
          jurisdiction: 'US',
          leader_name:  'Donald Trump',
          party:        'Republican Party',
          promise_text: promiseText.slice(0, 1000),
          category:     priority.title,
          date_made:    '2025-01-20', // Inauguration
          source_url:   `https://www.whitehouse.gov/priorities/${priority.slug}/`,
          status:       'in_progress',
          source:       'White House — Administration Priorities',
        });
      } catch (err) {
        console.warn(`[promises:US] WH priority ${priority.slug} error: ${err.message}`);
        // Store stub so the collection stays complete
        records.push({
          id:           `us-wh-priority-${slug(priority.slug)}`,
          jurisdiction: 'US',
          leader_name:  'Donald Trump',
          party:        'Republican Party',
          promise_text: priority.title,
          category:     priority.title,
          date_made:    '2025-01-20',
          source_url:   `https://www.whitehouse.gov/priorities/${priority.slug}/`,
          status:       'in_progress',
          source:       'White House — Administration Priorities',
        });
      }
    }
    console.log(`[promises:US] White House priorities: ${WH_PRIORITIES.length} records`);
  } catch (err) {
    console.warn(`[promises:US] White House priorities error: ${err.message}`);
  }

  // ── 2. Executive Orders (Federal Register API) ────────────────────────────
  try {
    console.log('[promises:US] Fetching executive orders from Federal Register...');
    const resp = await axios.get(FEDERAL_REGISTER_EO_URL, { timeout: 30000 });
    const eos  = resp.data?.results || [];

    for (const eo of eos) {
      const title    = safeStr(eo.title);
      const abstract = safeStr(eo.abstract);
      if (!title) continue;

      records.push({
        id:                     `us-eo-${eo.executive_order_number || slug(title)}`,
        jurisdiction:           'US',
        leader_name:            'Donald Trump',
        party:                  'Republican Party',
        promise_text:           abstract && abstract.length > 20 ? abstract : title,
        category:               inferCategory(title + ' ' + (abstract || '')),
        date_made:              eo.signing_date || null,
        executive_order_number: eo.executive_order_number || null,
        source_url:             eo.html_url || null,
        status:                 'enacted',
        source:                 'Federal Register — Executive Orders',
      });
    }
    console.log(`[promises:US] Executive orders: ${eos.length} records`);
  } catch (err) {
    console.warn(`[promises:US] Federal Register EO error: ${err.message}`);
  }

  return saveRecords('US', records);
}

// ─── United Kingdom — King's Speech 2024 + GOV.UK Manifesto Commitments ───────

const KINGS_SPEECH_API = 'https://www.gov.uk/api/content/government/speeches/the-kings-speech-2024';
const GOVUK_MANIFESTO_SEARCH =
  'https://www.gov.uk/api/search.json' +
  '?q=manifesto+commitment' +
  '&count=50' +
  '&fields%5B%5D=title' +
  '&fields%5B%5D=public_timestamp' +
  '&fields%5B%5D=description' +
  '&fields%5B%5D=link';

async function fetchUKPromises() {
  const records = [];

  // ── 1. King's Speech 2024 ─────────────────────────────────────────────────
  try {
    console.log("[promises:UK] Fetching King's Speech 2024 via GOV.UK Content API...");
    const resp = await axios.get(KINGS_SPEECH_API, { timeout: 20000 });
    const body = resp.data?.details?.body || '';
    const date = resp.data?.public_updated_at?.slice(0, 10) || '2024-07-17';

    const paras = [...body.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m, i) => {
      const raw   = m[1];
      const text  = stripHtml(raw).replace(/\[[^\]]+\]/g, '').trim();
      const bills = [...raw.matchAll(/\[([^\]]+)\]/g)].map(b => b[1].trim());
      return { idx: i, text, bills };
    }).filter(p => p.text.length > 50);

    // Skip the opening ceremonial line (first paragraph)
    const commitment_paras = paras.slice(1);

    for (const para of commitment_paras) {
      records.push({
        id:           `uk-kings-speech-2024-para-${para.idx}`,
        jurisdiction: 'UK',
        leader_name:  'Keir Starmer',
        party:        'Labour Party',
        promise_text: para.text,
        legislation:  para.bills.length > 0 ? para.bills : null,
        category:     inferCategory(para.text),
        date_made:    date,
        source_url:   'https://www.gov.uk/government/speeches/the-kings-speech-2024',
        status:       para.bills.length > 0 ? 'in_progress' : 'announced',
        source:       "King's Speech 2024",
      });
    }
    console.log(`[promises:UK] King's Speech: ${commitment_paras.length} commitment paragraphs`);
  } catch (err) {
    console.warn(`[promises:UK] King's Speech error: ${err.message}`);
  }

  // ── 2. GOV.UK search — manifesto commitments ─────────────────────────────
  try {
    console.log('[promises:UK] Fetching manifesto commitments via GOV.UK search API...');
    const resp    = await axios.get(GOVUK_MANIFESTO_SEARCH, { timeout: 30000 });
    const results = resp.data?.results || [];

    const seen = new Set();
    for (const item of results) {
      const title = safeStr(item.title);
      const desc  = safeStr(item.description);
      if (!title || seen.has(title)) continue;
      seen.add(title);

      const dateStr = item.public_timestamp?.slice(0, 10) || null;
      const url     = item.link ? `https://www.gov.uk${item.link}` : null;

      records.push({
        id:           `uk-gov-manifesto-${slug(title)}`,
        jurisdiction: 'UK',
        leader_name:  'Keir Starmer',
        party:        'Labour Party',
        promise_text: desc || title,
        category:     inferCategory(title + ' ' + (desc || '')),
        date_made:    dateStr,
        source_url:   url,
        status:       'in_progress',
        source:       'GOV.UK — Manifesto Commitments',
      });
    }
    console.log(`[promises:UK] GOV.UK manifesto search: ${results.length} records`);
  } catch (err) {
    console.warn(`[promises:UK] GOV.UK manifesto search error: ${err.message}`);
  }

  return saveRecords('UK', records);
}

// ─── Australia — ALP 2025 Policy Pages + PM Media Releases ────────────────────

async function fetchAUPromises() {
  const records = [];

  // ── 1. ALP 2025 policies (alp.org.au) ────────────────────────────────────
  try {
    console.log('[promises:AU] Fetching ALP 2025 policy list from alp.org.au...');
    const listResp = await axios.get('https://alp.org.au/policies', {
      timeout: 25000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
      maxRedirects: 5,
    });
    const listHtml = listResp.data;

    const policyLinks = [...new Set(
      [...listHtml.matchAll(/href="(\/policies-2025\/[^"]+)"/g)].map(m => m[1])
    )];
    console.log(`[promises:AU] Found ${policyLinks.length} ALP policy pages`);

    for (const link of policyLinks) {
      try {
        const pageResp = await axios.get(`https://alp.org.au${link}`, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
          maxRedirects: 5,
        });
        const html    = pageResp.data;
        const title   = stripHtml(html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] || '');
        const desc    = stripHtml(html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] || '');
        const dateStr = html.match(/datetime="([^"T]+)/)?.[1] || '2025';
        if (!title) continue;

        records.push({
          id:           `au-alp-${slug(link)}`,
          jurisdiction: 'AU',
          leader_name:  'Anthony Albanese',
          party:        'Australian Labor Party',
          promise_text: desc || title,
          category:     inferCategory(title + ' ' + (desc || '')),
          date_made:    dateStr,
          source_url:   `https://alp.org.au${link}`,
          status:       'committed',
          source:       'ALP 2025 Federal Election Policy',
        });
      } catch (err) {
        // Individual page fetch failures are non-fatal
      }
    }
    console.log(`[promises:AU] ALP policies fetched: ${records.length} commitments`);
  } catch (err) {
    console.warn(`[promises:AU] ALP policies listing error: ${err.message}`);
  }

  // ── 2. PM of Australia media releases (pm.gov.au) ────────────────────────
  try {
    console.log('[promises:AU] Fetching PM media releases from pm.gov.au...');
    const listResp = await axios.get('https://www.pm.gov.au/media', {
      timeout: 25000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
      maxRedirects: 5,
    });
    const listHtml = listResp.data;

    const mediaLinks = [...new Set(
      [...listHtml.matchAll(/href="(\/media\/[^"]+)"/g)].map(m => m[1])
    )].slice(0, 20);

    for (const link of mediaLinks) {
      // Skip press conferences, doorstops, interviews — not policy commitments
      if (/doorstop|interview|press-conference|television|question-and-answer|doorstop/i.test(link)) continue;

      try {
        const pageResp = await axios.get(`https://www.pm.gov.au${link}`, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
          maxRedirects: 5,
        });
        const html    = pageResp.data;
        const h1      = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '');
        const ogTitle = stripHtml(html.match(/property="og:title"\s+content="([^"]+)"/)?.[1] || '');
        const desc    = stripHtml(html.match(/property="og:description"\s+content="([^"]+)"/)?.[1] || '');
        const title   = h1 || ogTitle;
        const dateStr = html.match(/datetime="([^"T]+)/)?.[1]?.trim() || null;
        if (!title || title.length < 5) continue;

        records.push({
          id:           `au-pm-${slug(link)}`,
          jurisdiction: 'AU',
          leader_name:  'Anthony Albanese',
          party:        'Australian Labor Party',
          promise_text: desc || title,
          category:     inferCategory(title + ' ' + (desc || '')),
          date_made:    dateStr,
          source_url:   `https://www.pm.gov.au${link}`,
          status:       'announced',
          source:       'PM of Australia — Media Release',
        });
      } catch { /* skip failed fetches */ }
    }

    const pmCount = records.filter(r => r.source.includes('Media Release')).length;
    console.log(`[promises:AU] PM media releases: ${pmCount} announcements`);
  } catch (err) {
    console.warn(`[promises:AU] PM media releases error: ${err.message}`);
  }

  return saveRecords('AU', records);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllPromises() {
  console.log('\n[promises] Starting promise tracker fetch (CA / US / UK / AU)...');
  const results = await Promise.allSettled([
    fetchCanadaPromises(),
    fetchUSPromises(),
    fetchUKPromises(),
    fetchAUPromises(),
  ]);

  const [ca, us, uk, au] = results.map(r => r.status === 'fulfilled' ? r.value : 0);
  const total = ca + us + uk + au;
  console.log(`\n[promises] Done — CA:${ca} US:${us} UK:${uk} AU:${au} (total: ${total})`);
  return total;
}

module.exports = {
  fetchAllPromises,
  fetchCanadaPromises,
  fetchUSPromises,
  fetchUKPromises,
  fetchAUPromises,
};

if (require.main === module) {
  fetchAllPromises()
    .then(n => { console.log(`\n[promises] ${n} total records saved.`); process.exit(0); })
    .catch(err => { console.error('[promises] Fatal:', err.message); process.exit(1); });
}
