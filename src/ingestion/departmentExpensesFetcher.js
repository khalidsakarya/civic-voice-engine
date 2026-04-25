'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER  = 'monthly';
const COLLECTION_NAME = 'department_expenses';

const OUTPUT_DIR = path.resolve(__dirname, '../../output/department_expenses');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function safeNum(v) {
  if (v == null || v === '') return null;
  // Strip all non-numeric chars except decimal point and minus sign.
  // This handles garbled currency symbols (£ mangled by latin-1/UTF-8 mismatch),
  // parenthesis-negative format, and any currency prefix.
  const s = String(v).replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}
function saveOutput(jur, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `department_expenses_${jur}_${ts()}.json`);
  fs.writeFileSync(file, JSON.stringify({ records }, null, 2));
  console.log(`[dept-expenses:${jur}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

// Minimal CSV parser (handles quoted fields)
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let field = ''; let fields = []; let inQ = false; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQ = false; } else { field += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { fields.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { fields.push(field); field = ''; rows.push(fields); fields = []; }
      else { field += ch; }
    }
    i++;
  }
  if (field || fields.length) { fields.push(field); rows.push(fields); }
  return rows;
}
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
    return obj;
  });
}

// ZIP parser using Central Directory (handles data-descriptor XLSX files)
function extractZipEntriesFromCD(buf) {
  const entries = {}; let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i]===0x50&&buf[i+1]===0x4B&&buf[i+2]===0x05&&buf[i+3]===0x06) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) return extractZipEntries(buf); // fallback
  const cdOffset     = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let pos = cdOffset;
  for (let e = 0; e < totalEntries; e++) {
    if (pos + 46 > buf.length) break;
    if (!(buf[pos]===0x50&&buf[pos+1]===0x4B&&buf[pos+2]===0x01&&buf[pos+3]===0x02)) break;
    const compMethod  = buf.readUInt16LE(pos + 10);
    const compSize    = buf.readUInt32LE(pos + 20);
    const fnLen       = buf.readUInt16LE(pos + 28);
    const extraLen    = buf.readUInt16LE(pos + 30);
    const commentLen  = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const fn          = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
    const lfhFnLen    = buf.readUInt16LE(localOffset + 26);
    const lfhExtra    = buf.readUInt16LE(localOffset + 28);
    const dataStart   = localOffset + 30 + lfhFnLen + lfhExtra;
    if (compSize > 0) {
      const cd = buf.slice(dataStart, dataStart + compSize);
      try { entries[fn] = (compMethod === 8 ? zlib.inflateRawSync(cd) : cd).toString('utf8'); }
      catch { entries[fn] = ''; }
    } else { entries[fn] = ''; }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

// Lightweight XLSX parser (ZIP + XML, no external deps)
function extractZipEntries(buf) {
  const entries = {}; let i = 0;
  while (i < buf.length - 30) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) { i++; continue; }
    const compression = buf.readUInt16LE(i + 8);
    const compSize    = buf.readUInt32LE(i + 18);
    const nameLen     = buf.readUInt16LE(i + 26);
    const extraLen    = buf.readUInt16LE(i + 28);
    const name        = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart   = i + 30 + nameLen + extraLen;
    const compData    = buf.slice(dataStart, dataStart + compSize);
    let data;
    if (compression === 0) { data = compData; }
    else if (compression === 8) { try { data = zlib.inflateRawSync(compData); } catch { data = compData; } }
    else { data = compData; }
    entries[name] = data.toString('utf8');
    i = dataStart + compSize;
  }
  return entries;
}
function parseSharedStrings(xml) {
  const strings = []; const siRe = /<si>[\s\S]*?<\/si>/g; let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t[^>]*>([^<]*)<\/t>/g; let text = ''; let tm;
    while ((tm = tRe.exec(m[0])) !== null) text += tm[1];
    strings.push(text.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>'));
  }
  return strings;
}
function parseSheet(xml, strings) {
  const rows = []; const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g; let rowM;
  while ((rowM = rowRe.exec(xml)) !== null) {
    const cells = []; const cellRe = /<c\s[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g; let cellM;
    while ((cellM = cellRe.exec(rowM[1])) !== null) {
      const col = colIndex(cellM[1]); const attrs = cellM[2]; const inner = cellM[3];
      const vM = /<v>([^<]*)<\/v>/.exec(inner); let val = vM ? vM[1] : '';
      if (/t="s"/.test(attrs)) val = strings[parseInt(val, 10)] ?? '';
      cells[col] = val.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    }
    rows.push(cells);
  }
  return rows;
}
function colIndex(col) { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

function parseXlsxSheet1(buf) {
  const entries = extractZipEntriesFromCD(buf);
  const strings = parseSharedStrings(entries['xl/sharedStrings.xml'] || '');
  return parseSheet(entries['xl/worksheets/sheet1.xml'] || '', strings);
}

function xlsxRowsToObjects(rows) {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h || '').trim());
  return rows.slice(1).filter(r => r.some(c => c != null && String(c).trim())).map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });
    return obj;
  });
}

// ─── Canada ──────────────────────────────────────────────────────────────────
// Sources: open.canada.ca proactive disclosure travel, hospitality, and
//          acquisition card (credit card) datasets (CKAN datastore_search).

const CA_CKAN    = 'https://open.canada.ca/data/api/3/action';
const CA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept':     'application/json',
  'Referer':    'https://open.canada.ca/',
};

// Known proactive disclosure resource IDs (stable — confirmed via package_show).
// Field 'total' = CAD amount in both travel and hospitality datasets.
// No sort by 'total' — the datastore returns 409 when sorting by 'total' on these resources;
// we fetch a large page of recent records and aggregate client-side.
const CA_PD_RESOURCES = {
  travel:      '8282db2a-878f-475c-af10-ad56aa8fa72c',  // Travel Expenses proactive disclosure
  hospitality: '7b301f1a-2a7a-48bd-9ea9-e0ac4a5313ed',  // Hospitality Expenses proactive disclosure
  // No credit-card (acquisition card) datastore resource confirmed accessible
};

async function caDatastoreFetch(resourceId, limit = 5000, sort = 'start_date desc') {
  const r = await axios.get(`${CA_CKAN}/datastore_search`, {
    params: { resource_id: resourceId, limit, sort },
    headers: CA_HEADERS,
    timeout: 60000,
  });
  return r.data?.result?.records || [];
}

async function fetchCAExpenses() {
  const _ts = new Date().toISOString();
  try {
    console.log('[dept-expenses:CA] Fetching proactive disclosure travel + hospitality (CKAN)...');

    const [travelRows, hospRows] = await Promise.all([
      caDatastoreFetch(CA_PD_RESOURCES.travel,      5000).catch(() => []),
      caDatastoreFetch(CA_PD_RESOURCES.hospitality, 3000).catch(() => []),
    ]);
    console.log(`[dept-expenses:CA] ${travelRows.length} travel / ${hospRows.length} hosp rows`);

    const byOrg = {};
    const ensure = org => { if (!byOrg[org]) byOrg[org] = { travel: 0, hosp: 0, card: 0 }; };

    // Fields: owner_org_title, total (CAD)
    for (const r of travelRows) {
      const org = (r['owner_org_title'] || '').trim(); if (!org) continue;
      ensure(org); byOrg[org].travel += safeNum(r['total']) || 0;
    }
    for (const r of hospRows) {
      const org = (r['owner_org_title'] || '').trim(); if (!org) continue;
      ensure(org); byOrg[org].hosp += safeNum(r['total']) || 0;
    }

    const records = Object.entries(byOrg).map(([dept, d]) => ({
      id:                   `ca-expense-${slug(dept)}`,
      jurisdiction:         'CA',
      department:           dept,
      fiscal_year:          '2024-25',
      travel_expenses:      d.travel || null,
      hospitality_expenses: d.hosp   || null,
      credit_card_spending: null,  // No accessible credit-card datastore resource
      flagged_items:        [],
      currency:             'CAD',
      source_url:           'https://open.canada.ca/en/proactive-disclosure',
    }));

    const count = saveOutput('CA', records);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: CA_CKAN, record_count: count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    return count;
  } catch (err) {
    console.warn(`[dept-expenses:CA] Error: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: CA_CKAN, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return 0;
  }
}

