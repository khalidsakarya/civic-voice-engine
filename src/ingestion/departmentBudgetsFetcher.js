'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/department_budgets');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) { return (v == null) ? null : String(v).trim() || null; }

function safeNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function saveRecords(jurisdiction, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `department_budgets_${jurisdiction}_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ jurisdiction, fetchedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[dept-budgets:${jurisdiction}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

// Lightweight CSV parser (handles quoted fields with embedded commas/newlines)
function parseCsv(text) {
  // Strip UTF-8 BOM
  text = text.replace(/^\uFEFF/, '');
  const rows   = [];
  let   field  = '';
  let   fields = [];
  let   inQ    = false;
  let   i      = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        fields.push(field); field = '';
      } else if (ch === '\r') {
        // skip
      } else if (ch === '\n') {
        fields.push(field); field = '';
        rows.push(fields); fields = [];
      } else {
        field += ch;
      }
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
  return rows.slice(1)
    .filter(r => r.some(c => c.trim()))
    .map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (r[idx] || '').trim(); });
      return obj;
    });
}

// ─── Lightweight XLSX parser (ZIP binary + XML regex, no external deps) ───────

function parseXlsx(buf) {
  const entries = extractZipEntries(buf);
  const ssEntry = entries['xl/sharedStrings.xml'];
  const shEntry = entries['xl/worksheets/sheet1.xml'];
  if (!shEntry) return [];
  const strings = ssEntry ? parseSharedStrings(ssEntry) : [];
  return parseSheet(shEntry, strings);
}

function extractZipEntries(buf) {
  const entries = {};
  let i = 0;
  while (i < buf.length - 30) {
    // Local file header: PK\x03\x04
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) {
      i++;
      continue;
    }
    const compression = buf.readUInt16LE(i + 8);
    const compSize    = buf.readUInt32LE(i + 18);
    const nameLen     = buf.readUInt16LE(i + 26);
    const extraLen    = buf.readUInt16LE(i + 28);
    const name        = buf.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const dataStart   = i + 30 + nameLen + extraLen;
    const compData    = buf.slice(dataStart, dataStart + compSize);

    let data;
    if (compression === 0) {
      data = compData;
    } else if (compression === 8) {
      try { data = zlib.inflateRawSync(compData); } catch { data = compData; }
    } else {
      data = compData;
    }

    entries[name] = data.toString('utf8');
    i = dataStart + compSize;
  }
  return entries;
}

function parseSharedStrings(xml) {
  const strings = [];
  const siRe = /<si>[\s\S]*?<\/si>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    let text = '';
    let tm;
    while ((tm = tRe.exec(m[0])) !== null) text += tm[1];
    strings.push(decodeXmlEntities(text));
  }
  return strings;
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function parseSheet(xml, strings) {
  const rows  = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let   rowM;
  while ((rowM = rowRe.exec(xml)) !== null) {
    const cells = [];
    const cellRe = /<c\s[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g;
    let   cellM;
    while ((cellM = cellRe.exec(rowM[1])) !== null) {
      const col   = colIndex(cellM[1]);
      const attrs = cellM[2];
      const inner = cellM[3];
      const vM    = /<v>([^<]*)<\/v>/.exec(inner);
      let   val   = vM ? vM[1] : '';
      if (/t="s"/.test(attrs)) val = strings[parseInt(val, 10)] ?? '';
      cells[col] = decodeXmlEntities(val);
    }
    rows.push(cells);
  }
  return rows;
}

function colIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// ─── Canada — GC InfoBase CSVs (open.canada.ca CKAN) ─────────────────────────

const CA_CKAN_PKG = 'a35cf382-690c-4221-a971-cf0fd189a46f';

async function fetchCanadaDepartmentBudgets() {
  try {
    console.log('[dept-budgets:CA] Fetching GC InfoBase package resource list...');
    const pkgRes = await axios.get(
      `https://open.canada.ca/data/api/3/action/package_show?id=${CA_CKAN_PKG}`,
      { timeout: 30000 }
    );
    const resources = pkgRes.data?.result?.resources || [];

    const estRes  = resources.find(r => /abv_apc_en/i.test(r.name || r.url || ''));
    const planRes = resources.find(r => /rbpo_rppo_en/i.test(r.name || r.url || ''));

    if (!estRes && !planRes) {
      console.warn('[dept-budgets:CA] Could not find GC InfoBase CSV resources, skipping');
      return 0;
    }

    // ── Estimates CSV: total authorities (budget) by org ─────────────────────
    const estimatesMap = {};
    if (estRes) {
      console.log(`[dept-budgets:CA] Fetching Estimates CSV...`);
      const resp = await axios.get(estRes.url, {
        timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
      });
      const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));
      // Fields: fy_ef, organization, vote_type, authorities (amounts in thousands CAD)
      for (const r of rows) {
        const fy  = r['fy_ef']        || '';
        const org = r['organization'] || '';
        const amt = safeNum(r['authorities']);
        if (!org || !amt) continue;
        if (!estimatesMap[org] || fy > estimatesMap[org].fy) {
          estimatesMap[org] = { fy, total: 0 };
        }
        if (fy === estimatesMap[org].fy) estimatesMap[org].total += amt;
      }
      console.log(`[dept-budgets:CA] Estimates: ${Object.keys(estimatesMap).length} orgs`);
    }

    // ── Departmental Plans CSV: programs by org ────────────────────────────
    const plansMap = {};
    if (planRes) {
      console.log(`[dept-budgets:CA] Fetching Departmental Plans CSV...`);
      const resp = await axios.get(planRes.url, {
        timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
      });
      const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));
      // Fields: fy_ef, organization, program_name, planned_spending_1, actual_spending
      for (const r of rows) {
        const org  = r['organization']      || '';
        const prog = r['program_name']       || '';
        const plan = safeNum(r['planned_spending_1']);
        const act  = safeNum(r['actual_spending']);
        if (!org) continue;
        if (!plansMap[org]) plansMap[org] = [];
        if (prog) plansMap[org].push({ program_name: prog, planned_spending: plan, actual_spending: act });
      }
    }

    // ── Merge ────────────────────────────────────────────────────────────────
    const orgs    = new Set([...Object.keys(estimatesMap), ...Object.keys(plansMap)]);
    const records = [];
    for (const org of orgs) {
      const est      = estimatesMap[org];
      const programs = (plansMap[org] || []).slice(0, 20);
      const totalSpent = programs.length
        ? programs.reduce((s, p) => s + (p.actual_spending || 0), 0) || null
        : null;
      records.push({
        id:           `ca-dept-${slug(org)}`,
        jurisdiction: 'CA',
        name:         org,
        fiscal_year:  est?.fy || '2026-27',
        total_budget: est?.total ?? null,
        total_spent:  totalSpent,
        currency:     'CAD',
        budget_note:  'GC InfoBase Estimates — authorities granted by Parliament (thousands CAD)',
        key_programs: programs,
        source_url:   `https://open.canada.ca/data/dataset/${CA_CKAN_PKG}`,
      });
    }
    return saveRecords('CA', records);
  } catch (err) {
    console.warn(`[dept-budgets:CA] Error: ${err.message}`);
    return 0;
  }
}

