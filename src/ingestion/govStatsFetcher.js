/**
 * Government Statistics Fetcher — Civic Voice Engine
 *
 * Fetches quarterly fiscal statistics for Canada, USA, United Kingdom, Australia:
 *   - Revenue sources breakdown  (tax types, social contributions, total)
 *   - Total spending by department
 *   - Deficit / surplus figures
 *   - National debt total
 *   - Unemployment rate
 *   - Foreign aid given (ODA)
 *   - Foreign loans note
 *   - Grants by department
 *   - Department spending trends (year-over-year)
 *
 * Data Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Core fiscal indicators:       World Bank API (api.worldbank.org) — all 4
 * US unemployment (monthly):    BLS Public Data API v1 (api.bls.gov)
 * US agency spending:           USAspending.gov (api.usaspending.gov)
 * CA grants & contributions:    open.canada.ca CKAN proactive disclosure
 * CA dept allocations:          open.canada.ca CKAN Main Estimates
 * UK fiscal data:               data.gov.uk CKAN (ONS PSF / HM Treasury)
 * AU fiscal data:               data.gov.au CKAN (ABS GFS / Treasury)
 * National debt (all):          World Bank GC.DOD.TOTL.GD.ZS (% of GDP × GDP)
 *
 * Output: output/govstats/govstats_{JUR}_{timestamp}.json  (one per country)
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'gov_stats_quarterly';
const COLLECTION_NAME = 'government_stats';

const OUTPUT_DIR   = path.resolve(__dirname, '../../output/govstats');
const TIMEOUT_MS   = 30000;
const CURRENT_YEAR = new Date().getFullYear();

const WB_CODES          = { CA: 'CA', US: 'US', UK: 'GB', AU: 'AU' };
const CURRENCY_BY_JUR   = { CA: 'CAD', US: 'USD', UK: 'GBP', AU: 'AUD' };
const POPULATION_APPROX = { CA: 40_500_000, US: 335_000_000, UK: 67_600_000, AU: 26_500_000 };

const _now    = new Date();
const QUARTER = `Q${Math.ceil((_now.getMonth() + 1) / 3)}`;
const QUARTER_YEAR = _now.getFullYear();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeNum = v => { const n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; };
const safeStr = v => (v != null ? String(v).trim().slice(0, 500) || null : null);

function saveJSON(filename, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[govstats] Saved → ${filepath}`);
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

// ─── World Bank: core fiscal indicators ───────────────────────────────────────
//
//  All indicators use mrv=3 (most recent 3 values) to support trend calculation.
//  GC.* series = central government fiscal accounts (IMF GFS methodology).
//  DC.ODA.TOTL.CD = net official development assistance provided by DAC donors.

const WB_INDICATORS = {
  gdp:                  'NY.GDP.MKTP.CD',     // GDP current USD
  population:           'SP.POP.TOTL',        // Total population
  revenue:              'GC.REV.XGRT.GD.ZS',  // Revenue, excl. grants (% of GDP)
  taxRevenue:           'GC.TAX.TOTL.GD.ZS',  // Tax revenue (% of GDP)
  incomeTaxPctRev:      'GC.TAX.INTT.RV.ZS',  // Income / profit taxes (% of revenue)
  goodsTaxPctRev:       'GC.TAX.GSRV.RV.ZS',  // Goods & services taxes (% of revenue)
  tradeTaxPctRev:       'GC.TAX.IMPT.ZS',     // Import duties (% of tax revenue)
  socialContributions:  'GC.SRF.TOTL.GD.ZS',  // Social contributions (% of GDP)
  govtExpPctGDP:        'GC.XPN.TOTL.GD.ZS',  // Total govt expenditure (% of GDP)
  deficitPctGDP:        'GC.NLD.TOTL.GD.ZS',  // Net lending (+) / borrowing (-) (% of GDP)
  debtPctGDP:           'GC.DOD.TOTL.GD.ZS',  // Central govt debt, total (% of GDP)
  unemployment:         'SL.UEM.TOTL.ZS',     // Unemployment (% of labour force, ILO)
  odaProvided:          'DC.ODA.TOTL.CD',      // Net ODA provided, current USD
};

async function fetchWBIndicator(indicatorId) {
  const codes = Object.values(WB_CODES).join(';');
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
  console.log('[govstats] Fetching World Bank fiscal indicators...');
  const result = { CA: {}, US: {}, UK: {}, AU: {} };

  for (const [key, indicatorId] of Object.entries(WB_INDICATORS)) {
    try {
      console.log(`[govstats]   → ${key} (${indicatorId})`);
      const data = await fetchWBIndicator(indicatorId);
      for (const jur of Object.keys(result)) result[jur][key] = data[jur];
    } catch (err) {
      console.error(`[govstats]   ✗ ${key}: ${err.message}`);
      const blank = { value: null, prevValue: null, year: null };
      for (const jur of Object.keys(result)) result[jur][key] = blank;
    }
  }
  return result;
}

// ─── US: BLS Public API v1 — current unemployment rate ────────────────────────
//
//  Series LNS14000000 = civilian unemployment rate, seasonally adjusted.
//  v1 requires no API key; returns latest available monthly observation.

async function fetchUSBLSUnemployment() {
  console.log('[govstats:US] Fetching current unemployment from BLS...');
  const url  = 'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true';
  const resp = await axios.get(url, { timeout: TIMEOUT_MS });
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) return null;
  return {
    rate:    safeNum(latest.value),
    period:  safeStr(latest.periodName),
    year:    safeNum(latest.year),
    source:  'U.S. Bureau of Labor Statistics — CPS series LNS14000000 (api.bls.gov)',
  };
}

// ─── US: USAspending — agency budget authority (year-round via period retry) ──

async function fetchUSAgencySpending() {
  console.log('[govstats:US] Fetching agency spending from USAspending...');
  const month       = _now.getMonth() + 1;
  const currentFY   = month >= 10 ? CURRENT_YEAR + 1 : CURRENT_YEAR;
  const currentPeriod = month >= 10 ? month - 9 : month + 3;

  const candidates = [
    { fy: currentFY,     period: Math.max(1, currentPeriod - 1) },
    { fy: currentFY - 1, period: 12 },
    { fy: currentFY - 2, period: 12 },
    { fy: currentFY - 3, period: 12 },
  ];

  for (const { fy, period } of candidates) {
    console.log(`[govstats:US]   Trying agency spending FY${fy} period ${period}...`);
    try {
      const resp = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'agency', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      const results = resp.data?.results || [];
      if (results.length === 0) continue;
      const total = resp.data?.total || results.reduce((s, r) => s + (r.amount || 0), 0);
      console.log(`[govstats:US]   ✓ FY${fy} period ${period} — ${results.length} agencies`);
      return {
        fiscalYear:  fy,
        period,
        totalUSD:    total,
        agencies:    results
          .map(r => ({
            agency:     safeStr(r.name),
            amountUSD:  safeNum(r.amount),
            pctOfTotal: total > 0 ? parseFloat(((r.amount / total) * 100).toFixed(2)) : null,
          }))
          .sort((a, b) => (b.amountUSD || 0) - (a.amountUSD || 0))
          .slice(0, 25),
        source: `USAspending.gov — agency budget authority FY${fy} (period ${period})`,
      };
    } catch (err) {
      if (err.response?.status === 400) continue;
      throw err;
    }
  }
  return null;
}

// ─── CA: open.canada.ca — grants & contributions (proactive disclosure) ────────
//
//  The proactive disclosure dataset for grants & contributions covers all federal
//  departments and is updated quarterly.  We aggregate by department to produce
//  a ranked grant-by-department summary.

async function fetchCAGrantsContributions() {
  console.log('[govstats:CA] Fetching grants & contributions from open.canada.ca...');

  // Try the official G&C proactive disclosure package first
  const PKG_ID = '432527ab-7aac-45b5-81d6-7597107a7013';
  let resourceId = null;

  try {
    const pkgResp = await axios.get('https://open.canada.ca/data/api/3/action/package_show', {
      params: { id: PKG_ID }, timeout: TIMEOUT_MS,
    });
    const resource = (pkgResp.data?.result?.resources || []).find(r => r.datastore_active);
    if (resource) resourceId = resource.id;
  } catch (_) { /* fall through to search */ }

  // Fallback: search for the dataset
  if (!resourceId) {
    const searchResp = await axios.get('https://open.canada.ca/data/api/3/action/package_search', {
      params: { q: 'grants contributions proactive disclosure federal', rows: 5 },
      timeout: TIMEOUT_MS,
    });
    for (const pkg of searchResp.data?.result?.results || []) {
      const resource = (pkg.resources || []).find(r => r.datastore_active);
      if (resource) { resourceId = resource.id; break; }
    }
  }

  if (!resourceId) return null;

  const dataResp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
    params: { resource_id: resourceId, limit: 1000, sort: '_id desc' },
    timeout: TIMEOUT_MS,
  });
  const rows = dataResp.data?.result?.records || [];
  if (rows.length === 0) return null;

  const byDept = {};
  for (const row of rows) {
    const dept   = safeStr(
      row.owner_org_title || row.owner_org || row['Organization'] ||
      row['Recipient Organization'] || 'Other'
    ) || 'Other';
    const amount = safeNum(
      row.agreement_value || row.federal_funding_amount ||
      row['Amount'] || row['Value'] || row['Funding Amount']
    ) || 0;
    if (!byDept[dept]) byDept[dept] = { department: dept, totalCAD: 0, count: 0 };
    byDept[dept].totalCAD += amount;
    byDept[dept].count++;
  }

  const departments = Object.values(byDept)
    .sort((a, b) => b.totalCAD - a.totalCAD)
    .slice(0, 20);

  return {
    departments,
    totalCAD:    departments.reduce((s, d) => s + d.totalCAD, 0),
    recordCount: rows.length,
    totalAvailable: dataResp.data?.result?.total,
    source:      'open.canada.ca — Proactive Disclosure of Grants and Contributions (CKAN)',
  };
}

