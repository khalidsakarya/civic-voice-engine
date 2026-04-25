'use strict';

require('dotenv').config();

const axios = require('axios');
const zlib  = require('zlib');
const { getDb } = require('../firebase/client');

// ─── Browser headers (AU data.gov.au requires them) ───────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,text/csv,*/*',
};

// ─── Fuzzy name matching ──────────────────────────────────────────────────────

const STRIP_PREFIXES = [
  /^the\s+/i,
  /^department\s+of\s+the\s+/i,
  /^department\s+of\s+/i,
  /^department\s+for\s+/i,
  /^ministry\s+of\s+/i,
  /^office\s+of\s+the\s+/i,
  /^office\s+of\s+/i,
  /^agency\s+for\s+/i,
  /^agency\s+of\s+/i,
  /^his\s+majesty.s\s+/i,
  /^her\s+majesty.s\s+/i,
];

function normalizeName(raw) {
  let s = (raw || '').toLowerCase()
    .replace(/\s*\|.*$/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const re of STRIP_PREFIXES) s = s.replace(re, '');
  return s.trim();
}

function findBestMatch(deptName, officialMap) {
  const nn = normalizeName(deptName);
  if (!nn) return null;
  if (officialMap[nn]) return officialMap[nn];

  let best = null, bestScore = 0;
  for (const [k, entry] of Object.entries(officialMap)) {
    let score = 0;
    if (k.startsWith(nn) || nn.startsWith(k)) score = 0.9;
    else if (k.includes(nn) || nn.includes(k))  score = 0.8;
    else {
      const ta = new Set(nn.split(' ').filter(t => t.length > 3));
      const tb = new Set(k.split(' ').filter(t => t.length > 3));
      if (ta.size && tb.size) {
        const intersect = [...ta].filter(t => tb.has(t)).length;
        const union     = new Set([...ta, ...tb]).size;
        score = intersect / union;
      }
    }
    if (score > bestScore && score >= 0.45) { bestScore = score; best = entry; }
  }
  return best;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let field = ''; let fields = []; let inQ = false; let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQ = false; } else { field += ch; }
    } else {
      if (ch === '"')       { inQ = true; }
      else if (ch === ',')  { fields.push(field); field = ''; }
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { fields.push(field); field = ''; rows.push(fields); fields = []; }
      else                  { field += ch; }
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
    headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
    return obj;
  });
}

// ─── XLSX parser ──────────────────────────────────────────────────────────────

function colIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

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
    if (compression === 0)      { data = compData; }
    else if (compression === 8) { try { data = zlib.inflateRawSync(compData); } catch { data = compData; } }
    else                        { data = compData; }
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
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

function parseSheet(xml, strings) {
  const rows = []; const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g; let rowM;
  while ((rowM = rowRe.exec(xml)) !== null) {
    const cells = []; const cellRe = /<c\s[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g; let cellM;
    while ((cellM = cellRe.exec(rowM[1])) !== null) {
      const col = colIndex(cellM[1]); const attrs = cellM[2]; const inner = cellM[3];
      const vM  = /<v>([^<]*)<\/v>/.exec(inner); let val = vM ? vM[1] : '';
      if (/t="s"/.test(attrs)) val = strings[parseInt(val, 10)] ?? '';
      cells[col] = decodeXmlEntities(val);
    }
    rows.push(cells);
  }
  return rows;
}

function parseXlsxSheetByName(buf, sheetName) {
  const entries = extractZipEntries(buf);
  const wbRels  = entries['xl/_rels/workbook.xml.rels'] || '';
  const relMap  = {};
  [...wbRels.matchAll(/<Relationship[^>]+>/g)].forEach(m => {
    const idM = m[0].match(/\bId="([^"]+)"/); const tM = m[0].match(/\bTarget="([^"]+)"/);
    if (idM && tM) relMap[idM[1]] = tM[1];
  });
  const wbXml = entries['xl/workbook.xml'] || '';
  const shM   = [...wbXml.matchAll(/<sheet\s[^>]*/g)]
    .map(m => ({
      name: (m[0].match(/name="([^"]+)"/) || [])[1],
      rId:  (m[0].match(/r:id="([^"]+)"/) || [])[1],
    }))
    .find(s => s.name === sheetName);
  if (!shM) return [];
  const sheetFile = relMap[shM.rId]; if (!sheetFile) return [];
  const strings   = parseSharedStrings(entries['xl/sharedStrings.xml'] || '');
  return parseSheet(entries[`xl/${sheetFile}`] || '', strings);
}

function listXlsxSheets(buf) {
  const entries = extractZipEntries(buf);
  const wbXml   = entries['xl/workbook.xml'] || '';
  return [...wbXml.matchAll(/<sheet\s[^>]*/g)]
    .map(m => (m[0].match(/name="([^"]+)"/) || [])[1])
    .filter(Boolean);
}

// ─── CA: GC InfoBase Estimates CSV ───────────────────────────────────────────

const CA_CKAN_PKG   = 'a35cf382-690c-4221-a971-cf0fd189a46f';
const CA_SOURCE_URL = `https://open.canada.ca/data/dataset/${CA_CKAN_PKG}`;

async function fetchCAOfficial() {
  console.log('[validator:CA] Fetching GC InfoBase Estimates CSV...');
  const pkgRes = await axios.get(
    `https://open.canada.ca/data/api/3/action/package_show?id=${CA_CKAN_PKG}`,
    { timeout: 30000 }
  );
  const resources = pkgRes.data?.result?.resources || [];
  const estRes = resources.find(r =>
    /abv_apc_en/i.test(r.url || '') ||
    /Estimates.*Budgetary Authorities by Vote/i.test(r.name || '')
  );
  if (!estRes) throw new Error('CA Estimates CSV resource not found in package');

  const resp = await axios.get(estRes.url, {
    timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
  });
  const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));

  const orgMap = {};
  for (const r of rows) {
    const fy  = r['fy_ef']        || '';
    const org = r['organization'] || '';
    const amt = safeNum(r['authorities']);
    if (!org || amt == null) continue;
    if (!orgMap[org] || fy > orgMap[org].fy) orgMap[org] = { fy, total: 0 };
    if (fy === orgMap[org].fy) orgMap[org].total += amt;
  }

  const result = {};
  for (const [org, data] of Object.entries(orgMap)) {
    result[normalizeName(org)] = { original: org, value: data.total };
  }
  console.log(`[validator:CA] ${Object.keys(result).length} orgs from Estimates CSV`);
  return result;
}