// ─── United States — USASpending.gov ─────────────────────────────────────────

const US_AGENCIES_URL = 'https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&limit=50';
const US_PROGRAMS_URL = (code, fy) =>
  `https://api.usaspending.gov/api/v2/agency/${code}/program_activity/?fiscal_year=${fy}&limit=5`;

async function fetchUSDepartmentBudgets() {
  try {
    console.log('[dept-budgets:US] Fetching top-tier agencies from USASpending...');
    const agencyRes = await axios.get(US_AGENCIES_URL, { timeout: 30000 });
    const agencies  = agencyRes.data?.results || [];
    console.log(`[dept-budgets:US] Got ${agencies.length} agencies — fetching program activity for top 10...`);

    const currentFY = 2025;
    const records   = [];

    for (let idx = 0; idx < agencies.length; idx++) {
      const agency = agencies[idx];
      const code   = agency.toptier_code;
      const name   = agency.agency_name;
      if (!code || !name) continue;

      // Use aggregated values from the agencies list endpoint
      const totalBudget = agency.budget_authority_amount ?? null;
      const totalSpent  = agency.obligated_amount        ?? null;

      // Fetch top programs only for top 10 agencies (by index) to limit API calls
      let programs = [];
      if (idx < 10) {
        try {
          const progRes = await axios.get(US_PROGRAMS_URL(code, currentFY), { timeout: 20000 });
          programs = (progRes.data?.results || []).slice(0, 5).map(a => ({
            program_name: a.program_activity_name || null,
            obligations:  a.obligations?.total_budgetary_resources
                       ?? (typeof a.obligations === 'number' ? a.obligations : null),
          }));
        } catch { /* program fetch is best-effort */ }
      }

      records.push({
        id:           `us-dept-${slug(code + '-' + name)}`,
        jurisdiction: 'US',
        name,
        toptier_code: code,
        fiscal_year:  String(currentFY),
        total_budget: totalBudget,
        total_spent:  totalSpent,
        currency:     'USD',
        budget_note:  'USASpending.gov — budget authority and obligations (USD)',
        key_programs: programs,
        source_url:   `https://www.usaspending.gov/agency/${code}`,
      });
    }

    return saveRecords('US', records);
  } catch (err) {
    console.warn(`[dept-budgets:US] Error: ${err.message}`);
    return 0;
  }
}