// ─── CA: open.canada.ca — Main Estimates dept allocations ────────────────────

async function fetchCADeptAllocations() {
  console.log('[govstats:CA] Fetching Main Estimates from open.canada.ca...');
  const RESOURCE_ID = 'f87c5f47-dd85-4c6f-b85e-2c59ccf8d84c';
  const resp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
    params: { resource_id: RESOURCE_ID, limit: 1000, sort: '_id desc' },
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
    .map(([department, allocated]) => ({ department, allocated }))
    .sort((a, b) => b.allocated - a.allocated)
    .slice(0, 25);

  return {
    departments,
    totalCAD: departments.reduce((s, d) => s + d.allocated, 0),
    source:   'open.canada.ca — Main Estimates (Budgetary Authorities) CKAN',
  };
}

// ─── UK: data.gov.uk — ONS Public Sector Finances / HM Treasury ──────────────

async function fetchUKFiscalData() {
  console.log('[govstats:UK] Searching data.gov.uk for public sector finances...');
  const queries = [
    'public sector finances receipts expenditure ONS',
    'HMRC tax receipts government revenue',
    'public sector net debt central government',
  ];

  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.uk/api/3/action/package_search', {
        params:  { q, rows: 5, sort: 'score desc' },
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' },
      });
      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;
        const dataResp = await axios.get('https://data.gov.uk/api/3/action/datastore_search', {
          params:  { resource_id: resource.id, limit: 50 },
          timeout: TIMEOUT_MS,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' },
        });
        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;

        // Extract dept/amount pairs from whatever columns are present
        const departments = rows.map(r => ({
          department: safeStr(
            r.Department || r.department || r['Department name'] ||
            r['Departmental group'] || r.Body || r['Organisation']
          ),
          amount: safeNum(
            r.Amount || r.amount || r.Expenditure || r.expenditure ||
            r['Total DEL'] || r['Total AME'] || r.Total || r.total ||
            r['2024-25'] || r['2023-24'] || r['2022-23']
          ),
        }))
          .filter(d => d.department && d.amount != null)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 20);

        if (departments.length === 0) continue;
        console.log(`[govstats:UK] ✓ Found via "${safeStr(pkg.title)}"`);
        return {
          departments,
          totalAmount: departments.reduce((s, d) => s + (d.amount || 0), 0),
          packageTitle: safeStr(pkg.title),
          source:       `data.gov.uk — ${safeStr(pkg.title)}`,
        };
      }
    } catch (err) {
      console.warn(`[govstats:UK] Query "${q.slice(0, 40)}" failed: ${err.message}`);
    }
  }
  return null;
}

