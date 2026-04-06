/**
 * Corporate Affiliations Fetcher — Civic Voice Engine
 *
 * Fetches real corporate affiliation data for elected members from official
 * government sources. "Corporate affiliation" covers two complementary angles:
 *   (a) companies that have lobbied a member (CA / US)
 *   (b) paid employment and earnings interests declared by a member (UK / AU)
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * CA  open.canada.ca CKAN — Lobbying Communications dataset
 *     Package: 04b97c75-82a7-4716-8231-56e1ebd64e28
 *     Each row is a communication between a company/lobbyist and a Designated
 *     Public Office Holder (DPOH, which includes MPs). We aggregate rows per
 *     DPOH to build a list of corporate entities that have directly contacted
 *     each member.
 *
 * US  lda.senate.gov/api/v1/filings/
 *     Lobbying Disclosure Act (LDA) filings submitted by corporate lobbyists.
 *     Each filing names a registrant (lobbying firm) and a client (the paying
 *     company). We fetch recent filings and record the client companies,
 *     issues lobbied, and spend — giving a view of which corporations are most
 *     active in lobbying Congress.
 *     Also queries /api/v1/registrants/ for the top active registrant firms.
 *
 * UK  members-api.parliament.uk
 *     Category 1 "Employment and earnings" from each MP's Registered Interests.
 *     This is the official record of paid roles outside Parliament — employers,
 *     directorships, consultancies, and remuneration amounts where declared.
 *     Strategy: paginate Members Search (house=1, isCurrentMember=true) then
 *     per-member GET /Members/{id}/RegisteredInterests, filter to employment
 *     category, emit one record per MP with an `employment_interests` array.
 *
 * AU  aph.gov.au/Senators_and_Members/Members/Register  (HTML index)
 *     The Australian Parliament publishes the Register of Interests as per-member
 *     PDFs only — no JSON API exists. We parse the HTML index to capture each
 *     member's name, electorate, state, and disclosure PDF link. Section 2
 *     ("Employment") lives inside the PDF; we surface the PDF URL so the app
 *     can deep-link to the original document.
 *     A `data_note` field explains the PDF-only limitation.
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/corporate_affiliations');
const TIMEOUT_MS = 45_000;

// ─── Output helper ─────────────────────────────────────────────────────────────

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${sourceName}_${timestamp}.json`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));

  console.log(`[corp-affiliations:${sourceName}] Saved ${records.length} records → ${filename}`);
  return { filepath, count: records.length };
}

// ─── Normalisation helpers ─────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 800) || null : null);
const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const slug    = s => s ? s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'unknown';
const sleep   = ms => new Promise(r => setTimeout(r, ms));

// ─── CA: Lobbying Communications per DPOH ─────────────────────────────────────
//
//  The open.canada.ca CKAN Lobbying Communications dataset (same package used
//  by the disclosure fetcher for lobbying activity) contains one row per
//  communication between a registered lobbyist/company and a DPOH (which
//  includes MPs and Senators). Fields vary by resource version; we try both
//  English-specific (_en) and generic field names.
//
//  We fetch the most recent 1 000 communications, then aggregate by dpoh_name:
//    { dpoh_name → { dpoh_title, companies: [ { name, subject, date, regNo } ] } }
//
//  One Firestore doc per DPOH, with the corporate contacts embedded as an array.

const CKAN_BASE    = 'https://open.canada.ca/data/api/3/action';
const CA_LOBBY_PKG = '04b97c75-82a7-4716-8231-56e1ebd64e28';
const CA_ROW_LIMIT = parseInt(process.env.CA_CORP_ROW_LIMIT || '1000', 10);

async function fetchCanadaCorporateAffiliations() {
  console.log('[corp-affiliations:CA] Resolving lobbying communications package…');

  // Step 1 — resolve datastore resource
  const pkgResp = await axios.get(`${CKAN_BASE}/package_show`, {
    params:  { id: CA_LOBBY_PKG },
    timeout: TIMEOUT_MS,
  });

  const resources = pkgResp.data?.result?.resources || [];
  const resource  =
    resources.find(r => r.datastore_active && /en/i.test(r.name || r.description || '')) ||
    resources.find(r => r.datastore_active) ||
    resources[0];

  if (!resource) throw new Error(`No usable resource in CA lobbying package ${CA_LOBBY_PKG}`);
  console.log(`[corp-affiliations:CA] Querying resource ${resource.id} (limit ${CA_ROW_LIMIT})…`);

  // Step 2 — fetch rows sorted most-recent first
  const dataResp = await axios.get(`${CKAN_BASE}/datastore_search`, {
    params:  { resource_id: resource.id, limit: CA_ROW_LIMIT, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows  = dataResp.data?.result?.records || [];
  const total = dataResp.data?.result?.total;
  console.log(`[corp-affiliations:CA] Retrieved ${rows.length} rows (total available: ${total})`);

  // Step 3 — aggregate by DPOH name
  const byDpoh = new Map(); // dpoh_name → { title, contacts: Map<regNo|company, entry> }

  for (const r of rows) {
    // Field names vary across resource versions — try both _en suffixed and plain
    const dpohName = safeStr(
      r.dpoh_name_en || r.dpoh_name || r['Designated public office holder name (English)'] || r.dpoh
    );
    if (!dpohName) continue;

    const dpohTitle = safeStr(
      r.dpoh_title_en || r.dpoh_title || r['Designated public office holder title (English)'] || r.dpoh_position
    );
    const company = safeStr(
      r.registrant_name || r.client_name || r.firm_name || r.organization_name ||
      r['Registrant name'] || r['Subject matter (English)']
    );
    const subject = safeStr(
      r.subject_matter_en || r.subject_matter || r['Subject matter (English)'] || r.subject
    );
    const commDate = safeStr(
      r.communication_date || r.date || r['Communication date'] || r.comm_date
    );
    const regNo = safeStr(
      r.registration_number || r.reg_no || r['Registration number']
    );

    if (!byDpoh.has(dpohName)) {
      byDpoh.set(dpohName, { title: dpohTitle, contacts: new Map() });
    }

    const entry = byDpoh.get(dpohName);
    // Deduplicate contacts by registration number or company name
    const key = regNo || company || 'unknown';
    if (!entry.contacts.has(key)) {
      entry.contacts.set(key, {
        company_name:       company,
        registration_no:    regNo,
        subject_matter:     subject,
        most_recent_date:   commDate,
        communication_count: 0,
      });
    }
    const contact = entry.contacts.get(key);
    contact.communication_count++;
    // Keep the most recent date
    if (commDate && (!contact.most_recent_date || commDate > contact.most_recent_date)) {
      contact.most_recent_date = commDate;
    }
    // Keep the title from whichever row has it
    if (dpohTitle && !entry.title) entry.title = dpohTitle;
  }

  // Step 4 — flatten to records
  const records = [];
  for (const [dpohName, entry] of byDpoh) {
    const contacts = Array.from(entry.contacts.values())
      .sort((a, b) => (b.communication_count - a.communication_count));

    records.push({
      id:                   `ca-corp-dpoh-${slug(dpohName)}`,
      member_name:          dpohName,
      dpoh_title:           entry.title || null,
      jurisdiction:         'CA',
      affiliation_type:     'lobbying_contact',
      corporate_contacts:   contacts,
      total_companies:      contacts.length,
      total_communications: contacts.reduce((s, c) => s + c.communication_count, 0),
      source_url:           'https://lobbycanada.gc.ca',
      data_note: 'Aggregated from Lobbying Communications registry — each entry is a company or registered lobbyist that has contacted this DPOH.',
    });
  }

  return saveRecords('ca_dpoh_corporate_contacts', records, {
    packageId:      CA_LOBBY_PKG,
    resourceId:     resource.id,
    totalRowsFetched: rows.length,
    totalAvailable: total,
    dpohsAggregated: records.length,
    sourceApi:      `${CKAN_BASE}/datastore_search`,
  });
}

// ─── US: LDA Corporate Lobbying Clients & Registrants ─────────────────────────
//
//  lda.senate.gov/api/v1/filings/ returns LDA filings with:
//    filing_uuid, filing_type, filing_year, dt_posted,
//    registrant: { id, name, country, … }
//    client:     { id, name, country, senate_id, … }
//    lobbying_activities: [ { general_issue_code, general_issue_code_display, … } ]
//    income / expenses (quarterly amounts in USD)
//
//  We fetch recent filings for the past two years, deduplicate by client.id,
//  and build a per-company record that aggregates all their filings:
//    { company_name, total_filings, total_income, total_expenses,
//      issues_lobbied: [distinct codes], latest_filing_date,
//      registrants: [firms they hired], … }
//
//  Filing types: 'Q1','Q2','Q3','Q4' (quarterly reports) and 'MR','MM' (mid-year).
//  We fetch the four quarterly types across the last two completed years.

const LDA_BASE         = 'https://lda.senate.gov/api/v1';
const LDA_PAGE_SIZE    = 100;
const LDA_FILING_TYPES = ['Q1', 'Q2', 'Q3', 'Q4'];
const LDA_YEARS_BACK   = parseInt(process.env.LDA_YEARS_BACK || '2', 10);

async function fetchUSCorporateAffiliations() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - LDA_YEARS_BACK; y <= currentYear; y++) years.push(y);

  console.log(`[corp-affiliations:US] Fetching LDA filings for years ${years.join(', ')}…`);

  const allFilings = [];

  for (const year of years) {
    for (const ftype of LDA_FILING_TYPES) {
      try {
        const resp = await axios.get(`${LDA_BASE}/filings/`, {
          params: {
            filing_year: year,
            filing_type: ftype,
            page_size:   LDA_PAGE_SIZE,
            ordering:    '-dt_posted',
          },
          headers: { Accept: 'application/json' },
          timeout: TIMEOUT_MS,
        });
        const results = resp.data?.results || [];
        allFilings.push(...results);
        console.log(`[corp-affiliations:US]   ${year} ${ftype}: ${results.length} filings (total ${resp.data?.count ?? '?'})`);
      } catch (err) {
        console.warn(`[corp-affiliations:US]   ⚠ ${year} ${ftype} failed: ${err.message}`);
      }
    }
  }

  console.log(`[corp-affiliations:US] ${allFilings.length} total filing rows — aggregating by company…`);

  // Aggregate by client.id (or client.name if id is missing)
  const byClient = new Map();

  for (const f of allFilings) {
    const client    = f.client     || {};
    const registrant= f.registrant || {};

    const clientKey  = safeStr(client.id)   || slug(safeStr(client.name) || 'unknown');
    const clientName = safeStr(client.name) || null;
    if (!clientName) continue;

    if (!byClient.has(clientKey)) {
      byClient.set(clientKey, {
        client_id:       safeStr(client.id),
        company_name:    clientName,
        country:         safeStr(client.country),
        senate_id:       safeStr(client.senate_id),
        total_filings:   0,
        total_income:    0,
        total_expenses:  0,
        issues_set:      new Set(),
        registrants_set: new Set(),
        latest_date:     null,
        filing_years:    new Set(),
      });
    }

    const entry = byClient.get(clientKey);
    entry.total_filings++;
    entry.total_income  += safeNum(f.income)   || 0;
    entry.total_expenses+= safeNum(f.expenses) || 0;
    entry.filing_years.add(safeNum(f.filing_year) || f.filing_year);

    const regName = safeStr(registrant.name);
    if (regName) entry.registrants_set.add(regName);

    for (const act of f.lobbying_activities || []) {
      const code = safeStr(act.general_issue_code_display || act.general_issue_code);
      if (code) entry.issues_set.add(code);
    }

    const postedDate = safeStr(f.dt_posted);
    if (postedDate && (!entry.latest_date || postedDate > entry.latest_date)) {
      entry.latest_date = postedDate;
    }
  }

  const records = Array.from(byClient.values())
    .sort((a, b) => b.total_income - a.total_income)
    .map(entry => ({
      id:               `us-corp-lda-${slug(entry.company_name)}`,
      company_name:     entry.company_name,
      client_id:        entry.client_id,
      country:          entry.country,
      senate_id:        entry.senate_id,
      jurisdiction:     'US',
      affiliation_type: 'lobbying_client',
      total_filings:    entry.total_filings,
      total_income_usd: Math.round(entry.total_income),
      total_expenses_usd: Math.round(entry.total_expenses),
      issues_lobbied:   Array.from(entry.issues_set).sort(),
      registrant_firms: Array.from(entry.registrants_set).sort(),
      filing_years:     Array.from(entry.filing_years).sort(),
      latest_filing_date: entry.latest_date,
      source_url:       `https://lda.senate.gov/filings/public/`,
    }));

  return saveRecords('us_lda_corporate_clients', records, {
    yearsQueried:      years,
    filingTypesQueried: LDA_FILING_TYPES,
    totalFilingRows:   allFilings.length,
    totalCompanies:    records.length,
    sourceApi:         `${LDA_BASE}/filings/`,
  });
}

// ─── UK: MPs' Registered Employment and Earnings ──────────────────────────────
//
//  members-api.parliament.uk /api/Members/{id}/RegisteredInterests
//  Returns an array of interest categories. Each category has a `name` and
//  an `interests` array. We filter to the employment/earnings category:
//    Category 1: "Employment and earnings"
//
//  Interest text format varies but typically reads:
//    "Job title, Company Name. Remuneration: £X,XXX for Y hours"
//  We record the raw interest_text along with parsed employer name where possible.
//
//  We fetch up to TARGET_MPs MPs per run (polite paging with delays).

const UK_API        = 'https://members-api.parliament.uk/api';
const UK_PAGE_SIZE  = 20;
const UK_TARGET_MPs = parseInt(process.env.UK_CORP_TARGET_MPs || '150', 10);
const UK_PAGE_DELAY = 300;   // ms between member-search pages
const UK_REQ_DELAY  = 120;   // ms between per-member interest requests

// Employment categories by name fragment (case-insensitive match)
const EMPLOYMENT_CATEGORY_PATTERNS = [
  /employment\s+and\s+earnings/i,
  /employment/i,
  /earnings/i,
  /remunerated/i,
];

function isEmploymentCategory(categoryName) {
  return EMPLOYMENT_CATEGORY_PATTERNS.some(p => p.test(categoryName || ''));
}

async function fetchUKCorporateAffiliations() {
  console.log(`[corp-affiliations:UK] Fetching up to ${UK_TARGET_MPs} current Commons MPs…`);

  // Step 1 — collect members via paginated search
  const members = [];
  for (let skip = 0; members.length < UK_TARGET_MPs; skip += UK_PAGE_SIZE) {
    const pageResp = await axios.get(`${UK_API}/Members/Search`, {
      params:  { house: 1, isCurrentMember: true, skip, take: UK_PAGE_SIZE },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const items = pageResp.data?.items || [];
    if (items.length === 0) break;
    members.push(...items);
    if (items.length < UK_PAGE_SIZE) break; // last page
    if (members.length < UK_TARGET_MPs) await sleep(UK_PAGE_DELAY);
  }

  const batch = members.slice(0, UK_TARGET_MPs);
  console.log(`[corp-affiliations:UK] ${batch.length} MPs retrieved — querying registered interests…`);

  const records = [];
  let mpsWith = 0;

  // Step 2 — per-member interest fetch, filter to employment category
  for (let i = 0; i < batch.length; i++) {
    const member   = batch[i].value || batch[i];
    const memberId = member.id;
    if (!memberId) continue;

    let categories = [];
    try {
      const intResp = await axios.get(`${UK_API}/Members/${memberId}/RegisteredInterests`, {
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      categories = intResp.data?.value || [];
    } catch (err) {
      if (err.response?.status !== 404) {
        console.warn(`[corp-affiliations:UK]   ⚠ interests failed for MP ${memberId}: ${err.message}`);
      }
    }

    // Filter to employment/earnings categories only
    const employmentInterests = [];
    for (const cat of categories) {
      if (!isEmploymentCategory(cat.name)) continue;
      for (const interest of cat.interests || []) {
        const text = safeStr(interest.interest);
        if (!text) continue;

        // Attempt to extract employer name: text usually starts with role/employer
        // Format: "Role, Employer Name. [Additional details.]"
        let employer = null;
        const dotIdx = text.indexOf('.');
        const snippet = dotIdx > 0 ? text.slice(0, dotIdx) : text;
        const commaIdx = snippet.indexOf(',');
        if (commaIdx > 0) {
          // "Role, Employer" → take the part after the first comma as employer
          employer = snippet.slice(commaIdx + 1).trim() || null;
        }

        employmentInterests.push({
          category_id:       interest.id    ?? null,
          category_name:     safeStr(cat.name),
          interest_text:     text,
          employer_name:     employer ? safeStr(employer) : null,
          registered_date:   safeStr(interest.createdWhen),
          last_amended_date: safeStr(interest.lastAmendedWhen),
          deleted_date:      safeStr(interest.deletedWhen) || null,
          child_interests:   (interest.childInterests || [])
                               .map(c => safeStr(c.interest)).filter(Boolean),
        });
      }
    }

    if (employmentInterests.length > 0) mpsWith++;

    const party      = member.latestParty          || {};
    const membership = member.latestHouseMembership || {};

    records.push({
      id:                   `uk-corp-mp-${memberId}`,
      member_id:            memberId,
      member_name:          safeStr(member.nameDisplayAs || member.nameListAs),
      party:                safeStr(party.name),
      party_abbr:           safeStr(party.abbreviation),
      constituency:         safeStr(membership.membershipFrom),
      jurisdiction:         'UK',
      chamber:              'Commons',
      affiliation_type:     'declared_employment',
      employment_interests: employmentInterests,
      employment_count:     employmentInterests.length,
      thumbnail_url:        safeStr(member.thumbnailUrl),
      source_url:           `${UK_API}/Members/${memberId}/RegisteredInterests`,
    });

    if (i < batch.length - 1) await sleep(UK_REQ_DELAY);
  }

  console.log(`[corp-affiliations:UK] ${records.length} MPs — ${mpsWith} with employment interests`);
  const totalInterests = records.reduce((s, r) => s + r.employment_count, 0);

  return saveRecords('uk_mp_employment_interests', records, {
    mpsQueried:           records.length,
    mpsWithInterests:     mpsWith,
    totalInterestEntries: totalInterests,
    sourceApi:            `${UK_API}/Members/{id}/RegisteredInterests`,
    filterCategory:       'Employment and earnings (Category 1)',
  });
}

// ─── AU: Members Register of Interests — Employment section (HTML index) ──────
//
//  The Australian Parliament publishes the Register of Members' Interests as
//  individual PDFs only — no JSON or structured API exists for interest details.
//  Section 2 of each form is "Employment" but it lives inside the PDF.
//
//  We fetch the HTML index page, parse each member's entry (name, electorate,
//  state, PDF URL) and emit one record per member. A `data_note` explains that
//  employment details require opening the linked PDF. The `disclosure_url` field
//  provides the direct link.
//
//  This is consistent with the approach used in memberDisclosureFetcher.js for
//  the same page; here we save to corporate_affiliations/ with affiliation_type
//  set to 'employment_register_pdf' to distinguish it.

const AU_REGISTER_URL = 'https://www.aph.gov.au/Senators_and_Members/Members/Register';
const AU_BASE_URL     = 'https://www.aph.gov.au';

const AU_DATA_NOTE =
  'Employment interests for Australian Members of Parliament are declared in ' +
  'Section 2 ("Employment") of each member\'s individual disclosure form (PDF). ' +
  'No machine-readable API exists. Use disclosure_url to access the full form.';

async function fetchAUCorporateAffiliations() {
  console.log('[corp-affiliations:AU] Fetching Members Register of Interests index…');

  const resp = await axios.get(AU_REGISTER_URL, {
    headers: {
      Accept:       'text/html,application/xhtml+xml',
      'User-Agent': 'CivicVoiceBot/1.0 (civic data aggregator)',
    },
    timeout: TIMEOUT_MS,
  });

  const html = resp.data || '';
  if (typeof html !== 'string' || html.length < 1000) {
    throw new Error('[corp-affiliations:AU] Response too short — page structure may have changed');
  }
  console.log(`[corp-affiliations:AU] Received ${html.length} bytes — parsing register table…`);

  // Concatenate all <tbody> sections (alphabetical groupings on the page)
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
  if (!tbody) throw new Error('[corp-affiliations:AU] Could not locate any <tbody> in register page');

  const rowRe  = /<tr>([\s\S]*?)<\/tr>/g;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  const hrefRe = /href="([^"]+)"/;

  const records = [];
  let rowMatch;

  while ((rowMatch = rowRe.exec(tbody)) !== null) {
    const rowHtml = rowMatch[1];
    cellRe.lastIndex = 0;

    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rowHtml)) !== null) cells.push(cm[1]);
    if (cells.length < 2) continue;

    // Cell 0 — last updated date
    const lastUpdated = cells[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;

    // Cell 1 — "LastName, Title FirstName, Member for Electorate, STATE"
    const rawMeta = cells[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!rawMeta) continue;

    const mforIdx = rawMeta.indexOf(', Member for ');
    let memberName, electorate, state;
    if (mforIdx !== -1) {
      memberName      = rawMeta.slice(0, mforIdx).trim();
      const afterMfor = rawMeta.slice(mforIdx + ', Member for '.length).trim();
      const lastComma = afterMfor.lastIndexOf(',');
      if (lastComma !== -1) {
        electorate = afterMfor.slice(0, lastComma).trim();
        state      = afterMfor.slice(lastComma + 1).trim();
      } else {
        electorate = afterMfor;
        state      = null;
      }
    } else {
      memberName = rawMeta;
      electorate = null;
      state      = null;
    }

    if (!memberName || memberName.length < 3) continue;

    // Cell 2 — disclosure PDF link
    let disclosureUrl = null;
    if (cells[2]) {
      const hm = hrefRe.exec(cells[2]);
      if (hm) {
        disclosureUrl = hm[1].startsWith('http') ? hm[1] : `${AU_BASE_URL}${hm[1]}`;
      }
    }

    const memberSlug = slug(memberName);
    records.push({
      id:               `au-corp-member-${memberSlug}`,
      member_name:      safeStr(memberName),
      electorate:       safeStr(electorate),
      state:            safeStr(state),
      jurisdiction:     'AU',
      chamber:          'House of Representatives',
      affiliation_type: 'employment_register_pdf',
      disclosure_url:   disclosureUrl,
      // Employment details are in Section 2 of the linked PDF — not parseable here
      employment_interests: [],
      employment_count: null,
      register_last_updated: safeStr(lastUpdated),
      data_note:        AU_DATA_NOTE,
      source_url:       AU_REGISTER_URL,
    });
  }

  if (records.length === 0) {
    throw new Error(
      '[corp-affiliations:AU] No rows parsed from register page — structure may have changed. ' +
      'Re-inspect ' + AU_REGISTER_URL
    );
  }

  console.log(`[corp-affiliations:AU] Parsed ${records.length} member entries`);

  return saveRecords('au_members_employment_register', records, {
    sourceUrl:   AU_REGISTER_URL,
    parseMethod: 'html-table-scrape',
    parliament:  '48th Parliament',
    note:        AU_DATA_NOTE,
  });
}

// ─── Main export ───────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'CA — Lobbying Communications per DPOH',     fn: fetchCanadaCorporateAffiliations },
  { name: 'US — LDA Corporate Lobbying Clients',       fn: fetchUSCorporateAffiliations    },
  { name: 'UK — MPs Employment & Earnings Interests',  fn: fetchUKCorporateAffiliations    },
  { name: 'AU — Members Register (Employment PDFs)',   fn: fetchAUCorporateAffiliations    },
];

async function fetchAllCorporateAffiliations() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[corporateAffiliationsFetcher] Starting corporate affiliations ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[corporateAffiliationsFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[corporateAffiliationsFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, status: 'ok', records: result.count });
    } catch (err) {
      console.error(`[corporateAffiliationsFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total      = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[corporateAffiliationsFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60));

  return summary;
}

module.exports = {
  fetchAllCorporateAffiliations,
  fetchCanadaCorporateAffiliations,
  fetchUSCorporateAffiliations,
  fetchUKCorporateAffiliations,
  fetchAUCorporateAffiliations,
};

// ─── CLI entry-point ───────────────────────────────────────────────────────────

if (require.main === module) {
  fetchAllCorporateAffiliations()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
