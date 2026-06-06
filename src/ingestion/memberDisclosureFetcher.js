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
 *
 * CA   open.canada.ca CKAN    — Lobbyist Registry / Communication Reports
 *
 * UK   members-api.parliament.uk — MPs' Registered Interests
 *      Step 1: GET /api/Members/Search?house=1&isCurrentMember=true&take=N
 *      Step 2: GET /api/Members/{id}/RegisteredInterests  (per MP)
 *      No auth required. Full OpenAPI spec at members-api.parliament.uk/swagger.
 *
 * AU   aph.gov.au              — Members' Register of Interests (HTML index)
 *      The official register has no API; data exists only as PDFs per member.
 *      We fetch the HTML register index page and parse member names, electorates,
 *      parties, and disclosure PDF links — all real data from the live page.
 *      Endpoint: GET https://www.aph.gov.au/Senators_and_Members/Members/Register
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER          = 'bimonthly';
const COLLECTION_NAME_DISC    = 'member_disclosures';
const COLLECTION_NAME_LOBBY   = 'member_lobbying';
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
  const _ts = new Date().toISOString();
  const year      = CURRENT_YEAR - 1; // most recent completed year
  const fromDate  = `${year}-01-01`;
  const toDate    = `${year}-12-31`;

  try {
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
  const result = saveRecords(OUTPUT_DISCLOSURES, 'us_house_disclosures', records, {
    filingYear:     year,
    totalAvailable: total,
    sourceApi:      'https://efts.house.gov/EFTS-Public/query',
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://efts.house.gov/EFTS-Public/query', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://efts.house.gov/EFTS-Public/query', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
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
  const _ts = new Date().toISOString();
  try {
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

  const result = saveRecords(OUTPUT_LOBBYING, 'ca_lobbying_communications', records, {
    packageId:      CA_LOBBY_PKG,
    resourceId:     resource.id,
    resourceName:   safeStr(resource.name),
    totalAvailable: total,
    sourceApi:      `${CKAN_BASE}/datastore_search`,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME_LOBBY, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://open.canada.ca/data/api/3/action/datastore_search', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME_LOBBY, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://open.canada.ca/data/api/3/action/datastore_search', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
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
  const _ts  = new Date().toISOString();
  const VALID_TYPES = ['Q1', 'Q2', 'Q3', 'Q4'];
  // Fetch the two most recent years so we always have recent data
  const years = [CURRENT_YEAR - 1, CURRENT_YEAR];
  const allRecords = [];
  let totalFetched = 0;

  try {
  for (const year of years) {
    for (const filing_type of VALID_TYPES) {
      try {
        console.log(`[lobbying:US] Querying LDA ${filing_type} ${year}…`);
        const resp = await axios.get('https://lda.senate.gov/api/v1/filings/', {
          params: { filing_year: year, filing_type, page_size: 25, ordering: '-dt_posted' },
          headers: { Accept: 'application/json' },
          timeout: TIMEOUT_MS,
        });
        const results = resp.data?.results || [];
        totalFetched += results.length;
        for (const f of results) {
          const reg    = f.registrant || {};
          const client = f.client     || {};
          allRecords.push({
            id:              safeStr(f.filing_uuid || `us-lda-${f.id}`),
            filing_uuid:     safeStr(f.filing_uuid),
            filing_type:     safeStr(f.filing_type_display || f.filing_type),
            filing_year:     safeNum(f.filing_year) || year,
            filing_period:   safeStr(f.filing_period_display || f.filing_period),
            registrant_name: safeStr(reg.name),
            registrant_id:   safeStr(reg.id),
            client_name:     safeStr(client.name),
            client_id:       safeStr(client.id),
            income:          safeNum(f.income),
            expenses:        safeNum(f.expenses),
            posted_date:     safeStr(f.dt_posted),
            lobbying_issues: (f.lobbying_activities || [])
                               .map(a => safeStr(a.general_issue_code_display || a.general_issue_code))
                               .filter(Boolean)
                               .join('; ') || null,
            jurisdiction:    'US',
            sourceUrl:       `https://lda.senate.gov/filings/public/filing/${f.filing_uuid}/view/`,
          });
        }
      } catch (innerErr) {
        // Skip quarters that fail (e.g. future quarters return 400)
        console.warn(`[lobbying:US] Skipping ${filing_type} ${year}: ${innerErr.message}`);
      }
    }
  }

  // Deduplicate by filing_uuid
  const seen = new Set();
  const records = allRecords.filter(r => {
    if (!r.filing_uuid || seen.has(r.filing_uuid)) return false;
    seen.add(r.filing_uuid);
    return true;
  });

  console.log(`[lobbying:US] ${records.length} unique filings from ${totalFetched} fetched`);

  const result = saveRecords(OUTPUT_LOBBYING, 'us_senate_lda_filings', records, {
    yearsQueried:   years,
    typesQueried:   VALID_TYPES,
    totalFetched,
    sourceApi:      'https://lda.senate.gov/api/v1/filings/',
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME_LOBBY, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://lda.senate.gov/api/v1/filings/', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME_LOBBY, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://lda.senate.gov/api/v1/filings/', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── UK Parliament: MPs' Registered Financial Interests ──────────────────────
//
//  members-api.parliament.uk (no auth required, full OpenAPI spec available)
//
//  Strategy:
//    Step 1 — Search active Commons MPs (house=1, isCurrentMember=true).
//             Fetch up to TAKE_MPs members per run.
//    Step 2 — For each MP fetch /Members/{id}/RegisteredInterests.
//             Response: { value: [ { id, name, sortOrder, interests: [{…}] } ] }
//    Step 3 — Flatten: one Firestore doc per MP, interests embedded as array.
//
//  Registered interest categories (from the Register of Members' Financial
//  Interests): employment, shareholdings, land/property, gifts, visits, misc.
//  Each interest has: id, interest (text), createdWhen, lastAmendedWhen.

const UK_MEMBERS_API = 'https://members-api.parliament.uk/api';
const PAGE_SIZE      = 20;   // API hard cap per page
const TARGET_MPs     = 60;   // fetch this many MPs per run (3 pages × 20)
const INTER_REQ_MS   = 150;  // polite delay between per-member interest requests
const INTER_PAGE_MS  = 300;  // delay between member-search pages

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchUKMPsRegisteredInterests() {
  const _ts = new Date().toISOString();
  try {
  console.log(`[disclosures:UK] Fetching up to ${TARGET_MPs} current Commons MPs (paginating ${PAGE_SIZE}/page)…`);

  // Step 1 — paginate the Members Search to collect TARGET_MPs members
  const items = [];
  for (let skip = 0; items.length < TARGET_MPs; skip += PAGE_SIZE) {
    const pageResp = await axios.get(`${UK_MEMBERS_API}/Members/Search`, {
      params: { house: 1, isCurrentMember: true, skip, take: PAGE_SIZE },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const pageItems = pageResp.data?.items || [];
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    if (pageItems.length < PAGE_SIZE) break; // last page
    if (items.length < TARGET_MPs) await sleep(INTER_PAGE_MS);
  }

  const batch = items.slice(0, TARGET_MPs);
  if (batch.length === 0) throw new Error('[disclosures:UK] No members returned from Search');
  console.log(`[disclosures:UK] Retrieved ${batch.length} MPs — fetching registered interests…`);

  const records = [];

  // Step 2 — fetch interests for each MP
  for (let i = 0; i < batch.length; i++) {
    const member   = batch[i].value || batch[i];
    const memberId = member.id;
    if (!memberId) continue;

    let categories = [];
    try {
      const intResp = await axios.get(`${UK_MEMBERS_API}/Members/${memberId}/RegisteredInterests`, {
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      categories = intResp.data?.value || [];
    } catch (err) {
      // A 404 means the member has no registered interests on record — skip quietly
      if (err.response?.status !== 404) {
        console.warn(`[disclosures:UK]   ⚠ interests fetch failed for MP ${memberId}: ${err.message}`);
      }
    }

    // Step 3 — flatten interests into a searchable list
    const flatInterests = [];
    for (const cat of categories) {
      for (const interest of cat.interests || []) {
        flatInterests.push({
          category_id:       interest.id        ?? null,
          category_name:     safeStr(cat.name),
          interest_text:     safeStr(interest.interest),
          registered_date:   safeStr(interest.createdWhen),
          last_amended_date: safeStr(interest.lastAmendedWhen),
          deleted_date:      safeStr(interest.deletedWhen) || null,
          is_correction:     interest.isCorrection ?? false,
          // child interests (e.g. sub-entries under a shareholding)
          child_interests: (interest.childInterests || []).map(c => safeStr(c.interest)).filter(Boolean),
        });
      }
    }

    const party      = member.latestParty || {};
    const membership = member.latestHouseMembership || {};

    records.push({
      id:                `uk-mp-${memberId}`,
      member_id:         memberId,
      member_name:       safeStr(member.nameDisplayAs || member.nameListAs),
      name_list_as:      safeStr(member.nameListAs),
      party:             safeStr(party.name),
      party_abbr:        safeStr(party.abbreviation),
      constituency:      safeStr(membership.membershipFrom),
      gender:            safeStr(member.gender),
      membership_start:  safeStr(membership.membershipStartDate),
      is_active:         membership.membershipStatus?.statusIsActive ?? null,
      interests_count:   flatInterests.length,
      interests:         flatInterests,
      thumbnail_url:     safeStr(member.thumbnailUrl),
      jurisdiction:      'UK',
      chamber:           'Commons',
      sourceUrl:         `https://members-api.parliament.uk/api/Members/${memberId}/RegisteredInterests`,
    });

    if (i < batch.length - 1) await sleep(INTER_REQ_MS);
  }

  const totalInterests = records.reduce((s, r) => s + r.interests_count, 0);
  console.log(`[disclosures:UK] ${records.length} MPs, ${totalInterests} interest entries`);

  const result = saveRecords(OUTPUT_DISCLOSURES, 'uk_mp_registered_interests', records, {
    mpsReturned:      records.length,
    totalInterests,
    sourceApi:        `${UK_MEMBERS_API}/Members/{id}/RegisteredInterests`,
    parliamentaryHouse: 'Commons',
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: 'https://members-api.parliament.uk/api', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: 'https://members-api.parliament.uk/api', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── Australia: Members' Register of Interests (HTML index) ──────────────────
//
//  The Australian Parliament has no API for the register of interests.
//  All disclosures are individual PDFs linked from the HTML index page at:
//    https://www.aph.gov.au/Senators_and_Members/Members/Register
//
//  We fetch that page and parse:
//    • Member full name
//    • Electorate
//    • State
//    • Party (if present in the link text / surrounding markup)
//    • Disclosure document URL (absolute link to the PDF or HTML form)
//    • Last updated date (shown next to each member's entry)
//
//  Parsing uses targeted regex patterns against the raw HTML. The APH page
//  structure has been stable; we match <a> tags inside the register table and
//  the "Last updated" text adjacent to each row.

const AU_REGISTER_URL = 'https://www.aph.gov.au/Senators_and_Members/Members/Register';
const AU_BASE_URL     = 'https://www.aph.gov.au';

// Parse the 48th Parliament Members' Register of Interests index page.
//
// Confirmed table structure (live as of 2026-04):
//   <thead><tr>
//     <th class="date">Last updated</th>
//     <th>Member name and electorate</th>
//     <th class="format"></th>
//   </tr></thead>
//   <tbody>
//     <tr>
//       <td class="date">10 October 2025</td>
//       <td>Abdo, Mr Basem, Member for Calwell, VIC </td>
//       <td class="format">
//         <a href="/-/media/.../Abdo_48P.pdf"><img title="520KB" … /></a>
//       </td>
//     </tr>
//     …
//   </tbody>
//
// Column 2 format: "LastName, Title FirstName, Member for Electorate, STATE"
// We split on ", Member for " to isolate the name and electorate+state parts.

async function fetchAUMembersRegister() {
  const _ts = new Date().toISOString();
  try {
  console.log('[disclosures:AU] Fetching Members Register of Interests index page…');

  const resp = await axios.get(AU_REGISTER_URL, {
    headers: {
      Accept:       'text/html,application/xhtml+xml',
      'User-Agent': 'CivicVoiceBot/1.0 (civic data aggregator)',
    },
    timeout: TIMEOUT_MS,
  });

  const html = resp.data || '';
  if (typeof html !== 'string' || html.length < 1000) {
    throw new Error('[disclosures:AU] Response too short — page structure may have changed');
  }
  console.log(`[disclosures:AU] Received ${html.length} bytes — parsing register table…`);

  // The register page splits members across 6 <tbody> sections (one per
  // alphabetical group). Concatenate all of them before parsing rows.
  let tbody = '';
  let searchFrom = 0;
  while (true) {
    const start = html.indexOf('<tbody>', searchFrom);
    if (start === -1) break;
    const end = html.indexOf('</tbody>', start);
    if (end === -1) break;
    tbody += html.slice(start, end + 8);
    searchFrom = end + 8;
  }
  if (!tbody) {
    throw new Error('[disclosures:AU] Could not locate any <tbody> in register page');
  }

  // Match each <tr>…</tr> in the tbody
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  // Within a row, match the three <td> contents in order:
  //   td[0]: class="date"  → last updated date text
  //   td[1]: no class      → "LastName, Title FirstName, Member for Electorate, STATE"
  //   td[2]: class="format"→ contains <a href="…pdf">
  const cellRe  = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const hrefRe  = /href="([^"]+)"/;

  const records = [];
  let rowMatch;

  while ((rowMatch = rowRe.exec(tbody)) !== null) {
    const rowHtml = rowMatch[1];
    cellRe.lastIndex = 0; // reset since we reuse the regex

    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rowHtml)) !== null) {
      cells.push(cm[1]); // raw inner HTML of this cell
    }
    if (cells.length < 2) continue; // header or empty row

    // Cell 0 — date
    const lastUpdated = cells[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;

    // Cell 1 — "LastName, Title FirstName, Member for Electorate, STATE"
    const rawMeta = cells[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!rawMeta) continue;

    // Split "Name part, Member for Electorate, STATE"
    const mforIdx = rawMeta.indexOf(', Member for ');
    let memberName, electorate, state;
    if (mforIdx !== -1) {
      memberName        = rawMeta.slice(0, mforIdx).trim();
      const afterMfor   = rawMeta.slice(mforIdx + ', Member for '.length).trim();
      // afterMfor = "Electorate, STATE" — last comma-separated token is the state
      const lastComma   = afterMfor.lastIndexOf(',');
      if (lastComma !== -1) {
        electorate = afterMfor.slice(0, lastComma).trim();
        state      = afterMfor.slice(lastComma + 1).trim();
      } else {
        electorate = afterMfor;
        state      = null;
      }
    } else {
      // Fallback: no "Member for" — treat entire text as name
      memberName = rawMeta;
      electorate = null;
      state      = null;
    }

    if (!memberName || memberName.length < 3) continue;

    // Cell 2 — PDF href (optional: some rows may only have 2 cells)
    let disclosureUrl = null;
    if (cells[2]) {
      const hm = hrefRe.exec(cells[2]);
      if (hm) {
        disclosureUrl = hm[1].startsWith('http') ? hm[1] : `${AU_BASE_URL}${hm[1]}`;
      }
    }

    const slug = memberName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    records.push({
      id:             `au-member-register-${slug}`,
      member_name:    safeStr(memberName),
      electorate:     safeStr(electorate),
      state:          safeStr(state),
      disclosure_url: disclosureUrl,
      last_updated:   safeStr(lastUpdated),
      jurisdiction:   'AU',
      chamber:        'House of Representatives',
      register_type:  'Members Register of Interests',
      parliament:     '48th Parliament',
      sourceUrl:      AU_REGISTER_URL,
    });
  }

  if (records.length === 0) {
    throw new Error(
      '[disclosures:AU] No member rows parsed — page structure may have changed. ' +
      'Re-inspect tbody content at ' + AU_REGISTER_URL
    );
  }

  console.log(`[disclosures:AU] Parsed ${records.length} member entries`);

  const result = saveRecords(OUTPUT_DISCLOSURES, 'au_members_register_of_interests', records, {
    sourceUrl:    AU_REGISTER_URL,
    parseMethod:  'html-table-scrape',
    parliament:   '48th Parliament',
    note:         'Full interest details are in individual PDFs per member — this index captures member list, electorate, state, and disclosure PDF links.',
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: 'https://www.aph.gov.au/Senators_and_Members/Members/Register', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME_DISC, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: 'https://www.aph.gov.au/Senators_and_Members/Members/Register', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── Staleness check ─────────────────────────────────────────────────────────
//
//  Skip the full fetch if any output file in both output directories was written
//  within the last STALE_DAYS days. This prevents redundant API hammering when
//  the quarterly scheduler fires but data is already fresh.

const STALE_DAYS = 85; // ~3 months

function isDataFresh(outputDir) {
  if (!fs.existsSync(outputDir)) return false;
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.json'));
  if (files.length === 0) return false;
  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  return files.some(f => {
    const stat = fs.statSync(path.join(outputDir, f));
    return stat.mtimeMs > cutoff;
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'US House — Financial Disclosures (EFTS)',       fn: fetchUSHouseDisclosures,       type: 'disclosures' },
  { name: 'UK     — MPs Registered Interests (Parliament)', fn: fetchUKMPsRegisteredInterests, type: 'disclosures' },
  { name: 'AU     — Members Register of Interests (APH)',  fn: fetchAUMembersRegister,        type: 'disclosures' },
  { name: 'CA     — Lobbying Communications (CKAN)',       fn: fetchCanadaLobbying,           type: 'lobbying'    },
  { name: 'US     — Senate LDA Lobbying Filings',         fn: fetchUSFederalLobbying,        type: 'lobbying'    },
];

async function fetchAllMemberData() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[memberDisclosureFetcher] Starting member data ingestion');
  console.log('='.repeat(60));

  // Skip entirely if both output directories have files fresher than STALE_DAYS
  if (isDataFresh(OUTPUT_DISCLOSURES) && isDataFresh(OUTPUT_LOBBYING)) {
    console.log(`[memberDisclosureFetcher] ⏭ Data is fresh (< ${STALE_DAYS} days old) — skipping fetch.`);
    console.log('[memberDisclosureFetcher] Delete output/member_disclosures/ and output/member_lobbying/ to force a re-fetch.');
    return [
      { source: 'staleness-check', type: 'skipped', status: 'skipped', records: 0, reason: `fresh data found (< ${STALE_DAYS} days)` },
    ];
  }

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

module.exports = {
  fetchAllMemberData,
  fetchUSHouseDisclosures,
  fetchUKMPsRegisteredInterests,
  fetchAUMembersRegister,
  fetchCanadaLobbying,
  fetchUSFederalLobbying,
};

if (require.main === module) {
  fetchAllMemberData().then(summary => {
    process.exit(summary.some(r => r.status === 'error') ? 1 : 0);
  }).catch(err => {
    console.error('[memberDisclosureFetcher] Fatal:', err.message);
    process.exit(1);
  });
}