// ─── US: USASpending.gov agency budgetary resources ──────────────────────────

const US_AGENCIES_URL = 'https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&limit=200';
const US_BUD_RES_URL  = code => `https://api.usaspending.gov/api/v2/agency/${code}/budgetary_resources/`;
const CURRENT_FY      = 2025;

async function fetchUSOfficial() {
  console.log('[validator:US] Fetching USASpending agency budgetary resources (FY2025)...');
  const agencyRes = await axios.get(US_AGENCIES_URL, { timeout: 60000 });
  const agencies  = agencyRes.data?.results || [];
  const CONCUR    = 20;

  const budgetByCode = {};
  for (let i = 0; i < agencies.length; i += CONCUR) {
    await Promise.all(agencies.slice(i, i + CONCUR).map(async ag => {
      try {
        const res  = await axios.get(US_BUD_RES_URL(ag.toptier_code), { timeout: 20000 });
        const fy25 = (res.data?.agency_data_by_year || []).find(y => y.fiscal_year === CURRENT_FY);
        budgetByCode[ag.toptier_code] = fy25?.agency_budgetary_resources ?? null;
      } catch { budgetByCode[ag.toptier_code] = null; }
    }));
  }

  const result = {};
  for (const ag of agencies) {
    result[normalizeName(ag.agency_name)] = {
      original:   ag.agency_name,
      value:      budgetByCode[ag.toptier_code] ?? null,
      code:       ag.toptier_code,
      source_url: `https://www.usaspending.gov/agency/${ag.toptier_code}`,
    };
  }
  console.log(`[validator:US] ${Object.keys(result).length} agencies from USASpending`);
  return result;
}

// ─── UK: HM Treasury Main Supply Estimates — all DEL/AME sheets ──────────────

const UK_DEL_URL    = 'https://assets.publishing.service.gov.uk/media/6827211850dbd3ce8372ab24/2025-26_Mains_DEL_tables_for_publication.xlsx';
const UK_MULTIPLIER = 1_000_000_000; // £billion → GBP
const UK_DEL_SKIP   = /^total|^of which|^note|^source|^\d{4}|^department|^table|^£|^resource|^capital/i;
// Sheets in this file: 'RDEL inc', 'RDEL ex', 'CDEL', 'Direct impact of tax changes'
const UK_BUDGET_SHEETS = ['RDEL inc', 'RDEL ex', 'CDEL'];

