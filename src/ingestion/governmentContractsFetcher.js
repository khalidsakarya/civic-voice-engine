'use strict';

const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/government_contracts');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function saveOutput(jur, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `government_contracts_${jur}_${ts()}.json`);
  fs.writeFileSync(file, JSON.stringify({ records }, null, 2));
  console.log(`[contracts:${jur}] Saved ${records.length} records → ${path.basename(file)}`);
}

// ─── Canada ──────────────────────────────────────────────────────────────────
// Source: open.canada.ca proactive disclosure contracts (CKAN datastore)
// Resource: fac950c0-00d5-4ec1-a4d3-9cbebf98a305
//
// Strategy: contract_value is TEXT in CKAN — numeric sort unavailable server-side.
// Fetch 2000 rows per reporting period (2023 onwards) in parallel, aggregate
// client-side, apply status filter, sort by value desc, keep top 500.
// Headers require X-Requested-With + Chrome UA to pass the open.canada.ca WAF.
//
// Filter logic (per user requirement):
//   KEEP  if contract_date (award date) >= 2023-01-01          → recently awarded
//   KEEP  if delivery_date (end date) >= today or no end date   → still active
//   DROP  if contract_date < 2023-01-01 AND delivery_date < today  → pre-2023 + expired
//
// Status:
//   "Active"    — delivery_date in future or absent
//   "Completed" — delivery_date has passed
//
// contract_value_type:
//   Per the open.canada.ca proactive disclosure schema, contract_value is always
//   the TOTAL value of the contract (including all amendments). It is not an
//   annual figure. For Standing Offers / Supply Arrangements (instrument SO/SOSA)
//   with value 0, the ceiling is not committed — actual spend is via call-ups.

const CA_CONTRACTS_RESOURCE = 'fac950c0-00d5-4ec1-a4d3-9cbebf98a305';
const CA_CONTRACTS_HEADERS  = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://open.canada.ca/en/proactive-disclosure/contracts',
  'X-Requested-With':'XMLHttpRequest',
};
// All fiscal reporting periods from 2023 onwards
const CA_RECENT_PERIODS = [
  '2025-2026-Q2', '2025-2026-Q1',
  '2024-2025-Q4', '2024-2025-Q3', '2024-2025-Q2', '2024-2025-Q1',
  '2023-2024-Q4', '2023-2024-Q3', '2023-2024-Q2', '2023-2024-Q1',
];

function caContractStatus(deliveryDate) {
  if (!deliveryDate || deliveryDate.trim() === '') return 'Active';
  return new Date(deliveryDate) >= new Date() ? 'Active' : 'Completed';
}

function caContractValueType(instrumentType) {
  const t = (instrumentType || '').toUpperCase();
  if (t === 'SO' || t === 'SOSA' || t === 'SA') {
    return 'ceiling (standing offer — actual spend via call-ups)';
  }
  return 'total';
}

