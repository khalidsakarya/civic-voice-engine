'use strict';

require('dotenv').config();
const axios = require('axios');
const { getDb } = require('../firebase/client');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html, application/json, */*',
};

const TRUMP_NAME    = 'Donald Trump';
const TRUMP_SLUG    = 'donald-trump';
const CARNEY_NAME   = 'Mark Carney';
const CARNEY_SLUG   = 'mark-carney';
const STARMER_NAME  = 'Keir Starmer';
const STARMER_SLUG  = 'keir-starmer';
const ALBANESE_NAME = 'Anthony Albanese';
const ALBANESE_SLUG = 'anthony-albanese';

const TRUMP_START   = '2025-01-20';
const CARNEY_START  = '2025-03-14';
const STARMER_START = '2024-07-05';
const ALBANESE_START = '2022-05-23';

const COLLECTION = 'executive_actions';
const TIMEOUT    = 25000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

async function batchSet(db, docs) {
  const SIZE = 400;
  let written = 0;
  for (let i = 0; i < docs.length; i += SIZE) {
    const batch = db.batch();
    docs.slice(i, i + SIZE).forEach(({ id, data }) =>
      batch.set(db.collection(COLLECTION).doc(sanitizeId(id)), data),
    );
    await batch.commit();
    written += Math.min(SIZE, docs.length - i);
  }
  return written;
}

async function clearSlug(db, slug) {
  const snap = await db.collection(COLLECTION).where('politician_slug', '==', slug).get();
  if (snap.empty) return 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`  Cleared ${snap.size} existing ${slug} docs`);
  return snap.size;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Build a Federal Register URL with per_page=20 and ISO date filter
function frUrl(type, page) {
  const base = 'https://www.federalregister.gov/api/v1/documents.json';
  const qs = [
    'conditions%5Btype%5D%5B%5D=PRESDOCU',
    `conditions%5Bpresidential_document_type%5D%5B%5D=${encodeURIComponent(type)}`,
    `conditions%5Bsigning_date%5D%5Bgte%5D=${TRUMP_START}`,
    'per_page=20',
    'order=newest',
    'fields%5B%5D=title',
    'fields%5B%5D=signing_date',
    'fields%5B%5D=executive_order_number',
    'fields%5B%5D=html_url',
    'fields%5B%5D=abstract',
    `page=${page}`,
  ].join('&');
  return `${base}?${qs}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUMP — federalregister.gov
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTrumpExecutiveActions() {
  console.log('[trump:exec] Fetching Federal Register presidential documents...');
  const ts   = new Date().toISOString();
  const docs = [];

  for (const frType of ['executive_order', 'proclamation']) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      let data = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          const r = await axios.get(frUrl(frType, page), { timeout: TIMEOUT, headers: BROWSER_HEADERS });
          data = r.data;
          break;
        } catch (e) {
          console.warn(`  [trump] ${frType} page ${page} attempt ${attempt} error: ${e.response?.status ?? e.code}`);
          if (attempt < 4) await sleep(attempt * 1500);
          else if (page === 1) { console.warn('  [trump] giving up on first page'); break; }
        }
      }
      if (!data) { if (page > 1) break; else { page++; continue; } }

      if (page === 1) {
        totalPages = data.total_pages ?? 1;
        console.log(`  [trump] ${frType}: ${data.count} docs, ${totalPages} pages`);
      }

      for (const item of data.results ?? []) {
        const eoNum = item.executive_order_number;
        const idSuffix = eoNum
          ? `eo${eoNum}`
          : `${sanitizeId(item.signing_date ?? 'nd')}-${sanitizeId((item.title ?? '').slice(0, 40))}`;

        docs.push({
          id: `us-trump-exec-${frType === 'executive_order' ? 'eo' : 'proc'}-${idSuffix}`,
          data: {
            member_name:     TRUMP_NAME,
            politician_slug: TRUMP_SLUG,
            jurisdiction:    'US',
            title:           item.title ?? null,
            date:            item.signing_date ?? null,
            type:            frType === 'executive_order' ? 'Executive Order' : 'Presidential Proclamation',
            description:     item.abstract ?? null,
            source_url:      item.html_url ?? null,
            source_name:     'Federal Register',
            last_updated:    ts,
          },
        });
      }

      page++;
      if (page <= totalPages) await sleep(500);
    }
  }

  console.log(`[trump:exec] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARNEY — Canada Gazette Part II (SORs / Statutory Orders)
// ─────────────────────────────────────────────────────────────────────────────

// Returns all gazette issue dates (YYYY-MM-DD) for a given year
async function gazetteIssues(year) {
  const r = await axios.get(`https://www.gazette.gc.ca/rp-pr/p2/${year}/index-eng.html`, {
    timeout: TIMEOUT,
    headers: BROWSER_HEADERS,
  });
  return (r.data.match(new RegExp(`\\/rp-pr\\/p2\\/${year}\\/(\\d{4}-\\d{2}-\\d{2})\\/html\\/index-eng\\.html`, 'g')) ?? [])
    .map(u => u.match(/(\d{4}-\d{2}-\d{2})/)?.[1])
    .filter(Boolean);
}

// Parse SOR/SI entries from a Gazette Part II issue index page
function parseSorIndex(html, issueDate) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  const entries = [];
  // Format: [title] — [enabling act] (SOR|SI)/YYYY-NNN DD/MM/YY [new|erratum]
  const re = /([^—]{5,150})—([^(S]{3,120}?)(SOR|SI)\/(\d{4})-(\d+)\s+(\d{2}\/\d{2}\/\d{2})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, rawTitle, , type, year, num, rawDate] = m;
    const title    = rawTitle.trim().replace(/^[,;.\s]+|[,;.\s]+$/g, '');
    const sorNum   = `${type}/${year}-${num}`;
    const [d, mo, yr] = rawDate.split('/');
    const date     = `20${yr}-${mo}-${d}`;

    // Only Carney-era items
    if (date < CARNEY_START) continue;

    const sorN     = parseInt(num, 10);
    const sorFile  = `sor-dors${sorN}`;
    entries.push({
      sorNum,
      title,
      date,
      issueDate,
      sourceUrl: `https://www.gazette.gc.ca/rp-pr/p2/${issueDate.slice(0, 4)}/${issueDate}/html/${sorFile}-eng.html`,
    });
  }
  return entries;
}

async function fetchCarneyExecutiveActions() {
  console.log('[carney:exec] Fetching Canada Gazette Part II SORs...');
  const ts   = new Date().toISOString();
  const docs = [];

  // Collect issue dates from 2025 and 2026
  const allIssues = [];
  for (const year of [2025, 2026]) {
    try {
      const issues = await gazetteIssues(year);
      // Filter to Carney era
      allIssues.push(...issues.filter(d => d >= CARNEY_START.slice(0, 7)));
    } catch (e) {
      console.warn(`  [carney] Gazette ${year} index error: ${e.message?.slice(0, 60)}`);
    }
  }
  console.log(`  [carney] ${allIssues.length} Gazette Part II issues to scan`);

  for (const issueDate of allIssues) {
    try {
      const r = await axios.get(
        `https://www.gazette.gc.ca/rp-pr/p2/${issueDate.slice(0, 4)}/${issueDate}/html/index-eng.html`,
        { timeout: TIMEOUT, headers: BROWSER_HEADERS },
      );
      const entries = parseSorIndex(r.data, issueDate);

      for (const e of entries) {
        docs.push({
          id: `ca-carney-exec-${sanitizeId(e.sorNum)}`,
          data: {
            member_name:     CARNEY_NAME,
            politician_slug: CARNEY_SLUG,
            jurisdiction:    'CA',
            title:           e.title,
            date:            e.date,
            type:            e.sorNum.startsWith('SOR') ? 'Statutory Order and Regulation' : 'Statutory Instrument',
            description:     `${e.sorNum} — published in Canada Gazette Part II, ${e.issueDate}`,
            source_url:      e.sourceUrl,
            source_name:     'Canada Gazette, Part II',
            last_updated:    ts,
          },
        });
      }

      await sleep(200);
    } catch (e) {
      console.warn(`  [carney] Issue ${issueDate} error: ${e.message?.slice(0, 60)}`);
    }
  }

  console.log(`[carney:exec] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// STARMER — legislation.gov.uk UKSI Atom feed
// ─────────────────────────────────────────────────────────────────────────────

function parseAtomEntries(xml) {
  const entries = [];
  const re = /<entry>([\s\S]+?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block   = m[1];
    const title   = block.match(/<title[^>]*>([^<]+)/)?.[1]?.trim() ?? null;
    const link    = block.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? null;
    const updated = block.match(/<updated>([^<]+)/)?.[1]?.slice(0, 10) ?? null;
    const summary = block.match(/<summary[^>]*>([^<]+)/)?.[1]?.trim() ?? null;
    // Extract year/number from link e.g. http://www.legislation.gov.uk/id/uksi/2026/454
    const match   = link?.match(/uksi\/(\d{4})\/(\d+)/);
    if (title && link && updated && match) {
      entries.push({
        title,
        date:    updated,
        year:    match[1],
        number:  match[2],
        summary,
        sourceUrl: `https://www.legislation.gov.uk/uksi/${match[1]}/${match[2]}`,
      });
    }
  }
  return entries;
}

async function fetchStarmerExecutiveActions() {
  console.log('[starmer:exec] Fetching legislation.gov.uk UKSI Atom feed...');
  const ts   = new Date().toISOString();
  const docs = [];
  const PER_PAGE = 50;
  const MAX_PAGES = 40; // ~2000 SIs; Starmer era ~21 months as of Apr 2026

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const url = `https://www.legislation.gov.uk/uksi/data.feed?made-date-start=${STARMER_START}&sort=made-desc&results-count=${PER_PAGE}&page=${page}`;
      const r   = await axios.get(url, { timeout: TIMEOUT, headers: BROWSER_HEADERS });
      const entries = parseAtomEntries(r.data);

      for (const e of entries) {
        docs.push({
          id: `uk-starmer-exec-si-${e.year}-${e.number}`,
          data: {
            member_name:     STARMER_NAME,
            politician_slug: STARMER_SLUG,
            jurisdiction:    'UK',
            title:           e.title,
            date:            e.date,
            type:            'Statutory Instrument',
            description:     e.summary ?? null,
            source_url:      e.sourceUrl,
            source_name:     'legislation.gov.uk',
            last_updated:    ts,
          },
        });
      }

      if (entries.length < PER_PAGE) break; // last page
      await sleep(200);
    } catch (e) {
      console.warn(`  [starmer] Page ${page} error: ${e.message?.slice(0, 80)}`);
      if (page > 3) break;
    }
  }

  console.log(`[starmer:exec] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// ALBANESE — legislation.gov.au OData API (Versions entityset)
// ─────────────────────────────────────────────────────────────────────────────

const AU_API = 'https://api.prod.legislation.gov.au/v1';
const AU_HEADERS = {
  'User-Agent': BROWSER_HEADERS['User-Agent'],
  Accept: 'application/json',
  'OData-MaxVersion': '4.0',
};

async function fetchAuVersions(prefix) {
  const items = [];
  const TOP   = 50;
  let skip    = 0;

  while (true) {
    const url = `${AU_API}/Versions?$filter=startswith(registerId,'${prefix}')&$top=${TOP}&$skip=${skip}&$orderby=registerId`;
    try {
      const r = await axios.get(url, { timeout: TIMEOUT, headers: AU_HEADERS });
      const batch = r.data?.value ?? [];
      items.push(...batch);
      if (batch.length < TOP) break;
      skip += TOP;
      await sleep(200);
    } catch (e) {
      console.warn(`  [albanese] OData ${prefix} skip=${skip} error: ${e.message?.slice(0, 80)}`);
      break;
    }
  }
  return items;
}

async function fetchAlbaneseExecutiveActions() {
  console.log('[albanese:exec] Fetching legislation.gov.au OData (Acts + Instruments)...');
  const ts   = new Date().toISOString();
  const docs = [];

  // Acts: C2025A, C2026A (Albanese was PM until ~2025, but listed all of his era)
  // Legislative Instruments: C2025L, C2026L
  const prefixes = [
    { prefix: 'C2022A', type: 'Act' },
    { prefix: 'C2023A', type: 'Act' },
    { prefix: 'C2024A', type: 'Act' },
    { prefix: 'C2025A', type: 'Act' },
    { prefix: 'C2022L', type: 'Legislative Instrument' },
    { prefix: 'C2023L', type: 'Legislative Instrument' },
    { prefix: 'C2024L', type: 'Legislative Instrument' },
    { prefix: 'C2025L', type: 'Legislative Instrument' },
  ];

  for (const { prefix, type } of prefixes) {
    try {
      const versions = await fetchAuVersions(prefix);
      console.log(`  [albanese] ${prefix}: ${versions.length} versions`);

      for (const v of versions) {
        if (!v.name || !v.registerId) continue;
        // Filter to only current/latest versions to avoid duplicates
        if (!v.isLatest && !v.isCurrent) continue;

        const startDate = v.start?.slice(0, 10) ?? null;
        if (startDate && startDate < ALBANESE_START) continue;

        docs.push({
          id: `au-albanese-exec-${v.registerId}`,
          data: {
            member_name:     ALBANESE_NAME,
            politician_slug: ALBANESE_SLUG,
            jurisdiction:    'AU',
            title:           v.name,
            date:            startDate,
            type,
            description:     `${v.status ?? ''} ${type} — ${v.registerId}`.trim(),
            source_url:      `https://www.legislation.gov.au/Details/${v.registerId}`,
            source_name:     'Federal Register of Legislation (Australia)',
            last_updated:    ts,
          },
        });
      }
    } catch (e) {
      console.warn(`  [albanese] prefix ${prefix} error: ${e.message?.slice(0, 80)}`);
    }
  }

  console.log(`[albanese:exec] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function fetchExecutiveActions() {
  const db = getDb();

  // Run Carney/Starmer/Albanese in parallel (different hosts), then Trump after
  // (Federal Register rate-limits when hit simultaneously with other fetches)
  console.log('[exec:actions] Fetching Carney, Starmer, Albanese in parallel...');
  const [carney, starmer, albanese] = await Promise.allSettled([
    fetchCarneyExecutiveActions(),
    fetchStarmerExecutiveActions(),
    fetchAlbaneseExecutiveActions(),
  ]).then(results =>
    results.map((r, i) => {
      const label = ['carney', 'starmer', 'albanese'][i];
      if (r.status === 'rejected') {
        console.error(`[exec:actions] ${label} failed:`, r.reason?.message);
        return [];
      }
      return r.value;
    }),
  );

  console.log('[exec:actions] Fetching Trump (Federal Register)...');
  let trump = [];
  try { trump = await fetchTrumpExecutiveActions(); }
  catch (e) { console.error('[exec:actions] trump failed:', e.message); }

  console.log('\n[exec:actions] Counts:', {
    trump:    trump.length,
    carney:   carney.length,
    starmer:  starmer.length,
    albanese: albanese.length,
  });

  let totalWritten = 0;
  for (const [slug, docs] of [
    [TRUMP_SLUG,    trump],
    [CARNEY_SLUG,   carney],
    [STARMER_SLUG,  starmer],
    [ALBANESE_SLUG, albanese],
  ]) {
    await clearSlug(db, slug);
    totalWritten += await batchSet(db, docs);
  }

  console.log(`\n[exec:actions] ✓ ${totalWritten} total documents written`);
  return totalWritten;
}

module.exports = { fetchExecutiveActions };

if (require.main === module) {
  fetchExecutiveActions()
    .then(n => { console.log(`Done — ${n} documents written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