// ─── United Kingdom — HM Treasury Main Supply Estimates DEL tables XLSX ───────

const UK_DEL_URL = 'https://assets.publishing.service.gov.uk/media/6827211850dbd3ce8372ab24/2025-26_Mains_DEL_tables_for_publication.xlsx';

async function fetchUKDepartmentBudgets() {
  try {
    console.log('[dept-budgets:UK] Downloading HM Treasury DEL tables XLSX...');
    const resp = await axios.get(UK_DEL_URL, {
      timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5,
    });
    const buf  = Buffer.from(resp.data);
    console.log(`[dept-budgets:UK] Downloaded ${buf.length} bytes, parsing XLSX...`);

    const rows = parseXlsx(buf);
    if (!rows.length) {
      console.warn('[dept-budgets:UK] XLSX parse returned no rows, skipping');
      return 0;
    }

    // Find the data region: look for a row where col 0 is a non-numeric string
    // and at least one later column is numeric (the DEL allocation).
    // Skip title/header rows at the top (usually first 3-6 rows).
    const records = [];
    for (const r of rows) {
      const name = safeStr(r[0]);
      if (!name || name.length < 3) continue;
      // Skip header/label/total rows
      if (/^total|^of which|^note|^source|^\d{4}|^department$/i.test(name)) continue;
      if (/^\s*$/.test(name)) continue;

      // Find the first numeric column value after col 0
      let totalBudget = null;
      for (let ci = 1; ci < Math.min((r.length || 0), 15); ci++) {
        const n = safeNum(r[ci]);
        if (n !== null && Math.abs(n) > 0) { totalBudget = n; break; }
      }
      if (totalBudget === null) continue;

      records.push({
        id:           `uk-dept-${slug(name)}`,
        jurisdiction: 'UK',
        name,
        fiscal_year:  '2025-26',
        total_budget: totalBudget,
        total_spent:  null,
        currency:     'GBP',
        budget_note:  'HM Treasury Main Supply Estimates 2025-26 — Departmental Expenditure Limit (DEL, £millions)',
        key_programs: [],
        source_url:   'https://www.gov.uk/government/publications/main-supply-estimates-2025-to-2026',
      });
    }

    if (!records.length) {
      console.warn('[dept-budgets:UK] No department rows extracted from XLSX');
      return 0;
    }
    return saveRecords('UK', records);
  } catch (err) {
    console.warn(`[dept-budgets:UK] Error: ${err.message}`);
    return 0;
  }
}