// ─── AU: data.gov.au — ABS Government Finance Statistics ─────────────────────

async function fetchAUFiscalData() {
  console.log('[govstats:AU] Searching data.gov.au for government finance statistics...');
  const queries = [
    'government finance statistics revenue expenditure ABS',
    'commonwealth budget revenue tax receipts treasury',
    'federal government fiscal balance surplus deficit',
  ];

  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
        params:       { q, rows: 5, sort: 'score desc' },
        timeout:      TIMEOUT_MS,
        maxRedirects: 10,
        headers:      { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' },
      });
      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;
        const dataResp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
          params:       { resource_id: resource.id, limit: 50 },
          timeout:      TIMEOUT_MS,
          maxRedirects: 10,
          headers:      { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' },
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
            r.Departmental || r.Administered
          ),
        }))
          .filter(d => d.department && d.amount != null)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 20);

        if (departments.length === 0) continue;
        console.log(`[govstats:AU] ✓ Found via "${safeStr(pkg.title)}"`);
        return {
          departments,
          totalAmount: departments.reduce((s, d) => s + (d.amount || 0), 0),
          packageTitle: safeStr(pkg.title),
          source:       `data.gov.au — ${safeStr(pkg.title)}`,
        };
      }
    } catch (err) {
      console.warn(`[govstats:AU] Query "${q.slice(0, 40)}" failed: ${err.message}`);
    }
  }
  return null;
}