async function fetchUKOfficial() {
  console.log('[validator:UK] Downloading HM Treasury Main Supply Estimates XLSX...');
  const resp = await axios.get(UK_DEL_URL, { timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5 });
  const buf  = Buffer.from(resp.data);

  const availableSheets = listXlsxSheets(buf);
  const sheetsToTry = UK_BUDGET_SHEETS.filter(s => availableSheets.includes(s));
  console.log(`[validator:UK] Parsing sheets: ${sheetsToTry.join(', ')}`);

  const result = {};
  for (const sheetName of sheetsToTry) {
    try {
      const rows = parseXlsxSheetByName(buf, sheetName);
      let added = 0;
      for (const r of rows) {
        const name = String(r[1] || '').trim();
        if (!name || name.length < 3 || UK_DEL_SKIP.test(name)) continue;
        let totalBudget = null;
        for (let ci = 2; ci < Math.min((r.length || 0), 20); ci++) {
          const n = safeNum(r[ci]);
          if (n !== null && Math.abs(n) > 0) { totalBudget = n; break; }
        }
        if (totalBudget === null) continue;
        const cleanName = name.replace(/\d+$/, '').trim();
        const key = normalizeName(cleanName);
        if (!result[key]) {
          result[key] = { original: cleanName, value: Math.round(totalBudget * UK_MULTIPLIER) };
          added++;
        }
      }
      console.log(`[validator:UK]   "${sheetName}": +${added} new entries`);
    } catch (e) {
      console.warn(`[validator:UK]   "${sheetName}" failed: ${e.message}`);
    }
  }

  console.log(`[validator:UK] ${Object.keys(result).length} total departments from HM Treasury XLSX`);
  return result;
}

// ─── UK: gov.uk org lookup for unverified agencies ───────────────────────────

const GOVUK_ORG_API  = slug => `https://www.gov.uk/api/content/government/organisations/${slug}`;
const GOVUK_ORG_PAGE = slug => `https://www.gov.uk/government/organisations/${slug}`;
const STOP_WORDS     = new Set(['and', 'of', 'the', 'for', 'a', 'an', 'in', 'to', 'at', 'by', 'on']);

function govukSlugCandidates(name) {
  const base = normalizeName(name);
  const full  = base.replace(/\s+/g, '-');
  const short = base.split(' ').filter(w => !STOP_WORDS.has(w)).join('-');
  const candidates = [short, full];
  // dedupe while preserving order
  return [...new Set(candidates)].filter(s => s.length >= 3);
}

