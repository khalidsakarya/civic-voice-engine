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
// Source: USASpending.gov spending_by_award (FY2025, contract awards)

async function fetchUSContracts() {
  const url = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
  const body = {
    filters: {
      award_type_codes: ['A', 'B', 'C', 'D'],
      time_period: [{ start_date: '2024-10-01', end_date: '2025-09-30' }],
    },
    fields: [
      'Award ID', 'Recipient Name', 'Awarding Agency',
      'Award Amount', 'Description', 'Action Date',
    ],
    sort: 'Award Amount',
    order: 'desc',
    limit: 100,
    page: 1,
  };
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
  };

  console.log('[contracts:US] Fetching top 100 FY2025 contracts by value...');
  const r = await axios.post(url, body, { headers, timeout: 30000 });
  const results = r.data?.results || [];

  const records = results.map(row => ({
    id: `US-${(row['Award ID'] || '').replace(/\s+/g, '_') || Math.random().toString(36).slice(2)}`,
    jurisdiction: 'US',
    contractor_name: (row['Recipient Name'] || '').trim() || null,
    department: (row['Awarding Agency'] || '').trim() || null,
    value: parseFloat(row['Award Amount']) || null,
    currency: 'USD',
    purpose: (row['Description'] || '').trim() || null,
    date_awarded: row['Action Date'] || null,
    source_url: 'https://www.usaspending.gov/search/?hash=contracts',
  })).filter(r => r.contractor_name || r.value);

  saveOutput('US', records);
  return records.length;
}

// ─── United Kingdom ───────────────────────────────────────────────────────────
// Source: Contracts Finder (contractsfinder.service.gov.uk) — contract award notices

async function fetchUKContracts() {
  const url = 'https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json';
  const body = {
    notice_type: ['contract_award'],
    limit: 200,
    order_by: 'published_date_desc',
  };
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Accept': 'application/json',
  };

  console.log('[contracts:UK] Fetching 200 most recent contract awards...');
  const r = await axios.post(url, body, { headers, timeout: 30000 });
  const notices = r.data?.noticeList || [];

  const records = notices.map(entry => {
    const item = entry.item || entry;
    // awardedSupplier may be a string or an object
    let contractor = null;
    if (item.awardedSupplier) {
      contractor = typeof item.awardedSupplier === 'string'
        ? item.awardedSupplier
        : (item.awardedSupplier.supplierName || item.awardedSupplier.name || null);
    }
    const dept = item.organisationName || item.buyerName || null;
    const value = parseFloat(item.awardedValue) || null;
    const purpose = (item.title || '').replace(/&#039;/g, "'").trim() || null;
    return {
      id: `UK-${item.id || item.noticeIdentifier || Math.random().toString(36).slice(2)}`,
      jurisdiction: 'UK',
      contractor_name: contractor ? String(contractor).trim() : null,
      department: dept ? String(dept).trim() : null,
      value,
      currency: 'GBP',
      purpose,
      date_awarded: item.awardedDate || item.publishedDate || null,
      source_url: `https://www.contractsfinder.service.gov.uk/Notice/${item.id || ''}`,
    };
  }).filter(r => r.contractor_name || r.value);

  saveOutput('UK', records);
  return records.length;
}

// ─── Australia ────────────────────────────────────────────────────────────────
// Source: data.gov.au CKAN — Historical Australian Government Contract Data (FY2019-20)
// Resource: 06439664-bbcf-4118-a604-164006bffcaa (72,500 records)
// Note: AusTender.gov.au and api.tenders.gov.au both block programmatic access.

async function fetchAUContracts() {
  const url = 'https://data.gov.au/data/api/3/action/datastore_search';
  const params = {
    resource_id: '06439664-bbcf-4118-a604-164006bffcaa',
    limit: 200,
    sort: 'Value desc',
  };
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Accept': 'application/json',
    'Referer': 'https://data.gov.au/data/',
  };

  console.log('[contracts:AU] Fetching top 200 FY2019-20 contracts by value (data.gov.au)...');
  const r = await axios.get(url, { params, headers, timeout: 30000 });
  const rows = r.data?.result?.records || [];

  const records = rows.map(row => ({
    id: `AU-${row['Contract ID'] || row._id}`,
    jurisdiction: 'AU',
    contractor_name: (row['Supplier Name'] || '').trim() || null,
    department: (row['Agency Name'] || '').trim() || null,
    value: parseFloat(String(row['Value'] || '').replace(/,/g, '')) || null,
    currency: 'AUD',
    purpose: (row['Description'] || '').trim() || null,
    date_awarded: row['Start Date'] || null,
    source_url: 'https://data.gov.au/dataset/historical-australian-government-contract-data',
  })).filter(r => r.contractor_name || r.value);

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
