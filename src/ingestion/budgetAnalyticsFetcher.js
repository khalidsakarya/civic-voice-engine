/**
 * Budget & Analytics Data Fetcher — Civic Voice Engine
 *
 * Fetches two data categories for Canada, USA, United Kingdom, and Australia:
 *
 * BUDGET DATA (output/budget_analytics/budget_{JUR}_{ts}.json)
 *   - Federal budget distribution by sector (health, education, defence, social)
 *   - Department spending vs allocated budgets
 *   - "Where the Money Goes" overview stats
 *
 * ANALYTICS DATA (output/budget_analytics/analytics_{ts}.json)
 *   - GDP and GDP per capita            (World Bank: NY.GDP.MKTP.CD, NY.GDP.PCAP.CD)
 *   - Unemployment rate                  (World Bank: SL.UEM.TOTL.ZS)
 *   - Inflation / CPI                    (World Bank: FP.CPI.TOTL.ZG)
 *   - Crime trends / homicide rate       (World Bank / UNODC: VC.IHR.PSRC.P5)
 *   - Government expenditure by sector   (World Bank: health %, education %, military %)
 *
 * Data Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Economic + crime indicators:  World Bank API   (api.worldbank.org)  — all 4
 * US budget functions:          USAspending.gov  (api.usaspending.gov)
 * US agency spending:           USAspending.gov  (api.usaspending.gov) — year-round
 * CA allocations:               Open Canada CKAN (open.canada.ca) — Main Estimates
 * UK dept spending:             HM Treasury COINS search (data.gov.uk)
 * AU dept spending:             Portfolio budget search  (data.gov.au)
 *
 * Crime data strategy
 * ─────────────────────────────────────────────────────────────────────────────
 * Base (all 4 countries): World Bank / UNODC intentional homicide rate per 100k
 *   indicator VC.IHR.PSRC.P5 — reliable, consistent, no key required.
 * Supplemental (where accessible): country-specific total crime APIs.
 *   StatCan and ABS publish data as zip archives (no dependency for unzip);
 *   the ONS and BJS APIs do not expose crime datasets via free REST endpoints.
 *   Homicide rate is therefore the primary reliable crime metric across all
 *   four jurisdictions.
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'budget_analytics';
const COLLECTION_NAME = 'budget_data';

const OUTPUT_DIR   = path.resolve(__dirname, '../../output/budget_analytics');
const TIMEOUT_MS   = 30000;
const CURRENT_YEAR = new Date().getFullYear();

// World Bank uses 'GB' for the UK
const WB_CODES = { CA: 'CA', US: 'US', UK: 'GB', AU: 'AU' };

const CURRENCY_BY_JUR   = { CA: 'CAD', US: 'USD', UK: 'GBP', AU: 'AUD' };
const POPULATION_APPROX = { CA: 40_500_000, US: 335_000_000, UK: 67_600_000, AU: 26_500_000 };

const DEPT_SPENDING_NOTE =
  'Actual spending data available after fiscal year closes, typically 6–18 months after year-end. ' +
  'Amount shown is the allocated budget authority.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const safeStr = v => (v != null ? String(v).trim().slice(0, 500) || null : null);

function saveJSON(filename, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[budget-analytics] Saved → ${filepath}`);
  return filepath;
}

function calcTrend(current, previous) {
  if (current == null || previous == null || previous === 0) return 'unknown';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (pct >  1) return 'up';
  if (pct < -1) return 'down';
  return 'stable';
}

function calcPctChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return parseFloat(((current - previous) / Math.abs(previous) * 100).toFixed(2));
}

// ─── World Bank: economic, expenditure, and crime indicators ─────────────────
//
//  VC.IHR.PSRC.P5 is the UNODC intentional homicide rate sourced through the
//  World Bank and provides a consistent crime severity proxy for all 4
//  jurisdictions without any API key or country-specific endpoint.

const WB_INDICATORS = {
  gdp:             'NY.GDP.MKTP.CD',     // GDP current USD
  gdpPerCapita:    'NY.GDP.PCAP.CD',     // GDP per capita current USD
  unemployment:    'SL.UEM.TOTL.ZS',     // Unemployment % of labour force
  inflation:       'FP.CPI.TOTL.ZG',     // Inflation CPI annual %
  population:      'SP.POP.TOTL',        // Total population
  govtExpPctGDP:   'GC.XPN.TOTL.GD.ZS', // Government expense % of GDP
  militaryPctGDP:  'MS.MIL.XPND.GD.ZS', // Military expenditure % of GDP
  healthPctGDP:    'SH.XPD.GHED.GD.ZS', // Govt health expenditure % of GDP
  educationPctGDP: 'SE.XPD.TOTL.GD.ZS', // Govt education expenditure % of GDP
  homicideRate:    'VC.IHR.PSRC.P5',     // Intentional homicides per 100k (UNODC/World Bank)
};

async function fetchWBIndicator(indicatorId) {
  const codes = Object.values(WB_CODES).join(';'); // CA;US;GB;AU
  const url   = `https://api.worldbank.org/v2/country/${codes}/indicator/${indicatorId}?format=json&mrv=3&per_page=200`;
  const resp  = await axios.get(url, { timeout: TIMEOUT_MS });
  const entries = resp.data?.[1] || [];

  const byJur = {};
  for (const [jur, wbCode] of Object.entries(WB_CODES)) {
    const hits = entries
      .filter(e => e.country?.id === wbCode && e.value != null)
      .sort((a, b) => parseInt(b.date) - parseInt(a.date));

    byJur[jur] = {
      value:     hits[0]?.value ?? null,
      prevValue: hits[1]?.value ?? null,
      year:      hits[0]?.date  ? parseInt(hits[0].date) : null,
    };
  }
  return byJur;
}

async function fetchAllWorldBankData() {
  console.log('[budget-analytics] Fetching World Bank economic & crime indicators...');
  const result = { CA: {}, US: {}, UK: {}, AU: {} };

  for (const [key, indicatorId] of Object.entries(WB_INDICATORS)) {
    try {
      console.log(`[budget-analytics]   → ${key} (${indicatorId})`);
      const data = await fetchWBIndicator(indicatorId);
      for (const jur of Object.keys(result)) result[jur][key] = data[jur];
    } catch (err) {
      console.error(`[budget-analytics]   ✗ ${key}: ${err.message}`);
      const blank = { value: null, prevValue: null, year: null };
      for (const jur of Object.keys(result)) result[jur][key] = blank;
    }
  }

  return result;
}

// ─── USA: USAspending.gov — agency spending (year-round) ─────────────────────
//
//  POST /api/v2/spending/ with type="agency" and a period qualifier works
//  year-round for any certified fiscal year.
//  Retry strategy: try most-recent completed FY first (period=6 for partial,
//  period=12 for complete), stepping back one year at a time until data lands.

async function fetchUSAgencySpending() {
  const month = new Date().getMonth() + 1; // 1–12
  // Current FY (US: Oct–Sep). In Oct-Dec we're in the next FY.
  const currentFY = month >= 10 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
  // Period 1=Oct … 12=Sep; estimate current period within this FY
  const currentPeriod = month >= 10 ? month - 9 : month + 3;

  // Build a candidate list: [(currentFY, currentPeriod-1), (prevFY, 12), (prevFY-1, 12)]
  const candidates = [
    { fy: currentFY,     period: Math.max(1, currentPeriod - 1) },
    { fy: currentFY - 1, period: 12 },
    { fy: currentFY - 2, period: 12 },
    { fy: currentFY - 3, period: 12 },
  ];

  for (const { fy, period } of candidates) {
    console.log(`[budget-analytics:US] Trying agency spending FY${fy} period ${period}...`);
    try {
      const resp = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'agency', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      const results = resp.data?.results || [];
      if (results.length === 0) continue;

      const total = resp.data?.total || results.reduce((s, r) => s + (r.amount || 0), 0);
      console.log(`[budget-analytics:US] ✓ agency spending FY${fy} period ${period} — ${results.length} agencies`);
      return {
        fiscalYear: fy,
        period,
        total,
        departments: results
          .map(r => ({
            department: safeStr(r.name),
            amount:     safeNum(r.amount),
            code:       safeStr(r.id || r.code),
            pctOfTotal: total > 0 ? parseFloat(((r.amount / total) * 100).toFixed(2)) : null,
          }))
          .sort((a, b) => (b.amount || 0) - (a.amount || 0))
          .slice(0, 30),
        currency: 'USD',
        source:   `USAspending.gov — agency budget authority, FY${fy} (period ${period})`,
        dataNote: 'Budget authority (obligations) sourced from agency submission data',
      };
    } catch (err) {
      if (err.response?.status === 400) {
        console.log(`[budget-analytics:US] FY${fy} period ${period} not available (400), trying next...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error('USAspending: no available fiscal year / period combination found');
}

// ─── USA: USAspending.gov — budget functions ──────────────────────────────────
//
//  Same retry approach as agency spending above.

async function fetchUSBudgetFunctions() {
  const month = new Date().getMonth() + 1;
  const currentFY      = month >= 10 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
  const currentPeriod  = month >= 10 ? month - 9 : month + 3;

  const candidates = [
    { fy: currentFY,     period: Math.max(1, currentPeriod - 1) },
    { fy: currentFY - 1, period: 12 },
    { fy: currentFY - 2, period: 12 },
  ];

  for (const { fy, period } of candidates) {
    console.log(`[budget-analytics:US] Trying budget functions FY${fy} period ${period}...`);
    try {
      const resp = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'budget_function', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      const total   = resp.data?.total   || 0;
      const results = resp.data?.results || [];
      if (results.length === 0) continue;

      console.log(`[budget-analytics:US] ✓ budget functions FY${fy} period ${period} — ${results.length} functions`);
      return {
        fiscalYear: fy,
        period,
        total,
        functions: results
          .map(r => ({
            name:       safeStr(r.name),
            amount:     safeNum(r.amount),
            percentage: total > 0 ? parseFloat(((r.amount / total) * 100).toFixed(2)) : null,
          }))
          .sort((a, b) => (b.amount || 0) - (a.amount || 0)),
      };
    } catch (err) {
      if (err.response?.status === 400) { continue; }
      throw err;
    }
  }

  throw new Error('USAspending: no available fiscal year / period combination found for budget functions');
}

// ─── Canada: open.canada.ca — Main Estimates departmental appropriations ──────

async function fetchCABudgetAllocations() {
  console.log('[budget-analytics:CA] Fetching departmental allocations (Main Estimates)...');
  const RESOURCE_ID = 'f87c5f47-dd85-4c6f-b85e-2c59ccf8d84c';

  const resp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
    params:  { resource_id: RESOURCE_ID, limit: 1000, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows = resp.data?.result?.records || [];
  if (rows.length === 0) return null;

  const byDept = {};
  for (const row of rows) {
    const dept   = safeStr(row.organization) || 'Other';
    const amount = safeNum(row.authorities)  || 0;
    byDept[dept] = (byDept[dept] || 0) + amount;
  }

  const departments = Object.entries(byDept)
    .map(([department, amount]) => ({ department, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 30);

  return {
    departments,
    totalAmount:    departments.reduce((s, d) => s + d.amount, 0),
    currency:       'CAD',
    sourceRows:     rows.length,
    totalAvailable: resp.data?.result?.total,
    source:         'open.canada.ca — Main Estimates (Budgetary Authorities)',
  };
}

// ─── UK: HM Treasury COINS data via data.gov.uk ──────────────────────────────
//
//  Searches data.gov.uk specifically for HM Treasury COINS (Combined Online
//  Information System) departmental expenditure datasets.

async function fetchUKBudgetData() {
  console.log('[budget-analytics:UK] Searching data.gov.uk for HM Treasury COINS expenditure data...');

  const queries = [
    'HM Treasury COINS departmental expenditure limits',
    'public expenditure statistical analyses department spending',
    'central government supply expenditure HM Treasury',
  ];

  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.uk/api/3/action/package_search', {
        params:  { q, rows: 5, sort: 'score desc' },
        timeout: TIMEOUT_MS,
      });

      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;

        const dataResp = await axios.get('https://data.gov.uk/api/3/action/datastore_search', {
          params:  { resource_id: resource.id, limit: 100 },
          timeout: TIMEOUT_MS,
        });

        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;

        const departments = rows.map(r => ({
          department: safeStr(
            r.Department || r.department || r['Department name'] ||
            r['Departmental group'] || r.Body || r.body
          ),
          amount: safeNum(
            r.Amount || r.amount || r.Expenditure || r.expenditure ||
            r['Total DEL'] || r['Total AME'] || r.Total || r.total ||
            r['2023-24'] || r['2022-23'] || r['2024-25']
          ),
        }))
          .filter(d => d.department && d.amount != null && d.amount !== 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 30);

        if (departments.length === 0) continue;

        console.log(`[budget-analytics:UK] ✓ Found via "${safeStr(pkg.title)}"`);
        return {
          departments,
          totalAmount: departments.reduce((s, d) => s + d.amount, 0),
          currency:    'GBP',
          source:      `data.gov.uk — ${safeStr(pkg.title)}`,
          resourceId:  resource.id,
        };
      }
    } catch (err) {
      console.warn(`[budget-analytics:UK] Query "${q.slice(0, 40)}" failed: ${err.message}`);
    }
  }

  return null;
}

// ─── Australia: Portfolio Budget Statements via data.gov.au ──────────────────

async function fetchAUBudgetData() {
  console.log('[budget-analytics:AU] Searching data.gov.au for portfolio budget data...');

  const queries = [
    'portfolio budget statements departmental appropriation agency',
    'australian government budget agency expenditure appropriation',
    'department expenditure appropriation treasury finance',
  ];

  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
        params:  { q, rows: 5, sort: 'score desc' },
        timeout: TIMEOUT_MS,
      });

      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;

        const dataResp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
          params:  { resource_id: resource.id, limit: 100 },
          timeout: TIMEOUT_MS,
        });

        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;

        const departments = rows.map(r => ({
          department: safeStr(
            r.Agency || r.agency || r.Department || r.department ||
            r.Portfolio || r.portfolio || r.Entity || r.entity
          ),
          amount: safeNum(
            r.Amount || r.amount || r.Total || r.total ||
            r.Expenditure || r.expenditure || r.Appropriation || r.appropriation ||
            r['Departmental'] || r['Administered']
          ),
        }))
          .filter(d => d.department && d.amount != null && d.amount !== 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 30);

        if (departments.length === 0) continue;

        console.log(`[budget-analytics:AU] ✓ Found via "${safeStr(pkg.title)}"`);
        return {
          departments,
          totalAmount: departments.reduce((s, d) => s + d.amount, 0),
          currency:    'AUD',
          source:      `data.gov.au — ${safeStr(pkg.title)}`,
          resourceId:  resource.id,
        };
      }
    } catch (err) {
      console.warn(`[budget-analytics:AU] Query "${q.slice(0, 40)}" failed: ${err.message}`);
    }
  }

  return null;
}

// ─── Budget document builder ──────────────────────────────────────────────────

function buildBudgetDoc(jur, wbData, deptData, budgetFunctions) {
  const gdp        = wbData.gdp?.value        ?? null;
  const gdpYear    = wbData.gdp?.year         ?? CURRENT_YEAR - 1;
  const population = wbData.population?.value ?? POPULATION_APPROX[jur];

  const healthPct   = wbData.healthPctGDP?.value    ?? null;
  const educPct     = wbData.educationPctGDP?.value ?? null;
  const militaryPct = wbData.militaryPctGDP?.value  ?? null;
  const govExpPct   = wbData.govtExpPctGDP?.value   ?? null;

  const totalGovtSpendUSD = gdp && govExpPct ? Math.round(gdp * govExpPct / 100) : null;

  // Sector breakdown from World Bank %s applied to GDP (USD for cross-country comparability)
  const budgetDistribution = [
    healthPct   != null ? { category: 'Health',    pctOfGDP: healthPct,   estimatedAmountUSD: gdp ? Math.round(gdp * healthPct   / 100) : null } : null,
    educPct     != null ? { category: 'Education', pctOfGDP: educPct,     estimatedAmountUSD: gdp ? Math.round(gdp * educPct     / 100) : null } : null,
    militaryPct != null ? { category: 'Defence',   pctOfGDP: militaryPct, estimatedAmountUSD: gdp ? Math.round(gdp * militaryPct / 100) : null } : null,
  ].filter(Boolean);

  // Department-level spending: amountType + note on every entry so the UI
  // can show an "Allocated (Estimated)" badge instead of a blank spent field.
  const departmentSpending = deptData?.departments?.map(d => {
    const total = deptData.totalAmount || 0;
    return {
      department:  d.department,
      allocated:   d.amount,
      amountType:  'Allocated',        // UI badge: show as "Estimated" / "Allocated"
      currency:    deptData.currency || CURRENCY_BY_JUR[jur],
      spent:       null,               // actuals released after fiscal year closes
      pctOfTotal:  total > 0 ? parseFloat(((d.amount / total) * 100).toFixed(2)) : null,
      note:        DEPT_SPENDING_NOTE,
    };
  }) ?? null;

  const whereMoneyGoes = {
    totalGovtExpenditureUSD: totalGovtSpendUSD,
    govtExpenditurePctOfGDP: govExpPct,
    perCapitaUSD:            totalGovtSpendUSD && population ? Math.round(totalGovtSpendUSD / population) : null,
    topSectors:              budgetDistribution,
    dataYear:                gdpYear,
    source:                  'World Bank government expenditure indicators',
    note:                    'Sector amounts are World Bank estimates and may differ from official national accounts',
  };

  return {
    id:                      jur,
    jurisdiction:            jur,
    currency:                CURRENCY_BY_JUR[jur],
    fiscalYear:              CURRENT_YEAR,
    dataYear:                gdpYear,
    gdpUSD:                  gdp ? Math.round(gdp) : null,
    totalGovtExpenditureUSD: totalGovtSpendUSD,
    govtExpenditurePctOfGDP: govExpPct,
    budgetDistribution,
    budgetFunctions:         budgetFunctions ?? null, // US only
    departmentSpending,
    whereMoneyGoes,
    dataSources: [
      'World Bank Open Data (api.worldbank.org)',
      ...(jur === 'US' ? ['USAspending.gov (api.usaspending.gov)']    : []),
      ...(jur === 'CA' ? ['Open Canada — Main Estimates (open.canada.ca)'] : []),
      ...(jur === 'UK' && deptData ? [deptData.source || 'data.gov.uk']   : []),
      ...(jur === 'AU' && deptData ? [deptData.source || 'data.gov.au']   : []),
    ],
  };
}

// ─── Analytics document builder ───────────────────────────────────────────────
//
//  crimeTrends is built from the World Bank / UNODC intentional homicide rate
//  (VC.IHR.PSRC.P5) which is consistently available for all 4 jurisdictions.
//  This is the primary crime metric — comparable, annual, and key-free.

function buildAnalyticsDoc(jur, wbData) {
  const gdp         = wbData.gdp;
  const gdpPC       = wbData.gdpPerCapita;
  const unemp       = wbData.unemployment;
  const inf         = wbData.inflation;
  const healthPct   = wbData.healthPctGDP;
  const educPct     = wbData.educationPctGDP;
  const militaryPct = wbData.militaryPctGDP;
  const homicide    = wbData.homicideRate;

  const crimeTrends = homicide?.value != null ? {
    homicideRatePer100k: parseFloat(homicide.value.toFixed(3)),
    year:                homicide.year,
    trend:               calcTrend(homicide.value, homicide.prevValue),
    percentChange:       calcPctChange(homicide.value, homicide.prevValue),
    metric:              'Intentional homicides per 100,000 population',
    source:              'United Nations Office on Drugs and Crime (UNODC) via World Bank (VC.IHR.PSRC.P5)',
    note:                'Homicide rate is the primary internationally comparable crime metric. ' +
                         'Total recorded crime figures require country-specific open data sources.',
  } : null;

  return {
    id:           jur,
    jurisdiction: jur,
    gdp: {
      valueUSD:      gdp?.value    != null ? Math.round(gdp.value) : null,
      perCapitaUSD:  gdpPC?.value  != null ? Math.round(gdpPC.value) : null,
      year:          gdp?.year     ?? null,
      trend:         calcTrend(gdp?.value, gdp?.prevValue),
      percentChange: calcPctChange(gdp?.value, gdp?.prevValue),
    },
    unemployment: {
      rate:          unemp?.value      ?? null,
      year:          unemp?.year       ?? null,
      trend:         calcTrend(unemp?.value, unemp?.prevValue),
      percentChange: calcPctChange(unemp?.value, unemp?.prevValue),
    },
    inflation: {
      rate:          inf?.value        ?? null,
      year:          inf?.year         ?? null,
      trend:         calcTrend(inf?.value, inf?.prevValue),
      percentChange: calcPctChange(inf?.value, inf?.prevValue),
    },
    crimeTrends,
    governmentSpendingByCategory: {
      healthPctGDP:    healthPct?.value    ?? null,
      educationPctGDP: educPct?.value      ?? null,
      militaryPctGDP:  militaryPct?.value  ?? null,
      dataYear:        healthPct?.year     ?? null,
    },
    source: 'World Bank Open Data (api.worldbank.org)',
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function fetchAllBudgetAnalytics() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // ── 1. World Bank indicators for all countries (includes homicide rate) ────
  const wbData = await fetchAllWorldBankData();

  // ── 2. US: agency spending (year-round via period retry) ──────────────────
  let usAgencySpending  = null;
  let usBudgetFunctions = null;

  try {
    usAgencySpending = await fetchUSAgencySpending();
  } catch (err) {
    console.error(`[budget-analytics:US] ✗ agency spending: ${err.message}`);
  }

  try {
    usBudgetFunctions = await fetchUSBudgetFunctions();
  } catch (err) {
    console.error(`[budget-analytics:US] ✗ budget functions: ${err.message}`);
  }

  // ── 3. Canada budget (open.canada.ca Main Estimates) ──────────────────────
  let caAllocations = null;
  try {
    caAllocations = await fetchCABudgetAllocations();
  } catch (err) {
    console.error(`[budget-analytics:CA] ✗ allocations: ${err.message}`);
  }

  // ── 4. UK budget (HM Treasury COINS via data.gov.uk) ─────────────────────
  let ukBudget = null;
  try {
    ukBudget = await fetchUKBudgetData();
  } catch (err) {
    console.error(`[budget-analytics:UK] ✗ budget: ${err.message}`);
  }

  // ── 5. Australia budget (Portfolio Budget Statements via data.gov.au) ──────
  let auBudget = null;
  try {
    auBudget = await fetchAUBudgetData();
  } catch (err) {
    console.error(`[budget-analytics:AU] ✗ budget: ${err.message}`);
  }

  // ── 6. Assemble and save budget docs ──────────────────────────────────────
  const deptDataByJur = { CA: caAllocations, US: usAgencySpending, UK: ukBudget, AU: auBudget };

  const budgetAll = {};
  const _ts = new Date().toISOString();
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    const doc = buildBudgetDoc(
      jur,
      wbData[jur],
      deptDataByJur[jur],
      jur === 'US' ? usBudgetFunctions : null
    );
    budgetAll[jur] = doc;

    saveJSON(`budget_${jur}_${timestamp}.json`, {
      generatedAt:  new Date().toISOString(),
      jurisdiction: jur,
      ...doc,
    });
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: jur, data_pull_timestamp: _ts, source_endpoint: 'https://api.worldbank.org/v2/country', record_count: 1, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  }

  // ── 7. Assemble and save analytics docs (crime from World Bank) ───────────
  const analyticsAll = {};
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    analyticsAll[jur] = buildAnalyticsDoc(jur, wbData[jur]);
  }

  saveJSON(`analytics_${timestamp}.json`, {
    generatedAt:   new Date().toISOString(),
    jurisdictions: analyticsAll,
  });

  console.log('[budget-analytics] ✓ All data fetched and saved to output/budget_analytics/');
  return { budget: budgetAll, analytics: analyticsAll };
}

module.exports = { fetchAllBudgetAnalytics };

// ── Standalone run ─────────────────────────────────────────────────────────
if (require.main === module) {
  fetchAllBudgetAnalytics()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