// ─── Document builder ──────────────────────────────────────────────────────────

function buildGovStatsDoc(jur, wbData, sup) {
  const gdpValue   = wbData.gdp?.value          ?? null;
  const gdpYear    = wbData.gdp?.year           ?? CURRENT_YEAR - 1;
  const population = wbData.population?.value   ?? POPULATION_APPROX[jur];

  // Convert World Bank % of GDP → absolute USD (for cross-country comparability)
  const pctToUSD = pct => (gdpValue != null && pct != null) ? Math.round(gdpValue * pct / 100) : null;

  // ── Revenue ────────────────────────────────────────────────────────────────
  const revPct          = wbData.revenue?.value             ?? null;
  const taxPct          = wbData.taxRevenue?.value          ?? null;
  const incomeTaxPctRev = wbData.incomeTaxPctRev?.value     ?? null;
  const goodsTaxPctRev  = wbData.goodsTaxPctRev?.value      ?? null;
  const tradeTaxPctRev  = wbData.tradeTaxPctRev?.value      ?? null;
  const socialContribPct= wbData.socialContributions?.value ?? null;
  const revYear         = wbData.revenue?.year              ?? gdpYear;

  const revUSD    = pctToUSD(revPct);
  const taxUSD    = pctToUSD(taxPct);
  const socialUSD = pctToUSD(socialContribPct);

  const revenue = {
    totalPctGDP:  revPct,
    totalUSD:     revUSD,
    perCapitaUSD: revUSD && population ? Math.round(revUSD / population) : null,
    trend: {
      direction:     calcTrend(wbData.revenue?.value, wbData.revenue?.prevValue),
      percentChange: calcPctChange(wbData.revenue?.value, wbData.revenue?.prevValue),
    },
    sources: {
      taxRevenuePctGDP:             taxPct,
      taxRevenueUSD:                taxUSD,
      incomeTaxPctOfRevenue:        incomeTaxPctRev,
      incomeTaxEstimatedUSD:        taxUSD != null && incomeTaxPctRev != null
                                      ? Math.round(taxUSD * incomeTaxPctRev / 100) : null,
      goodsServicesTaxPctOfRevenue: goodsTaxPctRev,
      goodsServicesTaxEstimatedUSD: taxUSD != null && goodsTaxPctRev != null
                                      ? Math.round(taxUSD * goodsTaxPctRev / 100) : null,
      importDutiesPctOfTaxRevenue:  tradeTaxPctRev,
      socialContributionsPctGDP:    socialContribPct,
      socialContributionsUSD:       socialUSD,
    },
    dataYear: revYear,
    source:   'World Bank — GC.REV.XGRT.GD.ZS, GC.TAX.* indicators',
  };

  // ── Spending ───────────────────────────────────────────────────────────────
  const spendPct  = wbData.govtExpPctGDP?.value     ?? null;
  const spendUSD  = pctToUSD(spendPct);

  // Dept breakdown: prefer live API data, fall back to WB total only
  let topDepartments = null;
  let spendingSource = 'World Bank GC.XPN.TOTL.GD.ZS';
  let spendingFY     = gdpYear;

  if (jur === 'US' && sup.agencySpending?.agencies) {
    topDepartments = sup.agencySpending.agencies;
    spendingSource = sup.agencySpending.source;
    spendingFY     = sup.agencySpending.fiscalYear;
  } else if (jur === 'CA' && sup.caDeptAllocations?.departments) {
    topDepartments = sup.caDeptAllocations.departments
      .slice(0, 20)
      .map(d => ({ agency: d.department, amountLocal: d.allocated, currency: 'CAD', pctOfTotal: null }));
    spendingSource = sup.caDeptAllocations.source;
  } else if (jur === 'UK' && sup.ukFiscal?.departments) {
    topDepartments = sup.ukFiscal.departments
      .map(d => ({ agency: d.department, amountLocal: d.amount, currency: 'GBP', pctOfTotal: null }));
    spendingSource = sup.ukFiscal.source;
  } else if (jur === 'AU' && sup.auFiscal?.departments) {
    topDepartments = sup.auFiscal.departments
      .map(d => ({ agency: d.department, amountLocal: d.amount, currency: 'AUD', pctOfTotal: null }));
    spendingSource = sup.auFiscal.source;
  }

  const spending = {
    totalPctGDP:     spendPct,
    totalUSD:        jur === 'US' && sup.agencySpending?.totalUSD
                       ? sup.agencySpending.totalUSD : spendUSD,
    perCapitaUSD:    spendUSD && population ? Math.round(spendUSD / population) : null,
    topDepartments,
    fiscalYear:      spendingFY,
    trend: {
      direction:     calcTrend(wbData.govtExpPctGDP?.value, wbData.govtExpPctGDP?.prevValue),
      percentChange: calcPctChange(wbData.govtExpPctGDP?.value, wbData.govtExpPctGDP?.prevValue),
    },
    source: spendingSource,
  };

  // ── Deficit / Surplus ──────────────────────────────────────────────────────
  const deficitPct  = wbData.deficitPctGDP?.value ?? null;
  const deficitUSD  = pctToUSD(deficitPct);
  const deficitYear = wbData.deficitPctGDP?.year  ?? gdpYear;

  const deficitSurplus = {
    cashBalancePctGDP: deficitPct,
    cashBalanceUSD:    deficitUSD,
    // Positive = surplus (govt lending to rest of economy); negative = deficit (borrowing)
    status:            deficitPct == null ? null : deficitPct >= 0 ? 'surplus' : 'deficit',
    trend: {
      direction:     calcTrend(wbData.deficitPctGDP?.value, wbData.deficitPctGDP?.prevValue),
      percentChange: calcPctChange(wbData.deficitPctGDP?.value, wbData.deficitPctGDP?.prevValue),
    },
    dataYear: deficitYear,
    source:   'World Bank — Net lending (+) / borrowing (-) (% of GDP) GC.NLD.TOTL.GD.ZS',
  };

  // ── National Debt ──────────────────────────────────────────────────────────
  const debtPct  = wbData.debtPctGDP?.value ?? null;
  const debtUSD  = pctToUSD(debtPct);
  const debtYear = wbData.debtPctGDP?.year  ?? gdpYear;

  const nationalDebt = {
    totalPctGDP:  debtPct,
    totalUSD:     debtUSD,
    perCapitaUSD: debtUSD && population ? Math.round(debtUSD / population) : null,
    trend: {
      direction:     calcTrend(wbData.debtPctGDP?.value, wbData.debtPctGDP?.prevValue),
      percentChange: calcPctChange(wbData.debtPctGDP?.value, wbData.debtPctGDP?.prevValue),
    },
    dataYear: debtYear,
    source:   'World Bank — Central government debt, total (% of GDP) GC.DOD.TOTL.GD.ZS',
  };

  // ── Unemployment ───────────────────────────────────────────────────────────
  // US: prefer BLS monthly rate; others: World Bank annual ILO estimate
  const unempWB  = wbData.unemployment;
  const unempBLS = jur === 'US' ? sup.blsUnemployment : null;

  const unemployment = {
    rate:    unempBLS?.rate    ?? unempWB?.value ?? null,
    period:  unempBLS?.period  ?? null,
    year:    unempBLS?.year    ?? unempWB?.year  ?? null,
    trend: {
      direction:     calcTrend(unempWB?.value, unempWB?.prevValue),
      percentChange: calcPctChange(unempWB?.value, unempWB?.prevValue),
    },
    source: jur === 'US' && unempBLS
      ? 'U.S. Bureau of Labor Statistics — CPS LNS14000000 (most recent month)'
      : 'World Bank — SL.UEM.TOTL.ZS (ILO modelled estimate, annual)',
  };

  // ── Foreign Aid ────────────────────────────────────────────────────────────
  // DC.ODA.TOTL.CD = net ODA provided by DAC donors (positive = aid given).
  // Coverage: CA/US/UK/AU are all OECD DAC members so this applies to all four.
  const odaUSD  = wbData.odaProvided?.value ?? null;
  const odaYear = wbData.odaProvided?.year  ?? gdpYear;

  const foreignAid = {
    netOdaUSD:    odaUSD != null ? Math.round(odaUSD) : null,
    netOdaPctGDP: gdpValue && odaUSD ? parseFloat((odaUSD / gdpValue * 100).toFixed(4)) : null,
    trend: {
      direction:     calcTrend(wbData.odaProvided?.value, wbData.odaProvided?.prevValue),
      percentChange: calcPctChange(wbData.odaProvided?.value, wbData.odaProvided?.prevValue),
    },
    dataYear: odaYear,
    note:     'Net ODA is total official development assistance after deducting loan repayments. ' +
              'Includes both grants and concessional loans (interest below market rate).',
    source:   'World Bank — Net ODA provided (DC.ODA.TOTL.CD)',
  };

  // ── Foreign Loans ──────────────────────────────────────────────────────────
  // Non-concessional bilateral lending (OOF — Other Official Flows) is tracked by
  // OECD DAC but not exposed via World Bank or the CKAN sources used here.
  const foreignLoans = {
    totalUSD:  null,
    dataYear:  null,
    note:      'Non-concessional official lending (OOF) is published by the OECD Development ' +
               'Assistance Committee (DAC). Concessional loans are included in the foreignAid.netOdaUSD ' +
               'figure above.',
    source:    'OECD DAC statistics (stats.oecd.org/QWIDS)',
  };

  // ── Grants by Department ───────────────────────────────────────────────────
  let grantsByDept;
  if (jur === 'US' && sup.agencySpending) {
    grantsByDept = {
      topAgencies:  sup.agencySpending.agencies?.slice(0, 15) ?? null,
      totalUSD:     sup.agencySpending.totalUSD ?? null,
      fiscalYear:   sup.agencySpending.fiscalYear,
      note:         'Figures are total agency budget authority (obligations). ' +
                    'Award-type filtered grant totals available via USAspending /api/v2/search/spending_by_category/.',
      source:       sup.agencySpending.source,
    };
  } else if (jur === 'CA' && sup.caGrants) {
    grantsByDept = {
      topDepartments: sup.caGrants.departments,
      totalCAD:       sup.caGrants.totalCAD,
      recordCount:    sup.caGrants.recordCount,
      source:         sup.caGrants.source,
    };
  } else {
    grantsByDept = {
      totalUSD:  null,
      dataYear:  null,
      note:      'Grants-by-department data not available from current API sources for this jurisdiction. ' +
                 'See spending.topDepartments for full departmental budget breakdown.',
      source:    null,
    };
  }

  // ── Department Spending Trends ─────────────────────────────────────────────
  const spendWB = wbData.govtExpPctGDP;
  const spendingTrends = {
    currentPctGDP:    spendWB?.value     ?? null,
    previousPctGDP:   spendWB?.prevValue ?? null,
    currentUSD:       pctToUSD(spendWB?.value),
    previousUSD:      pctToUSD(spendWB?.prevValue),
    direction:        calcTrend(spendWB?.value, spendWB?.prevValue),
    percentChange:    calcPctChange(spendWB?.value, spendWB?.prevValue),
    dataYear:         spendWB?.year ?? gdpYear,
    note: 'Year-over-year change in total government expenditure as a % of GDP. ' +
          'Department-level multi-year trends require longitudinal budget data from national accounts.',
    source: 'World Bank GC.XPN.TOTL.GD.ZS',
  };

  // ── Final document ─────────────────────────────────────────────────────────
  return {
    id:          `${jur}_${QUARTER_YEAR}_${QUARTER}`,
    country:     jur,
    quarter:     QUARTER,
    year:        QUARTER_YEAR,
    currency:    CURRENCY_BY_JUR[jur],
    gdpUSD:      gdpValue ? Math.round(gdpValue) : null,
    gdpYear,
    revenue,
    spending,
    deficitSurplus,
    nationalDebt,
    unemployment,
    foreignAid,
    foreignLoans,
    grantsByDept,
    spendingTrends,
    dataSources: [
      'World Bank Open Data (api.worldbank.org)',
      ...(jur === 'US' ? [
        'U.S. Bureau of Labor Statistics (api.bls.gov)',
        'USAspending.gov (api.usaspending.gov)',
      ] : []),
      ...(jur === 'CA' ? [
        'open.canada.ca — Proactive Disclosure G&C (CKAN)',
        'open.canada.ca — Main Estimates (CKAN)',
      ] : []),
      ...(jur === 'UK' && sup.ukFiscal ? [`data.gov.uk — ${sup.ukFiscal.packageTitle || 'ONS/HM Treasury'}`] : []),
      ...(jur === 'AU' && sup.auFiscal ? [`data.gov.au — ${sup.auFiscal.packageTitle || 'ABS GFS'}`] : []),
    ],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function fetchAllGovStats() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`[govstats] Starting quarterly government stats fetch (${QUARTER} ${QUARTER_YEAR})...`);

  // ── 1. World Bank core indicators (all 4 countries, single request per indicator) ──
  const wbData = await fetchAllWorldBankData();

  // ── 2. US supplements ──────────────────────────────────────────────────────
  let blsUnemployment = null;
  let agencySpending  = null;

  try { blsUnemployment = await fetchUSBLSUnemployment();      } catch (e) { console.error(`[govstats:US] ✗ BLS unemployment: ${e.message}`); }
  try { agencySpending  = await fetchUSAgencySpending();       } catch (e) { console.error(`[govstats:US] ✗ agency spending: ${e.message}`); }

  // ── 3. Canada supplements ──────────────────────────────────────────────────
  let caGrants         = null;
  let caDeptAllocations = null;

  try { caGrants          = await fetchCAGrantsContributions(); } catch (e) { console.error(`[govstats:CA] ✗ grants: ${e.message}`); }
  try { caDeptAllocations = await fetchCADeptAllocations();     } catch (e) { console.error(`[govstats:CA] ✗ dept allocations: ${e.message}`); }

  // ── 4. UK fiscal data ─────────────────────────────────────────────────────
  let ukFiscal = null;
  try { ukFiscal = await fetchUKFiscalData(); } catch (e) { console.error(`[govstats:UK] ✗ fiscal: ${e.message}`); }

  // ── 5. Australia fiscal data ──────────────────────────────────────────────
  let auFiscal = null;
  try { auFiscal = await fetchAUFiscalData(); } catch (e) { console.error(`[govstats:AU] ✗ fiscal: ${e.message}`); }

  // ── 6. Assemble and save docs ─────────────────────────────────────────────
  const supplementsByJur = {
    US: { blsUnemployment, agencySpending },
    CA: { caGrants, caDeptAllocations },
    UK: { ukFiscal },
    AU: { auFiscal },
  };

  const results = {};
  const _ts = new Date().toISOString();
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    const doc = buildGovStatsDoc(jur, wbData[jur], supplementsByJur[jur]);
    results[jur] = doc;
    saveJSON(`govstats_${jur}_${timestamp}.json`, {
      generatedAt: new Date().toISOString(),
      ...doc,
    });
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: jur, data_pull_timestamp: _ts, source_endpoint: 'https://api.worldbank.org/v2/country', record_count: 1, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  }

  console.log('[govstats] ✓ All government stats saved to output/govstats/');
  return results;
}

module.exports = { fetchAllGovStats };

// ── Standalone run ─────────────────────────────────────────────────────────────
if (require.main === module) {
  fetchAllGovStats()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