async function fetchCanadaContracts() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[contracts:CA] Fetching proactive disclosure contracts 2023+ (10 periods × 2000 rows, today=${today})...`);

  // Fetch all periods concurrently
  const periodResults = await Promise.allSettled(
    CA_RECENT_PERIODS.map(period =>
      axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
        params: {
          resource_id: CA_CONTRACTS_RESOURCE,
          limit: 2000,
          filters: JSON.stringify({ reporting_period: period }),
        },
        headers: CA_CONTRACTS_HEADERS,
        timeout: 30000,
      }).then(r => ({ period, rows: r.data?.result?.records || [] }))
        .catch(e => { console.warn(`[contracts:CA]   ${period} failed: ${e.message}`); return { period, rows: [] }; })
    )
  );

  const allRows = [];
  for (const res of periodResults) {
    if (res.status === 'fulfilled') {
      const { period, rows } = res.value;
      console.log(`[contracts:CA]   ${period}: ${rows.length} rows`);
      allRows.push(...rows);
    }
  }
  console.log(`[contracts:CA] ${allRows.length} raw rows fetched`);

  // Deduplicate by reference_number — same contract can appear in multiple periods
  const seen = new Set();
  const deduped = allRows.filter(row => {
    const key = row.reference_number || String(row._id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`[contracts:CA] ${deduped.length} rows after deduplication`);

  // Apply filter:
  //   Keep if awarded 2023+ OR still active (end date in future / absent)
  //   Drop  if awarded before 2023 AND end date has passed
  const filtered = deduped.filter(row => {
    const awardDate    = row.contract_date || '';
    const endDate      = row.delivery_date || '';
    const awardedRecently = awardDate >= '2023-01-01';
    const stillActive     = !endDate || endDate >= today;
    return awardedRecently || stillActive;
  });
  console.log(`[contracts:CA] ${filtered.length} rows after status filter (keeping active or 2023+ awarded)`);

  // Sort by numeric contract_value desc, take top 500
  const sorted = filtered
    .filter(row => parseFloat(row.contract_value) > 0)
    .sort((a, b) => parseFloat(b.contract_value) - parseFloat(a.contract_value))
    .slice(0, 500);

  const records = sorted.map(row => ({
    id:                    `CA-${row.reference_number || row._id}`,
    jurisdiction:          'CA',
    contractor_name:       (row.vendor_name || '').trim() || null,
    department:            (row.owner_org_title || row.buyer_name || '').trim() || null,
    value:                 parseFloat(row.contract_value) || null,
    original_value:        parseFloat(row.original_value) || null,
    contract_value_type:   caContractValueType(row.instrument_type),
    currency:              'CAD',
    status:                caContractStatus(row.delivery_date),
    purpose:               (row.description_en || '').trim() || null,
    date_awarded:          row.contract_date || null,
    contract_period_start: row.contract_period_start || null,
    end_date:              row.delivery_date || null,
    reporting_period:      row.reporting_period || null,
    solicitation_procedure: row.solicitation_procedure || null,
    instrument_type:       row.instrument_type || null,
    source_url:            'https://open.canada.ca/en/proactive-disclosure/contracts',
  }));

  const activeCount    = records.filter(r => r.status === 'Active').length;
  const completedCount = records.filter(r => r.status === 'Completed').length;
  console.log(`[contracts:CA] ${records.length} records — Active: ${activeCount}, Completed: ${completedCount}`);

  saveOutput('CA', records);
  return records.length;
}

// ─── United States ────────────────────────────────────────────────────────────
// Source: USASpending.gov spending_by_award — contracts from FY2022 onwards.
// Fetches 3 pages of 100 (300 records) sorted by Award Amount desc to capture
// a broad value-sorted sample across multiple fiscal years.
// contract_value_type: 'ceiling' for IDIQ (indefinite delivery/qty contracts
// where each order is a separate obligation); 'total' for all other types.

const US_IDIQ_RE = /indefinite.delivery|indefinite.quantity|\bIDIQ\b/i;

function usStatus(endDate) {
  if (!endDate) return 'Active';
  return new Date(endDate) >= new Date() ? 'Active' : 'Completed';
}
function usContractValueType(awardType) {
  return US_IDIQ_RE.test(awardType || '') ? 'ceiling' : 'total';
}

async function fetchUSContracts() {
  const today = new Date().toISOString().slice(0, 10);
  const US_FIELDS = [
    'Award ID', 'Recipient Name', 'Awarding Agency', 'Award Amount',
    'Description', 'Start Date', 'End Date', 'Base Obligation Date',
    'Contract Award Type',
  ];
  const allResults = [];

  // Fetch 3 pages covering FY2022-2026 sorted by value desc
  console.log('[contracts:US] Fetching contracts 2022+ by value (3 pages × 100)...');
  await Promise.all([1, 2, 3].map(async page => {
    try {
      const r = await axios.post('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        filters: {
          award_type_codes: ['A', 'B', 'C', 'D'],
          time_period: [{ start_date: '2022-01-01', end_date: '2026-09-30' }],
        },
        fields: US_FIELDS, sort: 'Award Amount', order: 'desc', limit: 100, page,
      }, { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 45000 });
      const rows = r.data?.results || [];
      console.log(`[contracts:US]   page ${page}: ${rows.length} rows`);
      allResults.push(...rows);
    } catch (e) { console.warn(`[contracts:US]   page ${page} failed: ${e.message}`); }
  }));

  // Deduplicate by Award ID
  const seen = new Set();
  const deduped = allResults.filter(row => {
    const k = row['Award ID'] || String(Math.random());
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  console.log(`[contracts:US] ${deduped.length} rows after dedup`);

  // Filter: keep if start date 2022+ OR still active
  const filtered = deduped.filter(row => {
    const startDate = (row['Start Date'] || '').slice(0, 10);
    const endDate   = (row['End Date']   || '').slice(0, 10);
    return startDate >= '2022-01-01' || !endDate || endDate >= today;
  });
  console.log(`[contracts:US] ${filtered.length} rows after 2022+ / active filter`);

  const records = filtered.map(row => {
    const endDate   = (row['End Date']              || '').slice(0, 10) || null;
    const startDate = (row['Start Date']            || '').slice(0, 10) || null;
    const baseDate  = (row['Base Obligation Date']  || '').slice(0, 10) || null;
    return {
      id:                    `US-${(row['Award ID'] || '').replace(/\s+/g, '_') || Math.random().toString(36).slice(2)}`,
      jurisdiction:          'US',
      contractor_name:       (row['Recipient Name'] || '').trim() || null,
      department:            (row['Awarding Agency'] || '').trim() || null,
      value:                 parseFloat(row['Award Amount']) || null,
      contract_value_type:   usContractValueType(row['Contract Award Type']),
      currency:              'USD',
      status:                usStatus(endDate),
      purpose:               (row['Description'] || '').trim() || null,
      date_awarded:          baseDate,
      contract_period_start: startDate,
      end_date:              endDate,
      award_type:            (row['Contract Award Type'] || '').trim() || null,
      source_url:            'https://www.usaspending.gov/search/?hash=contracts',
    };
  });

  const active    = records.filter(r => r.status === 'Active').length;
  const completed = records.filter(r => r.status === 'Completed').length;
  console.log(`[contracts:US] ${records.length} records — Active: ${active}, Completed: ${completed}`);
  saveOutput('US', records);
  return records.length;
}

// ─── United Kingdom ───────────────────────────────────────────────────────────
// Source: Find a Tender Service (FTS) — UK post-Brexit official procurement,
// OCDS-compliant API with cursor-based pagination.
// Contracts Finder was abandoned — its API hard-caps at 20 unique records
// regardless of all pagination/filter parameters.
//
// FTS OCDS structure:
//   Releases tagged ['award','contract'] contain the full award data
//   (value in awards[0].value, period in awards[0].contractPeriod, suppliers).
//   Releases tagged only ['award'] are pre-signature notices with no value.
//   Releases tagged ['stages=award'] via the stages param are mostly unsuccessful.
//   Strategy: fetch default endpoint (all notice types), keep only releases
//   tagged with BOTH 'award' AND 'contract' — these are fully signed contracts.
//
// contract_value_type:
//   'framework (ceiling)' if techniques.frameworkAgreement present
//   'total' for direct awards
// status derived from awards[0].contractPeriod.endDate.

function ukStatus(endDate) {
  if (!endDate) return 'Active';
  return endDate.slice(0, 10) >= new Date().toISOString().slice(0, 10) ? 'Active' : 'Completed';
}

function ukValueType(rel) {
  if (rel.tender?.techniques?.frameworkAgreement) return 'framework (ceiling)';
  return 'total';
}

async function fetchUKContracts() {
  const today = new Date().toISOString().slice(0, 10);
  const FTS_BASE = 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages';
  const FTS_HEADERS = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
  // Fetch 20 pages × 100 releases to capture ~480+ award+contract notices.
  // Sequential cursor-based pagination (FTS uses updatedTo cursor).
  const N_PAGES = 20;

  console.log(`[contracts:UK] Fetching ${N_PAGES} pages × 100 from Find a Tender (FTS) OCDS API...`);

  const allReleases = [];
  let url = `${FTS_BASE}?limit=100`;
  for (let p = 0; p < N_PAGES; p++) {
    try {
      const r = await axios.get(url, { headers: FTS_HEADERS, timeout: 30000 });
      const releases = r.data?.releases || [];
      allReleases.push(...releases);
      console.log(`[contracts:UK]   page ${p + 1}: ${releases.length} releases (total: ${allReleases.length})`);
      const next = r.data?.links?.next;
      if (!next) break;
      url = next;
    } catch (e) {
      console.warn(`[contracts:UK]   page ${p + 1} failed: ${e.message}`);
      break;
    }
  }
  console.log(`[contracts:UK] ${allReleases.length} total releases`);

  // Keep only releases tagged with BOTH 'award' AND 'contract' — these have full data.
  const contractAwards = allReleases.filter(rel => {
    const tags = rel.tag || [];
    return tags.includes('award') && tags.includes('contract') && rel.awards?.length > 0;
  });
  console.log(`[contracts:UK] ${contractAwards.length} award+contract releases`);

  // Filter: published 2022+ or still active
  const filtered = contractAwards.filter(rel => {
    const published = (rel.date || '').slice(0, 10);
    const endDate   = (rel.awards?.[0]?.contractPeriod?.endDate || '').slice(0, 10);
    return published >= '2022-01-01' || !endDate || endDate >= today;
  });
  console.log(`[contracts:UK] ${filtered.length} after 2022+/active filter`);

  // Deduplicate by ocid
  const seen = new Set();
  const deduped = filtered.filter(rel => {
    if (seen.has(rel.ocid)) return false;
    seen.add(rel.ocid); return true;
  });

  const records = deduped.map(rel => {
    const aw      = rel.awards[0];
    const buyer   = rel.parties?.find(p => Array.isArray(p.roles) && p.roles.includes('buyer'));
    const supplier = aw.suppliers?.[0]?.name || null;
    const endDate  = aw.contractPeriod?.endDate ? aw.contractPeriod.endDate.slice(0, 10) : null;
    const startDate = aw.contractPeriod?.startDate ? aw.contractPeriod.startDate.slice(0, 10) : null;
    const value = aw.value?.amountGross ?? aw.value?.amount ?? null;

    return {
      id:                    `UK-${rel.ocid.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
      jurisdiction:          'UK',
      contractor_name:       supplier,
      department:            buyer?.name || rel.tender?.procuringEntity?.name || null,
      value:                 typeof value === 'number' ? value : (parseFloat(value) || null),
      contract_value_type:   ukValueType(rel),
      currency:              aw.value?.currency || 'GBP',
      status:                ukStatus(endDate),
      purpose:               (rel.tender?.title || '').trim() || null,
      date_awarded:          (rel.date || '').slice(0, 10) || null,
      contract_period_start: startDate,
      end_date:              endDate,
      source_url:            `https://www.find-tender.service.gov.uk/Notice/${rel.ocid}`,
    };
  }).filter(r => r.contractor_name || r.value);

  const active    = records.filter(r => r.status === 'Active').length;
  const completed = records.filter(r => r.status === 'Completed').length;
  console.log(`[contracts:UK] ${records.length} records — Active: ${active}, Completed: ${completed}`);
  saveOutput('UK', records);
  return records.length;
}

