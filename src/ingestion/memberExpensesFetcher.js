/**
 * Member Expenses Fetcher — Civic Voice Engine
 *
 * Fetches individual expense reports for legislators from official government
 * sources and writes records to output/member_expenses/ for Firestore upload.
 *
 * Sources & methodology
 * ─────────────────────────────────────────────────────────────────────────────
 * CA   ourcommons.ca/ProactiveDisclosure/en/members
 *      Quarterly proactive disclosure of MP expenses (salaries, travel,
 *      hospitality, contracts). Fetches the most recent 4 quarters by:
 *        1. GET /ProactiveDisclosure/en/members/{year}/{q}?summaryId=... page
 *        2. Extract CSV download link from page HTML
 *        3. Parse CSV: Name, Constituency, Caucus, Salaries, Travel,
 *           Hospitality, Contracts
 *
 * US   clerk.house.gov
 *      The quarterly Statement of Disbursements (official quarterly expense
 *      report for Member Representational Allowances) is published only as PDF.
 *      Machine-readable per-member amounts are not available.
 *      Fetches the MemberData.xml for identity data and records a data_note
 *      explaining the limitation; zero-amount placeholder records are written
 *      so downstream systems know the collection includes US members.
 *
 * UK   theipsa.org.uk/api/download
 *      IPSA publishes two machine-readable files:
 *        – individualBusinessCosts?year=24_25  →  per-claim detail CSV (~21 MB)
 *        – totalSpend?year=24_25               →  per-MP annual summary CSV
 *      Both are parsed and merged into one record per MP.
 *
 * AU   data.gov.au (CKAN datastore) — IPEA quarterly data
 *      Independent Parliamentary Expenses Authority publishes per-line-item
 *      expense records for all parliamentarians every quarter.
 *      Search for the latest "Parliamentarians' Expenditure" package, then
 *      fetch the main expenses resource (not repayments/certifications).
 *      Aggregates by member: total amount + category breakdown.
 *
 * Output: output/member_expenses/{source}_{timestamp}.json
 * Firestore: member_expenses collection  (doc id = {source}_{memberId}_{period})
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/member_expenses');
const TIMEOUT_MS = 60_000;   // large CSV downloads need more time
const CA_QUARTERS_TO_FETCH = parseInt(process.env.CA_EXPENSE_QUARTERS || '2', 10);
const AU_EXPENSE_LIMIT     = parseInt(process.env.AU_EXPENSE_LIMIT    || '2000', 10);

// ─── Shared helpers ───────────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 500) || null : null);
const safeNum = v => { const n = parseFloat(String(v || '').replace(/[£,$\s,]/g, '')); return isNaN(n) ? null : n; };
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(OUTPUT_DIR, `${sourceName}_${ts}.json`);
  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));
  return { filepath, count: records.length };
}

/**
 * Minimal CSV parser that handles quoted fields with embedded commas/newlines.
 * Returns an array of objects keyed by the header row.
 */
function parseCsv(text) {
  // Strip BOM
  const clean = text.replace(/^\uFEFF\uFEFF|\uFEFF/g, '');
  const rows  = [];
  let cur     = '';
  let inQuote = false;

  for (let i = 0; i < clean.length; i++) {
    const ch   = clean[i];
    const next = clean[i + 1];
    if (ch === '"') {
      if (inQuote && next === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      rows[rows.length - 1]?.push(cur); cur = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (ch === '\r' && next === '\n') i++;
      if (rows.length === 0) rows.push([]);
      rows[rows.length - 1].push(cur); cur = '';
      rows.push([]);
    } else {
      cur += ch;
    }
  }
  if (cur) rows[rows.length - 1]?.push(cur);

  const nonEmpty = rows.filter(r => r.some(c => c.trim()));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map(h => h.trim());
  return nonEmpty.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] ?? '').trim(); });
    return obj;
  });
}

// ─── Canada — ourcommons.ca ProactiveDisclosure ───────────────────────────────

const CA_PD_BASE = 'https://www.ourcommons.ca';

// Known recent quarters in descending order (year / quarter-number).
// These are Parliament of Canada fiscal quarters (not calendar quarters).
// New quarters are appended to the front when the page is updated.
const CA_KNOWN_QUARTERS = [
  { year: 2026, q: 3 },
  { year: 2026, q: 2 },
  { year: 2026, q: 1 },
  { year: 2025, q: 4 },
  { year: 2025, q: 3 },
  { year: 2025, q: 2 },
  { year: 2025, q: 1 },
  { year: 2024, q: 4 },
];

