/**
 * Government Expense & Waste Tracker — Civic Voice Engine
 *
 * Fetches raw expense/spending/contract records from four government open-data
 * APIs and writes them to output/expenses/<jurisdiction>_<source>_<timestamp>.json
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * CA  open.canada.ca  — Estimates & Expenditure Budgetary Authorities (CKAN)
 *                        Dataset: a35cf382-690c-4221-a971-cf0fd189a46f
 *                        Resource: f87c5f47-dd85-4c6f-b85e-2c59ccf8d84c
 *
 * US  api.usaspending.gov — Federal Account Spending (POST /api/v2/spending/)
 *
 * UK  contractsfinder.service.gov.uk — Contract Notices (POST REST v2)
 *
 * AU  data.gov.au — 2019-20 Australian Government Contract Data (CKAN datastore)
 *                    Resource: 06439664-bbcf-4118-a604-164006bffcaa
 */

require('dotenv').config();
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');

const OUTPUT_DIR   = path.resolve(__dirname, '../../output/expenses');
const TIMEOUT_MS   = 45000;
const CURRENT_YEAR = new Date().getFullYear();

// ─── Output helper ────────────────────────────────────────────────────────────

function saveExpenses(sourceName, jurisdiction, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${jurisdiction}_${sourceName}_${timestamp}.json`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  const payload = {
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    type:         'expense',
    jurisdiction,
    totalRecords: records.length,
    ...meta,
    records,
  };

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  return { filepath, count: records.length };
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

const safeStr = (v) => (v != null ? String(v).trim().slice(0, 500) || null : null);
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// ─── Canada: Estimates & Expenditure Budgetary Authorities ───────────────────
//
//  Step 1: package_show to confirm the package and resolve resource IDs.
//  Step 2: datastore_search on the first active resource.
//
//  Endpoint:  https://open.canada.ca/data/api/3/action/package_show
//  Dataset:   a35cf382-690c-4221-a971-cf0fd189a46f
//  Fields:    fy_ef, organization, estimates_document, vote_number,
//             vote_type, authorities

async function fetchCanadaExpenses() {
  const PACKAGE_ID  = 'a35cf382-690c-4221-a971-cf0fd189a46f';
  const RESOURCE_ID = 'f87c5f47-dd85-4c6f-b85e-2c59ccf8d84c'; // Expenditure Budgetary Authorities (active)

  console.log('[expense:CA] Step 1/2 — resolving package metadata...');
  const pkgResp = await axios.get('https://open.canada.ca/data/api/3/action/package_show', {
    params:  { id: PACKAGE_ID },
    timeout: TIMEOUT_MS,
  });

  const pkg       = pkgResp.data?.result || {};
  const resources = pkg.resources || [];
  const resource  = resources.find(r => r.id === RESOURCE_ID) || resources.find(r => r.datastore_active) || resources[0];

  if (!resource) throw new Error('No usable resource found in CA package');

  console.log(`[expense:CA] Step 2/2 — querying datastore (resource: ${resource.id})...`);
  const dataResp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
    params:  { resource_id: resource.id, limit: 20, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows    = dataResp.data?.result?.records || [];
  const records = rows.map((r, i) => ({
    id:          safeStr(r._id || `ca-${i}`),
    title:       safeStr(r.estimates_document || r.vote_type),
    date:        safeStr(r.fy_ef),
    amount:      safeNum(r.authorities),
    recipient:   null,
    category:    safeStr(r.vote_type || 'budgetary_authority'),
    department:  safeStr(r.organization),
    vote_number: safeStr(r.vote_number),
    jurisdiction: 'CA',
    sourceUrl:   `https://open.canada.ca/data/en/dataset/${PACKAGE_ID}`,
  }));

  return saveExpenses('canada_budgetary_authorities', 'CA', records, {
    packageId:      PACKAGE_ID,
    resourceId:     resource.id,
    resourceName:   safeStr(resource.name),
    totalAvailable: dataResp.data?.result?.total,
  });
}

// ─── USA: USASpending.gov — Federal Account Spending ─────────────────────────
//
//  Endpoint:  POST https://api.usaspending.gov/api/v2/spending/
//  Body:      { type: 'federal_account', filters: { fy, period } }
//  Fields:    amount, id, account_number, name (account name), code
//
//  fiscal_period: Oct=1 … Sep=12; current FY starts Oct of previous calendar year.

async function fetchUSExpenses() {
  // USASpending typically lags 1-2 months — try periods backwards from the
  // most recently completed one until the API accepts the submission window.
  const now       = new Date();
  const month     = now.getMonth() + 1;
  const rawPeriod = month >= 10 ? month - 9 : month + 3; // Oct→1 … Sep→12
  const fy        = month >= 10 ? now.getFullYear() + 1 : now.getFullYear();

  let resp = null;
  let period = rawPeriod - 1 || 12; // start one period back
  for (let attempt = 0; attempt < 6; attempt++, period--) {
    if (period < 1) period = 12;
    console.log(`[expense:US] Trying FY${fy} period ${period}...`);
    try {
      resp = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'federal_account', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      break; // found a valid period
    } catch (err) {
      if (err.response?.status === 400) continue; // period not yet available
      throw err; // unexpected error
    }
  }
  if (!resp) throw new Error(`No available submission period found for FY${fy}`);

  const results = resp.data?.results || [];
  const records = results.map((r, i) => ({
    id:           safeStr(r.id || r.account_number || `us-${i}`),
    title:        safeStr(r.name),
    date:         safeStr(resp.data?.end_date || String(fy)),
    amount:       safeNum(r.amount),
    recipient:    null,
    category:     'federal_account',
    department:   safeStr(r.name),
    account_code: safeStr(r.account_number || r.code),
    jurisdiction: 'US',
    sourceUrl:    'https://api.usaspending.gov',
  }));

  return saveExpenses('us_federal_spending', 'US', records, {
    fiscalYear:    fy,
    fiscalPeriod:  period,
    endDate:       resp.data?.end_date,
    totalSpending: resp.data?.total,
    totalResults:  resp.data?.page_metadata?.count || results.length,
  });
}

