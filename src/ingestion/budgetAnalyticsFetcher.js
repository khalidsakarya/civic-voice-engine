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
 *   - Crime trends                       (UK: data.police.uk; US: FBI CDE)
 *   - Government expenditure by sector   (World Bank: health %, education %, military %)
 *
 * Data Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Economic indicators:  World Bank API     (api.worldbank.org)           — all 4
 * US budget functions:  USAspending.gov    (api.usaspending.gov)
 * US agency spending:   USAspending.gov    (api.usaspending.gov)
 * CA allocations:       Open Canada CKAN   (open.canada.ca) — Main Estimates
 * UK expenditure:       data.gov.uk CKAN   (data.gov.uk)
 * AU budget:            data.gov.au CKAN   (data.gov.au)
 * US crime:             FBI CDE API        (cde.ucr.cjis.gov)
 * UK crime:             data.police.uk     (data.police.uk)
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR   = path.resolve(__dirname, '../../output/budget_analytics');
const TIMEOUT_MS   = 30000;
const CURRENT_YEAR = new Date().getFullYear();

// World Bank uses 'GB' for the UK
const WB_CODES = { CA: 'CA', US: 'US', UK: 'GB', AU: 'AU' };

const CURRENCY_BY_JUR   = { CA: 'CAD', US: 'USD', UK: 'GBP', AU: 'AUD' };
const POPULATION_APPROX = { CA: 40_500_000, US: 335_000_000, UK: 67_600_000, AU: 26_500_000 };

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

// ─── World Bank: economic & expenditure indicators ───────────────────────────

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
};

/**
 * Fetches one World Bank indicator for all 4 jurisdictions at once.
 * Returns { CA, US, UK, AU } each with { value, prevValue, year }.
 */
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
  console.log('[budget-analytics] Fetching World Bank economic indicators...');
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

// ─── USA: USAspending.gov — budget functions & agency spending ────────────────
//
//  POST /api/v2/spending/ with type="budget_function" → spending by federal function
//  POST /api/v2/spending/ with type="agency"          → spending by top-tier agency
//
//  Tries the current US fiscal year first, then FY-1 if the submission window
//  is not yet available (same retry pattern as expenseFetcher.js).

async function fetchUSBudgetForFY(type, fy) {
  const resp = await axios.post(
    'https://api.usaspending.gov/api/v2/spending/',
    { type, filters: { fy: String(fy) } },
    { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
  );
  return resp;
}

async function fetchUSBudgetFunctions() {
  const month = new Date().getMonth() + 1;
  const fy    = month >= 10 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
  console.log(`[budget-analytics:US] Fetching budget functions (FY${fy})...`);

  let resp;
  try {
    resp = await fetchUSBudgetForFY('budget_function', fy);
  } catch (err) {
    if (err.response?.status === 400) {
      console.log(`[budget-analytics:US] FY${fy} not available, trying FY${fy - 1}...`);
      resp = await fetchUSBudgetForFY('budget_function', fy - 1);
    } else throw err;
  }

  const total   = resp.data?.total   || 0;
  const results = resp.data?.results || [];
  return {
    fiscalYear: fy,
    total,
    functions: results
      .map(r => ({
        name:       safeStr(r.name),
        amount:     safeNum(r.amount),
        percentage: total > 0 ? parseFloat(((r.amount / total) * 100).toFixed(2)) : null,
      }))
      .sort((a, b) => (b.amount || 0) - (a.amount || 0)),
  };
}

async function fetchUSAgencySpending(fy) {
  console.log(`[budget-analytics:US] Fetching agency spending (FY${fy})...`);
  let resp;
  try {
    resp = await fetchUSBudgetForFY('agency', fy);
  } catch (err) {
    if (err.response?.status === 400) {
      resp = await fetchUSBudgetForFY('agency', fy - 1);
    } else throw err;
  }
  const total   = resp.data?.total   || 0;
  const results = resp.data?.results || [];
  return results
    .map(r => ({
      department: safeStr(r.name),
      amount:     safeNum(r.amount),
      code:       safeStr(r.id || r.code),
      pctOfTotal: total > 0 ? parseFloat(((r.amount / total) * 100).toFixed(2)) : null,
    }))
    .sort((a, b) => (b.amount || 0) - (a.amount || 0))
    .slice(0, 30);
}

// ─── Canada: open.canada.ca — Main Estimates departmental appropriations ──────
//
//  Uses the same CKAN dataset as expenseFetcher (a35cf382-…) and fetches a
//  higher record limit to aggregate per-department budget allocations.

async function fetchCABudgetAllocations() {
  console.log('[budget-analytics:CA] Fetching departmental allocations (Main Estimates)...');
  const RESOURCE_ID = 'f87c5f47-dd85-4c6f-b85e-2c59ccf8d84c';

  const resp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
    params:  { resource_id: RESOURCE_ID, limit: 1000, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });

  const rows = resp.data?.result?.records || [];
  if (rows.length === 0) return null;

  // Aggregate authority amounts by organization (department)
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

  const totalAmount = departments.reduce((s, d) => s + d.amount, 0);

  return {
    departments,
    totalAmount,
    currency:       'CAD',
    sourceRows:     rows.length,
    totalAvailable: resp.data?.result?.total,
    source:         'open.canada.ca — Main Estimates (Budgetary Authorities)',
  };
}