// ─── Australia — PAES 2025-26 program expenses CSV (data.gov.au) ──────────────

const AU_PAES_URL = 'https://data.gov.au/data/dataset/f84698ea-c749-4ff2-a5c5-e4b5a4d819e1/resource/8b7149fa-5882-4feb-8b20-89a25e6abac2/download/2025-26-paes-program-expenses-line-items.csv';

async function fetchAUDepartmentBudgets() {
  try {
    console.log('[dept-budgets:AU] Fetching PAES 2025-26 CSV from data.gov.au...');
    const resp = await axios.get(AU_PAES_URL, {
      timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5,
    });
    const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));
    console.log(`[dept-budgets:AU] Parsed ${rows.length} rows`);

    // Fields: Portfolio, Agency Name, Outcome, Program, Expense_type,
    //         Appropriation_type, 2024-25, 2025-26, 2026-27, 2027-28, 2028-29
    // Amounts are in AUD thousands — aggregate by Agency Name
    const byAgency = {};
    for (const r of rows) {
      const agency    = r['Agency Name'] || '';
      const portfolio = r['Portfolio']   || null;
      const prog      = r['Program']     || null;
      const bud2526   = safeNum(r['2025-26']);
      const act2425   = safeNum(r['2024-25']);
      if (!agency) continue;

      if (!byAgency[agency]) {
        byAgency[agency] = { portfolio, totalBudget: 0, totalSpent: 0, programs: new Set() };
      }
      if (bud2526 != null) byAgency[agency].totalBudget += bud2526;
      if (act2425 != null) byAgency[agency].totalSpent  += act2425;
      if (prog) byAgency[agency].programs.add(prog);
    }

    const records = [];
    for (const [agency, data] of Object.entries(byAgency)) {
      records.push({
        id:           `au-dept-${slug(agency)}`,
        jurisdiction: 'AU',
        name:         agency,
        portfolio:    data.portfolio,
        fiscal_year:  '2025-26',
        total_budget: data.totalBudget || null,
        total_spent:  data.totalSpent  || null,
        currency:     'AUD',
        budget_note:  'PAES 2025-26 program expenses (AUD thousands; total_spent = 2024-25 actuals)',
        key_programs: Array.from(data.programs).slice(0, 20).map(p => ({ program_name: p })),
        source_url:   AU_PAES_URL,
      });
    }

    return saveRecords('AU', records);
  } catch (err) {
    console.warn(`[dept-budgets:AU] Error: ${err.message}`);
    return 0;
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllDepartmentBudgets() {
  console.log('\n[dept-budgets] Starting department budgets fetch (CA / US / UK / AU)...');
  const results = await Promise.allSettled([
    fetchCanadaDepartmentBudgets(),
    fetchUSDepartmentBudgets(),
    fetchUKDepartmentBudgets(),
    fetchAUDepartmentBudgets(),
  ]);

  const [ca, us, uk, au] = results.map(r => r.status === 'fulfilled' ? r.value : 0);
  const total = ca + us + uk + au;
  console.log(`\n[dept-budgets] Done — CA:${ca} US:${us} UK:${uk} AU:${au} (total: ${total})`);
  return total;
}

module.exports = {
  fetchAllDepartmentBudgets,
  fetchCanadaDepartmentBudgets,
  fetchUSDepartmentBudgets,
  fetchUKDepartmentBudgets,
  fetchAUDepartmentBudgets,
};

if (require.main === module) {
  fetchAllDepartmentBudgets()
    .then(n => { console.log(`\n[dept-budgets] ${n} total records saved.`); process.exit(0); })
    .catch(err => { console.error('[dept-budgets] Fatal:', err.message); process.exit(1); });
}
