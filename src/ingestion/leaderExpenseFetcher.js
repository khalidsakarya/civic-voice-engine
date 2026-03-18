/**
 * Leader & Minister Personal Expense Fetcher — Civic Voice Engine
 *
 * Fetches individual expense records for the PM and cabinet ministers
 * from four government open-data sources.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CA  open.canada.ca proactive disclosure
 *       Travel:      resource 8282db2a-878f-475c-af10-ad56aa8fa72c
 *       Hospitality: resource 7b301f1a-2a7a-48bd-9ea9-e0ac4a5313ed
 *       Filter: disclosure_group=MPSES (Ministers, Parliamentary Secretaries)
 *
 * US  api.usaspending.gov
 *       Individual cabinet travel is not exposed by USASpending.
 *       Best available: agency object-class spending for travel (class 21)
 *       and travel-service contract awards per cabinet agency.
 *       Note stored in every record.
 *
 * UK  members-api.parliament.uk — current ministers via GovernmentPosts
 *       IPSA (theipsa.org.uk) — expense data; REST API unavailable as of 2026.
 *       Minister list is populated from Parliament API; expense fields
 *       are populated where IPSA bulk data is accessible.
 *
 * AU  data.gov.au IPEA quarterly expenses (CKAN datastore)
 *       Filter: FullNameWithTitle contains "the Hon" (ministerial convention)
 *       Per-line-item records grouped into trip-level aggregates.
 *
 * Output schema per record:
 *   id, person, role, jurisdiction, destination, startDate, endDate,
 *   purpose, transportation, accommodation, mealsEntertainment,
 *   otherExpenses, total, currency, rawCategory, dataNote, sourceUrl
 *
 * Saves to output/expenses/leaders/<JURISDICTION>_<source>_<timestamp>.json
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/expenses/leaders');
const TIMEOUT_MS = 45_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function saveLeaderExpenses(sourceName, jurisdiction, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${jurisdiction}_${sourceName}_${ts}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);
  const payload  = {
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    type:         'leader_expense',
    jurisdiction,
    totalRecords: records.length,
    ...meta,
    records,
  };
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  return { filepath, count: records.length };
}

const safeStr = (v) => (v != null ? String(v).trim().slice(0, 500) || null : null);
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

/** Sleep helper — used between UK Parliament biography calls to avoid 429s */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Canada: Proactive Disclosure — Travel & Hospitality ─────────────────────
//
//  Two CKAN datastore resources are combined:
//    Travel:      8282db2a-878f-475c-af10-ad56aa8fa72c
//    Hospitality: 7b301f1a-2a7a-48bd-9ea9-e0ac4a5313ed
//  disclosure_group = MPSES  →  Ministers, Parliamentary Secretaries, Exempt Staff

const CA_TRAVEL_RESOURCE = '8282db2a-878f-475c-af10-ad56aa8fa72c';
const CA_HOSP_RESOURCE   = '7b301f1a-2a7a-48bd-9ea9-e0ac4a5313ed';

