/**
 * Social Statistics Fetcher — Civic Voice Engine
 *
 * Fetches quarterly social statistics for Canada, USA, United Kingdom, Australia:
 *   - Unemployment rate (monthly / annual)
 *   - Inflation (CPI, annual %)
 *   - House prices (index or median value)
 *   - Rent / housing costs
 *   - Immigration / net migration
 *   - Homelessness
 *
 * Data Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Core indicators (all 4):     World Bank API (api.worldbank.org)
 * US unemployment (monthly):   BLS Public Data API v1 (api.bls.gov)
 * US CPI + rent index:         BLS Public Data API v1 (api.bls.gov)
 * US housing + immigration:    U.S. Census Bureau ACS (api.census.gov)
 * CA indicators:               StatCan Web Data Service (www150.statcan.gc.ca)
 * CA datasets:                 open.canada.ca CKAN
 * UK datasets:                 data.gov.uk CKAN (ONS / MHCLG)
 * AU indicators:               ABS SDMX-JSON API (api.data.abs.gov.au)
 * AU datasets:                 data.gov.au CKAN (ABS / AIHW)
 *
 * Output: output/socialstats/socialstats_{JUR}_{timestamp}.json  (one per country)
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR    = path.resolve(__dirname, '../../output/socialstats');
const TIMEOUT_MS    = 30000;
const CURRENT_YEAR  = new Date().getFullYear();

const WB_CODES          = { CA: 'CA', US: 'US', UK: 'GB', AU: 'AU' };
const POPULATION_APPROX = { CA: 40_500_000, US: 335_000_000, UK: 67_600_000, AU: 26_500_000 };

const _now         = new Date();
const QUARTER      = `Q${Math.ceil((_now.getMonth() + 1) / 3)}`;
const QUARTER_YEAR = _now.getFullYear();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeNum = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? null : n; };
const safeStr = v => (v != null ? String(v).trim().slice(0, 500) || null : null);

function saveJSON(filename, data) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[socialstats] Saved → ${filepath}`);
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

// ─── World Bank: core social indicators ───────────────────────────────────────
//
//  FP.CPI.TOTL.ZG  = Consumer price inflation (% annual)
//  SL.UEM.TOTL.ZS  = Unemployment rate (ILO modelled, % of labour force)
//  SM.POP.TOTL.ZS  = International migrant stock (% of population)
//  SM.POP.NETM     = Net migration (5-year cumulative estimate)
//  SP.POP.TOTL     = Total population

const WB_INDICATORS = {
  population:      'SP.POP.TOTL',
  unemployment:    'SL.UEM.TOTL.ZS',
  inflation:       'FP.CPI.TOTL.ZG',
  migrantStockPct: 'SM.POP.TOTL.ZS',
  netMigration:    'SM.POP.NETM',
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
  console.log('[socialstats] Fetching World Bank social indicators...');
  const result = { CA: {}, US: {}, UK: {}, AU: {} };

  for (const [key, indicatorId] of Object.entries(WB_INDICATORS)) {
    try {
      console.log(`[socialstats]   → ${key} (${indicatorId})`);
      const data = await fetchWBIndicator(indicatorId);
      for (const jur of Object.keys(result)) result[jur][key] = data[jur];
    } catch (err) {
      console.error(`[socialstats]   ✗ ${key}: ${err.message}`);
      const blank = { value: null, prevValue: null, year: null };
      for (const jur of Object.keys(result)) result[jur][key] = blank;
    }
  }
  return result;
}

// ─── US: BLS Public API v1 — unemployment, CPI all-items, CPI rent ────────────
//
//  LNS14000000  = Civilian unemployment rate, seasonally adjusted (monthly)
//  CUSR0000SA0  = CPI-U All items, seasonally adjusted (monthly index, 1982-84=100)
//  CUSR0000SEHA = CPI-U Rent of primary residence, not seasonally adjusted

async function fetchBLSSeries(seriesId) {
  const url  = `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}?latest=true`;
  const resp = await axios.get(url, { timeout: TIMEOUT_MS });
  const data = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!data) return null;
  return {
    value:  safeNum(data.value),
    period: safeStr(data.periodName),
    year:   safeNum(data.year),
  };
}

async function fetchUSBLSData() {
  console.log('[socialstats:US] Fetching BLS unemployment, CPI, and rent index...');
  const [unemployment, cpiAllItems, cpiRent] = await Promise.allSettled([
    fetchBLSSeries('LNS14000000'),   // Unemployment rate (SA)
    fetchBLSSeries('CUSR0000SA0'),   // CPI-U All items (SA)
    fetchBLSSeries('CUSR0000SEHA'),  // CPI-U Rent of primary residence
  ]);
  return {
    unemployment: unemployment.status === 'fulfilled' ? unemployment.value : null,
    cpiAllItems:  cpiAllItems.status  === 'fulfilled' ? cpiAllItems.value  : null,
    cpiRent:      cpiRent.status      === 'fulfilled' ? cpiRent.value      : null,
  };
}

// ─── US: Census Bureau ACS — median rent, home value, immigration ─────────────
//
//  Uses the ACS 1-Year Summary File (Profile table DP04 for housing, DP02 for people).
//  No API key required for basic profile queries (rate-limited without key).
//  DP04_0134E = Median gross rent ($/month)
//  DP04_0089E = Median value of owner-occupied housing units ($)
//  DP02_0093E = Foreign-born population (persons)
//  DP02_0094PE = Foreign-born, percent of total population

async function fetchUSCensusACS() {
  console.log('[socialstats:US] Fetching Census ACS housing and immigration data...');
  // ACS 1-Year lags ~18 months; try CURRENT_YEAR-2 first, then CURRENT_YEAR-3
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const [housingResp, peopleResp] = await Promise.all([
        axios.get(
          `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP04_0134E,DP04_0089E,NAME&for=us:1`,
          { timeout: TIMEOUT_MS }
        ),
        axios.get(
          `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP02_0093E,DP02_0094PE,NAME&for=us:1`,
          { timeout: TIMEOUT_MS }
        ),
      ]);

      const hRows = housingResp.data;
      const pRows = peopleResp.data;
      if (!Array.isArray(hRows) || hRows.length < 2) continue;

      const hObj = {}, pObj = {};
      hRows[0].forEach((h, i) => { hObj[h] = hRows[1][i]; });
      pRows[0].forEach((h, i) => { pObj[h] = pRows[1][i]; });

      console.log(`[socialstats:US] ✓ Census ACS ${yr} housing + people data fetched`);
      return {
        medianGrossRent:  safeNum(hObj['DP04_0134E']),
        medianHomeValue:  safeNum(hObj['DP04_0089E']),
        foreignBornCount: safeNum(pObj['DP02_0093E']),
        foreignBornPct:   safeNum(pObj['DP02_0094PE']),
        year: yr,
        source: `U.S. Census Bureau — American Community Survey 1-Year ${yr} (api.census.gov)`,
      };
    } catch (err) {
      console.warn(`[socialstats:US] Census ACS ${yr} failed: ${err.message}`);
    }
  }
  return null;
}

// ─── CA: StatCan Web Data Service — unemployment, CPI, housing price index ────
//
//  v2064705   = Unemployment rate, Canada, both sexes, 15+, SA (14-10-0287-01)
//  v41690914  = CPI All-items, Canada, not SA, 2002=100 (18-10-0004-01)
//  v111181756 = New Housing Price Index, Canada, total composite (18-10-0205-01)

async function fetchStatCanVector(vectorId, n = 3) {
  const url  = `https://www150.statcan.gc.ca/t1/tbl1/en/dtbl/getDataFromVectorsAndLatestNPeriods/v${vectorId}/${n}`;
  const resp = await axios.get(url, { timeout: TIMEOUT_MS });
  if (resp.data?.status !== 'SUCCESS') return null;
  const series = resp.data?.object?.[0];
  if (!series) return null;
  const points = [...(series.vectorDataPoint || [])].sort((a, b) =>
    new Date(b.refPer) - new Date(a.refPer)
  );
  if (points.length === 0) return null;
  return {
    value:     points[0]?.value ?? null,
    prevValue: points[1]?.value ?? null,
    refPer:    points[0]?.refPer ?? null,
    productId: series.productId,
  };
}

async function fetchCAStatCanData() {
  console.log('[socialstats:CA] Fetching StatCan unemployment, CPI, housing price index...');
  const [unemployment, cpi, housingPriceIndex] = await Promise.allSettled([
    fetchStatCanVector(2064705,   3),   // Unemployment rate
    fetchStatCanVector(41690914,  3),   // CPI All-items
    fetchStatCanVector(111181756, 3),   // New Housing Price Index
  ]);
  return {
    unemployment:      unemployment.status      === 'fulfilled' ? unemployment.value      : null,
    cpi:               cpi.status               === 'fulfilled' ? cpi.value               : null,
    housingPriceIndex: housingPriceIndex.status === 'fulfilled' ? housingPriceIndex.value : null,
  };
}

// ─── CA: open.canada.ca CKAN — immigration, homelessness, housing ─────────────

async function fetchCAOpenDataset(queries) {
  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://open.canada.ca/data/api/3/action/package_search', {
        params: { q, rows: 5, sort: 'score desc' }, timeout: TIMEOUT_MS,
      });
      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;
        const dataResp = await axios.get('https://open.canada.ca/data/api/3/action/datastore_search', {
          params: { resource_id: resource.id, limit: 50, sort: '_id desc' }, timeout: TIMEOUT_MS,
        });
        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;
        console.log(`[socialstats:CA] ✓ "${safeStr(pkg.title)}" (${rows.length} rows)`);
        return { packageTitle: safeStr(pkg.title), records: rows, source: `open.canada.ca — ${safeStr(pkg.title)}` };
      }
    } catch (err) {
      console.warn(`[socialstats:CA] CKAN "${q.slice(0, 45)}" failed: ${err.message}`);
    }
  }
  return null;
}

async function fetchCASupplements() {
  console.log('[socialstats:CA] Fetching open.canada.ca datasets...');
  const [immigration, homelessness, housing] = await Promise.allSettled([
    fetchCAOpenDataset([
      'immigration permanent residents admissions IRCC federal',
      'immigration newcomers landed immigrants annual',
    ]),
    fetchCAOpenDataset([
      'homelessness reaching home shelter point-in-time',
      'federal homeless shelter services ESDC',
    ]),
    fetchCAOpenDataset([
      'rental housing vacancy rate CMHC affordability',
      'housing affordability rent residential price',
    ]),
  ]);
  return {
    immigration:  immigration.status  === 'fulfilled' ? immigration.value  : null,
    homelessness: homelessness.status === 'fulfilled' ? homelessness.value : null,
    housing:      housing.status      === 'fulfilled' ? housing.value      : null,
  };
}

// ─── UK: data.gov.uk CKAN — house prices, rent, immigration, homelessness ─────

async function fetchUKDataset(queries) {
  const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' };
  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.uk/api/3/action/package_search', {
        params: { q, rows: 5, sort: 'score desc' }, timeout: TIMEOUT_MS, headers: HEADERS,
      });
      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;
        const dataResp = await axios.get('https://data.gov.uk/api/3/action/datastore_search', {
          params: { resource_id: resource.id, limit: 50 }, timeout: TIMEOUT_MS, headers: HEADERS,
        });
        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;
        console.log(`[socialstats:UK] ✓ "${safeStr(pkg.title)}" (${rows.length} rows)`);
        return { packageTitle: safeStr(pkg.title), records: rows, source: `data.gov.uk — ${safeStr(pkg.title)}` };
      }
    } catch (err) {
      console.warn(`[socialstats:UK] CKAN "${q.slice(0, 45)}" failed: ${err.message}`);
    }
  }
  return null;
}

async function fetchUKSupplements() {
  console.log('[socialstats:UK] Fetching data.gov.uk datasets...');
  const [housePrices, rent, immigration, homelessness] = await Promise.allSettled([
    fetchUKDataset([
      'UK House Price Index ONS residential property HPI',
      'land registry house price index UK housing',
    ]),
    fetchUKDataset([
      'private rental market summary statistics ONS rent',
      'private sector rent index residential lettings',
    ]),
    fetchUKDataset([
      'long-term international migration net migration ONS',
      'migration statistics quarterly report immigration UK',
    ]),
    fetchUKDataset([
      'statutory homelessness MHCLG temporary accommodation',
      'rough sleeping count autumn homelessness England',
    ]),
  ]);
  return {
    housePrices:  housePrices.status  === 'fulfilled' ? housePrices.value  : null,
    rent:         rent.status         === 'fulfilled' ? rent.value         : null,
    immigration:  immigration.status  === 'fulfilled' ? immigration.value  : null,
    homelessness: homelessness.status === 'fulfilled' ? homelessness.value : null,
  };
}

// ─── AU: ABS SDMX-JSON API — CPI (YoY %), unemployment rate ──────────────────
//
//  CPI dataflow — key: 3.10001.10.50.Q
//    Dimension 1 (MEASURE):   3 = % change from corresponding quarter of previous year
//    Dimension 2 (REGION):    10001 = Weighted avg of 8 capital cities
//    Dimension 3 (INDEX):     10 = All groups
//    Dimension 4 (UNIT):      50 = Index number / %
//    Dimension 5 (FREQ):      Q = Quarterly
//
//  LF dataflow — key: 1.3.1599.20.M
//    Dimension 1 (SEX):       1 = Persons
//    Dimension 2 (ITEM):      3 = Unemployment rate
//    Dimension 3 (REGION):    1599 = Australia
//    Dimension 4 (ADJ):       20 = Seasonally adjusted
//    Dimension 5 (FREQ):      M = Monthly

function parseAbsSdmx(resp) {
  try {
    const ds     = resp.data?.data?.dataSets?.[0];
    const obsDim = resp.data?.data?.structure?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD');
    if (!ds || !obsDim) return null;

    const seriesKeys = Object.keys(ds.series || {});
    if (seriesKeys.length === 0) return null;
    const series = ds.series[seriesKeys[0]];
    const observations = series.observations || {};

    // Higher index = more recent period in SDMX-JSON
    const sortedIdx = Object.keys(observations).map(Number).sort((a, b) => b - a);
    if (sortedIdx.length === 0) return null;

    const latestIdx = sortedIdx[0];
    const prevIdx   = sortedIdx[1] ?? null;

    return {
      value:     observations[latestIdx]?.[0]  ?? null,
      prevValue: prevIdx != null ? (observations[prevIdx]?.[0] ?? null) : null,
      period:    obsDim.values[latestIdx]?.id ?? null,
    };
  } catch (_) {
    return null;
  }
}

async function fetchABSIndicator(dataflowId, dataKey) {
  const url = `https://api.data.abs.gov.au/data/${dataflowId}/${dataKey}/?format=jsondata&startPeriod=${CURRENT_YEAR - 2}`;
  const resp = await axios.get(url, {
    timeout: TIMEOUT_MS,
    headers: { Accept: 'application/vnd.sdmx.data+json' },
  });
  return parseAbsSdmx(resp);
}

async function fetchAUABSData() {
  console.log('[socialstats:AU] Fetching ABS SDMX data (CPI YoY%, unemployment)...');
  const [cpi, labourForce] = await Promise.allSettled([
    fetchABSIndicator('CPI', '3.10001.10.50.Q'),   // CPI all groups, % change YoY, quarterly
    fetchABSIndicator('LF',  '1.3.1599.20.M'),      // Unemployment rate, SA, monthly
  ]);
  return {
    cpi:         cpi.status         === 'fulfilled' ? cpi.value         : null,
    labourForce: labourForce.status === 'fulfilled' ? labourForce.value : null,
  };
}

// ─── AU: data.gov.au CKAN — house prices, homelessness, immigration ───────────

async function fetchAUDataset(queries) {
  const OPT = { maxRedirects: 10, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)' } };
  for (const q of queries) {
    try {
      const searchResp = await axios.get('https://data.gov.au/data/api/3/action/package_search', {
        params: { q, rows: 5, sort: 'score desc' }, timeout: TIMEOUT_MS, ...OPT,
      });
      for (const pkg of searchResp.data?.result?.results || []) {
        const resource = (pkg.resources || []).find(r => r.datastore_active);
        if (!resource) continue;
        const dataResp = await axios.get('https://data.gov.au/data/api/3/action/datastore_search', {
          params: { resource_id: resource.id, limit: 50 }, timeout: TIMEOUT_MS, ...OPT,
        });
        const rows = dataResp.data?.result?.records || [];
        if (rows.length === 0) continue;
        console.log(`[socialstats:AU] ✓ "${safeStr(pkg.title)}" (${rows.length} rows)`);
        return { packageTitle: safeStr(pkg.title), records: rows, source: `data.gov.au — ${safeStr(pkg.title)}` };
      }
    } catch (err) {
      console.warn(`[socialstats:AU] CKAN "${q.slice(0, 45)}" failed: ${err.message}`);
    }
  }
  return null;
}

async function fetchAUSupplements() {
  console.log('[socialstats:AU] Fetching data.gov.au datasets...');
  const [housePrices, homelessness, immigration] = await Promise.allSettled([
    fetchAUDataset([
      'residential property price index ABS housing dwelling',
      'house price index quarterly dwelling values Australia',
    ]),
    fetchAUDataset([
      'specialist homelessness services AIHW clients Australia',
      'homelessness rough sleeping count Australia',
    ]),
    fetchAUDataset([
      'net overseas migration permanent temporary visa arrivals',
      'immigration arrivals departures Department Home Affairs',
    ]),
  ]);
  return {
    housePrices:  housePrices.status  === 'fulfilled' ? housePrices.value  : null,
    homelessness: homelessness.status === 'fulfilled' ? homelessness.value : null,
    immigration:  immigration.status  === 'fulfilled' ? immigration.value  : null,
  };
}

// ─── Document builder ──────────────────────────────────────────────────────────

function buildSocialStatsDoc(jur, wbData, sup) {
  const population = wbData.population?.value ?? POPULATION_APPROX[jur];

  // ── Unemployment ──────────────────────────────────────────────────────────
  let uRate, uPeriod, uYear, uSource;
  if (jur === 'US' && sup.blsUnemployment) {
    uRate   = sup.blsUnemployment.value;
    uPeriod = `${sup.blsUnemployment.period} ${sup.blsUnemployment.year}`;
    uYear   = sup.blsUnemployment.year;
    uSource = 'U.S. Bureau of Labor Statistics — CPS series LNS14000000 (api.bls.gov)';
  } else if (jur === 'CA' && sup.statcan?.unemployment) {
    uRate   = sup.statcan.unemployment.value;
    uPeriod = sup.statcan.unemployment.refPer;
    uYear   = uPeriod ? parseInt(uPeriod) : wbData.unemployment?.year;
    uSource = 'Statistics Canada — Labour Force Survey, Table 14-10-0287-01 (WDS v2064705)';
  } else if (jur === 'AU' && sup.abs?.labourForce) {
    uRate   = sup.abs.labourForce.value;
    uPeriod = sup.abs.labourForce.period;
    uYear   = uPeriod ? parseInt(uPeriod) : wbData.unemployment?.year;
    uSource = 'Australian Bureau of Statistics — Labour Force, LF dataflow SDMX (api.data.abs.gov.au)';
  } else {
    uRate   = wbData.unemployment?.value;
    uPeriod = null;
    uYear   = wbData.unemployment?.year;
    uSource = 'World Bank — Unemployment, total (% of labour force ILO) SL.UEM.TOTL.ZS';
  }

  const unemployment = {
    rate:   uRate   ?? null,
    period: uPeriod ?? null,
    year:   uYear   ?? null,
    trend: {
      direction:     calcTrend(wbData.unemployment?.value, wbData.unemployment?.prevValue),
      percentChange: calcPctChange(wbData.unemployment?.value, wbData.unemployment?.prevValue),
    },
    source: uSource,
  };

  // ── Inflation (CPI, annual %) ──────────────────────────────────────────────
  // World Bank annual % is the primary figure; country APIs provide index levels / recency.
  let inflationPct, inflationContext, inflationYear, inflationSource;

  if (jur === 'AU' && sup.abs?.cpi?.value != null) {
    // ABS gives YoY % directly (measure=3 in SDMX key)
    inflationPct     = sup.abs.cpi.value;
    inflationContext = `ABS period: ${sup.abs.cpi.period}`;
    inflationYear    = sup.abs.cpi.period ? parseInt(sup.abs.cpi.period) : wbData.inflation?.year;
    inflationSource  = 'Australian Bureau of Statistics — CPI All Groups, YoY %, CPI dataflow SDMX';
  } else {
    inflationPct     = wbData.inflation?.value;
    inflationContext  = null;
    inflationYear    = wbData.inflation?.year;
    inflationSource  = 'World Bank — Consumer price inflation (% annual) FP.CPI.TOTL.ZG';
    // Supplement with BLS / StatCan index for recency note
    if (jur === 'US' && sup.blsCpiAllItems) {
      inflationContext = `BLS CPI-U index (SA): ${sup.blsCpiAllItems.value} (${sup.blsCpiAllItems.period} ${sup.blsCpiAllItems.year}, 1982-84=100)`;
      inflationSource += '; U.S. Bureau of Labor Statistics — CPI-U series CUSR0000SA0';
    } else if (jur === 'CA' && sup.statcan?.cpi) {
      inflationContext = `StatCan CPI index (not SA): ${sup.statcan.cpi.value} (${sup.statcan.cpi.refPer}, 2002=100)`;
      inflationSource += '; Statistics Canada — CPI All-items, Table 18-10-0004-01 (WDS v41690914)';
    }
  }

  const inflation = {
    annualPct:      inflationPct  ?? null,
    dataYear:       inflationYear ?? null,
    recentContext:  inflationContext ?? null,
    trend: {
      direction:     calcTrend(wbData.inflation?.value, wbData.inflation?.prevValue),
      percentChange: calcPctChange(wbData.inflation?.value, wbData.inflation?.prevValue),
    },
    source: inflationSource,
  };

  // ── House Prices ───────────────────────────────────────────────────────────
  let housePrices;
  if (jur === 'US' && sup.census) {
    housePrices = {
      medianHomeValueUSD: sup.census.medianHomeValue,
      dataYear:           sup.census.year,
      note:               'Median value of owner-occupied housing units. ACS 1-Year Survey.',
      source:             sup.census.source,
    };
  } else if (jur === 'CA' && sup.statcan?.housingPriceIndex) {
    const hpi = sup.statcan.housingPriceIndex;
    housePrices = {
      newHousingPriceIndex: hpi.value,
      prevIndex:            hpi.prevValue,
      period:               hpi.refPer,
      trend: {
        direction:     calcTrend(hpi.value, hpi.prevValue),
        percentChange: calcPctChange(hpi.value, hpi.prevValue),
      },
      note:   'New Housing Price Index (composite), base 2016=100. StatCan Table 18-10-0205-01.',
      source: 'Statistics Canada — New Housing Price Index, WDS v111181756',
    };
  } else if (jur === 'UK' && sup.ukCkan?.housePrices?.records?.length > 0) {
    housePrices = {
      datasetTitle: sup.ukCkan.housePrices.packageTitle,
      records:      sup.ukCkan.housePrices.records.slice(0, 10),
      source:       sup.ukCkan.housePrices.source,
    };
  } else if (jur === 'AU' && sup.auCkan?.housePrices?.records?.length > 0) {
    housePrices = {
      datasetTitle: sup.auCkan.housePrices.packageTitle,
      records:      sup.auCkan.housePrices.records.slice(0, 10),
      source:       sup.auCkan.housePrices.source,
    };
  } else {
    housePrices = {
      note:   'House price data not available from open API sources for this jurisdiction. ' +
              'Published by: FHFA/Case-Shiller (US), CMHC (CA), ONS Land Registry (UK), ABS RPPI (AU).',
      source: null,
    };
  }

  // ── Rent ───────────────────────────────────────────────────────────────────
  let rent;
  if (jur === 'US') {
    if (sup.census?.medianGrossRent) {
      rent = {
        medianGrossRentUSD: sup.census.medianGrossRent,
        dataYear:           sup.census.year,
        note:               'Median gross rent (contract + utilities) from ACS 1-Year Survey.',
        source:             sup.census.source,
      };
      if (sup.blsCpiRent) {
        rent.cpiRentIndex = sup.blsCpiRent.value;
        rent.cpiRentPeriod = `${sup.blsCpiRent.period} ${sup.blsCpiRent.year}`;
        rent.cpiRentNote  = 'BLS CPI-U Rent of Primary Residence (CUSR0000SEHA), 1982-84=100.';
      }
    } else if (sup.blsCpiRent) {
      rent = {
        cpiRentIndex: sup.blsCpiRent.value,
        period:       `${sup.blsCpiRent.period} ${sup.blsCpiRent.year}`,
        note:         'BLS CPI-U Rent of Primary Residence (CUSR0000SEHA), index 1982-84=100.',
        source:       'U.S. Bureau of Labor Statistics — CPI series CUSR0000SEHA (api.bls.gov)',
      };
    } else {
      rent = { note: 'Rent data not available.', source: null };
    }
  } else if (jur === 'CA' && sup.caCkan?.housing?.records?.length > 0) {
    rent = {
      datasetTitle: sup.caCkan.housing.packageTitle,
      records:      sup.caCkan.housing.records.slice(0, 10),
      source:       sup.caCkan.housing.source,
    };
  } else if (jur === 'UK' && sup.ukCkan?.rent?.records?.length > 0) {
    rent = {
      datasetTitle: sup.ukCkan.rent.packageTitle,
      records:      sup.ukCkan.rent.records.slice(0, 10),
      source:       sup.ukCkan.rent.source,
    };
  } else {
    rent = {
      note:   'Rental price data not available from open API sources for this jurisdiction.',
      source: null,
    };
  }

  // ── Immigration ────────────────────────────────────────────────────────────
  const migrantPct  = wbData.migrantStockPct?.value ?? null;
  const netMig      = wbData.netMigration?.value    ?? null;

  let immigrationDataset = null;
  if (jur === 'CA') immigrationDataset = sup.caCkan?.immigration;
  if (jur === 'UK') immigrationDataset = sup.ukCkan?.immigration;
  if (jur === 'AU') immigrationDataset = sup.auCkan?.immigration;
  if (jur === 'US' && sup.census) {
    immigrationDataset = {
      packageTitle: 'Census ACS — Foreign-Born Population',
      foreignBornCount: sup.census.foreignBornCount,
      foreignBornPct:   sup.census.foreignBornPct,
      year:             sup.census.year,
      source:           sup.census.source,
    };
  }

  const immigration = {
    migrantStockPctOfPopulation: migrantPct,
    migrantStockYear:            wbData.migrantStockPct?.year ?? null,
    estimatedMigrantCount:       migrantPct && population
      ? Math.round((migrantPct / 100) * population) : null,
    netMigration5yr:             netMig,
    netMigrationYear:            wbData.netMigration?.year ?? null,
    trend: {
      direction:     calcTrend(wbData.netMigration?.value, wbData.netMigration?.prevValue),
      percentChange: calcPctChange(wbData.netMigration?.value, wbData.netMigration?.prevValue),
    },
    dataset: immigrationDataset,
    sources: [
      'World Bank — International migrant stock, % of population (SM.POP.TOTL.ZS)',
      'World Bank — Net migration, 5-year estimate (SM.POP.NETM)',
      ...(immigrationDataset ? [immigrationDataset.source ?? ''] : []),
    ].filter(Boolean),
  };

  // ── Homelessness ───────────────────────────────────────────────────────────
  let homelessnessDataset = null;
  if (jur === 'CA') homelessnessDataset = sup.caCkan?.homelessness;
  if (jur === 'UK') homelessnessDataset = sup.ukCkan?.homelessness;
  if (jur === 'AU') homelessnessDataset = sup.auCkan?.homelessness;

  const homelessness = homelessnessDataset ? {
    datasetTitle: homelessnessDataset.packageTitle,
    records:      homelessnessDataset.records.slice(0, 15),
    source:       homelessnessDataset.source,
  } : {
    note:   'Point-in-time homelessness count data not available from open CKAN API sources. ' +
            'Annual reports published by: HUD (US), ESDC/Reaching Home (CA), MHCLG (UK), AIHW (AU).',
    source: null,
  };

  // ── Final document ─────────────────────────────────────────────────────────
  return {
    id:          `${jur}_${QUARTER_YEAR}_${QUARTER}_social`,
    country:     jur,
    quarter:     QUARTER,
    year:        QUARTER_YEAR,
    population,
    unemployment,
    inflation,
    housePrices,
    rent,
    immigration,
    homelessness,
    dataSources: [
      'World Bank Open Data (api.worldbank.org)',
      ...(jur === 'US' ? [
        'U.S. Bureau of Labor Statistics (api.bls.gov)',
        'U.S. Census Bureau — ACS 1-Year (api.census.gov)',
      ] : []),
      ...(jur === 'CA' ? [
        'Statistics Canada Web Data Service (www150.statcan.gc.ca)',
        'open.canada.ca CKAN',
      ] : []),
      ...(jur === 'UK' ? ['data.gov.uk CKAN (ONS / MHCLG)'] : []),
      ...(jur === 'AU' ? [
        'ABS SDMX-JSON API (api.data.abs.gov.au)',
        'data.gov.au CKAN',
      ] : []),
    ],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function fetchAllSocialStats() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`[socialstats] Starting social stats fetch (${QUARTER} ${QUARTER_YEAR})...`);

  // 1. World Bank base indicators (all 4 countries, one request per indicator)
  const wbData = await fetchAllWorldBankData();

  // 2. US supplements
  let blsUnemployment = null, blsCpiAllItems = null, blsCpiRent = null, census = null;
  try {
    const bls = await fetchUSBLSData();
    blsUnemployment = bls.unemployment;
    blsCpiAllItems  = bls.cpiAllItems;
    blsCpiRent      = bls.cpiRent;
  } catch (e) { console.error(`[socialstats:US] ✗ BLS: ${e.message}`); }
  try { census = await fetchUSCensusACS(); } catch (e) { console.error(`[socialstats:US] ✗ Census: ${e.message}`); }

  // 3. Canada supplements
  let statcan = null, caCkan = null;
  try { statcan = await fetchCAStatCanData(); } catch (e) { console.error(`[socialstats:CA] ✗ StatCan: ${e.message}`); }
  try { caCkan  = await fetchCASupplements(); } catch (e) { console.error(`[socialstats:CA] ✗ CKAN: ${e.message}`); }

  // 4. UK supplements
  let ukCkan = null;
  try { ukCkan = await fetchUKSupplements(); } catch (e) { console.error(`[socialstats:UK] ✗ CKAN: ${e.message}`); }

  // 5. Australia supplements
  let abs = null, auCkan = null;
  try { abs    = await fetchAUABSData();     } catch (e) { console.error(`[socialstats:AU] ✗ ABS: ${e.message}`); }
  try { auCkan = await fetchAUSupplements(); } catch (e) { console.error(`[socialstats:AU] ✗ CKAN: ${e.message}`); }

  // 6. Assemble and save per-country documents
  const supplementsByJur = {
    US: { blsUnemployment, blsCpiAllItems, blsCpiRent, census },
    CA: { statcan, caCkan },
    UK: { ukCkan },
    AU: { abs, auCkan },
  };

  const results = {};
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    const doc = buildSocialStatsDoc(jur, wbData[jur], supplementsByJur[jur]);
    results[jur] = doc;
    saveJSON(`socialstats_${jur}_${timestamp}.json`, {
      generatedAt: new Date().toISOString(),
      ...doc,
    });
  }

  console.log('[socialstats] ✓ All social stats saved to output/socialstats/');
  return results;
}

module.exports = { fetchAllSocialStats };

// ── Standalone run ─────────────────────────────────────────────────────────────
if (require.main === module) {
  fetchAllSocialStats()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
