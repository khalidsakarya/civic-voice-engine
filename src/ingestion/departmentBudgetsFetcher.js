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

// ZIP parser using Central Directory — needed for files that use data descriptor
// pattern (compSize=0 in local headers, sizes only in Central Directory).
function extractZipEntriesFromCD(buf) {
  const entries = {};
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i]===0x50&&buf[i+1]===0x4B&&buf[i+2]===0x05&&buf[i+3]===0x06) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) return entries;
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

// Parse a named sheet from an XLSX buffer by navigating workbook.xml rels.
function parseXlsxSheetByName(buf, sheetName) {
  const entries = extractZipEntries(buf);
  const wbRels  = entries['xl/_rels/workbook.xml.rels'] || '';
  const relMap  = {};
  [...wbRels.matchAll(/<Relationship[^>]+>/g)].forEach(m => {
    const idM  = m[0].match(/\bId="([^"]+)"/);
    const tM   = m[0].match(/\bTarget="([^"]+)"/);
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
  const sheetFile = relMap[shM.rId];
  if (!sheetFile) return [];
  const sheetXml = entries[`xl/${sheetFile}`] || '';
  const strings  = parseSharedStrings(entries['xl/sharedStrings.xml'] || '');
  return parseSheet(sheetXml, strings);
}

// Parse a named table from an ODS buffer (ODS is ZIP with content.xml).
function parseOdsTable(buf, tableName) {
  const entries = extractZipEntries(buf);
  const xml     = entries['content.xml'] || '';
  const tStart  = xml.indexOf(`table:name="${tableName}"`);
  if (tStart === -1) return [];
  const tEnd = xml.indexOf('</table:table>', tStart);
  const tXml = xml.substring(tStart, tEnd + 14);
  const rows = [];
  const rowRe = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
  let rowM;
  while ((rowM = rowRe.exec(tXml)) !== null) {
    const cells    = [];
    const rowXml   = rowM[1];
    // Match both open/close and self-closing table-cell tags
    const cellRe   = /<table:table-cell([^>]*?)(\/>|>([\s\S]*?)<\/table:table-cell>)/g;
    let cellM;
    while ((cellM = cellRe.exec(rowXml)) !== null) {
      const attrs   = cellM[1];
      const content = cellM[3] || '';
      const repM    = attrs.match(/table:number-columns-repeated="(\d+)"/);
      const rep     = repM ? parseInt(repM[1]) : 1;
      if (rep > 50) break; // trailing empty-cell run → end of row
      const valM = attrs.match(/office:value="([^"]+)"/);
      const txtM = content.match(/<text:p[^>]*>([^<]*)<\/text:p>/);
      const val  = valM ? parseFloat(valM[1]) : (txtM ? decodeXmlEntities(txtM[1]) : '');
      for (let r = 0; r < Math.min(rep, 20); r++) cells.push(val);
    }
    if (cells.some(c => c !== '' && c !== 0)) rows.push(cells);
  }
  return rows;
}

// Normalise a department name for fuzzy matching across data sources.
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/^(department of the|department of|department for|ministry of|office of the|office of|the )\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// ─── Canada — GC InfoBase CSVs (open.canada.ca CKAN) ─────────────────────────

const CA_CKAN_PKG          = 'a35cf382-690c-4221-a971-cf0fd189a46f';
// Proactive disclosure: transfer payments/grants to external recipients
const CA_GRANTS_RESOURCE   = '1d15a62f-5656-49ad-8c88-f40ce689d831';