async function fetchCanadaLeaderExpenses() {
  console.log('[expense:CA-leaders] Fetching travel & hospitality proactive disclosure…');

  const ckanSearch = async (resourceId, extraFilters = {}) => {
    const filters = JSON.stringify({ disclosure_group: 'MPSES', ...extraFilters });
    const url = 'https://open.canada.ca/data/api/3/action/datastore_search';
    const resp = await axios.get(url, {
      params: { resource_id: resourceId, limit: 100, sort: 'start_date desc', filters },
      timeout: TIMEOUT_MS,
    });
    return resp.data?.result?.records || [];
  };

  // Travel records — disclosure_group MPSES, prefer title_en=Minister
  const [travelRows, travelMinRows, hospRows] = await Promise.all([
    ckanSearch(CA_TRAVEL_RESOURCE),
    ckanSearch(CA_TRAVEL_RESOURCE, { title_en: 'Minister' }),
    ckanSearch(CA_HOSP_RESOURCE),
  ]);

  // Prefer exact-minister subset, fall back to full MPSES if empty
  const travelData = travelMinRows.length > 0 ? travelMinRows : travelRows;

  const travelRecords = travelData.map((r, i) => ({
    id:               safeStr(r.ref_number || `ca-travel-${i}`),
    person:           safeStr(r.name),
    role:             safeStr(r.title_en),
    jurisdiction:     'CA',
    destination:      safeStr(r.destination_en || r.destination_2_en),
    startDate:        safeStr(r.start_date),
    endDate:          safeStr(r.end_date),
    purpose:          safeStr(r.purpose_en),
    transportation:   safeNum(r.airfare) !== null ? (safeNum(r.airfare) + (safeNum(r.other_transport) || 0)) : safeNum(r.other_transport),
    accommodation:    safeNum(r.lodging),
    mealsEntertainment: safeNum(r.meals),
    otherExpenses:    safeNum(r.other_expenses),
    total:            safeNum(r.total),
    currency:         'CAD',
    rawCategory:      'Travel',
    department:       safeStr(r.owner_org_title),
    dataNote:         null,
    sourceUrl:        'https://open.canada.ca/data/en/dataset/009f9a49-c2d9-4d29-a6d4-1a228da335ce',
  }));

  const hospRecords = hospRows.map((r, i) => ({
    id:               safeStr(r.ref_number || `ca-hosp-${i}`),
    person:           safeStr(r.name),
    role:             safeStr(r.title_en),
    jurisdiction:     'CA',
    destination:      safeStr(r.location_en),
    startDate:        safeStr(r.start_date),
    endDate:          safeStr(r.end_date),
    purpose:          safeStr(r.description_en),
    transportation:   null,
    accommodation:    null,
    mealsEntertainment: safeNum(r.total), // hospitality = food/entertainment
    otherExpenses:    null,
    total:            safeNum(r.total),
    currency:         'CAD',
    rawCategory:      'Hospitality',
    vendor:           safeStr(r.vendor_en),
    employeeAttendees: r.employee_attendees != null ? Number(r.employee_attendees) : null,
    guestAttendees:   r.guest_attendees    != null ? Number(r.guest_attendees)    : null,
    department:       safeStr(r.owner_org_title),
    dataNote:         null,
    sourceUrl:        'https://open.canada.ca/data/en/dataset/b9f51ef4-4605-4ef2-8231-62a2edda1b54',
  }));

  const allRecords = [...travelRecords, ...hospRecords];
  console.log(`[expense:CA-leaders]   travel: ${travelRecords.length}  hospitality: ${hospRecords.length}`);

  return saveLeaderExpenses('canada_minister_expenses', 'CA', allRecords, {
    travelResourceId:      CA_TRAVEL_RESOURCE,
    hospitalityResourceId: CA_HOSP_RESOURCE,
    disclosureGroup:       'MPSES',
  });
}

// ─── USA: Cabinet Agency Travel Spending + Travel Contracts ──────────────────
//
//  USASpending.gov does not expose individual cabinet member travel records.
//  Best available:
//    1. Agency-level object-class 21 (Travel and transportation of persons)
//       GET /api/v2/agency/{toptier_code}/object_class/?fiscal_year=2025
//    2. Travel-service contract awards (PSC V = Transportation/Travel)
//       POST /api/v2/search/spending_by_award/
//
//  Each record maps to the current Secretary/head of that agency.

const US_CABINET_AGENCIES = [
  { code: '1100', name: 'Executive Office of the President',     secretary: 'President / Chief of Staff',      role: 'President' },
  { code: '019',  name: 'Department of State',                   secretary: 'Secretary of State',              role: 'Secretary' },
  { code: '015',  name: 'Department of Justice',                 secretary: 'Attorney General',                role: 'Secretary' },
  { code: '020',  name: 'Department of the Treasury',            secretary: 'Secretary of the Treasury',       role: 'Secretary' },
  { code: '097',  name: 'Department of Defense',                 secretary: 'Secretary of Defense',            role: 'Secretary' },
  { code: '075',  name: 'Department of Health and Human Services', secretary: 'Secretary of HHS',              role: 'Secretary' },
  { code: '070',  name: 'Department of Homeland Security',       secretary: 'Secretary of Homeland Security',  role: 'Secretary' },
  { code: '012',  name: 'Department of Agriculture',             secretary: 'Secretary of Agriculture',        role: 'Secretary' },
  { code: '013',  name: 'Department of Commerce',                secretary: 'Secretary of Commerce',           role: 'Secretary' },
  { code: '014',  name: 'Department of the Interior',            secretary: 'Secretary of the Interior',       role: 'Secretary' },
  { code: '017',  name: 'Department of Labor',                   secretary: 'Secretary of Labor',              role: 'Secretary' },
  { code: '036',  name: 'Department of Veterans Affairs',        secretary: 'Secretary of Veterans Affairs',   role: 'Secretary' },
  { code: '089',  name: 'Department of Energy',                  secretary: 'Secretary of Energy',             role: 'Secretary' },
  { code: '091',  name: 'Department of Education',               secretary: 'Secretary of Education',          role: 'Secretary' },
  { code: '086',  name: 'Department of Housing and Urban Development', secretary: 'Secretary of HUD',         role: 'Secretary' },
  { code: '069',  name: 'Department of Transportation',          secretary: 'Secretary of Transportation',     role: 'Secretary' },
];