async function tryGovukOrgUrl(deptName) {
  for (const slug of govukSlugCandidates(deptName)) {
    try {
      const res = await axios.get(GOVUK_ORG_API(slug), {
        timeout: 8000,
        validateStatus: s => s < 500,
      });
      if (res.status === 200 && res.data?.title) {
        return GOVUK_ORG_PAGE(slug);
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

// ─── AU: PAES 2025-26 program expenses — multi-source with browser headers ───

const AU_CKAN_PKG   = 'f84698ea-c749-4ff2-a5c5-e4b5a4d819e1';
const AU_CKAN_RES   = '8b7149fa-5882-4feb-8b20-89a25e6abac2';
const AU_CKAN_API   = 'https://data.gov.au/data/api/3/action';
const AU_PAES_URL   = `https://data.gov.au/data/dataset/${AU_CKAN_PKG}/resource/${AU_CKAN_RES}/download/2025-26-paes-program-expenses-line-items.csv`;
const AU_SOURCE_URL = `https://data.gov.au/data/dataset/${AU_CKAN_PKG}`;
const AU_MULTIPLIER = 1_000; // AUD thousands → AUD

function buildAUMap(byAgency) {
  const result = {};
  for (const [agency, total] of Object.entries(byAgency)) {
    result[normalizeName(agency)] = { original: agency, value: Math.round(total * AU_MULTIPLIER) };
  }
  console.log(`[validator:AU] ${Object.keys(result).length} agencies from PAES data`);
  return result;
}

function parseAUCsv(buf) {
  const rows = csvToObjects(buf.toString('utf8'));
  const byAgency = {};
  for (const r of rows) {
    const agency = r['Agency Name'] || '';
    const val    = safeNum(r['2025-26']);
    if (!agency || val == null) continue;
    byAgency[agency] = (byAgency[agency] || 0) + val;
  }
  return byAgency;
}

async function fetchAUOfficial() {
  // Attempt 1: CKAN package_show → fresh download URL (browser headers bypass 403)
  try {
    console.log('[validator:AU] Fetching PAES CSV via CKAN package_show...');
    const pkgRes = await axios.get(`${AU_CKAN_API}/package_show?id=${AU_CKAN_PKG}`,
      { timeout: 30000, headers: BROWSER_HEADERS });
    const resources = pkgRes.data?.result?.resources || [];
    const target = resources.find(r => r.id === AU_CKAN_RES) || resources.find(r => /paes.*program.*expense/i.test(r.name || ''));
    if (target?.url) {
      const resp = await axios.get(target.url, {
        timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
        headers: { ...BROWSER_HEADERS, Referer: 'https://data.gov.au/' },
      });
      return buildAUMap(parseAUCsv(Buffer.from(resp.data)));
    }
  } catch (e) { console.warn(`[validator:AU] CKAN package_show failed: ${e.message}`); }

  // Attempt 2: direct PAES URL with browser headers
  try {
    console.log('[validator:AU] Trying direct PAES URL with browser headers...');
    const resp = await axios.get(AU_PAES_URL, {
      timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5,
      headers: { ...BROWSER_HEADERS, Referer: 'https://data.gov.au/' },
    });
    return buildAUMap(parseAUCsv(Buffer.from(resp.data)));
  } catch (e) { console.warn(`[validator:AU] Direct PAES URL failed: ${e.message}`); }

  // Attempt 3: CKAN datastore_search (JSON — some installs allow this when download is blocked)
  try {
    console.log('[validator:AU] Trying CKAN datastore API...');
    const res = await axios.get(
      `${AU_CKAN_API}/datastore_search?resource_id=${AU_CKAN_RES}&limit=5000`,
      { timeout: 60000, headers: BROWSER_HEADERS }
    );
    if (res.data?.success && Array.isArray(res.data.result?.records) && res.data.result.records.length > 0) {
      const byAgency = {};
      for (const r of res.data.result.records) {
        const agency = r['Agency Name'] || '';
        const val    = safeNum(r['2025-26']);
        if (!agency || val == null) continue;
        byAgency[agency] = (byAgency[agency] || 0) + val;
      }
      return buildAUMap(byAgency);
    }
  } catch (e) { console.warn(`[validator:AU] CKAN datastore failed: ${e.message}`); }

  console.warn('[validator:AU] All AU sources failed — AU depts will be self-reported');
  return {};
}

// ─── Build a single validation result ────────────────────────────────────────

function buildResult(dept, match, defaultSourceUrl, ts) {
  const stored = dept.budget_authority ?? null;

  if (!match || match.value == null) {
    return {
      jurisdiction:    dept.jurisdiction,
      department:      dept.department_name,
      department_id:   dept.department_id || null,
      currency:        dept.currency      || null,
      stored_value:    stored,
      official_value:  null,
      official_name:   null,
      discrepancy_pct: null,
      status:          'unverified',
      source_url:      defaultSourceUrl,
      validated_at:    ts,
    };
  }

  if (stored == null) {
    return {
      jurisdiction:    dept.jurisdiction,
      department:      dept.department_name,
      department_id:   dept.department_id || null,
      currency:        dept.currency      || null,
      stored_value:    null,
      official_value:  match.value,
      official_name:   match.original,
      discrepancy_pct: null,
      status:          'unverified',
      source_url:      match.source_url || defaultSourceUrl,
      validated_at:    ts,
    };
  }

  const discrepancy_pct = Math.abs(stored - match.value) / Math.max(Math.abs(match.value), 1) * 100;
  const rounded         = Math.round(discrepancy_pct * 100) / 100;

  return {
    jurisdiction:    dept.jurisdiction,
    department:      dept.department_name,
    department_id:   dept.department_id || null,
    currency:        dept.currency      || null,
    stored_value:    stored,
    official_value:  match.value,
    official_name:   match.original,
    discrepancy_pct: rounded,
    status:          rounded <= 5 ? 'verified' : 'mismatch',
    source_url:      match.source_url || defaultSourceUrl,
    validated_at:    ts,
  };
}

// ─── Validate one jurisdiction ────────────────────────────────────────────────

function validateJurisdiction(depts, officialMap, defaultSourceUrl, ts) {
  return depts.map(dept => {
    let match = findBestMatch(dept.department_name, officialMap);

    // US fallback: extract toptier_code from stored department_id (us-dept-{code}-{slug})
    if (!match && dept.jurisdiction === 'US' && dept.department_id) {
      const codeM = dept.department_id.match(/^us-dept-(\d{3})-/);
      if (codeM) {
        const code   = codeM[1];
        const byCode = Object.values(officialMap).find(v => v.code === code);
        if (byCode) match = byCode;
      }
    }

    return buildResult(dept, match, defaultSourceUrl, ts);
  });
}

// ─── Summarise results ────────────────────────────────────────────────────────

function summarise(jur, results) {
  const verified      = results.filter(r => r.status === 'verified').length;
  const mismatch      = results.filter(r => r.status === 'mismatch').length;
  const unverified    = results.filter(r => r.status === 'unverified').length;
  const selfReported  = results.filter(r => r.status === 'self-reported').length;
  console.log(`[validator:${jur}] ${results.length} depts — verified: ${verified}  mismatch: ${mismatch}  unverified: ${unverified}  self-reported: ${selfReported}`);
  if (mismatch > 0) {
    results
      .filter(r => r.status === 'mismatch')
      .sort((a, b) => (b.discrepancy_pct || 0) - (a.discrepancy_pct || 0))
      .slice(0, 5)
      .forEach(r => console.log(`  ⚠  ${r.department}: stored=${r.stored_value?.toLocaleString()} official=${r.official_value?.toLocaleString()} diff=${r.discrepancy_pct}%`));
  }
}

// ─── Upload to Firestore ──────────────────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

async function uploadValidationResults(db, results) {
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < results.length; i += BATCH_SIZE) {
    const chunk = results.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const r of chunk) {
      const docId = sanitizeId(r.department_id || `${r.jurisdiction}-${r.department}`);
      batch.set(db.collection('budget_validation').doc(docId), r);
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function validateBudgets() {
  const db = getDb();
  const ts = new Date().toISOString();

  console.log('[validator] Loading federal_departments from Firestore...');
  const snap     = await db.collection('federal_departments').get();
  const allDepts = snap.docs.map(d => ({ department_id: d.id, ...d.data() }));

  const byJur = { CA: [], US: [], UK: [], AU: [] };
  for (const dept of allDepts) {
    if (byJur[dept.jurisdiction]) byJur[dept.jurisdiction].push(dept);
  }
  console.log(`[validator] Loaded: CA=${byJur.CA.length} US=${byJur.US.length} UK=${byJur.UK.length} AU=${byJur.AU.length}`);

  // ── Primary validation pass ───────────────────────────────────────────────
  const resultsByJur = {};
  for (const [jur, fetchFn, sourceUrl] of [
    ['CA', fetchCAOfficial, CA_SOURCE_URL],
    ['US', fetchUSOfficial, 'https://www.usaspending.gov'],
    ['UK', fetchUKOfficial, UK_DEL_URL],
    ['AU', fetchAUOfficial, AU_SOURCE_URL],
  ]) {
    try {
      const officialMap  = await fetchFn();
      resultsByJur[jur]  = validateJurisdiction(byJur[jur], officialMap, sourceUrl, ts);
      summarise(jur, resultsByJur[jur]);
    } catch (err) {
      console.warn(`[validator:${jur}] Skipped — ${err.message}`);
      resultsByJur[jur] = byJur[jur].map(d => buildResult(d, null, sourceUrl, ts));
    }
  }

  // ── UK secondary pass: gov.uk org lookup for unverified agencies ──────────
  const ukUnverified = resultsByJur.UK.filter(r => r.status === 'unverified');
  if (ukUnverified.length > 0) {
    console.log(`\n[validator:UK] gov.uk org lookup for ${ukUnverified.length} unverified agencies...`);
    const CONCUR = 10;
    let found = 0;
    for (let i = 0; i < ukUnverified.length; i += CONCUR) {
      await Promise.all(ukUnverified.slice(i, i + CONCUR).map(async r => {
        const url = await tryGovukOrgUrl(r.department);
        if (url) { r.source_url = url; found++; }
      }));
    }
    console.log(`[validator:UK] Located gov.uk org pages for ${found}/${ukUnverified.length} agencies`);
  }

  // ── Final pass: mark all remaining unverified as self-reported ────────────
  const allResults = Object.values(resultsByJur).flat();
  let selfReportedCount = 0;
  for (const r of allResults) {
    if (r.status === 'unverified') { r.status = 'self-reported'; selfReportedCount++; }
  }
  console.log(`\n[validator] Marked ${selfReportedCount} depts as self-reported (no independent source found)`);
  console.log('[validator] Final summary:');
  for (const jur of ['CA', 'US', 'UK', 'AU']) summarise(jur, resultsByJur[jur]);

  console.log(`\n[validator] Total results: ${allResults.length}`);

  // Clear existing, then write fresh
  const existing = await db.collection('budget_validation').get();
  if (!existing.empty) {
    for (let i = 0; i < existing.docs.length; i += 400) {
      const batch = db.batch();
      existing.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    console.log(`[validator] Cleared ${existing.size} existing docs`);
  }

  const written = await uploadValidationResults(db, allResults);
  console.log(`[validator] ✓ budget_validation: ${written} documents written`);
  return written;
}

module.exports = { validateBudgets };

if (require.main === module) {
  validateBudgets()
    .then(n => { console.log(`Done — ${n} validation results written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
