'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/foreign_aid');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) { return (v == null) ? null : String(v).trim() || null; }

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function saveRecords(jurisdiction, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `foreign_aid_${jurisdiction}_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ jurisdiction, fetchedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[foreign-aid:${jurisdiction}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

// Native https.get wrapper (canada.ca AEM CDN stalls axios)
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)', Accept: 'text/html' },
      timeout: 45000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Parse a dollar/number string → float.  Returns null if not parseable.
function parseMoney(str) {
  if (!str) return null;
  const clean = String(str).replace(/[,$\s]/g, '');
  const val = parseFloat(clean);
  return isNaN(val) ? null : val;
}

// ─── Canada ──────────────────────────────────────────────────────────────────
//
// Source: Global Affairs Canada, International Assistance Report 2023-2024
// URL:    https://www.international.gc.ca/world-monde/issues_development-enjeux_developpement/priorities-priorites/iab_report-rapport_aai-2023-2024.aspx?lang=eng
//
// Structure:
//   Table 0 — ODA by government department (CAD millions)
//   Table 2 — ODA by recipient country (USD millions)
//   Table 11 — ODA by sector (CAD millions)

async function fetchCanadaForeignAid() {
  const url = 'https://www.international.gc.ca/world-monde/issues_development-enjeux_developpement/priorities-priorites/iab_report-rapport_aai-2023-2024.aspx?lang=eng';
  console.log('[foreign-aid:CA] Fetching International Assistance Report 2023-2024...');

  let html;
  try {
    html = await httpsGet(url);
  } catch (err) {
    console.warn(`[foreign-aid:CA] Fetch failed: ${err.message}`);
    return [];
  }

  // Extract all <table> blocks
  const tableBlocks = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html)) !== null) {
    tableBlocks.push(m[0]);
  }

  const records = [];
  const reportYear = '2023-2024';

  // ── Table 0: ODA by department ────────────────────────────────────────────
  if (tableBlocks[0]) {
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowM;
    let rowIdx = 0;
    while ((rowM = rowRe.exec(tableBlocks[0])) !== null) {
      if (rowIdx === 0) { rowIdx++; continue; } // skip header
      const cells = [...rowM[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripHtml(c[1]));
      if (cells.length < 2) { rowIdx++; continue; }
      const dept   = safeStr(cells[0]);
      const amount = parseMoney(cells[1]);
      if (!dept || dept.toLowerCase().includes('total')) { rowIdx++; continue; }
      records.push({
        id:           `ca-dept-${slug(dept)}-${reportYear}`,
        jurisdiction: 'CA',
        report_year:  reportYear,
        category:     'by_department',
        label:        dept,
        amount_millions: amount,
        currency:     'CAD',
        unit:         'millions CAD',
        source_url:   url,
      });
      rowIdx++;
    }
    console.log(`[foreign-aid:CA] by_department: ${records.filter(r => r.category === 'by_department').length} rows`);
  }

  // ── Table 2: ODA by recipient country ────────────────────────────────────
  const countryStart = records.length;
  if (tableBlocks[2]) {
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowM;
    let rowIdx = 0;
    while ((rowM = rowRe.exec(tableBlocks[2])) !== null) {
      if (rowIdx === 0) { rowIdx++; continue; }
      const cells = [...rowM[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripHtml(c[1]));
      if (cells.length < 2) { rowIdx++; continue; }
      const country = safeStr(cells[0]);
      const amount  = parseMoney(cells[1]);
      if (!country || country.toLowerCase().includes('total')) { rowIdx++; continue; }
      records.push({
        id:           `ca-country-${slug(country)}-${reportYear}`,
        jurisdiction: 'CA',
        report_year:  reportYear,
        category:     'by_recipient_country',
        label:        country,
        amount_millions: amount,
        currency:     'USD',
        unit:         'millions USD',
        source_url:   url,
      });
      rowIdx++;
    }
    console.log(`[foreign-aid:CA] by_recipient_country: ${records.length - countryStart} rows`);
  }

  // ── Table 11: ODA by sector ───────────────────────────────────────────────
  const sectorStart = records.length;
  if (tableBlocks[11]) {
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowM;
    let rowIdx = 0;
    while ((rowM = rowRe.exec(tableBlocks[11])) !== null) {
      if (rowIdx === 0) { rowIdx++; continue; }
      const cells = [...rowM[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripHtml(c[1]));
      if (cells.length < 2) { rowIdx++; continue; }
      const sector = safeStr(cells[0]);
      const amount = parseMoney(cells[1]);
      if (!sector || sector.toLowerCase().includes('total')) { rowIdx++; continue; }
      records.push({
        id:           `ca-sector-${slug(sector)}-${reportYear}`,
        jurisdiction: 'CA',
        report_year:  reportYear,
        category:     'by_sector',
        label:        sector,
        amount_millions: amount,
        currency:     'CAD',
        unit:         'millions CAD',
        source_url:   url,
      });
      rowIdx++;
    }
    console.log(`[foreign-aid:CA] by_sector: ${records.length - sectorStart} rows`);
  }

  // Add a summary record for total ODA
  const deptRecords = records.filter(r => r.category === 'by_department');
  const totalCAD = deptRecords.reduce((sum, r) => sum + (r.amount_millions || 0), 0);
  if (totalCAD > 0) {
    records.unshift({
      id:              `ca-total-${reportYear}`,
      jurisdiction:    'CA',
      report_year:     reportYear,
      category:        'total_oda',
      label:           'Total Official Development Assistance',
      amount_millions: Math.round(totalCAD * 10) / 10,
      currency:        'CAD',
      unit:            'millions CAD',
      source_url:      url,
    });
  }

  return records;
}

// ─── United States ───────────────────────────────────────────────────────────
//
// Source: USAspending.gov v2 API
// Endpoint: POST https://api.usaspending.gov/api/v2/spending/
//
// Budget function 150 = International Affairs
// Subfunctions: 151 (Development/Humanitarian), 152 (Security), 153 (Foreign Affairs),
//               154 (Info/Exchange), 155 (Financial Programs)
// Top agencies: State, USAID, Treasury

const USA_SPENDING_URL = 'https://api.usaspending.gov/api/v2/spending/';

async function usaPost(body) {
  const resp = await axios.post(USA_SPENDING_URL, body, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });
  return resp.data;
}

async function fetchUSForeignAid() {
  console.log('[foreign-aid:US] Fetching from USAspending.gov API (FY2024)...');

  const records = [];
  const fy = '2024';
  const sourceUrl = 'https://api.usaspending.gov/api/v2/spending/';

  // ── Budget function total ─────────────────────────────────────────────────
  try {
    const funcData = await usaPost({
      type: 'budget_function',
      filters: { fy, quarter: '4' },
    });
    const intlAffairs = (funcData.results || []).find(r =>
      r.budget_function_code === '150' || (r.name || '').toLowerCase().includes('international')
    );
    if (intlAffairs) {
      records.push({
        id:           `us-total-fy${fy}`,
        jurisdiction: 'US',
        report_year:  `FY${fy}`,
        category:     'total_international_affairs',
        label:        intlAffairs.name || 'International Affairs (Budget Function 150)',
        amount_billions: Math.round((intlAffairs.obligated_amount / 1e9) * 100) / 100,
        amount_raw:   intlAffairs.obligated_amount,
        currency:     'USD',
        unit:         'USD (obligated)',
        source_url:   sourceUrl,
      });
      console.log(`[foreign-aid:US] Total International Affairs FY${fy}: $${(intlAffairs.obligated_amount / 1e9).toFixed(2)}B`);
    }
  } catch (err) {
    console.warn(`[foreign-aid:US] budget_function fetch failed: ${err.message}`);
  }

  // ── Budget subfunctions ───────────────────────────────────────────────────
  try {
    const subfuncData = await usaPost({
      type: 'budget_subfunction',
      filters: { fy, quarter: '4', budget_function: '150' },
    });
    for (const row of (subfuncData.results || [])) {
      if (!row.name) continue;
      records.push({
        id:           `us-subfunction-${slug(row.name)}-fy${fy}`,
        jurisdiction: 'US',
        report_year:  `FY${fy}`,
        category:     'by_subfunction',
        label:        row.name,
        budget_subfunction_code: row.budget_subfunction_code || null,
        amount_billions: Math.round((row.obligated_amount / 1e9) * 100) / 100,
        amount_raw:   row.obligated_amount,
        currency:     'USD',
        unit:         'USD (obligated)',
        source_url:   sourceUrl,
      });
    }
    console.log(`[foreign-aid:US] by_subfunction: ${subfuncData.results?.length || 0} rows`);
  } catch (err) {
    console.warn(`[foreign-aid:US] budget_subfunction fetch failed: ${err.message}`);
  }

  // ── Top agencies for International Affairs ────────────────────────────────
  try {
    const agencyData = await usaPost({
      type: 'agency',
      filters: { fy, quarter: '4', budget_function: '150' },
    });
    const topAgencies = (agencyData.results || [])
      .sort((a, b) => (b.obligated_amount || 0) - (a.obligated_amount || 0))
      .slice(0, 15);
    for (const row of topAgencies) {
      if (!row.name) continue;
      records.push({
        id:           `us-agency-${slug(row.name)}-fy${fy}`,
        jurisdiction: 'US',
        report_year:  `FY${fy}`,
        category:     'by_agency',
        label:        row.name,
        amount_billions: Math.round((row.obligated_amount / 1e9) * 100) / 100,
        amount_raw:   row.obligated_amount,
        currency:     'USD',
        unit:         'USD (obligated)',
        source_url:   sourceUrl,
      });
    }
    console.log(`[foreign-aid:US] by_agency: ${topAgencies.length} rows`);
  } catch (err) {
    console.warn(`[foreign-aid:US] agency fetch failed: ${err.message}`);
  }

  return records;
}

// ─── United Kingdom ───────────────────────────────────────────────────────────
//
// Source: GOV.UK — Statistics on International Development: Final UK ODA Spend 2024
// URL:    https://www.gov.uk/government/statistics/statistics-on-international-development-final-uk-oda-spend-2024/statistics-on-international-development-final-uk-oda-spend-2024

async function fetchUKForeignAid() {
  const url = 'https://www.gov.uk/government/statistics/statistics-on-international-development-final-uk-oda-spend-2024/statistics-on-international-development-final-uk-oda-spend-2024';
  console.log('[foreign-aid:UK] Fetching GOV.UK ODA statistics 2024...');

  let html;
  try {
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)', Accept: 'text/html' },
    });
    html = resp.data;
  } catch (err) {
    console.warn(`[foreign-aid:UK] Fetch failed: ${err.message}`);
    return [];
  }

  const records = [];
  const reportYear = '2024';
  const sourceUrl  = url;

  // ── Extract JSON-LD structured data sections ──────────────────────────────
  const ldRe = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let ldM;
  while ((ldM = ldRe.exec(html)) !== null) {
    try {
      const ld = JSON.parse(ldM[1]);
      if (Array.isArray(ld)) {
        for (const item of ld) {
          if (item.headline && item.description) {
            records.push({
              id:           `uk-headline-${slug(item.headline)}-${reportYear}`,
              jurisdiction: 'UK',
              report_year:  reportYear,
              category:     'headline_figure',
              label:        safeStr(item.headline),
              description:  safeStr(item.description),
              currency:     'GBP',
              source_url:   sourceUrl,
            });
          }
        }
      }
    } catch (_) {}
  }
  console.log(`[foreign-aid:UK] JSON-LD headline figures: ${records.filter(r => r.category === 'headline_figure').length}`);

  // ── Table 1: ODA and GNI year-series ─────────────────────────────────────
  // Find first <table> — it contains year, Total ODA (£M), ODA/GNI %
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (tableMatch) {
    const rowRe = /<tr[\s\S]*?<\/tr>/gi;
    let rowM;
    let rowIdx = 0;
    let headerCells = [];
    while ((rowM = rowRe.exec(tableMatch[0])) !== null) {
      const cells = [...rowM[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => stripHtml(c[1]));
      if (rowIdx === 0) { headerCells = cells; rowIdx++; continue; }
      if (cells.length < 2) { rowIdx++; continue; }
      const year   = safeStr(cells[0]);
      const odaGbp = parseMoney(cells[1]);
      const gniPct = cells[2] ? parseMoney(cells[2]) : null;
      if (!year || !/^\d{4}$/.test(year)) { rowIdx++; continue; }
      records.push({
        id:           `uk-oda-year-${year}`,
        jurisdiction: 'UK',
        report_year:  year,
        category:     'annual_oda',
        label:        `Total ODA ${year}`,
        amount_millions: odaGbp,
        gni_percentage:  gniPct,
        currency:     'GBP',
        unit:         'millions GBP',
        source_url:   sourceUrl,
      });
      rowIdx++;
    }
    console.log(`[foreign-aid:UK] annual_oda year series: ${records.filter(r => r.category === 'annual_oda').length} rows`);
  }

  // ── Inline key figures from HTML body text ────────────────────────────────
  // £14,082M total, 0.50% GNI, bilateral £11,273M, FCDO £9,469M
  const figurePatterns = [
    { re: /total\s+UK\s+ODA[^£]*£([\d,]+)\s*(?:million|m)/i, label: 'Total UK ODA 2024', unit: 'millions GBP' },
    { re: /£([\d,]+)\s*million.*?bilateral/i,                  label: 'Bilateral ODA 2024', unit: 'millions GBP' },
    { re: /FCDO[^£]*£([\d,]+)\s*(?:million|m)/i,              label: 'FCDO ODA spend 2024', unit: 'millions GBP' },
    { re: /([\d.]+)%\s+of\s+(?:gross\s+national\s+income|GNI)/i, label: 'ODA as % GNI 2024', unit: '% of GNI' },
  ];

  const bodyText = stripHtml(html);
  for (const { re, label, unit } of figurePatterns) {
    const m = bodyText.match(re);
    if (m) {
      const val = parseMoney(m[1]);
      if (val !== null) {
        records.push({
          id:           `uk-figure-${slug(label)}-${reportYear}`,
          jurisdiction: 'UK',
          report_year:  reportYear,
          category:     'key_figure',
          label,
          amount_millions: unit.includes('%') ? null : val,
          percentage:   unit.includes('%') ? val : null,
          unit,
          currency:     unit.includes('%') ? null : 'GBP',
          source_url:   sourceUrl,
        });
      }
    }
  }
  console.log(`[foreign-aid:UK] key_figures + totals: ${records.filter(r => r.category === 'key_figure').length}`);

  return records;
}

// ─── Australia ────────────────────────────────────────────────────────────────
//
// Source: DFAT — Official Development Assistance Budget Summary 2025-26
// URL:    https://www.dfat.gov.au/about-us/corporate/portfolio-budget-statements/australias-official-development-assistance-budget-summary-2025-26

async function fetchAUForeignAid() {
  const url = 'https://www.dfat.gov.au/about-us/corporate/portfolio-budget-statements/australias-official-development-assistance-budget-summary-2025-26';
  console.log('[foreign-aid:AU] Fetching DFAT ODA Budget Summary 2025-26...');

  let html;
  try {
    const resp = await axios.get(url, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)', Accept: 'text/html' },
    });
    html = resp.data;
  } catch (err) {
    console.warn(`[foreign-aid:AU] Fetch failed: ${err.message}`);
    return [];
  }

  const bodyText = stripHtml(html);
  const records  = [];
  const reportYear = '2025-26';
  const sourceUrl  = url;

  // ── Key figures from body text ────────────────────────────────────────────
  // "$5.097 billion in Official Development Assistance"
  // "increase of $135.8 million"
  // "Three-quarters of our total ODA funding benefits the Indo-Pacific region"

  const totalM = bodyText.match(/\$([\d,.]+)\s*billion\s*in\s*(?:Official\s*Development\s*Assistance|ODA)/i);
  if (totalM) {
    const billions = parseMoney(totalM[1]);
    records.push({
      id:              `au-total-${reportYear}`,
      jurisdiction:    'AU',
      report_year:     reportYear,
      category:        'total_oda',
      label:           'Total Official Development Assistance',
      amount_billions: billions,
      amount_millions: billions ? Math.round(billions * 1000) : null,
      currency:        'AUD',
      unit:            'billions AUD',
      source_url:      sourceUrl,
    });
    console.log(`[foreign-aid:AU] Total ODA ${reportYear}: $${billions}B AUD`);
  }

  const changeM = bodyText.match(/increase\s+of\s+\$([\d,.]+)\s*million/i);
  if (changeM) {
    records.push({
      id:              `au-change-${reportYear}`,
      jurisdiction:    'AU',
      report_year:     reportYear,
      category:        'year_on_year_change',
      label:           'ODA increase from 2024-25',
      amount_millions: parseMoney(changeM[1]),
      currency:        'AUD',
      unit:            'millions AUD',
      direction:       'increase',
      source_url:      sourceUrl,
    });
  }

  // Indo-Pacific share
  const indoPacificM = bodyText.match(/(three[-\s]?quarters|75\s*%)\s+of\s+(?:our\s+total\s+)?ODA\s+(?:funding\s+)?benefits?\s+the\s+Indo[-\s]?Pacific/i);
  if (indoPacificM) {
    records.push({
      id:              `au-indo-pacific-share-${reportYear}`,
      jurisdiction:    'AU',
      report_year:     reportYear,
      category:        'regional_share',
      label:           'Indo-Pacific share of ODA',
      percentage:      75,
      unit:            '% of total ODA',
      source_url:      sourceUrl,
    });
  }

  // Any additional dollar figures in the page
  const extraFigureRe = /\$([\d,.]+)\s*(billion|million)\s+(?:in\s+)?([A-Za-z\s]{5,60?)(?=[.,;])/gi;
  let em;
  const seenLabels = new Set(records.map(r => r.label));
  while ((em = extraFigureRe.exec(bodyText)) !== null) {
    const val   = parseMoney(em[1]);
    const scale = em[2].toLowerCase();
    const label = safeStr(em[3]);
    if (!label || seenLabels.has(label)) continue;
    seenLabels.add(label);
    const billions    = scale === 'billion' ? val : null;
    const millions    = scale === 'million' ? val : (billions ? Math.round(billions * 1000) : null);
    records.push({
      id:              `au-figure-${slug(label)}-${reportYear}`,
      jurisdiction:    'AU',
      report_year:     reportYear,
      category:        'additional_figure',
      label,
      amount_billions: billions,
      amount_millions: millions,
      currency:        'AUD',
      unit:            `${scale}s AUD`,
      source_url:      sourceUrl,
    });
  }

  console.log(`[foreign-aid:AU] Total records: ${records.length}`);
  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchAllForeignAid() {
  console.log('\n[foreign-aid] Starting foreign aid ingestion (CA / US / UK / AU)...');

  const results = await Promise.allSettled([
    fetchCanadaForeignAid(),
    fetchUSForeignAid(),
    fetchUKForeignAid(),
    fetchAUForeignAid(),
  ]);

  const jurisdictions = ['CA', 'US', 'UK', 'AU'];
  let total = 0;

  for (let i = 0; i < results.length; i++) {
    const jur = jurisdictions[i];
    const res = results[i];
    if (res.status === 'fulfilled') {
      const records = res.value;
      if (records.length > 0) {
        saveRecords(jur, records);
        total += records.length;
      } else {
        console.warn(`[foreign-aid:${jur}] No records fetched`);
      }
    } else {
      console.error(`[foreign-aid:${jur}] Failed: ${res.reason?.message}`);
    }
  }

  console.log(`\n[foreign-aid] Done. ${total} total records saved.`);
  return total;
}

module.exports = { fetchAllForeignAid };

// Direct invocation
if (require.main === module) {
  require('dotenv').config();
  fetchAllForeignAid().then(n => {
    console.log(`[foreign-aid] Complete — ${n} records`);
    process.exit(0);
  }).catch(err => {
    console.error('[foreign-aid] Fatal:', err.message);
    process.exit(1);
  });
}