async function fetchUSLeaderExpenses() {
  console.log('[expense:US-leaders] Fetching agency travel spending from USASpending…');

  // Current fiscal year (US FY starts Oct)
  const now   = new Date();
  const fy    = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  const period = 9; // Use period 9 (June end) as a stable snapshot

  const records = [];

  for (const agency of US_CABINET_AGENCIES) {
    try {
      process.stdout.write(`[expense:US-leaders]   ${agency.name.slice(0, 45).padEnd(45)}… `);

      // ── Object-class breakdown for this agency ─────────────────────────────
      let travelAmount = null;
      for (let page = 1; page <= 3; page++) {
        const resp = await axios.get(
          `https://api.usaspending.gov/api/v2/agency/${agency.code}/object_class/`,
          { params: { fiscal_year: fy, fiscal_period: period, page }, timeout: TIMEOUT_MS }
        );
        const results = resp.data?.results || [];
        const travelEntry = results.find(r =>
          (r.name || '').toLowerCase().includes('travel and transportation')
        );
        if (travelEntry) {
          travelAmount = travelEntry.obligated_amount ?? travelEntry.gross_outlay_amount ?? null;
          break;
        }
        if (!resp.data?.page_metadata?.hasNext) break;
      }

      // ── Travel-service contracts (PSC V) for this agency ──────────────────
      let travelContractTotal = null;
      try {
        const awardsResp = await axios.post(
          'https://api.usaspending.gov/api/v2/search/spending_by_award/',
          {
            filters: {
              award_type_codes: ['A', 'B', 'C', 'D'],
              psc_codes: { require: [['Service', 'V']], exclude: [] },
              agencies: [{ type: 'awarding', tier: 'toptier', name: agency.name }],
              time_period: [{ start_date: `${fy - 1}-10-01`, end_date: `${fy}-09-30` }],
            },
            fields: ['Award ID', 'Award Amount', 'Description', 'PSC', 'Recipient Name', 'Start Date', 'End Date'],
            limit: 10,
            page: 1,
            sort: 'Award Amount',
            order: 'desc',
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
        );
        const awards = awardsResp.data?.results || [];
        travelContractTotal = awards.reduce((s, a) => s + (a['Award Amount'] || 0), 0) || null;
      } catch (_) { /* contracts lookup optional */ }

      records.push({
        id:               `us-${agency.code}-fy${fy}`,
        person:           agency.secretary,
        role:             agency.role,
        jurisdiction:     'US',
        destination:      null,
        startDate:        `${fy - 1}-10-01`,
        endDate:          `${fy}-09-30`,
        purpose:          'Agency-wide travel obligations (fiscal year aggregate)',
        transportation:   travelAmount,
        accommodation:    null,
        mealsEntertainment: null,
        otherExpenses:    travelContractTotal,
        total:            travelAmount,
        currency:         'USD',
        rawCategory:      'Federal Travel',
        department:       agency.name,
        fiscalYear:       fy,
        dataNote:         'USASpending does not expose individual cabinet travel records. '
                        + '"transportation" = agency object-class 21 obligations (travel & transportation of persons). '
                        + '"otherExpenses" = sum of PSC-V travel-service contract awards for this agency.',
        sourceUrl:        `https://api.usaspending.gov/api/v2/agency/${agency.code}/object_class/`,
      });

      console.log(`travel $${travelAmount != null ? (travelAmount / 1e6).toFixed(1) + 'M' : '—'}`);
    } catch (err) {
      console.error(`  ✗ ${agency.name}: ${err.message}`);
    }

    await sleep(200); // gentle rate limiting
  }

  return saveLeaderExpenses('us_cabinet_travel', 'US', records, {
    fiscalYear: fy,
    dataLimitation: 'Individual person-level travel expense records are not publicly available via USASpending.gov. Records represent aggregate fiscal-year travel obligations per cabinet department.',
  });
}

// ─── UK: Parliament Posts API → current ministers + IPSA bulk CSV ─────────────
//
//  Step 1: GET /api/Posts/GovernmentPosts → list of ministerial post IDs
//  Step 2: GET /api/Posts/{id}/Occupancy  → current holder (member ID + name)
//  Step 3: GET /api/Members/{id}/Biography → confirm role + party
//  IPSA:   No REST API available as of 2026.
//          Expense fields are left null with a dataNote.
//          IPSA publishes annual bulk data at theipsa.org.uk/mp-costs/

const PARLIAMENT_BASE = 'https://members-api.parliament.uk/api';

async function fetchUKLeaderExpenses() {
  console.log('[expense:UK-leaders] Fetching current ministers from Parliament API…');

  // ── Step 1: Fetch all government posts ────────────────────────────────────
  let posts = [];
  try {
    const resp = await axios.get(`${PARLIAMENT_BASE}/Posts/GovernmentPosts`, { timeout: TIMEOUT_MS });
    posts = resp.data?.value || resp.data?.items || [];
    if (posts.length === 0 && Array.isArray(resp.data)) posts = resp.data;
  } catch (err) {
    console.warn('[expense:UK-leaders] GovernmentPosts failed:', err.message);
  }

  // Fallback: search Members with current government post by iterating biographies
  // (used when the Posts endpoint is unavailable or returns empty)
  if (posts.length === 0) {
    console.log('[expense:UK-leaders] Falling back to Member biography scan…');
    const membResp = await axios.get(`${PARLIAMENT_BASE}/Members/Search`, {
      params: { IsCurrentMember: true, House: 1, skip: 0, take: 650 },
      timeout: TIMEOUT_MS,
    });
    const allMembers = (membResp.data?.items || []).map(i => i.value || i);
    let ministerCount = 0;

    for (const m of allMembers) {
      try {
        await sleep(80); // ~12 req/s — stays within rate limits
        const bioResp = await axios.get(`${PARLIAMENT_BASE}/Members/${m.id}/Biography`, { timeout: 15_000 });
        const govPosts = bioResp.data?.value?.governmentPosts || [];
        const current  = govPosts.find(p => !p.endDate);
        if (current) {
          posts.push({
            _memberId:   m.id,
            _memberName: m.nameDisplayAs,
            _party:      m.latestParty?.name,
            name:        current.name,
          });
          ministerCount++;
          if (ministerCount % 10 === 0) {
            console.log(`[expense:UK-leaders]   ${ministerCount} ministers found so far…`);
          }
        }
      } catch (_) { /* skip bio failures */ }
    }
    console.log(`[expense:UK-leaders] Biography scan complete: ${ministerCount} ministers`);
  }

  // ── Step 2: Resolve member details for posts (when using Posts endpoint) ──
  const ministerRecords = [];
  for (const post of posts) {
    let memberId   = post._memberId ?? null;
    let memberName = post._memberName ?? null;
    let party      = post._party ?? null;

    if (!memberId && post.id) {
      try {
        await sleep(80);
        const occResp = await axios.get(`${PARLIAMENT_BASE}/Posts/${post.id}/Occupancy`, { timeout: 15_000 });
        const occupancy = occResp.data?.value?.[0] || occupancy?.items?.[0];
        memberId   = occupancy?.member?.id ?? null;
        memberName = occupancy?.member?.nameDisplayAs ?? null;
      } catch (_) { /* skip */ }
    }

    ministerRecords.push({
      id:               `uk-minister-${memberId ?? post.id ?? ministerRecords.length}`,
      person:           safeStr(memberName || post._memberName),
      role:             safeStr(post.name),
      jurisdiction:     'UK',
      destination:      null,
      startDate:        null,
      endDate:          null,
      purpose:          null,
      transportation:   null,
      accommodation:    null,
      mealsEntertainment: null,
      otherExpenses:    null,
      total:            null,
      currency:         'GBP',
      rawCategory:      null,
      party,
      parliamentId:     memberId,
      dataNote:         'IPSA (Independent Parliamentary Standards Authority) does not expose a public REST API as of 2026. '
                      + 'Expense amounts unavailable programmatically. '
                      + 'See https://www.theipsa.org.uk/mp-costs/ for manual access.',
      sourceUrl:        memberId
                        ? `https://members.parliament.uk/member/${memberId}/expenses`
                        : 'https://members-api.parliament.uk/api/Posts/GovernmentPosts',
    });
  }

  console.log(`[expense:UK-leaders] ${ministerRecords.length} minister records assembled`);

  return saveLeaderExpenses('uk_minister_list', 'UK', ministerRecords, {
    dataLimitation: 'IPSA expense amounts unavailable via public API. Minister identities sourced from Parliament Members API.',
    ipsaManualDataUrl: 'https://www.theipsa.org.uk/mp-costs/',
  });
}

// ─── Australia: IPEA Quarterly Expense Data ───────────────────────────────────
//
//  IPEA publishes per-line-item expenses for all parliamentarians quarterly.
//  Find latest package → get main expenses resource → filter "the Hon" → aggregate.
//
//  "the Hon" is the parliamentary convention for ministers; PM and ministers
//  always have this prefix in FullNameWithTitle.

async function fetchAULeaderExpenses() {
  console.log('[expense:AU-leaders] Finding latest IPEA quarterly package…');

  // ── Find latest IPEA package ───────────────────────────────────────────────
  const searchResp = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
    params: { q: 'IPEA expenses', rows: 5, sort: 'metadata_modified desc' },
    timeout: TIMEOUT_MS,
  });

  const packages = searchResp.data?.result?.results || [];
  // Pick the latest quarterly package (title contains "Parliamentarians' Expenditure")
  const pkg = packages.find(p =>
    p.title?.toLowerCase().includes('parliamentarians') &&
    p.title?.toLowerCase().includes('expenditure')
  ) || packages[0];

  if (!pkg) throw new Error('No IPEA package found on data.gov.au');
  console.log(`[expense:AU-leaders] Using package: "${pkg.title}" (${pkg.id})`);

  // ── Find the main expenses resource (not repayments/certifications) ────────
  const resources = pkg.resources || [];
  const mainResource = resources.find(r =>
    r.name?.toLowerCase().includes('dataextract') &&
    !r.name?.toLowerCase().includes('repayment') &&
    !r.name?.toLowerCase().includes('certification') &&
    !r.name?.toLowerCase().includes('adjustment') &&
    !r.name?.toLowerCase().includes('office')
  ) || resources.find(r => r.datastore_active) || resources[0];

  if (!mainResource) throw new Error('No main expenses resource found in IPEA package');
  console.log(`[expense:AU-leaders] Resource: ${mainResource.name} (${mainResource.id})`);

  // ── Fetch expense records ──────────────────────────────────────────────────
  const dataResp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
    params: {
      resource_id: mainResource.id,
      limit: 500,
      sort: 'Amount desc',
      // No server-side filter for ministers — filter client-side
    },
    timeout: TIMEOUT_MS,
  });

  const rows = dataResp.data?.result?.records || [];
  const totalAvailable = dataResp.data?.result?.total;
  console.log(`[expense:AU-leaders] ${rows.length} / ${totalAvailable} rows fetched`);

  // ── Filter for ministers ("the Hon" prefix) ────────────────────────────────
  const ministerRows = rows.filter(r => {
    const name = (r.FullNameWithTitle || r.Name || '').toLowerCase();
    return name.includes('the hon') || name.includes('hon.') || name.includes('prime minister');
  });
  console.log(`[expense:AU-leaders] ${ministerRows.length} minister rows after filtering`);

  // ── Group line items into trip-level records ───────────────────────────────
  // Key: person + TripSequence (if available) or date range
  const tripMap = {};
  for (const r of ministerRows) {
    const person   = safeStr(r.FullNameWithTitle || r.Name);
    const tripKey  = r.TripSequence
      ? `${person}::${r.TripSequence}`
      : `${person}::${r.FromDate}::${r.ToDate}::${r.ToLocation}`;

    if (!tripMap[tripKey]) {
      tripMap[tripKey] = {
        id:               `au-${r.UniqueId || r._id || Object.keys(tripMap).length}`,
        person,
        role:             safeStr(r.Role || 'Parliamentarian'),
        party:            safeStr(r.Party),
        jurisdiction:     'AU',
        destination:      safeStr(r.ToLocation),
        startDate:        safeStr(r.FromDate),
        endDate:          safeStr(r.ToDate),
        purpose:          safeStr(r.ReasonForTravel || r.Description),
        transportation:   0,
        accommodation:    0,
        mealsEntertainment: 0,
        otherExpenses:    0,
        total:            0,
        currency:         'AUD',
        electorate:       safeStr(r.Electorate),
        state:            safeStr(r.StateOrTerritory),
        reportingPeriod:  safeStr(r.ReportingPeriod),
        dataNote:         null,
        sourceUrl:        `https://www.ipea.gov.au/resources/data/${pkg.name || pkg.id}`,
      };
    }

    const trip = tripMap[tripKey];
    const amt  = safeNum(r.Amount) || 0;
    const cat  = (r.HighLevelCategory || r.MajorSubCategory || '').toLowerCase();

    // Accumulate into the right bucket
    if (cat.includes('fare') || cat.includes('transport') || cat.includes('vehicle') || cat.includes('travel')) {
      trip.transportation += amt;
    } else if (cat.includes('accommodation') || cat.includes('allowance') || cat.includes('night')) {
      trip.accommodation += amt;
    } else if (cat.includes('meal') || cat.includes('catering') || cat.includes('entertainment')) {
      trip.mealsEntertainment += amt;
    } else {
      trip.otherExpenses += amt;
    }
    trip.total += amt;

    // Keep best destination / purpose
    if (!trip.destination && r.ToLocation)     trip.destination = safeStr(r.ToLocation);
    if (!trip.purpose    && r.ReasonForTravel) trip.purpose     = safeStr(r.ReasonForTravel);

    // Use rawCategory as comma-joined unique list
    const existingCats = new Set((trip.rawCategory || '').split(', ').filter(Boolean));
    if (r.HighLevelCategory) existingCats.add(r.HighLevelCategory);
    trip.rawCategory = [...existingCats].join(', ') || null;
  }

  const records = Object.values(tripMap);
  // Round all currency fields to 2 dp
  for (const rec of records) {
    for (const k of ['transportation', 'accommodation', 'mealsEntertainment', 'otherExpenses', 'total']) {
      rec[k] = rec[k] !== 0 ? Math.round(rec[k] * 100) / 100 : null;
    }
  }

  return saveLeaderExpenses('au_minister_expenses', 'AU', records, {
    packageId:         pkg.id,
    packageTitle:      pkg.title,
    resourceId:        mainResource.id,
    resourceName:      mainResource.name,
    totalAvailable,
    ministerFilter:    '"the Hon" in FullNameWithTitle',
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'Canada  — Ministerial Travel & Hospitality', fn: fetchCanadaLeaderExpenses },
  { name: 'USA     — Cabinet Agency Travel Spending',   fn: fetchUSLeaderExpenses     },
  { name: 'UK      — Parliament Minister List + IPSA',  fn: fetchUKLeaderExpenses     },
  { name: 'AU      — IPEA Ministerial Expenses',        fn: fetchAULeaderExpenses     },
];

async function fetchAllLeaderExpenses() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[leaderExpenseFetcher] Starting leader expense ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[leaderExpenseFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[leaderExpenseFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, status: 'ok', records: result.count, file: result.filepath });
    } catch (err) {
      console.error(`[leaderExpenseFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, status: 'error', error: err.message, records: 0 });
    }
  }

  const total = summary.reduce((s, r) => s + r.records, 0);
  const durationMs = Date.now() - startedAt;

  console.log('\n' + '='.repeat(60));
  console.log(`[leaderExpenseFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60) + '\n');

  return summary;
}

module.exports = { fetchAllLeaderExpenses, fetchCanadaLeaderExpenses, fetchUSLeaderExpenses, fetchUKLeaderExpenses, fetchAULeaderExpenses };

// Run directly when invoked as a script
if (require.main === module) {
  fetchAllLeaderExpenses()
    .then(summary => process.exit(summary.some(r => r.status === 'error') ? 1 : 0))
    .catch(err => { console.error('[leaderExpenseFetcher] Fatal:', err.message); process.exit(1); });
}