// ─── Australia ────────────────────────────────────────────────────────────────
// Source: data.gov.au CKAN — AusTender Historical Government Contract Data (FY2019-20)
// Resource: 06439664-bbcf-4118-a604-164006bffcaa (72,500 records)
// Note: api.tenders.gov.au requires auth; this FY2019-20 dataset is the only
// programmatically accessible source. Many large defence/IT contracts in it are
// multi-year and remain active through 2022-2026+ (e.g. airborne support ~$4B).
//
// Filter: keep if Start Date >= 2022-01-01 (recently awarded) OR
//         End Date >= 2022-01-01 (still active or expired after Jan 2022).
// Status: Active if End Date >= today or absent; Completed if End Date < today.
// contract_value_type: 'ceiling' if Panel Arrangement or SON ID present (spend
//   via call-up orders); 'total' for direct contracts.
// Erroneous end-dates (year > 2050) treated as null (data entry errors).

const AU_CKAN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':     'application/json',
  'Referer':    'https://data.gov.au/data/',
};

function auCleanDate(raw) {
  if (!raw) return null;
  const d = String(raw).slice(0, 10); // YYYY-MM-DD
  const yr = parseInt(d.slice(0, 4), 10);
  return (yr > 2050 || yr < 1990) ? null : d; // strip clearly erroneous dates
}