/**
 * Fetch one quarter: load the HTML page, extract the CSV download link, parse.
 * Returns null if the quarter isn't available yet.
 */
async function fetchCAQuarter(year, q) {
  const pageUrl = `${CA_PD_BASE}/ProactiveDisclosure/en/members/${year}/${q}`;
  let html;
  try {
    const r = await axios.get(pageUrl, {
      headers: { 'User-Agent': 'CivicVoiceBot/1.0 (research; contact@civicvoice.app)' },
      timeout: TIMEOUT_MS,
    });
    html = r.data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }

  // Extract CSV link: /ProactiveDisclosure/en/members/{summaryId}/csv
  const csvMatch = html.match(/href="(\/ProactiveDisclosure\/en\/members\/[a-f0-9-]+\/csv)"/i);
  if (!csvMatch) return null;

  const csvUrl = `${CA_PD_BASE}${csvMatch[1]}`;
  const csvResp = await axios.get(csvUrl, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });

  const rows = parseCsv(csvResp.data);
  const period = `${year}-Q${q}`;

  return rows
    .filter(row => row.Name && row.Name.trim())
    .map(row => {
      // Name is "Surname, First" or "Surname,  Hon. First"
      const nameParts = row.Name.split(',').map(s => s.trim());
      const lastName  = nameParts[0]?.replace(/^"/, '').trim();
      const firstName = nameParts[1]?.replace(/^"/, '').replace(/^(?:Right\s+)?Hon\.\s*/i, '').trim();
      const fullName  = `${firstName || ''} ${lastName || ''}`.trim();
      const idKey     = `${(lastName || '').toLowerCase().replace(/[^a-z]/g, '')}_${(row.Constituency || '').toLowerCase().replace(/[^a-z]/g, '')}`;

      return {
        id:           `ca_${idKey}_${period}`,
        source:       'canada',
        period,
        year,
        quarter:      q,
        member_name:  safeStr(fullName),
        last_name:    safeStr(lastName),
        first_name:   safeStr(firstName),
        constituency: safeStr(row.Constituency),
        caucus:       safeStr(row.Caucus),
        salaries:     safeNum(row.Salaries),
        travel:       safeNum(row.Travel),
        hospitality:  safeNum(row.Hospitality),
        contracts:    safeNum(row.Contracts),
        total:        [row.Salaries, row.Travel, row.Hospitality, row.Contracts]
                        .reduce((s, v) => s + (safeNum(v) || 0), 0),
        currency:     'CAD',
        source_url:   csvUrl,
      };
    });
}

async function fetchCanadaExpenses() {
  console.log('[ca-expenses] Fetching CA MP quarterly expense disclosures...');
  const allRecords = [];
  let fetched = 0;

  for (const { year, q } of CA_KNOWN_QUARTERS) {
    if (fetched >= CA_QUARTERS_TO_FETCH) break;
    try {
      const rows = await fetchCAQuarter(year, q);
      if (!rows) {
        console.log(`[ca-expenses] ${year}/Q${q} — not available yet, skipping`);
        continue;
      }
      console.log(`[ca-expenses] ${year}/Q${q} — ${rows.length} MP records`);
      allRecords.push(...rows);
      fetched++;
    } catch (err) {
      console.warn(`[ca-expenses] ⚠ ${year}/Q${q}: ${err.message}`);
    }
    await sleep(600);
  }

  const result = saveRecords('canada', allRecords, { quartersLoaded: fetched });
  console.log(`[ca-expenses] ✓ ${result.count} records → ${result.filepath}`);
  return result;
}

// ─── US — clerk.house.gov (identity only; SOD is PDF-only) ───────────────────

const CLERK_XML = 'https://clerk.house.gov/xml/lists/MemberData.xml';

const US_DATA_NOTE = [
  'The Statement of Disbursements (quarterly member operational expense report)',
  'is published by clerk.house.gov as PDF only — no machine-readable bulk format exists.',
  'Salaries, travel, and office expenses for individual House members are not available',
  'as structured open data. Records here contain member identity only.',
].join(' ');

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

async function fetchUSExpenses() {
  console.log('[us-expenses] Fetching member list from clerk.house.gov MemberData.xml...');
  const r = await axios.get(CLERK_XML, { timeout: TIMEOUT_MS });
  const xml = r.data;

  const memberBlocks = xml.match(/<member>[\s\S]*?<\/member>/gi) || [];
  console.log(`[us-expenses] ${memberBlocks.length} member blocks found`);

  const currentYear = new Date().getFullYear();
  const records = memberBlocks.map(block => {
    const bioguideId = xmlTag(block, 'bioguideID');
    const lastName   = xmlTag(block, 'lastname');
    const firstName  = xmlTag(block, 'firstname');
    const party      = xmlTag(block, 'party');
    const stateCode  = block.match(/<state postal-code="([^"]+)"/)?.[1] || null;
    const district   = xmlTag(block, 'district');
    const stateName  = xmlTag(block, 'state-fullname');

    return {
      id:            `us_${bioguideId}_${currentYear}`,
      source:        'usa',
      period:        String(currentYear),
      year:          currentYear,
      bioguide_id:   safeStr(bioguideId),
      member_name:   safeStr(`${firstName || ''} ${lastName || ''}`.trim()),
      first_name:    safeStr(firstName),
      last_name:     safeStr(lastName),
      party:         safeStr(party),
      state:         safeStr(stateCode),
      state_name:    safeStr(stateName),
      district:      safeStr(district),
      // Expense amounts not available in machine-readable format
      salaries:      null,
      travel:        null,
      office_costs:  null,
      total:         null,
      currency:      'USD',
      data_note:     US_DATA_NOTE,
      source_url:    'https://clerk.house.gov/financial_disclosure',
    };
  }).filter(r => r.bioguide_id);

  const result = saveRecords('usa', records, { dataNote: US_DATA_NOTE });
  console.log(`[us-expenses] ✓ ${result.count} records (identity only) → ${result.filepath}`);
  return result;
}