// ─── UK: data.gov.uk — Public Expenditure Statistical Analyses (PESA) ─────────

async function fetchUKBudgetData() {
  console.log('[budget-analytics:UK] Searching data.gov.uk for public expenditure data...');

  const searchResp = await axios.get('https://data.gov.uk/api/3/action/package_search', {
    params:  { q: 'public expenditure department spending statistics', rows: 5, sort: 'score desc' },
    timeout: TIMEOUT_MS,
  });

  const packages = searchResp.data?.result?.results || [];
  if (packages.length === 0) return null;

  for (const pkg of packages) {
    const resource = (pkg.resources || []).find(r => r.datastore_active);
    if (!resource) continue;

    try {
      const dataResp = await axios.get('https://data.gov.uk/api/3/action/datastore_search', {
        params:  { resource_id: resource.id, limit: 100 },
        timeout: TIMEOUT_MS,
      });

      const rows = dataResp.data?.result?.records || [];
      if (rows.length === 0) continue;

      // Try to extract department + amount from any plausible field names
      const departments = rows.map(r => {
        const dept   = safeStr(r.Department || r.department || r['Department name'] || r.Body || r.body);
        const amount = safeNum(r.Amount || r.amount || r.Expenditure || r.expenditure || r.Total || r['2023-24'] || r['2022-23']);
        return { department: dept, amount };
      }).filter(d => d.department && d.amount != null && d.amount !== 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 30);

      if (departments.length === 0) continue;

      return {
        departments,
        totalAmount: departments.reduce((s, d) => s + d.amount, 0),
        currency:    'GBP',
        source:      `data.gov.uk — ${safeStr(pkg.title)}`,
        resourceId:  resource.id,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// ─── Australia: data.gov.au — Portfolio Budget Statements ─────────────────────

async function fetchAUBudgetData() {
  console.log('[budget-analytics:AU] Searching data.gov.au for budget data...');

  const searchResp = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
    params:  { q: 'budget department portfolio expenditure agency', rows: 5, sort: 'score desc' },
    timeout: TIMEOUT_MS,
  });

  const packages = searchResp.data?.result?.results || [];
  if (packages.length === 0) return null;

  for (const pkg of packages) {
    const resource = (pkg.resources || []).find(r => r.datastore_active);
    if (!resource) continue;

    try {
      const dataResp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
        params:  { resource_id: resource.id, limit: 100 },
        timeout: TIMEOUT_MS,
      });

      const rows = dataResp.data?.result?.records || [];
      if (rows.length === 0) continue;

      const departments = rows.map(r => {
        const dept   = safeStr(r.Agency || r.agency || r.Department || r.department || r.Portfolio || r.portfolio);
        const amount = safeNum(r.Amount || r.amount || r.Total || r.total || r.Expenditure || r.expenditure);
        return { department: dept, amount };
      }).filter(d => d.department && d.amount != null && d.amount !== 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 30);

      if (departments.length === 0) continue;

      return {
        departments,
        totalAmount: departments.reduce((s, d) => s + d.amount, 0),
        currency:    'AUD',
        source:      `data.gov.au — ${safeStr(pkg.title)}`,
        resourceId:  resource.id,
      };
    } catch {
      continue;
    }
  }

  return null;
}