// ─── United States ────────────────────────────────────────────────────────────
// Sources:
//   • USASpending /agency/{code}/object_class/ — travel (OC 21.0) + services (OC 25.x)
//   • clerk.house.gov Statement of Disbursements — Congressional office travel
//   • data.gov GSA SmartPay spend — credit card spending by agency

const US_AGENCIES_URL = 'https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&limit=200';
const TRAVEL_OC_RE    = /travel|transportation of persons/i;
const ENTERTAIN_OC_RE = /^(entertainment|catering|hospitality|representational)/i;

async function fetchUSExpenses() {
  const _ts = new Date().toISOString();
  try {
    const FY = 2025; const CONCUR = 20;

    console.log('[dept-expenses:US] Fetching agency list...');
    const agencyRes = await axios.get(US_AGENCIES_URL, { timeout: 60000 });
    const agencies  = agencyRes.data?.results || [];
    console.log(`[dept-expenses:US] ${agencies.length} agencies — fetching object-class breakdown...`);

    // Per-agency object-class spending
    const ocMap = {};
    for (let i = 0; i < agencies.length; i += CONCUR) {
      await Promise.all(agencies.slice(i, i + CONCUR).map(async ag => {
        try {
          const res = await axios.get(
            `https://api.usaspending.gov/api/v2/agency/${ag.toptier_code}/object_class/?fiscal_year=${FY}&limit=50`,
            { timeout: 20000 }
          );
          ocMap[ag.toptier_code] = res.data?.results || [];
        } catch { ocMap[ag.toptier_code] = []; }
      }));
    }

    // GSA SmartPay credit card data via data.gov
    const smartpayByAgency = {};
    try {
      console.log('[dept-expenses:US] Trying GSA SmartPay data (data.gov catalog)...');
      const catRes = await axios.get('https://catalog.data.gov/api/3/action/package_search', {
        params: { q: 'GSA SmartPay spend agency travel account', rows: 10 },
        timeout: 20000,
      });
      const pkg = (catRes.data?.result?.results || []).find(p => /smartpay/i.test(p.title));
      if (pkg) {
        const csvRes = (pkg.resources || []).find(r => /csv/i.test(r.format || '') && r.url);
        if (csvRes) {
          const csvData = await axios.get(csvRes.url, { timeout: 20000, responseType: 'text' });
          const objs = csvToObjects(csvData.data);
          // SmartPay CSV typically has Agency, Travel Spend, Purchase Spend, Fleet Spend columns
          const agencyCol  = ['Agency', 'Agency Name', 'Department'].find(k => objs[0]?.[k] != null);
          const travelCol  = Object.keys(objs[0] || {}).find(k => /travel/i.test(k));
          if (agencyCol && travelCol) {
            for (const row of objs) {
              const ag  = (row[agencyCol] || '').trim();
              const amt = safeNum(row[travelCol]);
              if (ag && amt) smartpayByAgency[ag] = (smartpayByAgency[ag] || 0) + amt;
            }
            console.log(`[dept-expenses:US] SmartPay: ${Object.keys(smartpayByAgency).length} agency entries`);
          }
        }
      }
    } catch (e) {
      console.log(`[dept-expenses:US] SmartPay data not available: ${e.message}`);
    }

    // clerk.house.gov Statement of Disbursements (Congressional offices)
    const houseByOffice = {};
    try {
      console.log('[dept-expenses:US] Fetching House Statement of Disbursements...');
      // Quarterly bulk CSV: try FY2025 Q1 (Oct–Dec 2024)
      const houseCsvUrl = 'https://disbursements.house.gov/api/disbursements?startDate=2024-10-01&endDate=2025-03-31&limit=500&format=json';
      const houseRes = await axios.get(houseCsvUrl, {
        timeout: 20000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      const items = Array.isArray(houseRes.data) ? houseRes.data
                  : (houseRes.data?.items || houseRes.data?.results || []);
      for (const entry of items) {
        const office = (entry.office || entry.member || entry.payee || '').trim();
        const category = (entry.category || entry.description || '').toLowerCase();
        const amt = safeNum(entry.amount || entry.disbursement_amount);
        if (!office || !amt) continue;
        if (!houseByOffice[office]) houseByOffice[office] = { travel: 0, total: 0 };
        houseByOffice[office].total += amt;
        if (/travel/i.test(category)) houseByOffice[office].travel += amt;
      }
      console.log(`[dept-expenses:US] House disbursements: ${Object.keys(houseByOffice).length} offices`);
    } catch (e) {
      console.log(`[dept-expenses:US] House disbursements not accessible: ${e.message}`);
    }

    // Build executive agency records
    const records = [];
    for (const ag of agencies) {
      const code = ag.toptier_code;
      const ocs  = ocMap[code] || [];
      const travel    = ocs.filter(oc => TRAVEL_OC_RE.test(oc.name)).reduce((s, oc) => s + (oc.obligated_amount || 0), 0) || null;
      const entertain = ocs.filter(oc => ENTERTAIN_OC_RE.test(oc.name)).reduce((s, oc) => s + (oc.obligated_amount || 0), 0) || null;
      // Match SmartPay by agency name (fuzzy)
      const smartKey = Object.keys(smartpayByAgency).find(k => ag.agency_name.includes(k) || k.includes(ag.agency_name.split(' ')[0]));
      const ccSpend  = smartKey ? smartpayByAgency[smartKey] : null;

      records.push({
        id:                   `us-expense-${slug(code + '-' + ag.agency_name)}`,
        jurisdiction:         'US',
        department:           ag.agency_name,
        toptier_code:         code,
        fiscal_year:          String(FY),
        travel_expenses:      travel,
        hospitality_expenses: entertain,
        credit_card_spending: ccSpend,
        flagged_items:        [],
        currency:             'USD',
        source_url:           `https://www.usaspending.gov/agency/${code}`,
      });
    }

    // Append House disbursement records
    for (const [office, data] of Object.entries(houseByOffice)) {
      records.push({
        id:                   `us-house-${slug(office)}`,
        jurisdiction:         'US',
        department:           `[House Office] ${office}`,
        fiscal_year:          '2024-25',
        travel_expenses:      data.travel || null,
        hospitality_expenses: null,
        credit_card_spending: null,
        flagged_items:        [],
        currency:             'USD',
        source_url:           'https://disbursements.house.gov',
      });
    }

    const count = saveOutput('US', records);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: US_AGENCIES_URL, record_count: count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    return count;
  } catch (err) {
    console.warn(`[dept-expenses:US] Error: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: US_AGENCIES_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return 0;
  }
}

// ─── United Kingdom ───────────────────────────────────────────────────────────
// Sources: gov.uk transparency spending-over-£25,000 publications for 9 core
//          Whitehall departments, fetched directly via GOV.UK Content API.
//
// Each department publishes monthly CSV (or ODS for MoD) files at:
//   https://assets.publishing.service.gov.uk/...
// The Content API for each publication lists all attachments; we take the most
// recent one by sorting on the date embedded in the filename.

// Note: 'accommodat' excluded — matches building/estate management in HMCTS/MoJ spend.
// Supplier column excluded from matching — vendor names (e.g. "Network Rail") are not expense categories.
// 'accommodat' uses negative lookahead to exclude building/facilities management context
// (MoJ rows like "ACCOMMODATION & BLDNG MANAGEMENT - Building Fees" are estates, not travel).
const UK_TRAVEL_RE = /\btravel\b|subsistence|\bt\s*&\s*s\b|hotel\b|flight\b|airfare|overseas.{0,10}air\b|uk.{0,10}air\b|train\b|taxi\b|mileage|car\s*hire|vehicle\s*hire|accommodat(?!.{0,40}(building|management|bldng|estate|facilit|property|premises|repair|services))/i;
const UK_HOSP_RE   = /\bhospitality\b|\bentertainment\b|\bcatering\b|representational|refreshment/i;

// Target departments with their GOV.UK org slug and known publication/collection
// path. pubSlug = single publication with all monthly CSVs as attachments.
// collection = collection listing individual month publications.
const UK_DEPTS = [
  { name: 'HM Treasury',                                org: 'hm-treasury',                              searchQ: '"25,000"' },
  { name: 'Home Office',                                org: 'home-office',                               pubSlug: 'home-office-spending-over-25000-2025' },
  { name: 'Cabinet Office',                             org: 'cabinet-office',                            pubSlug: 'cabinet-office-spend-data' },
  { name: 'Ministry of Defence',                        org: 'ministry-of-defence',                       pubSlug: 'mod-spending-over-25000-january-to-december-2026' },
  { name: 'Department of Health and Social Care',       org: 'department-of-health-and-social-care',      searchQ: '"25,000"' },
  { name: 'Department for Education',                   org: 'department-for-education',                  pubSlug: 'dfe-and-executive-agency-spend-over-25000-2025-to-2026' },
  { name: 'Ministry of Justice',                        org: 'ministry-of-justice',                       pubSlug: 'hm-courts-and-tribunals-service-spending-over-25000-2025' },
  { name: 'Department for Transport',                   org: 'department-for-transport',                  collection: 'dft-departmental-spending-over-25000' },
  { name: 'Foreign Commonwealth and Development Office', org: 'foreign-commonwealth-development-office',  altOrg: 'foreign-commonwealth-office', searchQ: '"25,000"' },
];

const GOV_UK_API   = 'https://www.gov.uk/api/content';
const GOV_UK_SRCH  = 'https://www.gov.uk/api/search.json';
const GOV_HEADERS  = { 'User-Agent': 'CivicVoiceBot/1.0', 'Accept': 'application/json' };

// Extract YYYY-MM from an attachment filename for date-based sorting.
// Handles "month-year" (February_2026, oct-25) and "year-month" (2025_nov, 2026-02) patterns.
// Requires year to be in 20xx range to avoid false matches from numbers like "25000".
function attDate(filename) {
  const fn = (filename || '').toLowerCase();
  const mon3 = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
  const monFull = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
                    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
  let m;
  // Full month name before year: february_2026, october-2025
  m = fn.match(/(january|february|march|april|may|june|july|august|september|october|november|december)[^a-z0-9]*(20\d{2})/);
  if (m) return `${m[2]}-${monFull[m[1]]}`;
  // Full month name after year: 2025_october
  m = fn.match(/\b(20\d{2})[^a-z]*(january|february|march|april|may|june|july|august|september|october|november|december)\b/);
  if (m) return `${m[1]}-${monFull[m[2]]}`;
  // Short month before year: nov_25, jan-2026, feb_26
  m = fn.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[^a-z0-9]*(\d{2,4})\b/);
  if (m) { const yr = m[2].length === 2 ? '20' + m[2] : m[2]; if (yr >= '2015' && yr <= '2035') return `${yr}-${mon3[m[1]]}`; }
  // Year before short month: 2025_nov, 2026-jan
  m = fn.match(/(20\d{2})[^a-z]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?![a-z])/);
  if (m) return `${m[1]}-${mon3[m[2]]}`;
  // Year before 2-digit month number: 2025-11, 2026_02, 2025_12
  m = fn.match(/(20\d{2})[^0-9](0[1-9]|1[0-2])(?![0-9])/);
  if (m) return `${m[1]}-${m[2]}`;
  return '0000-00';
}

// Get the most recent CSV or ODS attachment from a publication's content API JSON.
function pickLatestAttachment(pubJson) {
  const atts = (pubJson?.details?.attachments || [])
    .filter(a => /csv|ods|xlsx/i.test(a.content_type || '') || /\.csv$|\.ods$|\.xlsx$/i.test(a.filename || ''))
    .filter(a => a.url);
  if (!atts.length) return null;
  atts.sort((a, b) => attDate(b.filename).localeCompare(attDate(a.filename)));
  return atts[0];
}

// Fetch the most recent attachment URL + metadata for a given department config.
async function ukFindLatestAttachment(dept) {
  // Option A: known publication slug
  if (dept.pubSlug) {
    const r = await axios.get(`${GOV_UK_API}/government/publications/${dept.pubSlug}`, { headers: GOV_HEADERS, timeout: 15000 });
    const att = pickLatestAttachment(r.data);
    if (att) return att;
  }

  // Option B: known collection slug → pick most recent doc → find attachment
  if (dept.collection) {
    const colRes = await axios.get(`${GOV_UK_API}/government/collections/${dept.collection}`, { headers: GOV_HEADERS, timeout: 15000 });
    const docs = (colRes.data?.links?.documents || []).sort((a, b) => (b.public_updated_at || '').localeCompare(a.public_updated_at || ''));
    for (const doc of docs.slice(0, 5)) {
      if (!doc.api_url) continue;
      const docRes = await axios.get(doc.api_url, { headers: GOV_HEADERS, timeout: 15000 });
      const att = pickLatestAttachment(docRes.data);
      if (att) return att;
    }
  }

  // Option C: GOV.UK search for most recent spending-over-25k publication
  for (const org of [dept.org, dept.altOrg].filter(Boolean)) {
    const srch = await axios.get(GOV_UK_SRCH, {
      params: { filter_organisations: org, q: dept.searchQ || '"25,000"', count: 10, order: '-public_timestamp', 'fields[]': 'title,link,public_timestamp' },
      headers: GOV_HEADERS, timeout: 15000,
    });
    const hits = (srch.data?.results || []).filter(h => /spend/i.test(h.title || '') && /25/.test(h.title || ''));
    for (const hit of hits.slice(0, 3)) {
      const pubRes = await axios.get(`${GOV_UK_API}${hit.link}`, { headers: GOV_HEADERS, timeout: 15000 }).catch(() => null);
      if (!pubRes) continue;
      const att = pickLatestAttachment(pubRes.data);
      if (att) return { ...att, _pubTitle: hit.title, _pubDate: hit.public_timestamp };
    }
  }

  return null;
}

// Parse ODS content.xml — extract first table as row arrays.
function parseOdsFirstTable(buf) {
  const entries = extractZipEntries(buf);
  const xml     = entries['content.xml'] || '';
  const tStart  = xml.indexOf('<table:table ');
  const tEnd    = xml.indexOf('</table:table>', tStart);
  if (tStart === -1 || tEnd === -1) return [];
  const tXml = xml.substring(tStart, tEnd + 14);
  const rows = [];
  const rowRe = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
  let rowM;
  while ((rowM = rowRe.exec(tXml)) !== null) {
    const cells = []; const rowXml = rowM[1];
    const cellRe = /<table:table-cell([^>]*?)(\/>|>([\s\S]*?)<\/table:table-cell>)/g;
    let cellM;
    while ((cellM = cellRe.exec(rowXml)) !== null) {
      const attrs = cellM[1]; const content = cellM[3] || '';
      const repM  = attrs.match(/table:number-columns-repeated="(\d+)"/);
      const rep   = repM ? parseInt(repM[1]) : 1;
      if (rep > 50) break;
      const valM  = attrs.match(/office:value="([^"]+)"/);
      const txtM  = content.match(/<text:p[^>]*>([^<]*)<\/text:p>/);
      const val   = valM ? parseFloat(valM[1]) : (txtM ? txtM[1].replace(/&amp;/g,'&') : '');
      for (let r = 0; r < Math.min(rep, 20); r++) cells.push(val);
    }
    if (cells.some(c => c !== '' && c !== 0)) rows.push(cells);
  }
  return rows;
}

// Aggregate travel + hospitality from an array of row objects with heuristic column matching.
// UK spend-over-£25k CSVs have BOTH "Expense type" (broad: resource/capital) and
// "Expense area" (specific: travel, hospitality, etc.).  We must check all category
// columns together so we catch the detail regardless of which dept uses which column.
function aggregateUKSpendRows(objs) {
  if (!objs.length) return { travel: null, hosp: null, total: null, source: null };

  const first = objs[0];
  const keys  = Object.keys(first);

  // Amount column — covers: 'Amount', 'Total' (MoD ODS), ' £ ' (DfT CSV), 'Invoice.GBP.Line.AMT' (FCDO)
  const amtKey = ['Amount', 'TRANSACTION AMOUNT', 'Transaction Amount', 'amount', 'Total', 'total']
    .find(k => first[k] != null)
    || keys.find(k => {
      const kl = k.trim().toLowerCase();
      return (/amount|value|\btotal\b|\bamt\b/.test(kl) || /^\s*[£$€]\s*$/.test(k))
          && !/desc|type|area|supp|date|entity|family|ref/.test(kl);
    });

  // Collect ALL category-like column names; we'll concatenate their values per row.
  const catKeys = keys.filter(k =>
    /expense.*(type|area)|type|categ|desc|area|subject|purpose|expenditure/i.test(k) &&
    !/amount|supplier|date|entity|family|number|ref|transaction/i.test(k)
  );
  let travel = 0, hosp = 0, total = 0;
  for (const row of objs) {
    const amt = safeNum(amtKey ? row[amtKey] : null);
    if (!amt) continue;
    const abs = Math.abs(amt);
    total += abs;
    // Build description from all category columns (NOT supplier — vendor names cause false positives)
    const parts = catKeys.map(k => row[k] || '');
    const desc = parts.join(' ') || Object.values(row).join(' ');
    if (UK_TRAVEL_RE.test(desc)) travel += abs;
    if (UK_HOSP_RE.test(desc))   hosp   += abs;
  }
  return {
    travel: travel ? Math.round(travel) : null,
    hosp:   hosp   ? Math.round(hosp)   : null,
    total:  total  ? Math.round(total)  : null,
  };
}

async function fetchUKExpenses() {
  const _ts = new Date().toISOString();
  try {
    console.log('[dept-expenses:UK] Fetching spending-over-£25k data for 9 core Whitehall departments...');
    const records = [];

    for (const dept of UK_DEPTS) {
      try {
        const att = await ukFindLatestAttachment(dept);
        if (!att) {
          console.log(`[dept-expenses:UK] ${dept.name}: no attachment found`);
          records.push({
            id:                   `uk-expense-${slug(dept.name)}`,
            jurisdiction:         'UK',
            department:           dept.name,
            fiscal_year:          '2024-25',
            travel_expenses:      null,
            hospitality_expenses: null,
            credit_card_spending: null,
            flagged_items:        [],
            currency:             'GBP',
            source_url:           `https://www.gov.uk/government/organisations/${dept.org}`,
            note:                 'No spend-over-£25k publication accessible via GOV.UK Content API',
          });
          continue;
        }

        console.log(`[dept-expenses:UK] ${dept.name}: downloading ${att.filename?.slice(0,60)}...`);
        const resp = await axios.get(att.url, {
          timeout: 30000, responseType: 'arraybuffer',
          headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
        });
        const buf = Buffer.from(resp.data);

        let objs = [];
        if (/ods/i.test(att.content_type || '') || /\.ods$/i.test(att.filename || '')) {
          // ODS: parse first table, convert to objects using first row as headers
          const rows = parseOdsFirstTable(buf);
          if (rows.length > 1) {
            const headers = rows[0].map(h => String(h || '').trim());
            objs = rows.slice(1).map(r => {
              const obj = {}; headers.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); }); return obj;
            });
          }
        } else {
          // CSV or XLSX-as-CSV — try UTF-8 first, fall back to latin1 for legacy gov.uk files
          // (some older CSVs are windows-1252/latin-1 encoded; £ byte 0xA3 is invalid in UTF-8)
          let text = buf.toString('utf8');
          if (text.includes('\uFFFD')) text = buf.toString('latin1');
          objs = csvToObjects(text);
        }

        const { travel, hosp, total } = aggregateUKSpendRows(objs);
        console.log(`[dept-expenses:UK] ${dept.name}: ${objs.length} rows → travel=£${travel?.toLocaleString()||'null'} hosp=£${hosp?.toLocaleString()||'null'}`);

        records.push({
          id:                   `uk-expense-${slug(dept.name)}`,
          jurisdiction:         'UK',
          department:           dept.name,
          fiscal_year:          '2024-25',
          total_spend_over_25k: total,
          travel_expenses:      travel,
          hospitality_expenses: hosp,
          credit_card_spending: null,
          flagged_items:        [],
          currency:             'GBP',
          source_url:           att.url,
          data_file:            att.filename,
        });
      } catch (e) {
        console.warn(`[dept-expenses:UK] ${dept.name}: ${e.message}`);
        records.push({
          id:           `uk-expense-${slug(dept.name)}`,
          jurisdiction: 'UK',
          department:   dept.name,
          fiscal_year:  '2024-25',
          travel_expenses: null, hospitality_expenses: null, credit_card_spending: null,
          flagged_items: [], currency: 'GBP',
          source_url: `https://www.gov.uk/government/organisations/${dept.org}`,
        });
      }
    }

    console.log(`[dept-expenses:UK] ${records.length} dept records`);
    const count = saveOutput('UK', records);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: GOV_UK_API, record_count: count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    return count;
  } catch (err) {
    console.warn(`[dept-expenses:UK] Error: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: GOV_UK_API, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return 0;
  }
}

// ─── Australia ────────────────────────────────────────────────────────────────
// Sources: finance.gov.au annual XLSX — travel, hospitality, and credit card
//          expenses by entity (PGPA transparency obligations, FY2023-24).
//          Falls back to data.gov.au CKAN search.

// finance.gov.au publishes PGPA transparency data annually; try multiple date prefixes.
const AU_FINANCE_PATTERNS = [
  { year: '2023-24', prefixes: ['2024-10', '2024-11', '2024-09', '2025-01'] },
  { year: '2022-23', prefixes: ['2023-10', '2023-11', '2023-09'] },
];
const AU_FINANCE_NAMES = {
  travel:      'travel-expenses-by-entity',
  hospitality: 'hospitality-expenses-by-entity',
  credit:      'credit-card-expenses-by-entity',
};
const AU_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.finance.gov.au/' };

async function fetchAUXlsx(type) {
  for (const { year, prefixes } of AU_FINANCE_PATTERNS) {
    for (const prefix of prefixes) {
      const url = `https://www.finance.gov.au/sites/default/files/${prefix}/${AU_FINANCE_NAMES[type]}-${year}.xlsx`;
      try {
        const resp = await axios.get(url, { timeout: 25000, responseType: 'arraybuffer', headers: AU_HEADERS });
        const rows = xlsxRowsToObjects(parseXlsxSheet1(Buffer.from(resp.data)));
        if (rows.length > 0) {
          console.log(`[dept-expenses:AU] ${type} XLSX: ${rows.length} rows from ${url}`);
          console.log(`[dept-expenses:AU] ${type} columns: ${Object.keys(rows[0] || {}).join(' | ')}`);
          return { rows, year };
        }
      } catch { /* try next */ }
    }
  }
  return { rows: [], year: '2023-24' };
}