// ─── UK — theipsa.org.uk ──────────────────────────────────────────────────────

const IPSA_BASE = 'https://www.theipsa.org.uk/api/download';
const IPSA_YEAR = process.env.IPSA_EXPENSE_YEAR || '24_25';

async function fetchUKExpenses() {
  console.log(`[uk-expenses] Downloading IPSA individualBusinessCosts CSV (year=${IPSA_YEAR})...`);

  // Download the individual claims CSV (~21 MB)
  const claimsResp = await axios.get(IPSA_BASE, {
    params: { type: 'individualBusinessCosts', year: IPSA_YEAR },
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  const claimsRows = parseCsv(claimsResp.data);
  console.log(`[uk-expenses] ${claimsRows.length} individual claim rows parsed`);

  await sleep(500);

  // Download the total spend summary CSV
  console.log('[uk-expenses] Downloading IPSA totalSpend CSV...');
  const totalResp = await axios.get(IPSA_BASE, {
    params: { type: 'totalSpend', year: IPSA_YEAR },
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  const totalRows = parseCsv(totalResp.data);
  console.log(`[uk-expenses] ${totalRows.length} MP total-spend rows parsed`);

  // Build pID → summary totals map from totalSpend
  const summaryMap = {};
  for (const row of totalRows) {
    const pid = row.pID?.trim();
    if (!pid) continue;
    summaryMap[pid] = {
      name:              safeStr(row["MP's name"]),
      constituency:      safeStr(row['Constituency since 5 July 2024'] !== 'N/A'
                           ? row['Constituency since 5 July 2024']
                           : row['Previous constituency']),
      office_spend:      safeNum(row['Office spend']),
      staffing_spend:    safeNum(row['Staffing spend']),
      accommodation_spend: safeNum(row['Accommodation spend']),
      travel_spend:      safeNum(row['Travel and subsistence (uncapped)']),
      other_costs:       safeNum(row['Other costs (uncapped)']),
      winding_up_spend:  safeNum(row['Winding-up spend']),
    };
  }

  // Aggregate individual claims per MP (count + recent sample)
  const claimsPerMp = {};
  for (const row of claimsRows) {
    const pid = row['Parliamentary ID']?.trim();
    if (!pid) continue;
    if (!claimsPerMp[pid]) {
      claimsPerMp[pid] = {
        total_claims: 0,
        total_claimed: 0,
        categories:   {},
        recent_claims: [],
      };
    }
    const agg = claimsPerMp[pid];
    agg.total_claims++;
    const amount = safeNum(row['Amount Claimed']) || 0;
    agg.total_claimed += amount;
    const cat = row.Category || 'Other';
    agg.categories[cat] = (agg.categories[cat] || 0) + amount;
    // Keep up to 10 most recent claims as a sample
    if (agg.recent_claims.length < 10) {
      agg.recent_claims.push({
        date:        safeStr(row.Date),
        category:    safeStr(row.Category),
        cost_type:   safeStr(row['Cost Type']),
        description: safeStr(row['Short Description']),
        amount:      amount,
      });
    }
  }

  // Merge summary + claims into one record per MP
  const allPids = new Set([...Object.keys(summaryMap), ...Object.keys(claimsPerMp)]);
  const records = [];

  for (const pid of allPids) {
    const summary = summaryMap[pid] || {};
    const claims  = claimsPerMp[pid] || {};
    const name    = summary.name || claimsRows.find(r => r['Parliamentary ID']?.trim() === pid)?.Name || null;

    const totalFromSummary = [
      summary.office_spend, summary.staffing_spend, summary.accommodation_spend,
      summary.travel_spend, summary.other_costs, summary.winding_up_spend,
    ].reduce((s, v) => s + (v || 0), 0);

    records.push({
      id:                   `uk_${pid}_${IPSA_YEAR.replace('_', '-')}`,
      source:               'uk',
      period:               IPSA_YEAR.replace('_', '/'),
      parliament_id:        pid,
      member_name:          safeStr(name),
      constituency:         safeStr(summary.constituency),
      office_spend:         summary.office_spend,
      staffing_spend:       summary.staffing_spend,
      accommodation_spend:  summary.accommodation_spend,
      travel_spend:         summary.travel_spend,
      other_costs:          summary.other_costs,
      winding_up_spend:     summary.winding_up_spend,
      total_spend:          totalFromSummary || null,
      total_claims:         claims.total_claims || 0,
      total_claimed:        claims.total_claimed || null,
      category_breakdown:   claims.categories || {},
      recent_claims:        claims.recent_claims || [],
      currency:             'GBP',
      source_url:           'https://www.theipsa.org.uk/mp-staffing-business-costs/annual-publications',
    });
  }

  const result = saveRecords('uk', records, { ipsaYear: IPSA_YEAR });
  console.log(`[uk-expenses] ✓ ${result.count} MP records → ${result.filepath}`);
  return result;
}

// ─── Australia — data.gov.au IPEA quarterly data ──────────────────────────────

const AU_CKAN = 'https://data.gov.au/data/api/3/action';

async function fetchAUExpenses() {
  console.log('[au-expenses] Searching for latest IPEA quarterly package on data.gov.au...');

  const searchResp = await axios.get(`${AU_CKAN}/package_search`, {
    params: { q: 'IPEA expenses parliamentarians expenditure', rows: 8, sort: 'metadata_modified desc' },
    timeout: TIMEOUT_MS,
  });
  const packages = searchResp.data?.result?.results || [];

  // Pick the latest quarterly "Parliamentarians' Expenditure" package
  const pkg = packages.find(p =>
    p.title?.toLowerCase().includes('parliamentarians') &&
    p.title?.toLowerCase().includes('expenditure')
  ) || packages[0];

  if (!pkg) throw new Error('No IPEA package found on data.gov.au');
  console.log(`[au-expenses] Package: "${pkg.title}" (${pkg.id})`);

  // Pick the main expenses resource (active datastore, skip repayments/certs/office costs)
  const resources = pkg.resources || [];
  const mainRes = resources.find(r =>
    r.datastore_active &&
    !r.name?.toLowerCase().includes('repayment') &&
    !r.name?.toLowerCase().includes('certification') &&
    !r.name?.toLowerCase().includes('office cost')
  ) || resources.find(r => r.datastore_active) || resources[0];

  if (!mainRes) throw new Error('No main expenses resource found in IPEA package');
  console.log(`[au-expenses] Resource: "${mainRes.name}" (${mainRes.id}), fetching up to ${AU_EXPENSE_LIMIT} records...`);

  // Fetch records in pages of 500
  const allExpenseRows = [];
  let offset = 0;
  const pageSize = 500;

  while (allExpenseRows.length < AU_EXPENSE_LIMIT) {
    const resp = await axios.get(`${AU_CKAN}/datastore_search`, {
      params: { resource_id: mainRes.id, limit: pageSize, offset },
      timeout: TIMEOUT_MS,
    });
    const rows = resp.data?.result?.records || [];
    if (rows.length === 0) break;
    allExpenseRows.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
    await sleep(300);
  }

  console.log(`[au-expenses] ${allExpenseRows.length} individual expense rows fetched`);

  // Aggregate per member (by OfficeCode + Surname + FirstName)
  const memberMap = {};
  const period = allExpenseRows[0]?.ReportingPeriod || pkg.title.match(/\d{1,2} \w+ to \d{1,2} \w+ \d{4}/)?.[0] || 'unknown';

  for (const row of allExpenseRows) {
    const key = row.OfficeCode || `${row.Surname}_${row.FirstName}`.toLowerCase().replace(/\s+/g, '_');
    if (!memberMap[key]) {
      memberMap[key] = {
        office_code:     row.OfficeCode,
        full_name:       row.FullNameWithTitle,
        surname:         row.Surname,
        first_name:      row.FirstName,
        party:           row.Party,
        electorate:      row.Electorate,
        state:           row.StateOrTerritory,
        homebase:        row.Homebase,
        role:            row.Role,
        reporting_period: row.ReportingPeriod,
        total:           0,
        category_breakdown: {},
        top_expenses:    [],
      };
    }
    const agg    = memberMap[key];
    const amount = parseFloat(row.Amount) || 0;
    agg.total   += amount;

    const cat = row.HighLevelCategory || 'Other';
    agg.category_breakdown[cat] = (agg.category_breakdown[cat] || 0) + amount;

    if (agg.top_expenses.length < 5 && amount > 0) {
      agg.top_expenses.push({
        category:    safeStr(row.HighLevelCategory),
        sub_category: safeStr(row.MajorSubCategory),
        description: safeStr(row.Description),
        from:        safeStr(row.FromLocation),
        to:          safeStr(row.ToLocation),
        from_date:   safeStr(row.FromDate),
        to_date:     safeStr(row.ToDate),
        amount,
      });
    }
  }

  const periodSlug = period.replace(/\s+/g, '_').replace(/[^a-z0-9_]/gi, '').toLowerCase().slice(0, 20);
  const records = Object.entries(memberMap).map(([key, m]) => ({
    id:                `au_${(m.office_code || key).toLowerCase().replace(/[^a-z0-9]/g, '_')}_${periodSlug}`,
    source:            'australia',
    period:            safeStr(period),
    office_code:       safeStr(m.office_code),
    member_name:       safeStr(m.full_name),
    first_name:        safeStr(m.first_name),
    last_name:         safeStr(m.surname),
    party:             safeStr(m.party),
    electorate:        safeStr(m.electorate),
    state:             safeStr(m.state),
    homebase:          safeStr(m.homebase),
    role:              safeStr(m.role),
    total:             Math.round(m.total * 100) / 100,
    category_breakdown: m.category_breakdown,
    top_expenses:      m.top_expenses,
    currency:          'AUD',
    source_url:        `https://data.gov.au/dataset/${pkg.id}`,
  }));

  const result = saveRecords('australia', records, { reportingPeriod: period, packageId: pkg.id });
  console.log(`[au-expenses] ✓ ${result.count} member records → ${result.filepath}`);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchAllMemberExpenses() {
  console.log('[member-expenses] Starting expense fetch for all sources...');
  const results = {};

  try {
    results.canada = await fetchCanadaExpenses();
  } catch (err) {
    console.error('[member-expenses] CA failed:', err.message);
    results.canada = { count: 0, error: err.message };
  }

  try {
    results.usa = await fetchUSExpenses();
  } catch (err) {
    console.error('[member-expenses] US failed:', err.message);
    results.usa = { count: 0, error: err.message };
  }

  try {
    results.uk = await fetchUKExpenses();
  } catch (err) {
    console.error('[member-expenses] UK failed:', err.message);
    results.uk = { count: 0, error: err.message };
  }

  try {
    results.australia = await fetchAUExpenses();
  } catch (err) {
    console.error('[member-expenses] AU failed:', err.message);
    results.australia = { count: 0, error: err.message };
  }

  const total = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);
  console.log(`[member-expenses] Complete — ${total} total expense records written`);
  return results;
}

module.exports = {
  fetchAllMemberExpenses,
  fetchCanadaExpenses,
  fetchUSExpenses,
  fetchUKExpenses,
  fetchAUExpenses,
};

// Direct execution
if (require.main === module) {
  fetchAllMemberExpenses()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
