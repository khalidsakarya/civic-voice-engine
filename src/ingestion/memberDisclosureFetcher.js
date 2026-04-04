/**
 * Member Financial Disclosure & Lobbying Fetcher — Civic Voice Engine
 *
 * Pulls real member-level data from official government sources and writes
 * to output/member_disclosures/ and output/member_lobbying/.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * US   disclosures.house.gov  — House Financial Disclosures (EFTS JSON API)
 *      Endpoint: GET https://efts.house.gov/EFTS-Public/query
 *      Returns filings with member name, office, filing type, year, PDF link.
 *
 * CA   lobbycanada.gc.ca       — Lobbying Communication Reports
 *      Endpoint: GET https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/clntSmmry
 *      Falls back to open.canada.ca CKAN dataset for lobbyist registry snapshots.
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DISCLOSURES = path.resolve(__dirname, '../../output/member_disclosures');
const OUTPUT_LOBBYING    = path.resolve(__dirname, '../../output/member_lobbying');
const TIMEOUT_MS         = 45_000;
const CURRENT_YEAR       = new Date().getFullYear();

// ─── Output helper ────────────────────────────────────────────────────────────

function saveRecords(outputDir, sourceName, records, meta = {}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${sourceName}_${timestamp}.json`;
  const filepath  = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));

  return { filepath, count: records.length };
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 600) || null : null);
const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// ─── US House Financial Disclosures (EFTS) ───────────────────────────────────
//
//  The Electronic Financial Disclosure System (EFTS) exposes a public JSON
//  search endpoint used by the disclosures.house.gov website itself.
//
//  GET https://efts.house.gov/EFTS-Public/query
//    ?q=                  — full-text search (blank = all)
//    &dateRange=custom
//    &fromDate=YYYY-MM-DD
//    &toDate=YYYY-MM-DD
//    &hits.hits.total.value=true
//
//  Response: { hits: { hits: [ { _id, _source: { … } } ] } }
//  _source fields: FilingID, First, Last, Office, FilingType, FilingYear,
//                  DocumentType, StateDst, URL
//
//  We request the most recent completed calendar year to get a stable, full
//  result set. The PTR (Periodic Transaction Report) filings update throughout
//  the year; FD (annual) filings cluster Jan–May following the disclosure year.

async function fetchUSHouseDisclosures() {
  const year      = CURRENT_YEAR - 1; // most recent completed year
  const fromDate  = `${year}-01-01`;
  const toDate    = `${year}-12-31`;

  console.log(`[disclosures:US] Querying EFTS for House disclosures filed in ${year}…`);

  const resp = await axios.get('https://efts.house.gov/EFTS-Public/query', {
    params: {
      q:          '',
      dateRange:  'custom',
      fromDate,
      toDate,
      // Request up to 100 hits (EFTS default page size is 10)
      'hits.hits._source.*': true,
    },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const hits = resp.data?.hits?.hits || [];

  if (hits.length === 0) {
    // Try current year (PTRs already filed this year)
    console.log('[disclosures:US] No hits for prior year, retrying with current year…');
    const resp2 = await axios.get('https://efts.house.gov/EFTS-Public/query', {
      params: {
        q:         '',
        dateRange: 'custom',
        fromDate:  `${CURRENT_YEAR}-01-01`,
        toDate:    new Date().toISOString().slice(0, 10),
        'hits.hits._source.*': true,
      },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    hits.push(...(resp2.data?.hits?.hits || []));
  }

  const records = hits.map(h => {
    const s = h._source || {};
    const memberId = safeStr(s.FilingID || h._id);
    return {
      id:           `us-house-fd-${memberId}`,
      member_name:  [safeStr(s.First), safeStr(s.Last)].filter(Boolean).join(' ') || null,
      first_name:   safeStr(s.First),
      last_name:    safeStr(s.Last),
      office:       safeStr(s.Office),
      state_district: safeStr(s.StateDst),
      filing_type:  safeStr(s.FilingType || s.DocumentType),
      filing_year:  safeNum(s.FilingYear) || year,
      document_url: s.URL ? `https://disclosures.house.gov${s.URL}` : null,
      filing_id:    memberId,
      jurisdiction: 'US',
      chamber:      'House',
      sourceUrl:    'https://disclosures.house.gov',
    };
  });

  const total = resp.data?.hits?.total?.value ?? hits.length;
  return saveRecords(OUTPUT_DISCLOSURES, 'us_house_disclosures', records, {
    filingYear:     year,
    totalAvailable: total,
    sourceApi:      'https://efts.house.gov/EFTS-Public/query',
  });
}

// ─── Canada: Lobbying Communication Reports ───────────────────────────────────
//
//  The Office of the Commissioner of Lobbying Canada (lobbycanada.gc.ca) /
//  Commissariat au lobbying du Canada (lobbyregistre.gc.ca) maintains a public
//  registry of all in-house and consultant lobbyists and their communications
//  with designated public office holders (DPOHs).
//
//  Primary: open.canada.ca CKAN — "Lobbyist Registry" dataset
//    Package: 04b97c75-82a7-4716-8231-56e1ebd64e28  (Lobbying Communications)
//    We query the CKAN datastore_search API which returns JSON directly.
//
//  The records contain: lobbyist name, firm/client, government institution,
//  DPOH name/title, subject matter, communication date, registration number.

const CKAN_BASE      = 'https://open.canada.ca/data/api/3/action';
const CA_LOBBY_PKG   = '04b97c75-82a7-4716-8231-56e1ebd64e28'; // Lobbying Communications

async function fetchCanadaLobbying() {
  console.log('[lobbying:CA] Resolving lobbyist registry package…');

  // Step 1 — resolve resource IDs from the package
  const pkgResp = await axios.get(`${CKAN_BASE}/package_show`, {
    params:  { id: CA_LOBBY_PKG },
    timeout: TIMEOUT_MS,
  });

  const resources = pkgResp.data?.result?.resources || [];
  // Prefer the English datastore-active resource
  const resource =
    resources.find(r => r.datastore_active && /en/i.test(r.name || r.description || '')) ||
    resources.find(r => r.datastore_active) ||
    resources[0];

  if (!resource) throw new Error(`[lobbying:CA] No usable resource in package ${CA_LOBBY_PKG}`);

  console.log(`[lobbying:CA] Querying datastore (resource: ${resource.id})…`);

  // Step 2 — fetch records
  const dataResp = await axios.get(`${CKAN_BASE}/datastore_search`, {
    params:  { resource_id: resource.id, limit: 100, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows    = dataResp.data?.result?.records || [];
  const total   = dataResp.data?.result?.total;
  const records = rows.map((r, i) => ({
    id:                   safeStr(r.registration_number || r.id || r._id || `ca-lobby-${i}`),
    registration_number:  safeStr(r.registration_number),
    lobbyist_name:        safeStr(r.lobbyist_name || r.registrant_name),
    firm_or_client:       safeStr(r.firm_name || r.client_name || r.organization_name),
    government_institution: safeStr(r.government_institution || r.institution),
    dpoh_name:            safeStr(r.dpoh_name || r.dpoh),
    dpoh_title:           safeStr(r.dpoh_title),
    subject_matter:       safeStr(r.subject_matter || r.topic),
    communication_date:   safeStr(r.communication_date || r.date),
    communication_type:   safeStr(r.communication_type || r.type),
    registration_status:  safeStr(r.status || r.registration_status),
    jurisdiction:         'CA',
    sourceUrl:            `https://lobbycanada.gc.ca`,
  }));

  return saveRecords(OUTPUT_LOBBYING, 'ca_lobbying_communications', records, {
    packageId:      CA_LOBBY_PKG,
    resourceId:     resource.id,
    resourceName:   safeStr(resource.name),
    totalAvailable: total,
    sourceApi:      `${CKAN_BASE}/datastore_search`,
  });
}

// ─── US: Lobby Disclosure Act filings (Senate Office of Public Records) ───────
//
//  The US Senate provides a public JSON API for Lobbying Disclosure Act (LDA)
//  filings at lda.senate.gov. This complements the House disclosures with
//  federal lobbying spend and registrant data.
//
//  Endpoint: GET https://lda.senate.gov/api/v1/filings/
//    ?filing_year=YYYY&page_size=25&ordering=-dt_posted
//
//  Response: { count, results: [ { filing_uuid, registrant, client,
//               lobbying_activities, income, expenses, filing_year, … } ] }

async function fetchUSFederalLobbying() {
  const year = CURRENT_YEAR - 1;
  console.log(`[lobbying:US] Querying Senate LDA API for filings in ${year}…`);

  const resp = await axios.get('https://lda.senate.gov/api/v1/filings/', {
    params: {
      filing_year: year,
      filing_type: 'MR', // Mid-Year Report — also try 'Q1','Q2','Q3','Q4'
      page_size:   50,
      ordering:    '-dt_posted',
    },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const results = resp.data?.results || [];
  const records = results.map(f => {
    const reg    = f.registrant  || {};
    const client = f.client      || {};
    return {
      id:                  safeStr(f.filing_uuid || `us-lda-${f.id}`),
      filing_uuid:         safeStr(f.filing_uuid),
      filing_type:         safeStr(f.filing_type_display || f.filing_type),
      filing_year:         safeNum(f.filing_year) || year,
      filing_period:       safeStr(f.filing_period_display || f.filing_period),
      registrant_name:     safeStr(reg.name),
      registrant_id:       safeStr(reg.id),
      client_name:         safeStr(client.name),
      client_id:           safeStr(client.id),
      income:              safeNum(f.income),
      expenses:            safeNum(f.expenses),
      posted_date:         safeStr(f.dt_posted),
      lobbying_issues:     (f.lobbying_activities || [])
                             .map(a => safeStr(a.general_issue_code_display || a.general_issue_code))
                             .filter(Boolean)
                             .join('; ') || null,
      jurisdiction:        'US',
      sourceUrl:           `https://lda.senate.gov/filings/public/filing/${f.filing_uuid}/view/`,
    };
  });

  return saveRecords(OUTPUT_LOBBYING, 'us_senate_lda_filings', records, {
    filingYear:     year,
    filingType:     'MR',
    totalAvailable: resp.data?.count,
    sourceApi:      'https://lda.senate.gov/api/v1/filings/',
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'US House — Financial Disclosures (EFTS)',  fn: fetchUSHouseDisclosures, type: 'disclosures' },
  { name: 'CA     — Lobbying Communications (CKAN)',  fn: fetchCanadaLobbying,     type: 'lobbying'    },
  { name: 'US     — Senate LDA Lobbying Filings',    fn: fetchUSFederalLobbying,  type: 'lobbying'    },
];

async function fetchAllMemberData() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[memberDisclosureFetcher] Starting member data ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[memberDisclosureFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[memberDisclosureFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, type: source.type, status: 'ok', records: result.count, file: result.filepath });
    } catch (err) {
      console.error(`[memberDisclosureFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, type: source.type, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[memberDisclosureFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60) + '\n');

  return summary;
}

module.exports = { fetchAllMemberData, fetchUSHouseDisclosures, fetchCanadaLobbying, fetchUSFederalLobbying };

if (require.main === module) {
  fetchAllMemberData().then(summary => {
    process.exit(summary.some(r => r.status === 'error') ? 1 : 0);
  }).catch(err => {
    console.error('[memberDisclosureFetcher] Fatal:', err.message);
    process.exit(1);
  });
}