// ─── Crime trends ─────────────────────────────────────────────────────────────

async function fetchUSCrimeData() {
  console.log('[budget-analytics:US] Fetching FBI crime estimates...');
  const year = CURRENT_YEAR - 2; // FBI data typically lags 2 years
  const resp = await axios.get(
    `https://cde.ucr.cjis.gov/LATEST/webapp/data/estimated-crime?year_start=${year}&year_end=${year}`,
    { timeout: TIMEOUT_MS }
  );
  const data = Array.isArray(resp.data) ? resp.data[0] : resp.data;
  if (!data) return null;

  const violent  = safeNum(data.violent_crime)  || safeNum(data.violentCrime);
  const property = safeNum(data.property_crime) || safeNum(data.propertyCrime);
  const pop      = safeNum(data.population)     || POPULATION_APPROX.US;

  return {
    year,
    violentCrimeTotal:  violent,
    propertyCrimeTotal: property,
    combinedTotal:      violent != null && property != null ? violent + property : null,
    crimeRatePer100k:   violent != null && property != null && pop > 0
      ? parseFloat(((violent + property) / pop * 100000).toFixed(1))
      : null,
    trend:  'unknown',
    source: 'FBI Crime Data Explorer (cde.ucr.cjis.gov)',
  };
}

async function fetchUKCrimeData() {
  console.log('[budget-analytics:UK] Fetching UK police crime data...');
  // data.police.uk national stop-and-search (no-location crimes) — no API key needed
  const now  = new Date();
  const date = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const resp = await axios.get(
    `https://data.police.uk/api/crimes-no-location?category=all-crime&date=${date}`,
    { timeout: TIMEOUT_MS }
  );
  const records = Array.isArray(resp.data) ? resp.data : [];
  if (records.length === 0) return null;

  const byCategory = {};
  for (const r of records) {
    const cat = safeStr(r.category) || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  }

  return {
    date,
    totalReported: records.length,
    topCategories: Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([category, count]) => ({ category, count })),
    trend:  'unknown',
    source: 'data.police.uk',
    note:   'National crimes with no specific location (excludes geolocalised crimes)',
  };
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

  // Sector breakdown from World Bank %s applied to GDP (all in USD for comparability)
  const budgetDistribution = [
    healthPct   != null ? { category: 'Health',    pctOfGDP: healthPct,   estimatedAmountUSD: gdp ? Math.round(gdp * healthPct   / 100) : null } : null,
    educPct     != null ? { category: 'Education', pctOfGDP: educPct,     estimatedAmountUSD: gdp ? Math.round(gdp * educPct     / 100) : null } : null,
    militaryPct != null ? { category: 'Defence',   pctOfGDP: militaryPct, estimatedAmountUSD: gdp ? Math.round(gdp * militaryPct / 100) : null } : null,
  ].filter(Boolean);

  // Department-level spending in local currency (from country-specific APIs)
  const departmentSpending = deptData?.departments?.map(d => {
    const total = deptData.totalAmount || 0;
    return {
      department: d.department,
      allocated:  d.amount,
      currency:   deptData.currency || CURRENCY_BY_JUR[jur],
      spent:      null, // actual spend requires separate actuals dataset
      pctOfTotal: total > 0 ? parseFloat(((d.amount / total) * 100).toFixed(2)) : null,
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
    // US only: granular budget function breakdown from USAspending.gov
    budgetFunctions:         budgetFunctions ?? null,
    departmentSpending,
    whereMoneyGoes,
    dataSources: [
      'World Bank Open Data (api.worldbank.org)',
      ...(jur === 'US' ? ['USAspending.gov (api.usaspending.gov)']                        : []),
      ...(jur === 'CA' ? ['Open Canada — Main Estimates (open.canada.ca)']                : []),
      ...(jur === 'UK' && deptData ? [`${deptData.source || 'data.gov.uk'}`]              : []),
      ...(jur === 'AU' && deptData ? [`${deptData.source || 'data.gov.au'}`]              : []),
    ],
  };
}

// ─── Analytics document builder ───────────────────────────────────────────────

function buildAnalyticsDoc(jur, wbData, crimeData) {
  const gdp         = wbData.gdp;
  const gdpPC       = wbData.gdpPerCapita;
  const unemp       = wbData.unemployment;
  const inf         = wbData.inflation;
  const healthPct   = wbData.healthPctGDP;
  const educPct     = wbData.educationPctGDP;
  const militaryPct = wbData.militaryPctGDP;

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
    crimeTrends: crimeData ?? null,
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

  // ── 1. World Bank indicators for all countries ─────────────────────────────
  const wbData = await fetchAllWorldBankData();

  // ── 2. US budget (USAspending.gov) ────────────────────────────────────────
  const month = new Date().getMonth() + 1;
  const usFY  = month >= 10 ? CURRENT_YEAR + 1 : CURRENT_YEAR;

  let usBudgetFunctions = null;
  let usAgencySpending  = null;

  try {
    usBudgetFunctions = await fetchUSBudgetFunctions();
  } catch (err) {
    console.error(`[budget-analytics:US] ✗ budget functions: ${err.message}`);
  }

  try {
    usAgencySpending = await fetchUSAgencySpending(usBudgetFunctions?.fiscalYear || usFY);
  } catch (err) {
    console.error(`[budget-analytics:US] ✗ agency spending: ${err.message}`);
  }

  // ── 3. Canada budget (open.canada.ca) ─────────────────────────────────────
  let caAllocations = null;
  try {
    caAllocations = await fetchCABudgetAllocations();
  } catch (err) {
    console.error(`[budget-analytics:CA] ✗ allocations: ${err.message}`);
  }

  // ── 4. UK budget (data.gov.uk) ────────────────────────────────────────────
  let ukBudget = null;
  try {
    ukBudget = await fetchUKBudgetData();
  } catch (err) {
    console.error(`[budget-analytics:UK] ✗ budget: ${err.message}`);
  }

  // ── 5. Australia budget (data.gov.au) ─────────────────────────────────────
  let auBudget = null;
  try {
    auBudget = await fetchAUBudgetData();
  } catch (err) {
    console.error(`[budget-analytics:AU] ✗ budget: ${err.message}`);
  }

  // ── 6. Crime data ──────────────────────────────────────────────────────────
  const crimeData = { CA: null, US: null, UK: null, AU: null };

  try { crimeData.US = await fetchUSCrimeData(); }
  catch (err) { console.error(`[budget-analytics:US] ✗ crime: ${err.message}`); }

  try { crimeData.UK = await fetchUKCrimeData(); }
  catch (err) { console.error(`[budget-analytics:UK] ✗ crime: ${err.message}`); }

  // ── 7. Assemble and save budget docs ──────────────────────────────────────
  const usDeptData = usAgencySpending
    ? { departments: usAgencySpending, totalAmount: usBudgetFunctions?.total || 0, currency: 'USD' }
    : null;

  const deptDataByJur = { CA: caAllocations, US: usDeptData, UK: ukBudget, AU: auBudget };

  const budgetAll = {};
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
  }

  // ── 8. Assemble and save analytics docs ──────────────────────────────────
  const analyticsAll = {};
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    analyticsAll[jur] = buildAnalyticsDoc(jur, wbData[jur], crimeData[jur]);
  }

  saveJSON(`analytics_${timestamp}.json`, {
    generatedAt:  new Date().toISOString(),
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