async function fetchAUExpenses() {
  const _ts = new Date().toISOString();
  try {
    console.log('[dept-expenses:AU] Downloading finance.gov.au XLSX files (travel / hosp / credit card)...');

    const [travelResult, hospResult, creditResult] = await Promise.allSettled([
      fetchAUXlsx('travel'),
      fetchAUXlsx('hospitality'),
      fetchAUXlsx('credit'),
    ]);

    const travelRows = travelResult.status  === 'fulfilled' ? travelResult.value.rows  : [];
    const hospRows   = hospResult.status    === 'fulfilled' ? hospResult.value.rows    : [];
    const creditRows = creditResult.status  === 'fulfilled' ? creditResult.value.rows  : [];
    const fiscalYear = (travelResult.status === 'fulfilled' ? travelResult.value.year : null)
                    || (hospResult.status   === 'fulfilled' ? hospResult.value.year   : null)
                    || '2023-24';

    console.log(`[dept-expenses:AU] Rows: travel=${travelRows.length}, hosp=${hospRows.length}, credit=${creditRows.length}`);

    // If XLSX fetch failed, fall back to data.gov.au CKAN search
    if (!travelRows.length && !hospRows.length && !creditRows.length) {
      console.log('[dept-expenses:AU] finance.gov.au XLSX not accessible — trying data.gov.au CKAN...');
      const ckanResult = await fetchAUExpensesFromCkan();
      if (ckanResult === 0) {
        // Save a placeholder record documenting the source limitation
        console.warn('[dept-expenses:AU] No AU expense data accessible; finance.gov.au transparency reports not publicly available via API');
      }
      return ckanResult;
    }

    // The finance.gov.au XLSX typically has columns:
    //   Entity | Total Travel Expenses ($) | ... (for travel)
    //   Entity | Total Hospitality Expenses ($) | ...
    //   Entity | Total Credit Card Expenditure ($) | ...
    // We use heuristic column matching.

    const entityKeyGuess = rows => {
      const first = rows[0] || {};
      return ['Entity', 'Entity Name', 'Agency', 'Department', 'Portfolio Entity']
        .find(k => first[k] != null) || Object.keys(first).find(k => /entity|agency|dept/i.test(k));
    };
    const amtKeyGuess = (rows, hint) => {
      const first = rows[0] || {};
      return Object.keys(first).find(k => new RegExp(hint, 'i').test(k))
        || Object.keys(first).find(k => /total|amount|expenditure|expenses/i.test(k));
    };

    const travelEntityKey = entityKeyGuess(travelRows);
    const hospEntityKey   = entityKeyGuess(hospRows);
    const creditEntityKey = entityKeyGuess(creditRows);
    const travelAmtKey    = amtKeyGuess(travelRows, 'travel');
    const hospAmtKey      = amtKeyGuess(hospRows,   'hospitality');
    const creditAmtKey    = amtKeyGuess(creditRows,  'credit|total');

    const byEntity = {};
    const ensure   = e => { if (!byEntity[e]) byEntity[e] = { travel: null, hosp: null, credit: null }; };

    for (const r of travelRows) {
      const e = travelEntityKey ? (r[travelEntityKey] || '').trim() : ''; if (!e) continue;
      ensure(e); const v = safeNum(travelAmtKey ? r[travelAmtKey] : null);
      if (v != null) byEntity[e].travel = (byEntity[e].travel || 0) + v;
    }
    for (const r of hospRows) {
      const e = hospEntityKey ? (r[hospEntityKey] || '').trim() : ''; if (!e) continue;
      ensure(e); const v = safeNum(hospAmtKey ? r[hospAmtKey] : null);
      if (v != null) byEntity[e].hosp = (byEntity[e].hosp || 0) + v;
    }
    for (const r of creditRows) {
      const e = creditEntityKey ? (r[creditEntityKey] || '').trim() : ''; if (!e) continue;
      ensure(e); const v = safeNum(creditAmtKey ? r[creditAmtKey] : null);
      if (v != null) byEntity[e].credit = (byEntity[e].credit || 0) + v;
    }

    const records = Object.entries(byEntity)
      .filter(([, d]) => d.travel != null || d.hosp != null || d.credit != null)
      .map(([entity, d]) => ({
        id:                   `au-expense-${slug(entity)}`,
        jurisdiction:         'AU',
        department:           entity,
        fiscal_year:          fiscalYear,
        travel_expenses:      d.travel,
        hospitality_expenses: d.hosp,
        credit_card_spending: d.credit,
        flagged_items:        [],
        currency:             'AUD',
        source_url:           'https://www.finance.gov.au/government/managing-commonwealth-resources/travel-related-expenses-transparency',
      }));

    console.log(`[dept-expenses:AU] ${records.length} entity records built`);
    const count = saveOutput('AU', records);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: 'https://www.finance.gov.au/government/managing-commonwealth-resources/accountability-transparency-and-reporting', record_count: count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    return count;
  } catch (err) {
    console.warn(`[dept-expenses:AU] Error: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: 'https://www.finance.gov.au/government/managing-commonwealth-resources/accountability-transparency-and-reporting', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return 0;
  }
}

async function fetchAUExpensesFromCkan() {
  try {
    const searchRes = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
      params: { q: 'travel expenses hospitality entities PGPA transparency', rows: 10, sort: 'metadata_modified desc' },
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 20000,
    });
    const pkgs = searchRes.data?.result?.results || [];
    const records = [];

    for (const pkg of pkgs) {
      const res = (pkg.resources || []).find(r => /csv|xlsx/i.test(r.format || '') && r.url);
      if (!res) continue;
      records.push({
        id:                   `au-expense-${slug(pkg.name || pkg.title)}`,
        jurisdiction:         'AU',
        department:           pkg.organization?.title || pkg.title,
        fiscal_year:          '2023-24',
        travel_expenses:      null,
        hospitality_expenses: null,
        credit_card_spending: null,
        flagged_items:        [],
        currency:             'AUD',
        source_url:           res.url,
        note:                 'Dataset discovered via data.gov.au; amounts require further parsing',
      });
    }
    return saveOutput('AU', records);
  } catch (e) {
    console.warn(`[dept-expenses:AU] CKAN fallback error: ${e.message}`);
    return 0;
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllDepartmentExpenses() {
  console.log('\n[dept-expenses] Starting department expenses fetch (CA / US / UK / AU)...');
  const results = await Promise.allSettled([
    fetchCAExpenses(),
    fetchUSExpenses(),
    fetchUKExpenses(),
    fetchAUExpenses(),
  ]);

  const labels = ['CA', 'US', 'UK', 'AU'];
  let total = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      total += r.value;
      console.log(`[dept-expenses:${labels[i]}] ✓ ${r.value} records`);
    } else {
      console.error(`[dept-expenses:${labels[i]}] ✗ ${r.reason?.message || r.reason}`);
    }
  });

  console.log(`[dept-expenses] Done — ${total} total records saved.`);
  return total;
}

module.exports = { fetchAllDepartmentExpenses };

if (require.main === module) {
  fetchAllDepartmentExpenses().then(n => {
    console.log(`Fetched ${n} department expense records.`);
    process.exit(0);
  }).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