function auStatus(endDate) {
  const d = auCleanDate(endDate);
  if (!d) return 'Active';
  return d >= new Date().toISOString().slice(0, 10) ? 'Active' : 'Completed';
}

function auContractValueType(row) {
  if ((row['SON ID'] || '').trim() || /panel/i.test(row['Panel Arrangement'] || '')) {
    return 'ceiling';
  }
  return 'total';
}

async function fetchAUContracts() {
  const today = new Date().toISOString().slice(0, 10);
  console.log('[contracts:AU] Fetching FY2019-20 AU contracts by value (2000 rows, filter 2022+/active)...');

  const r = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
    params: { resource_id: '06439664-bbcf-4118-a604-164006bffcaa', limit: 2000, sort: 'Value desc' },
    headers: AU_CKAN_HEADERS, timeout: 30000,
  });
  const rows = r.data?.result?.records || [];
  console.log(`[contracts:AU] ${rows.length} raw rows`);

  // Filter: awarded 2022+ OR end date >= 2022-01-01 (active in / after 2022)
  const filtered = rows.filter(row => {
    const start = auCleanDate(row['Start Date']) || '';
    const end   = auCleanDate(row['End Date'])   || '';
    return start >= '2022-01-01' || end >= '2022-01-01';
  });
  console.log(`[contracts:AU] ${filtered.length} rows after 2022+/active filter`);

  const records = filtered.map(row => ({
    id:                    `AU-${row['Contract ID'] || row._id}`,
    jurisdiction:          'AU',
    contractor_name:       (row['Supplier Name'] || '').trim() || null,
    department:            (row['Agency Name'] || '').trim() || null,
    value:                 parseFloat(String(row['Value'] || '').replace(/,/g, '')) || null,
    contract_value_type:   auContractValueType(row),
    currency:              'AUD',
    status:                auStatus(row['End Date']),
    purpose:               (row['Description'] || '').trim() || null,
    date_awarded:          auCleanDate(row['Start Date']),
    contract_period_start: auCleanDate(row['Start Date']),
    end_date:              auCleanDate(row['End Date']),
    procurement_method:    (row['Procurement Method'] || '').trim() || null,
    source_url:            'https://data.gov.au/dataset/historical-australian-government-contract-data',
  })).filter(r => r.contractor_name || r.value);

  const active    = records.filter(r => r.status === 'Active').length;
  const completed = records.filter(r => r.status === 'Completed').length;
  console.log(`[contracts:AU] ${records.length} records — Active: ${active}, Completed: ${completed}`);
  saveOutput('AU', records);
  return records.length;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllGovernmentContracts() {
  console.log('[contracts] Fetching government contracts for CA / US / UK / AU...');
  const results = await Promise.allSettled([
    fetchCanadaContracts(),
    fetchUSContracts(),
    fetchUKContracts(),
    fetchAUContracts(),
  ]);

  const labels = ['CA', 'US', 'UK', 'AU'];
  let total = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      total += r.value;
    } else {
      console.error(`[contracts:${labels[i]}] Failed: ${r.reason?.message || r.reason}`);
    }
  });

  console.log(`[contracts] Done — ${total} total contract records saved.`);
  return total;
}

module.exports = { fetchAllGovernmentContracts };

if (require.main === module) {
  fetchAllGovernmentContracts().then(n => {
    console.log(`Fetched ${n} contracts.`);
    process.exit(0);
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