async function fetchCanadaDepartmentBudgets() {
  try {
    console.log('[dept-budgets:CA] Fetching GC InfoBase package resource list...');
    const pkgRes = await axios.get(
      `https://open.canada.ca/data/api/3/action/package_show?id=${CA_CKAN_PKG}`,
      { timeout: 30000 }
    );
    const resources = pkgRes.data?.result?.resources || [];

    // Match by URL (which contains the filename slug) — resource names are in English
    const estRes  = resources.find(r => /abv_apc_en/i.test(r.url || '') || /Estimates.*Budgetary Authorities by Vote/i.test(r.name || ''));
    const planRes = resources.find(r => /rbpo_rppo_en/i.test(r.url || '') || (r.name || '').includes('Departmental Plans') && (r.name || '').includes('Expenditures'));

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

    // ── Departmental Plans CSV: programs + FTE by org ────────────────────────
    const plansMap = {};
    const fteByOrg = {}; // { org: { fy, total } }
    if (planRes) {
      console.log(`[dept-budgets:CA] Fetching Departmental Plans CSV...`);
      const resp = await axios.get(planRes.url, {
        timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
      });
      const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));
      // Fields: fy_ef, organization, program_name, planned_spending_1, actual_spending, actual_ftes, ...
      for (const r of rows) {
        const org  = r['organization']       || '';
        const prog = r['program_name']        || '';
        const plan = safeNum(r['planned_spending_1']);
        const act  = safeNum(r['actual_spending']);
        const fy   = r['fy_ef']              || '';
        const fte  = safeNum(r['actual_ftes']);
        if (!org) continue;
        if (!plansMap[org]) plansMap[org] = [];
        if (prog) plansMap[org].push({ program_name: prog, planned_spending: plan, actual_spending: act });
        // Accumulate FTEs for the most recent fiscal year
        if (fte != null) {
          if (!fteByOrg[org] || fy > fteByOrg[org].fy) { fteByOrg[org] = { fy, total: 0 }; }
          if (fy === fteByOrg[org].fy) fteByOrg[org].total += fte;
        }
      }
    }

    // ── Proactive disclosure grants (top 200 by agreement_value) ────────────
    // Resource 1d15a62f: fields owner_org_title, recipient_legal_name, prog_name_en, agreement_value
    const caGrantsMap = {};  // { org: [{ recipient_name, program_name, amount }] }
    try {
      console.log('[dept-budgets:CA] Fetching proactive disclosure grants (top 200 by value)...');
      const gRes = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
        params: {
          resource_id: CA_GRANTS_RESOURCE,
          limit: 200,
          sort: 'agreement_value desc',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json',
          'Referer': 'https://open.canada.ca/',
        },
        timeout: 30000,
      });
      for (const row of gRes.data?.result?.records || []) {
        const org = (row.owner_org_title || '').trim();
        if (!org) continue;
        if (!caGrantsMap[org]) caGrantsMap[org] = [];
        if (caGrantsMap[org].length < 10) {
          caGrantsMap[org].push({
            recipient_name: (row.recipient_legal_name || '').trim() || null,
            program_name:   (row.prog_name_en || '').trim()         || null,
            amount:         safeNum(row.agreement_value),
            currency:       'CAD',
          });
        }
      }
      console.log(`[dept-budgets:CA] Got grants for ${Object.keys(caGrantsMap).length} orgs`);
    } catch (gErr) {
      console.warn(`[dept-budgets:CA] Grants fetch error: ${gErr.message}`);
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
      const fteTotals = fteByOrg[org];
      records.push({
        id:             `ca-dept-${slug(org)}`,
        jurisdiction:   'CA',
        name:           org,
        fiscal_year:       est?.fy || '2026-27',
        total_budget:      est?.total ?? null,
        total_spent:       totalSpent,
        currency:          'CAD',
        budget_note:       'GC InfoBase Estimates — authorities granted by Parliament (thousands CAD)',
        key_programs:      programs,
        grants_given:      caGrantsMap[org] || [],
        internal_spending: programs.map(p => ({
          category:     p.program_name,
          amount:       p.planned_spending,
          amount_spent: p.actual_spending,
        })),
        employee_count:    fteTotals ? Math.round(fteTotals.total) : null,
        source_url:        `https://open.canada.ca/data/dataset/${CA_CKAN_PKG}`,
      });
    }
    return saveRecords('CA', records);
  } catch (err) {
    console.warn(`[dept-budgets:CA] Error: ${err.message}`);
    return 0;
  }
}