// ─── UK: Contracts Finder — Contract Award Notices ───────────────────────────
//
//  Endpoint:  POST https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json
//  Body:      { searchCriteria: { size, startIndex } }
//  Note:      User's URL was /PublicSearch/api — the working REST path is /api/rest/2/…

async function fetchUKExpenses() {
  console.log('[expense:UK] Fetching contract award notices...');
  const resp = await axios.post(
    'https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json',
    { searchCriteria: { size: 20, startIndex: 0 } },
    { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
  );

  // Each entry is { score, item: { id, title, awardedValue, awardedSupplier, … } }
  const entries = resp.data?.noticeList || [];
  const records = entries.map((entry, i) => {
    const n = entry.item || entry;
    return {
      id:          safeStr(n.id || n.noticeIdentifier || `uk-${i}`),
      title:       safeStr(n.title),
      date:        safeStr(n.awardedDate || n.publishedDate),
      amount:      safeNum(n.awardedValue || n.valueLow),
      recipient:   safeStr(n.awardedSupplier),
      category:    safeStr(n.cpvDescription || n.noticeType || 'government_contract'),
      department:  safeStr(n.organisationName),
      notice_id:   safeStr(n.noticeIdentifier),
      jurisdiction: 'UK',
      sourceUrl:   `https://www.contractsfinder.service.gov.uk/Notice/${n.id || ''}`,
    };
  });

  return saveExpenses('uk_contracts_finder', 'UK', records, {
    hitCount:   resp.data?.hitCount,
    maxHits:    resp.data?.maxHits,
  });
}

// ─── Australia: AusTender Government Contracts ───────────────────────────────
//
//  Endpoint:  GET https://data.gov.au/data/api/3/action/datastore_search
//  Resource:  06439664-bbcf-4118-a604-164006bffcaa (2019-20 Contract Data — active datastore)
//  Note:      User's resource_id 4d6e7c8b-… does not exist; this is the verified active resource.
//  Fields:    Agency Name, Contract ID, Publish Date, Value, Description,
//             Supplier Name, Procurement Method, Applicable FY Year

async function fetchAUExpenses() {
  const RESOURCE_ID = '06439664-bbcf-4118-a604-164006bffcaa';
  console.log('[expense:AU] Fetching AusTender contract data...');
  const resp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
    params:  { resource_id: RESOURCE_ID, limit: 20, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows    = resp.data?.result?.records || [];
  const records = rows.map((r, i) => ({
    id:                safeStr(r['Contract ID'] || r._id || `au-${i}`),
    title:             safeStr(r['Description']),
    date:              safeStr(r['Publish Date'] || r['Start Date']),
    amount:            safeNum(r['Value'] || r['Applicable Value']),
    recipient:         safeStr(r['Supplier Name']),
    category:          safeStr(r['Procurement Method'] || 'government_contract'),
    department:        safeStr(r['Agency Name']),
    fiscal_year:       safeStr(r['Applicable FY Year']),
    supplier_country:  safeStr(r['Supplier Country']),
    jurisdiction:      'AU',
    sourceUrl:         'https://www.tenders.gov.au',
  }));

  return saveExpenses('au_austender_contracts', 'AU', records, {
    resourceId:     RESOURCE_ID,
    totalAvailable: resp.data?.result?.total,
  });
}

// ─── Main: run all four sources ───────────────────────────────────────────────

const SOURCES = [
  { name: 'Canada — Budgetary Authorities', fn: fetchCanadaExpenses },
  { name: 'USA   — Federal Spending',       fn: fetchUSExpenses     },
  { name: 'UK    — Contracts Finder',       fn: fetchUKExpenses     },
  { name: 'AU    — AusTender Contracts',    fn: fetchAUExpenses     },
];

async function fetchAllExpenses() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[expenseFetcher] Starting government expense ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[expenseFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[expenseFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, status: 'ok', records: result.count, file: result.filepath });
    } catch (err) {
      console.error(`[expenseFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[expenseFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r => console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`));
  console.log('='.repeat(60) + '\n');

  return summary;
}

module.exports = { fetchAllExpenses, fetchCanadaExpenses, fetchUSExpenses, fetchUKExpenses, fetchAUExpenses };

// Run directly when invoked as a script
if (require.main === module) {
  fetchAllExpenses().then(summary => {
    const anyError = summary.some(r => r.status === 'error');
    process.exit(anyError ? 1 : 0);
  }).catch(err => {
    console.error('[expenseFetcher] Fatal:', err.message);
    process.exit(1);
  });
}