// ─── United States — USASpending.gov ─────────────────────────────────────────

const US_AGENCIES_URL  = 'https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&limit=200';
const US_BUD_RES_URL   = (code) => `https://api.usaspending.gov/api/v2/agency/${code}/budgetary_resources/`;
const US_CFDA_URL      = 'https://api.usaspending.gov/api/v2/search/spending_by_category/cfda/';
// Grants.gov agency codes keyed by USASpending toptier_code.
// Used to cross-reference open grant opportunities from grants.gov.
const GRANTS_GOV_CODE  = {
  '012': 'USDA', '013': 'DOC',  '014': 'DOI',  '015': 'USDOJ', '016': 'DOL',
  '017': 'DOS',  '019': 'DOS',  '020': 'USDOT','021': 'DOD',   '024': 'OPM',
  '068': 'EPA',  '069': 'DOT',  '070': 'DHS',  '075': 'HHS',   '080': 'NASA',
  '086': 'HUD',  '089': 'DOE',  '091': 'ED',   '097': 'DOD',   '036': 'VA',
};

async function fetchUSDepartmentBudgets() {
  try {
    const currentFY  = 2025;
    const FY_START   = '2024-10-01';
    const FY_END     = '2025-09-30';
    const CONCUR     = 20;

    console.log('[dept-budgets:US] Fetching agency list, employee counts, and grants.gov open counts...');
    const [agencyRes, empCounts, grantsGovCounts] = await Promise.all([
      axios.get(US_AGENCIES_URL, { timeout: 60000 }),
      fetchUSEmployeeCounts(),
      // Fetch grants.gov agency list once — returns pre-computed open opportunity counts per agency code
      axios.post('https://apply07.grants.gov/grantsws/rest/opportunities/search/',
        { rows: 1, oppStatuses: 'posted' }, { timeout: 20000 }
      ).then(r => {
        const map = {};
        for (const a of r.data?.agencies || []) map[a.value] = a.count;
        return map;
      }).catch(() => ({})),
    ]);

    const agencies = agencyRes.data?.results || [];
    console.log(`[dept-budgets:US] Got ${agencies.length} agencies`);

    // ── Budgetary resources (per-agency FY2025) ────────────────────────────────
    console.log('[dept-budgets:US] Fetching per-agency budgetary resources for FY2025...');
    const budgetMap = {};
    for (let i = 0; i < agencies.length; i += CONCUR) {
      await Promise.all(agencies.slice(i, i + CONCUR).map(async agency => {
        try {
          const res = await axios.get(US_BUD_RES_URL(agency.toptier_code), { timeout: 20000 });
          const fy25 = (res.data?.agency_data_by_year || []).find(y => y.fiscal_year === currentFY);
          budgetMap[agency.toptier_code] = {
            budget:    fy25?.agency_budgetary_resources ?? null,
            obligated: fy25?.agency_total_obligated     ?? null,
          };
        } catch { budgetMap[agency.toptier_code] = { budget: null, obligated: null }; }
      }));
    }

    // ── Top CFDA grant programs (FY2025) → grants_given ──────────────────────
    // Award type codes: 02=Block Grant, 03=Formula Grant, 04=Project Grant,
    //                   05=Cooperative Agreement, 06=Direct Payment
    console.log('[dept-budgets:US] Fetching top CFDA grant programs per agency...');
    const grantsMap = {};
    for (let i = 0; i < agencies.length; i += CONCUR) {
      await Promise.all(agencies.slice(i, i + CONCUR).map(async agency => {
        try {
          const res = await axios.post(US_CFDA_URL, {
            filters: {
              award_type_codes: ['02', '03', '04', '05', '06'],
              agencies: [{ type: 'awarding', tier: 'toptier', name: agency.agency_name }],
              time_period: [{ start_date: FY_START, end_date: FY_END }],
            },
            limit: 10, page: 1,
          }, { timeout: 20000 });
          grantsMap[agency.toptier_code] = (res.data?.results || []).map(r => ({
            program_name:   r.name   || null,
            cfda_number:    r.code   || null,
            amount:         r.amount ?? null,
            recipient_name: null,  // CFDA is program-level, not per-recipient
          }));
        } catch { grantsMap[agency.toptier_code] = []; }
      }));
    }

    // ── Object-class breakdown per agency (FY2025) → internal_spending ────────
    // Excludes grant/transfer/insurance object classes — only operational spend
    const GRANT_OC = /grants|subsidies|contributions|insurance claims|financial transfers|benefits for former/i;
    console.log('[dept-budgets:US] Fetching object-class breakdown per agency...');
    const ocMap = {};
    const US_OC_URL = (code) => `https://api.usaspending.gov/api/v2/agency/${code}/object_class/?fiscal_year=${currentFY}&limit=20`;
    for (let i = 0; i < agencies.length; i += CONCUR) {
      await Promise.all(agencies.slice(i, i + CONCUR).map(async agency => {
        try {
          const res = await axios.get(US_OC_URL(agency.toptier_code), { timeout: 20000 });
          ocMap[agency.toptier_code] = (res.data?.results || [])
            .filter(oc => !GRANT_OC.test(oc.name))
            .sort((a, b) => b.obligated_amount - a.obligated_amount)
            .slice(0, 10)
            .map(oc => ({ category: oc.name, amount: oc.obligated_amount }));
        } catch { ocMap[agency.toptier_code] = []; }
      }));
    }

    console.log('[dept-budgets:US] Building records...');
    const records = [];
    for (const agency of agencies) {
      const code = agency.toptier_code;
      const name = agency.agency_name;
      if (!code || !name) continue;

      const bud     = budgetMap[code]  || {};
      const grants  = grantsMap[code]  || [];
      const ggCode  = GRANTS_GOV_CODE[code];
      const openOps = ggCode != null ? (grantsGovCounts[ggCode] ?? null) : null;

      records.push({
        id:                         `us-dept-${slug(code + '-' + name)}`,
        jurisdiction:               'US',
        name,
        toptier_code:               code,
        fiscal_year:                String(currentFY),
        total_budget:               bud.budget,
        total_spent:                bud.obligated,
        currency:                   'USD',
        budget_note:                'USASpending.gov FY2025 — agency budgetary resources (mandatory + discretionary, USD)',
        key_programs:               grants,
        grants_given:               grants,
        internal_spending:          ocMap[code] || [],
        open_grant_opportunities:   openOps,
        employee_count:             empCounts[code] ?? null,
        source_url:                 `https://www.usaspending.gov/agency/${code}`,
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
    console.log('[dept-budgets:UK] Downloading HM Treasury DEL tables XLSX + Civil Service employee counts...');
    const [resp, empCounts] = await Promise.all([
      axios.get(UK_DEL_URL, { timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5 }),
      fetchUKEmployeeCounts(),
    ]);
    const buf  = Buffer.from(resp.data);
    console.log(`[dept-budgets:UK] Downloaded ${buf.length} bytes, parsing XLSX...`);

    // Parse 3 named sheets: RDEL (inc. depr.) = Table 1, CDEL = Table 3, Tax adjustment = Table 4
    // Sheet names in workbook: "RDEL inc" → Resource DEL incl. depr. (£billion)
    //                          "CDEL"     → Capital DEL (£billion)
    //                          "Direct impact of tax changes" → Budget 2024 tax adjustment (£million)
    const rdelRows = parseXlsxSheetByName(buf, 'RDEL inc');
    if (!rdelRows.length) {
      console.warn('[dept-budgets:UK] XLSX parse returned no rows, skipping');
      return 0;
    }

    // Helper: build dept_name → first numeric value map from a DEL sheet row set
    const DEL_SKIP = /^total|^of which|^note|^source|^\d{4}|^department|^table|^£|^resource|^capital/i;
    const buildDelMap = (rows) => {
      const map = {};
      for (const r of rows) {
        const name = safeStr(r[1]);
        if (!name || name.length < 3 || DEL_SKIP.test(name) || /^\s*$/.test(name)) continue;
        for (let ci = 2; ci < Math.min((r.length || 0), 15); ci++) {
          const n = safeNum(r[ci]);
          if (n !== null && Math.abs(n) > 0) {
            map[name.replace(/\d+$/, '').trim()] = n;
            break;
          }
        }
      }
      return map;
    };

    const cdelRows   = parseXlsxSheetByName(buf, 'CDEL');
    const taxAdjRows = parseXlsxSheetByName(buf, 'Direct impact of tax changes');
    const rdelMap    = buildDelMap(rdelRows);    // £billion
    const cdelMap    = buildDelMap(cdelRows);    // £billion
    const taxMap     = buildDelMap(taxAdjRows);  // £million

    // The DEL tables have data starting in column B (index 1):
    //   col 1 = department name (shared string)
    //   col 2 = DEL allocation (£ billion)
    const records = [];
    for (const r of rdelRows) {
      const name = safeStr(r[1]);
      if (!name || name.length < 3 || DEL_SKIP.test(name) || /^\s*$/.test(name)) continue;

      let totalBudget = null;
      for (let ci = 2; ci < Math.min((r.length || 0), 15); ci++) {
        const n = safeNum(r[ci]);
        if (n !== null && Math.abs(n) > 0) { totalBudget = n; break; }
      }
      if (totalBudget === null) continue;

      const cleanName = name.replace(/\d+$/, '').trim();

      // Build key_programs from DEL components: Resource DEL, Capital DEL, tax adjustment
      // Amounts are in £billion (matching total_budget units), except tax adjustment which is £million
      const programs = [];
      if (rdelMap[cleanName] != null) {
        programs.push({
          program_name: 'Resource DEL (day-to-day services & grants)',
          amount: rdelMap[cleanName],
          unit: '£billion',
        });
      }
      if (cdelMap[cleanName] != null) {
        programs.push({
          program_name: 'Capital DEL (infrastructure & investment)',
          amount: cdelMap[cleanName],
          unit: '£billion',
        });
      }
      if (taxMap[cleanName] != null && Math.abs(taxMap[cleanName]) > 0) {
        programs.push({
          program_name: 'Autumn Budget 2024 tax change adjustment',
          amount: taxMap[cleanName],
          unit: '£million',
        });
      }

      records.push({
        id:               `uk-dept-${slug(cleanName)}`,
        jurisdiction:     'UK',
        name:             cleanName,
        fiscal_year:      '2025-26',
        total_budget:     totalBudget,
        total_spent:      null,
        currency:         'GBP',
        budget_note:      'HM Treasury Main Supply Estimates 2025-26 — Resource DEL (£billion); Capital DEL (£billion)',
        key_programs:     programs,
        grants_given:     [],  // No machine-readable per-department grant recipient data available for UK
        internal_spending: programs.map(p => ({ category: p.program_name, amount: p.amount, unit: p.unit })),
        employee_count:   empCounts[normName(cleanName)] ?? null,
        source_url:       'https://www.gov.uk/government/publications/main-supply-estimates-2025-to-2026',
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
    console.log('[dept-budgets:AU] Fetching PAES 2025-26 CSV + APS employee counts...');
    const [resp, empCounts] = await Promise.all([
      axios.get(AU_PAES_URL, { timeout: 60000, responseType: 'arraybuffer', maxRedirects: 5 }),
      fetchAUEmployeeCounts(),
    ]);
    const rows = csvToObjects(Buffer.from(resp.data).toString('utf8'));
    console.log(`[dept-budgets:AU] Parsed ${rows.length} rows`);

    // Fields: Portfolio, Agency Name, Outcome, Program, Expense_type,
    //         Appropriation_type, 2024-25, 2025-26, 2026-27, 2027-28, 2028-29
    // Amounts are in AUD thousands.
    // Expense_type: "Administered Expenses" / "Annual Administered Expenses" → grants_given (external)
    //               "Departmental Expenses" → internal_spending (operational)
    const ADMINISTERED_RE = /administered/i;
    const byAgency = {};
    for (const r of rows) {
      const agency      = r['Agency Name']  || '';
      const portfolio   = r['Portfolio']    || null;
      const prog        = r['Program']      || null;
      const expType     = r['Expense_type'] || '';
      const bud2526     = safeNum(r['2025-26']);
      const act2425     = safeNum(r['2024-25']);
      if (!agency) continue;

      if (!byAgency[agency]) {
        byAgency[agency] = {
          portfolio,
          totalBudget:    0,
          totalSpent:     0,
          programMap:     {},   // all programs (for key_programs)
          administeredMap:{},   // grants_given (administered/external)
          departmentalMap:{},   // internal_spending (departmental/operational)
        };
      }
      if (bud2526 != null) byAgency[agency].totalBudget += bud2526;
      if (act2425 != null) byAgency[agency].totalSpent  += act2425;

      const isAdministered = ADMINISTERED_RE.test(expType);
      const targetMap = isAdministered ? byAgency[agency].administeredMap : byAgency[agency].departmentalMap;

      if (prog) {
        if (!byAgency[agency].programMap[prog]) {
          byAgency[agency].programMap[prog] = { budget: 0, spent: 0 };
        }
        if (bud2526 != null) byAgency[agency].programMap[prog].budget += bud2526;
        if (act2425 != null) byAgency[agency].programMap[prog].spent  += act2425;

        if (!targetMap[prog]) targetMap[prog] = { budget: 0, spent: 0 };
        if (bud2526 != null) targetMap[prog].budget += bud2526;
        if (act2425 != null) targetMap[prog].spent  += act2425;
      }
    }

    const mapToPrograms = (map, limit = 20) =>
      Object.entries(map)
        .sort((a, b) => b[1].budget - a[1].budget)
        .slice(0, limit)
        .map(([name, amt]) => ({
          program_name: name,
          amount:       amt.budget || null,
          amount_spent: amt.spent  || null,
        }));

    const records = [];
    for (const [agency, data] of Object.entries(byAgency)) {
      const programs = mapToPrograms(data.programMap, 20);

      // grants_given: administered programs (transfer payments to external recipients)
      const grantsGiven = mapToPrograms(data.administeredMap, 15).map(p => ({
        program_name:   p.program_name,
        recipient_name: null,  // PAES is program-level, not per-recipient
        amount:         p.amount,
        amount_spent:   p.amount_spent,
      }));

      // internal_spending: departmental expenses (operational costs by program)
      const internalSpending = mapToPrograms(data.departmentalMap, 15).map(p => ({
        category:     p.program_name,
        amount:       p.amount,
        amount_spent: p.amount_spent,
      }));

      records.push({
        id:               `au-dept-${slug(agency)}`,
        jurisdiction:     'AU',
        name:             agency,
        portfolio:        data.portfolio,
        fiscal_year:      '2025-26',
        total_budget:     data.totalBudget || null,
        total_spent:      data.totalSpent  || null,
        currency:         'AUD',
        budget_note:      'PAES 2025-26 program expenses (AUD thousands; total_spent = 2024-25 actuals)',
        key_programs:     programs,
        grants_given:     grantsGiven,
        internal_spending: internalSpending,
        employee_count:   empCounts[normName(agency)] ?? null,
        source_url:       AU_PAES_URL,
      });
    }

    return saveRecords('AU', records);
  } catch (err) {
    console.warn(`[dept-budgets:AU] Error: ${err.message}`);
    return 0;
  }
}

// ─── Employee count helpers ───────────────────────────────────────────────────

// US: OMB Historical Table 16.1 — FTE by major agency (thousands).
// Returns { toptier_code: headcount } for agencies that appear individually.
// HHS/Education/SSA are grouped together in the source, so they are omitted.
const US_OMB_FTE_URL = 'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z1_fy2027.xlsx';
async function fetchUSEmployeeCounts() {
  try {
    const resp    = await axios.get(US_OMB_FTE_URL, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const entries = extractZipEntriesFromCD(Buffer.from(resp.data));
    const strings = parseSharedStrings(entries['xl/sharedStrings.xml'] || '');
    const rows    = parseSheet(entries['xl/worksheets/sheet1.xml'] || '', strings);
    // Find the most recent actual year row (col 0 is fiscal year, numeric)
    const row = rows.slice().reverse().find(r => /^20\d{2}$/.test(String(r[0] || '').trim()));
    if (!row) return {};
    const k = 1000; // table values are in thousands
    return {
      '012': Math.round((safeNum(row[4])  || 0) * k),  // Agriculture
      '097': Math.round((safeNum(row[2])  || 0) * k),  // Defense
      '070': Math.round((safeNum(row[6])  || 0) * k),  // Homeland Security
      '014': Math.round((safeNum(row[7])  || 0) * k),  // Interior
      '015': Math.round((safeNum(row[8])  || 0) * k),  // Justice
      '069': Math.round((safeNum(row[9])  || 0) * k),  // Transportation
      '020': Math.round((safeNum(row[10]) || 0) * k),  // Treasury
      '036': Math.round((safeNum(row[11]) || 0) * k),  // Veterans Affairs
    };
  } catch (e) { console.warn('[dept-budgets:US] employee counts error:', e.message); return {}; }
}

// UK: Civil Service Statistics 2024 ODS — table_20 headcount by grade by department.
// Returns { parent_dept_normalised: headcount }
const UK_CS_STATS_URL = 'https://assets.publishing.service.gov.uk/media/66e1631138493bbcd79f4706/Statistical_tables_-_Civil_Service_Statistics_2024.ods';
async function fetchUKEmployeeCounts() {
  try {
    const resp = await axios.get(UK_CS_STATS_URL, { timeout: 60000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const rows = parseOdsTable(Buffer.from(resp.data), 'table_20');
    const counts = {};
    for (const r of rows) {
      const org = String(r[1] || '').trim();
      if (!org.toLowerCase().endsWith(' overall')) continue;
      const dept = String(r[0] || '').trim();
      if (!dept) continue;
      // Columns 2-7 are headcount by grade (SCS, G6/7, SHO/HEO, EO, AA/AO, unreported)
      let total = 0;
      for (let c = 2; c <= 7; c++) { const n = safeNum(r[c]); if (n) total += n; }
      if (total > 0) counts[normName(dept)] = total;
    }
    return counts;
  } catch (e) { console.warn('[dept-budgets:UK] employee counts error:', e.message); return {}; }
}

// AU: APS Employment Data 31 December 2025 — Table 2, total staff by agency.
// Returns { normalised_agency_name: headcount }
const AU_APS_EMP_URL = 'https://data.gov.au/data/dataset/252e144b-b975-4cc7-b7d6-5a4397fc4761/resource/f28f5882-e067-4f95-b3f2-60cc2d9fc076/download/aps-employment-release-tables-31-december-2025.xlsx';
async function fetchAUEmployeeCounts() {
  try {
    const resp  = await axios.get(AU_APS_EMP_URL, { timeout: 60000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const rows  = parseXlsxSheetByName(Buffer.from(resp.data), 'Table 2');
    const counts = {};
    for (const r of rows) {
      const name = String(r[0] || '').trim();
      // Skip sub-agencies (start with "- "), headers, and blank rows
      if (!name || name.startsWith('-') || name.startsWith('Table') || name.startsWith('Agency') || name.startsWith('Note')) continue;
      const total2025 = safeNum(r[6]); // col 6 = Total 2025
      if (total2025 != null && total2025 > 0) counts[normName(name)] = total2025;
    }
    return counts;
  } catch (e) { console.warn('[dept-budgets:AU] employee counts error:', e.message); return {}; }
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
