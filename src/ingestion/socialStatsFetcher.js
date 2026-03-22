/**
 * Social Statistics Fetcher — Civic Voice Engine
 *
 * Fetches quarterly social statistics for Canada, USA, United Kingdom, Australia:
 *
 *  Existing metrics:
 *   - Unemployment rate      - Inflation (CPI)        - House prices
 *   - Rent / housing costs   - Immigration             - Homelessness
 *
 *  New metrics (each saved with value, unit, date, sourceUrl, updateFrequency):
 *   - Crime rate             - Drug overdoses          - Homicide rate
 *   - Road fatalities        - Life expectancy         - Obesity rate
 *   - Poverty rate           - Graduation rates        - Student debt
 *
 * Data Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * Core indicators (all 4):     World Bank API (api.worldbank.org)
 * US unemployment (monthly):   BLS Public Data API v1 (api.bls.gov)
 * US CPI + rent index:         BLS Public Data API v1 (api.bls.gov)
 * US housing/education/poverty: U.S. Census Bureau ACS (api.census.gov)
 * US drug overdoses:           CDC VSRR Socrata API (data.cdc.gov)
 * CA indicators:               Bank of Canada Valet API (bankofcanada.ca/valet)
 * CA datasets:                 open.canada.ca CKAN
 * UK CPI + unemployment:       ONS timeseries (www.ons.gov.uk) — confirmed working 2026-03-22
 * UK datasets:                 data.gov.uk CKAN (ONS / MHCLG / Home Office)
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

/**
 * Standardised stat shape requested for new metrics.
 * @param {number|null} value    - The numeric value
 * @param {string}      unit     - Human-readable unit (e.g. "per 100,000 population")
 * @param {string|null} date     - ISO year or YYYY-MM period string
 * @param {string}      sourceUrl - Canonical source URL
 * @param {string}      updateFrequency - How often this is updated (e.g. "Annual", "Monthly")
 * @param {object}      extra    - Optional extra fields merged into the object
 */
function stat(value, unit, date, sourceUrl, updateFrequency, extra = {}) {
  return {
    value: value ?? null,
    unit,
    date: date != null ? String(date) : null,
    sourceUrl,
    updateFrequency,
    trend: extra.trend ?? null,
    ...extra,
  };
}

// ─── World Bank: core social indicators ───────────────────────────────────────
//
//  Existing:
//  FP.CPI.TOTL.ZG  = Consumer price inflation (% annual)
//  SL.UEM.TOTL.ZS  = Unemployment rate (ILO modelled, % of labour force)
//  SM.POP.TOTL.ZS  = International migrant stock (% of population)
//  SM.POP.NETM     = Net migration (5-year cumulative estimate)
//  SP.POP.TOTL     = Total population
//
//  New:
//  SP.DYN.LE00.IN  = Life expectancy at birth, total (years)
//  VC.IHR.PSRC.P5  = Intentional homicides (per 100,000 people)
//  SH.STA.TRAF.P5  = Road traffic mortality rate (per 100,000)
//  SH.STA.OWAD.ZS  = Prevalence of overweight adults, BMI ≥ 25 (% of adults)
//  SI.POV.NAHC     = Poverty headcount at national poverty line (% of population)
//  SE.SEC.CUAT.UP.ZS = Pop 25+ with at least upper-secondary education (%)
//  SE.TER.CUAT.BA.ZS = Pop 25+ with at least Bachelor's degree or equivalent (%)
//  SE.XPD.TOTL.GD.ZS = Government expenditure on education (% of GDP)

const WB_INDICATORS = {
  population:        'SP.POP.TOTL',
  unemployment:      'SL.UEM.TOTL.ZS',
  inflation:         'FP.CPI.TOTL.ZG',
  migrantStockPct:   'SM.POP.TOTL.ZS',
  netMigration:      'SM.POP.NETM',
  lifeExpectancy:    'SP.DYN.LE00.IN',
  homicideRate:      'VC.IHR.PSRC.P5',
  roadFatalities:    'SH.STA.TRAF.P5',
  obesityRate:       'SH.STA.OWAD.ZS',
  povertyRate:       'SI.POV.NAHC',
  upperSecondaryEdu: 'SE.SEC.CUAT.UP.ZS',
  tertiaryEdu:       'SE.TER.CUAT.BA.ZS',
  govtEdSpend:       'SE.XPD.TOTL.GD.ZS',
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

// ─── US: Census Bureau ACS — housing, immigration, education, poverty ─────────
//
//  Profile table DP02 (people):
//    DP02_0060PE = High school graduate or higher, % of persons 25+
//    DP02_0067PE = Bachelor's degree or higher, % of persons 25+
//    DP02_0093E  = Foreign-born population (count)
//    DP02_0094PE = Foreign-born, % of total population
//
//  Profile table DP03 (economic):
//    DP03_0119PE = % of all people below poverty level
//
//  Profile table DP04 (housing):
//    DP04_0134E  = Median gross rent ($/month)
//    DP04_0089E  = Median value of owner-occupied housing units ($)
//
//  No API key required for profile queries (rate-limited without key).
//  ACS 1-Year lags ~18 months; tries CURRENT_YEAR-2 first.

async function fetchUSCensusACS() {
  console.log('[socialstats:US] Fetching Census ACS housing, education, poverty, immigration...');
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const [housingResp, peopleResp, econResp] = await Promise.all([
        axios.get(
          `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP04_0134E,DP04_0089E,NAME&for=us:1`,
          { timeout: TIMEOUT_MS }
        ),
        axios.get(
          `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP02_0060PE,DP02_0067PE,DP02_0093E,DP02_0094PE,NAME&for=us:1`,
          { timeout: TIMEOUT_MS }
        ),
        axios.get(
          `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP03_0119PE,NAME&for=us:1`,
          { timeout: TIMEOUT_MS }
        ),
      ]);

      const hRows = housingResp.data;
      const pRows = peopleResp.data;
      const eRows = econResp.data;
      if (!Array.isArray(hRows) || hRows.length < 2) continue;

      const hObj = {}, pObj = {}, eObj = {};
      hRows[0].forEach((h, i) => { hObj[h] = hRows[1][i]; });
      pRows[0].forEach((h, i) => { pObj[h] = pRows[1][i]; });
      eRows[0].forEach((h, i) => { eObj[h] = eRows[1][i]; });

      console.log(`[socialstats:US] ✓ Census ACS ${yr} fetched`);
      return {
        medianGrossRent:        safeNum(hObj['DP04_0134E']),
        medianHomeValue:        safeNum(hObj['DP04_0089E']),
        foreignBornCount:       safeNum(pObj['DP02_0093E']),
        foreignBornPct:         safeNum(pObj['DP02_0094PE']),
        highSchoolGradPct:      safeNum(pObj['DP02_0060PE']),
        bachelorsPlusPct:       safeNum(pObj['DP02_0067PE']),
        povertyRatePct:         safeNum(eObj['DP03_0119PE']),
        year: yr,
        sourceUrl: `https://api.census.gov/data/${yr}/acs/acs1/profile`,
        source: `U.S. Census Bureau — American Community Survey 1-Year ${yr} (api.census.gov)`,
      };
    } catch (err) {
      console.warn(`[socialstats:US] Census ACS ${yr} failed: ${err.message}`);
    }
  }
  return null;
}

// ─── US: CDC Socrata API — drug overdose deaths ───────────────────────────────
//
//  VSRR Provisional Drug Overdose Death Counts (NCHS).
//  Endpoint: data.cdc.gov Socrata dataset — filters for US national total.
//  Falls back to second endpoint if first returns no data.

async function fetchUSCDCDrugOverdoses() {
  console.log('[socialstats:US] Fetching CDC drug overdose data...');
  const ENDPOINTS = [
    // VSRR Provisional Drug Overdose Death Counts — filter for US total, most recent periods
    'https://data.cdc.gov/resource/xkb8-kh2a.json?$where=state=%27US%27%20AND%20indicator=%27Number%20of%20Drug%20Overdose%20Deaths%27&$order=year%20DESC,month%20DESC&$limit=3',
    // Fallback: broader CDC drug death dataset
    'https://data.cdc.gov/resource/95ax-ymtc.json?$where=state=%27United%20States%27&$order=year%20DESC&$limit=3',
  ];

  for (const url of ENDPOINTS) {
    try {
      const resp = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'X-App-Token': '' } });
      const rows = resp.data;
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const latest = rows[0];
      const value  = safeNum(latest.data_value ?? latest.deaths ?? latest.value);
      if (value == null) continue;
      console.log(`[socialstats:US] ✓ CDC drug overdoses — ${value}`);
      return {
        totalDeaths:    value,
        period:         `${latest.month ?? ''} ${latest.year ?? ''}`.trim() || null,
        year:           safeNum(latest.year),
        indicator:      safeStr(latest.indicator ?? 'Drug Overdose Deaths'),
        sourceUrl:      'https://data.cdc.gov/resource/xkb8-kh2a.json',
        source:         'CDC — VSRR Provisional Drug Overdose Death Counts (data.cdc.gov)',
      };
    } catch (err) {
      console.warn(`[socialstats:US] CDC endpoint failed: ${err.message}`);
    }
  }
  return null;
}

// ─── CA: Bank of Canada Valet API — interest rates, exchange rates ────────────
//
//  Confirmed working (audit 2026-03-22): bankofcanada.ca/valet — 15,267 series.
//  StatCan WDS (www150.statcan.gc.ca/t1/tbl1/en/dtbl/) is returning HTTP 404
//  for all calls as of 2026-03-22; BoC Valet is the confirmed CA replacement.
//
//  Series used (all confirmed working 2026-03-22):
//  FXUSDCAD         = Canadian dollar per US dollar (daily)
//  V122530          = Bank rate — official BoC rate (monthly %)
//  CORRA_RATE_AT_TRIM = Overnight CORRA rate (daily %)
//  BD.CDN.2YR.DQ.YLD  = 2-year GoC benchmark bond yield (daily %)
//  BD.CDN.10YR.DQ.YLD = 10-year GoC benchmark bond yield (daily %)

const BOC_SERIES = ['FXUSDCAD', 'V122530', 'CORRA_RATE_AT_TRIM', 'BD.CDN.2YR.DQ.YLD', 'BD.CDN.10YR.DQ.YLD'];

async function fetchCABoCData() {
  console.log('[socialstats:CA] Fetching Bank of Canada Valet rates...');
  const BOC_BASE = 'https://www.bankofcanada.ca/valet/observations';
  const results = await Promise.allSettled(
    BOC_SERIES.map(s => axios.get(`${BOC_BASE}/${s}/json?recent=3`, { timeout: TIMEOUT_MS }))
  );
  const out = {};
  for (let i = 0; i < BOC_SERIES.length; i++) {
    const key = BOC_SERIES[i];
    const r   = results[i];
    if (r.status === 'fulfilled') {
      const obs  = r.value.data?.observations ?? [];
      const sorted = [...obs].sort((a, b) => b.d.localeCompare(a.d));
      const latest = sorted[0];
      const prev   = sorted[1];
      if (latest) {
        out[key] = {
          value:     safeNum(latest[key]?.v),
          prevValue: prev ? safeNum(prev[key]?.v) : null,
          date:      latest.d,
        };
      }
    }
  }
  return out;
}

// ─── CA: open.canada.ca CKAN — immigration, homelessness, housing, drugs ──────

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
  const [immigration, homelessness, housing, drugOverdoses, graduationRates] = await Promise.allSettled([
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
    fetchCAOpenDataset([
      'opioid overdose deaths apparent drug toxicity mortality',
      'drug overdose poisoning death public health',
    ]),
    fetchCAOpenDataset([
      'graduation rates secondary school completion youth',
      'high school graduation diploma attainment education',
    ]),
  ]);
  return {
    immigration:     immigration.status     === 'fulfilled' ? immigration.value     : null,
    homelessness:    homelessness.status    === 'fulfilled' ? homelessness.value    : null,
    housing:         housing.status         === 'fulfilled' ? housing.value         : null,
    drugOverdoses:   drugOverdoses.status   === 'fulfilled' ? drugOverdoses.value   : null,
    graduationRates: graduationRates.status === 'fulfilled' ? graduationRates.value : null,
  };
}

// ─── UK: data.gov.uk CKAN — house prices, rent, immigration, homelessness, etc.

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
  const [
    housePrices, rent, immigration, homelessness,
    crimeStats, drugDeaths, roadCasualties, studentLoans,
  ] = await Promise.allSettled([
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
    fetchUKDataset([
      'crime in England and Wales police recorded crime ONS',
      'Home Office crime statistics police data',
    ]),
    fetchUKDataset([
      'drug misuse deaths drug-related mortality ONS England Wales',
      'drug poisoning deaths drug related statistics',
    ]),
    fetchUKDataset([
      'reported road casualties Great Britain DVSA RRCGB',
      'road accidents road safety statistics Department Transport',
    ]),
    fetchUKDataset([
      'student loans company SLC statistics outstanding balance',
      'higher education student finance loans repayments',
    ]),
  ]);
  return {
    housePrices:  housePrices.status  === 'fulfilled' ? housePrices.value  : null,
    rent:         rent.status         === 'fulfilled' ? rent.value         : null,
    immigration:  immigration.status  === 'fulfilled' ? immigration.value  : null,
    homelessness: homelessness.status === 'fulfilled' ? homelessness.value : null,
    crimeStats:   crimeStats.status   === 'fulfilled' ? crimeStats.value   : null,
    drugDeaths:   drugDeaths.status   === 'fulfilled' ? drugDeaths.value   : null,
    roadCasualties: roadCasualties.status === 'fulfilled' ? roadCasualties.value : null,
    studentLoans: studentLoans.status === 'fulfilled' ? studentLoans.value : null,
  };
}

// ─── UK: ONS timeseries API — CPI, unemployment ───────────────────────────────
//
//  Confirmed working (audit 2026-03-22): www.ons.gov.uk/{category}/timeseries/{id}/data
//  with Accept: application/json header returns JSON with months[]/quarters[]/years[] arrays.
//  Note: api.ons.gov.uk/v1/timeseries/{id}/data returns HTTP 404 — use www.ons.gov.uk instead.
//
//  D7G7  = CPI 12-month rate (%)   — economy/inflationandpriceindices
//  MGSX  = ILO unemployment rate (%) — employmentandlabourmarket

const ONS_TS = {
  cpiRate: {
    url:   'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/data',
    label: 'CPI 12-month rate (%)',
  },
  unemployment: {
    url:   'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data',
    label: 'ILO unemployment rate (%)',
  },
};

async function fetchUKONSTimeseries() {
  console.log('[socialstats:UK] Fetching ONS timeseries (CPI, unemployment)...');
  const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; CivicBot/1.0)', Accept: 'application/json' };
  const out = {};
  for (const [key, { url, label }] of Object.entries(ONS_TS)) {
    try {
      const resp   = await axios.get(url, { timeout: TIMEOUT_MS, headers: HEADERS });
      const months = resp.data?.months ?? [];
      if (months.length === 0) { out[key] = null; continue; }
      const sorted = [...months].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sorted[0];
      const prev   = sorted[1];
      out[key] = {
        value:     safeNum(latest?.value),
        prevValue: safeNum(prev?.value),
        period:    latest?.date ?? null,
        label,
      };
      console.log(`[socialstats:UK] ✓ ONS ${key}: ${latest?.value} (${latest?.date})`);
    } catch (err) {
      console.warn(`[socialstats:UK] ONS ${key} failed: ${err.message}`);
      out[key] = null;
    }
  }
  return out;
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
    fetchABSIndicator('CPI', '3.10001.10.50.Q'),
    fetchABSIndicator('LF',  '1.3.1599.20.M'),
  ]);
  return {
    cpi:         cpi.status         === 'fulfilled' ? cpi.value         : null,
    labourForce: labourForce.status === 'fulfilled' ? labourForce.value : null,
  };
}

// ─── AU: data.gov.au CKAN — house prices, homelessness, immigration, etc. ─────

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
  const [housePrices, homelessness, immigration, crimeStats, drugDeaths, roadFatalities] =
    await Promise.allSettled([
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
      fetchAUDataset([
        'recorded crime victims ABS offences Australia',
        'crime statistics police recorded offences states',
      ]),
      fetchAUDataset([
        'drug caused deaths AIHW drug-induced mortality',
        'alcohol drug overdose deaths Australia statistics',
      ]),
      fetchAUDataset([
        'road deaths Australia BITRE road traffic fatalities',
        'road fatalities motor vehicle accidents annual',
      ]),
    ]);
  return {
    housePrices:   housePrices.status   === 'fulfilled' ? housePrices.value   : null,
    homelessness:  homelessness.status  === 'fulfilled' ? homelessness.value  : null,
    immigration:   immigration.status   === 'fulfilled' ? immigration.value   : null,
    crimeStats:    crimeStats.status    === 'fulfilled' ? crimeStats.value    : null,
    drugDeaths:    drugDeaths.status    === 'fulfilled' ? drugDeaths.value    : null,
    roadFatalities: roadFatalities.status === 'fulfilled' ? roadFatalities.value : null,
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
  } else if (jur === 'UK' && sup.onsTimeseries?.unemployment?.value != null) {
    uRate   = sup.onsTimeseries.unemployment.value;
    uPeriod = sup.onsTimeseries.unemployment.period;
    uYear   = uPeriod ? parseInt(uPeriod) : wbData.unemployment?.year;
    uSource = 'Office for National Statistics — ILO unemployment rate, series MGSX (www.ons.gov.uk)';
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
  let inflationPct, inflationContext, inflationYear, inflationSource;

  if (jur === 'UK' && sup.onsTimeseries?.cpiRate?.value != null) {
    inflationPct     = sup.onsTimeseries.cpiRate.value;
    inflationContext = `ONS CPI period: ${sup.onsTimeseries.cpiRate.period}`;
    inflationYear    = sup.onsTimeseries.cpiRate.period ? parseInt(sup.onsTimeseries.cpiRate.period) : wbData.inflation?.year;
    inflationSource  = 'Office for National Statistics — CPI 12-month rate, series D7G7 (www.ons.gov.uk)';
  } else if (jur === 'AU' && sup.abs?.cpi?.value != null) {
    inflationPct     = sup.abs.cpi.value;
    inflationContext = `ABS period: ${sup.abs.cpi.period}`;
    inflationYear    = sup.abs.cpi.period ? parseInt(sup.abs.cpi.period) : wbData.inflation?.year;
    inflationSource  = 'Australian Bureau of Statistics — CPI All Groups, YoY %, CPI dataflow SDMX';
  } else {
    inflationPct    = wbData.inflation?.value;
    inflationContext = null;
    inflationYear   = wbData.inflation?.year;
    inflationSource = 'World Bank — Consumer price inflation (% annual) FP.CPI.TOTL.ZG';
    if (jur === 'US' && sup.blsCpiAllItems) {
      inflationContext = `BLS CPI-U index (SA): ${sup.blsCpiAllItems.value} (${sup.blsCpiAllItems.period} ${sup.blsCpiAllItems.year}, 1982-84=100)`;
      inflationSource += '; U.S. Bureau of Labor Statistics — CPI-U series CUSR0000SA0';
    } else if (jur === 'CA' && sup.boc?.['V122530']) {
      inflationContext = `Bank of Canada Bank Rate: ${sup.boc['V122530'].value}% (${sup.boc['V122530'].date}); Overnight CORRA: ${sup.boc['CORRA_RATE_AT_TRIM']?.value ?? 'n/a'}% (${sup.boc['CORRA_RATE_AT_TRIM']?.date ?? 'n/a'})`;
      inflationSource += '; Bank of Canada Valet API — V122530 (Bank Rate), CORRA (bankofcanada.ca/valet)';
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
      note:   'House price data not available from open API sources for this jurisdiction.',
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
        rent.cpiRentIndex  = sup.blsCpiRent.value;
        rent.cpiRentPeriod = `${sup.blsCpiRent.period} ${sup.blsCpiRent.year}`;
        rent.cpiRentNote   = 'BLS CPI-U Rent of Primary Residence (CUSR0000SEHA), 1982-84=100.';
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
    rent = { datasetTitle: sup.caCkan.housing.packageTitle, records: sup.caCkan.housing.records.slice(0, 10), source: sup.caCkan.housing.source };
  } else if (jur === 'UK' && sup.ukCkan?.rent?.records?.length > 0) {
    rent = { datasetTitle: sup.ukCkan.rent.packageTitle, records: sup.ukCkan.rent.records.slice(0, 10), source: sup.ukCkan.rent.source };
  } else {
    rent = { note: 'Rental price data not available from open API sources for this jurisdiction.', source: null };
  }

  // ── Immigration ────────────────────────────────────────────────────────────
  const migrantPct = wbData.migrantStockPct?.value ?? null;
  const netMig     = wbData.netMigration?.value    ?? null;

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
    estimatedMigrantCount:       migrantPct && population ? Math.round((migrantPct / 100) * population) : null,
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
    note:   'Point-in-time homelessness count not available from open CKAN API sources. ' +
            'Published annually by: HUD (US), ESDC/Reaching Home (CA), MHCLG (UK), AIHW (AU).',
    source: null,
  };

  // ══════════════════════════════════════════════════════════════════════════
  // NEW METRICS — each in standardised { value, unit, date, sourceUrl, updateFrequency } shape
  // ══════════════════════════════════════════════════════════════════════════

  // ── Crime Rate ────────────────────────────────────────────────────────────
  // Primary: country-specific supplement; fallback: World Bank homicide rate as proxy
  let crimeRate;
  if (jur === 'UK' && sup.ukCkan?.crimeStats?.records?.length > 0) {
    crimeRate = stat(
      null,
      'police-recorded offences',
      String(CURRENT_YEAR - 2),
      'https://data.gov.uk',
      'Annual',
      { dataset: sup.ukCkan.crimeStats.packageTitle, records: sup.ukCkan.crimeStats.records.slice(0, 10), source: sup.ukCkan.crimeStats.source }
    );
  } else if (jur === 'AU' && sup.auCkan?.crimeStats?.records?.length > 0) {
    crimeRate = stat(
      null,
      'recorded offences',
      String(CURRENT_YEAR - 2),
      'https://data.gov.au',
      'Annual',
      { dataset: sup.auCkan.crimeStats.packageTitle, records: sup.auCkan.crimeStats.records.slice(0, 10), source: sup.auCkan.crimeStats.source }
    );
  } else {
    // Fallback: use WB homicide rate as a crime severity proxy
    crimeRate = stat(
      wbData.homicideRate?.value,
      'intentional homicides per 100,000 population (proxy)',
      String(wbData.homicideRate?.year ?? CURRENT_YEAR - 2),
      'https://api.worldbank.org/v2/country/indicator/VC.IHR.PSRC.P5?format=json',
      'Annual',
      { note: 'Full crime rate not available via open API. Homicide rate used as comparative proxy. ' +
               'US: FBI Crime Data Explorer (crime.fbi.gov). UK: ONS Crime in England & Wales. ' +
               'AU: ABS Recorded Crime Victims (abs.gov.au).' }
    );
  }

  // ── Drug Overdoses ────────────────────────────────────────────────────────
  let drugOverdoses;
  if (jur === 'US' && sup.cdcDrugOverdoses) {
    drugOverdoses = stat(
      sup.cdcDrugOverdoses.totalDeaths,
      'drug overdose deaths (national total)',
      sup.cdcDrugOverdoses.year ? String(sup.cdcDrugOverdoses.year) : null,
      'https://data.cdc.gov/resource/xkb8-kh2a.json',
      'Monthly (provisional)',
      { period: sup.cdcDrugOverdoses.period, indicator: sup.cdcDrugOverdoses.indicator, source: sup.cdcDrugOverdoses.source }
    );
  } else if (jur === 'CA' && sup.caCkan?.drugOverdoses?.records?.length > 0) {
    drugOverdoses = stat(
      null,
      'apparent opioid toxicity deaths',
      String(CURRENT_YEAR - 2),
      'https://open.canada.ca',
      'Quarterly',
      { dataset: sup.caCkan.drugOverdoses.packageTitle, records: sup.caCkan.drugOverdoses.records.slice(0, 10), source: sup.caCkan.drugOverdoses.source }
    );
  } else if (jur === 'UK' && sup.ukCkan?.drugDeaths?.records?.length > 0) {
    drugOverdoses = stat(
      null,
      'drug misuse deaths',
      String(CURRENT_YEAR - 2),
      'https://data.gov.uk',
      'Annual',
      { dataset: sup.ukCkan.drugDeaths.packageTitle, records: sup.ukCkan.drugDeaths.records.slice(0, 10), source: sup.ukCkan.drugDeaths.source }
    );
  } else if (jur === 'AU' && sup.auCkan?.drugDeaths?.records?.length > 0) {
    drugOverdoses = stat(
      null,
      'drug-induced deaths',
      String(CURRENT_YEAR - 2),
      'https://data.gov.au',
      'Annual',
      { dataset: sup.auCkan.drugDeaths.packageTitle, records: sup.auCkan.drugDeaths.records.slice(0, 10), source: sup.auCkan.drugDeaths.source }
    );
  } else {
    const DRUG_SOURCE_URLS = {
      US: 'https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm',
      CA: 'https://health-infobase.canada.ca/substance-related-harms/opioids-stimulants/',
      UK: 'https://www.ons.gov.uk/peoplepopulationandcommunity/birthsdeathsandmarriages/deaths/bulletins/deathsrelatedtodrugpoisoninginenglandandwales/latest',
      AU: 'https://www.aihw.gov.au/reports/illicit-use-of-drugs/alcohol-and-other-drug-deaths',
    };
    drugOverdoses = stat(
      null, 'drug-related deaths', null, DRUG_SOURCE_URLS[jur], 'Annual',
      { note: 'Drug overdose death data not available via open API for this jurisdiction. See source URL for official report.' }
    );
  }

  // ── Homicide Rate ─────────────────────────────────────────────────────────
  const homicideRate = stat(
    wbData.homicideRate?.value != null ? parseFloat(wbData.homicideRate.value.toFixed(2)) : null,
    'intentional homicides per 100,000 population',
    String(wbData.homicideRate?.year ?? CURRENT_YEAR - 2),
    'https://api.worldbank.org/v2/country/indicator/VC.IHR.PSRC.P5?format=json',
    'Annual',
    {
      prevValue: wbData.homicideRate?.prevValue,
      trend: {
        direction:     calcTrend(wbData.homicideRate?.value, wbData.homicideRate?.prevValue),
        percentChange: calcPctChange(wbData.homicideRate?.value, wbData.homicideRate?.prevValue),
      },
      note: 'UNODC data hosted by World Bank. Covers intentional homicide (murder). ' +
            'Excludes attempted homicide and non-intentional killings.',
    }
  );

  // ── Road Fatalities ───────────────────────────────────────────────────────
  let roadFatalityValue = wbData.roadFatalities?.value;
  let roadFatalitySource = 'https://api.worldbank.org/v2/country/indicator/SH.STA.TRAF.P5?format=json';
  let roadFatalityNote = 'WHO Global Status Report on Road Safety. Rate per 100,000 population.';

  if (jur === 'UK' && sup.ukCkan?.roadCasualties?.records?.length > 0) {
    roadFatalitySource = 'https://data.gov.uk';
    roadFatalityNote = sup.ukCkan.roadCasualties.source;
  } else if (jur === 'AU' && sup.auCkan?.roadFatalities?.records?.length > 0) {
    roadFatalitySource = 'https://data.gov.au';
    roadFatalityNote = sup.auCkan.roadFatalities.source;
  }

  const roadFatalities = stat(
    roadFatalityValue != null ? parseFloat(roadFatalityValue.toFixed(2)) : null,
    'road traffic deaths per 100,000 population',
    String(wbData.roadFatalities?.year ?? CURRENT_YEAR - 2),
    roadFatalitySource,
    'Annual (every 3–5 years for WHO; annual for country-specific)',
    {
      prevValue: wbData.roadFatalities?.prevValue,
      trend: {
        direction:     calcTrend(wbData.roadFatalities?.value, wbData.roadFatalities?.prevValue),
        percentChange: calcPctChange(wbData.roadFatalities?.value, wbData.roadFatalities?.prevValue),
      },
      note: roadFatalityNote,
      supplementDataset: jur === 'UK' ? sup.ukCkan?.roadCasualties?.packageTitle
                       : jur === 'AU' ? sup.auCkan?.roadFatalities?.packageTitle : null,
    }
  );

  // ── Life Expectancy ───────────────────────────────────────────────────────
  const lifeExpectancy = stat(
    wbData.lifeExpectancy?.value != null ? parseFloat(wbData.lifeExpectancy.value.toFixed(1)) : null,
    'years at birth (total population)',
    String(wbData.lifeExpectancy?.year ?? CURRENT_YEAR - 2),
    'https://api.worldbank.org/v2/country/indicator/SP.DYN.LE00.IN?format=json',
    'Annual',
    {
      prevValue: wbData.lifeExpectancy?.prevValue,
      trend: {
        direction:     calcTrend(wbData.lifeExpectancy?.value, wbData.lifeExpectancy?.prevValue),
        percentChange: calcPctChange(wbData.lifeExpectancy?.value, wbData.lifeExpectancy?.prevValue),
      },
      note: 'World Bank / WHO estimate. Life expectancy at birth indicates overall mortality levels ' +
            'across all age groups. COVID-19 caused notable declines in 2020–2021 for all 4 countries.',
    }
  );

  // ── Obesity Rate ──────────────────────────────────────────────────────────
  // WB SH.STA.OWAD.ZS = % adults with BMI ≥ 25 (overweight incl. obese).
  // This is overweight, not strictly obese (BMI ≥ 30). Noted in the stat.
  const obesityRate = stat(
    wbData.obesityRate?.value != null ? parseFloat(wbData.obesityRate.value.toFixed(1)) : null,
    '% of adults with BMI ≥ 25 (overweight, incl. obese)',
    String(wbData.obesityRate?.year ?? CURRENT_YEAR - 2),
    'https://api.worldbank.org/v2/country/indicator/SH.STA.OWAD.ZS?format=json',
    'Annual (WHO NCD data, typically 3–5 year lag)',
    {
      prevValue: wbData.obesityRate?.prevValue,
      trend: {
        direction:     calcTrend(wbData.obesityRate?.value, wbData.obesityRate?.prevValue),
        percentChange: calcPctChange(wbData.obesityRate?.value, wbData.obesityRate?.prevValue),
      },
      note: 'WHO Global Health Observatory data via World Bank. Indicator SH.STA.OWAD.ZS covers ' +
            'all adults with BMI ≥ 25 (overweight including obese). For obesity only (BMI ≥ 30) ' +
            'see: CDC NHANES (US), StatCan CHMS (CA), NHS Digital (UK), AIHW (AU).',
      strictObesitySourceUrls: {
        US: 'https://www.cdc.gov/obesity/data/adult.html',
        CA: 'https://www150.statcan.gc.ca/n1/pub/82-625-x/2019001/article/00005-eng.htm',
        UK: 'https://digital.nhs.uk/data-and-information/publications/statistical/health-survey-for-england',
        AU: 'https://www.aihw.gov.au/reports/overweight-obesity/overweight-and-obesity',
      },
    }
  );

  // ── Poverty Rate ──────────────────────────────────────────────────────────
  // World Bank SI.POV.NAHC covers national poverty lines but often has gaps for rich countries.
  // US: supplement with Census ACS DP03_0119PE (% all people below federal poverty level).
  let povertyValue  = wbData.povertyRate?.value;
  let povertyDate   = String(wbData.povertyRate?.year ?? CURRENT_YEAR - 2);
  let povertyUrl    = 'https://api.worldbank.org/v2/country/indicator/SI.POV.NAHC?format=json';
  let povertyUnit   = '% of population below national poverty line';
  let povertyNote   = 'World Bank — national poverty line definitions differ across countries; not directly comparable.';

  if (jur === 'US' && sup.census?.povertyRatePct != null) {
    povertyValue = sup.census.povertyRatePct;
    povertyDate  = String(sup.census.year);
    povertyUrl   = sup.census.sourceUrl;
    povertyUnit  = '% of all people below the federal poverty level';
    povertyNote  = 'U.S. Census Bureau ACS 1-Year. Federal poverty thresholds set by HHS.';
  }

  const povertyRate = stat(
    povertyValue != null ? parseFloat(povertyValue.toFixed(1)) : null,
    povertyUnit,
    povertyDate,
    povertyUrl,
    'Annual',
    {
      prevValue: jur !== 'US' ? wbData.povertyRate?.prevValue : null,
      trend: jur !== 'US' ? {
        direction:     calcTrend(wbData.povertyRate?.value, wbData.povertyRate?.prevValue),
        percentChange: calcPctChange(wbData.povertyRate?.value, wbData.povertyRate?.prevValue),
      } : null,
      note: povertyNote,
    }
  );

  // ── Graduation Rates ──────────────────────────────────────────────────────
  // World Bank: SE.SEC.CUAT.UP.ZS = % pop 25+ with at least upper secondary education.
  //             SE.TER.CUAT.BA.ZS = % pop 25+ with at least Bachelor's degree.
  // US supplement: Census ACS DP02_0060PE (% 25+ high school grad+), DP02_0067PE (% 25+ bachelor's+).
  let highSchoolGradPct = wbData.upperSecondaryEdu?.value;
  let bachelorsPct      = wbData.tertiaryEdu?.value;
  let gradDate          = String(wbData.upperSecondaryEdu?.year ?? CURRENT_YEAR - 2);
  let gradUrl           = 'https://api.worldbank.org/v2/country/indicator/SE.SEC.CUAT.UP.ZS?format=json';
  let gradSource        = 'World Bank — UNESCO Institute for Statistics (UIS) educational attainment data';

  if (jur === 'US' && sup.census) {
    if (sup.census.highSchoolGradPct != null) highSchoolGradPct = sup.census.highSchoolGradPct;
    if (sup.census.bachelorsPlusPct  != null) bachelorsPct      = sup.census.bachelorsPlusPct;
    gradDate   = String(sup.census.year);
    gradUrl    = sup.census.sourceUrl;
    gradSource = `U.S. Census Bureau — ACS 1-Year ${sup.census.year}, DP02 (api.census.gov)`;
  }

  const graduationRates = stat(
    highSchoolGradPct != null ? parseFloat(highSchoolGradPct.toFixed(1)) : null,
    '% of population aged 25+ with at least upper secondary / high school education',
    gradDate,
    gradUrl,
    'Annual',
    {
      highSchoolOrEquivalentPct: highSchoolGradPct != null ? parseFloat(highSchoolGradPct.toFixed(1)) : null,
      bachelorsDegreeOrHigherPct: bachelorsPct != null ? parseFloat(bachelorsPct.toFixed(1)) : null,
      govtExpenditureOnEducationPctGDP: wbData.govtEdSpend?.value != null
        ? parseFloat(wbData.govtEdSpend.value.toFixed(2)) : null,
      govtEdSpendYear: wbData.govtEdSpend?.year ?? null,
      note: gradSource,
      supplementDataset: jur === 'CA' ? sup.caCkan?.graduationRates?.packageTitle : null,
    }
  );

  // ── Student Debt ──────────────────────────────────────────────────────────
  // No country provides total outstanding student debt via an open JSON API.
  // UK Student Loans Company publishes annual statistics; UK supplement CKAN may find it.
  // US: Federal Student Aid portfolio summary (studentaid.gov — no API).
  // CA: National Student Loans Service Centre (NSLSC) — no API.
  // AU: HELP debt tracked by ATO — no API.
  const STUDENT_DEBT_URLS = {
    US: 'https://studentaid.gov/data-center/student/portfolio',
    CA: 'https://www.canada.ca/en/employment-social-development/programs/canada-student-loans.html',
    UK: 'https://www.slc.co.uk/official-statistics/student-support-statistics/england/student-loans-outstanding-balance.aspx',
    AU: 'https://www.aihw.gov.au/reports/higher-education/higher-education-debt',
  };

  let studentDebtRecords = null;
  let studentDebtValue   = null;
  let studentDebtNote    = `Student debt data not available via open JSON API. See: ${STUDENT_DEBT_URLS[jur]}`;

  if (jur === 'UK' && sup.ukCkan?.studentLoans?.records?.length > 0) {
    studentDebtRecords = sup.ukCkan.studentLoans.records.slice(0, 10);
    studentDebtNote    = `Dataset: ${sup.ukCkan.studentLoans.packageTitle}`;
  }

  const studentDebt = stat(
    studentDebtValue,
    'total outstanding student loan balance (national)',
    null,
    STUDENT_DEBT_URLS[jur],
    'Annual',
    {
      note:    studentDebtNote,
      records: studentDebtRecords,
      govtEdSpendPctGDP: wbData.govtEdSpend?.value != null ? parseFloat(wbData.govtEdSpend.value.toFixed(2)) : null,
      govtEdSpendYear:   wbData.govtEdSpend?.year ?? null,
      govtEdSpendNote:   'Government expenditure on education (% of GDP) — World Bank SE.XPD.TOTL.GD.ZS. ' +
                         'Related proxy for public investment in education.',
    }
  );

  // ── Final document ─────────────────────────────────────────────────────────
  return {
    id:      `${jur}_${QUARTER_YEAR}_${QUARTER}_social`,
    country: jur,
    quarter: QUARTER,
    year:    QUARTER_YEAR,
    population,
    // ── Existing metrics ──
    unemployment,
    inflation,
    housePrices,
    rent,
    immigration,
    homelessness,
    // ── New metrics ──
    crimeRate,
    drugOverdoses,
    homicideRate,
    roadFatalities,
    lifeExpectancy,
    obesityRate,
    povertyRate,
    graduationRates,
    studentDebt,
    dataSources: [
      'World Bank Open Data (api.worldbank.org)',
      ...(jur === 'US' ? [
        'U.S. Bureau of Labor Statistics (api.bls.gov)',
        'U.S. Census Bureau — ACS 1-Year (api.census.gov)',
        'CDC VSRR Drug Overdose Data (data.cdc.gov)',
      ] : []),
      ...(jur === 'CA' ? [
        'Bank of Canada Valet API (bankofcanada.ca/valet)',
        'open.canada.ca CKAN',
      ] : []),
      ...(jur === 'UK' ? [
        'Office for National Statistics timeseries (www.ons.gov.uk)',
        'data.gov.uk CKAN (ONS / MHCLG / Home Office / DfT / SLC)',
      ] : []),
      ...(jur === 'AU' ? [
        'ABS SDMX-JSON API (api.data.abs.gov.au)',
        'data.gov.au CKAN (ABS / AIHW / BITRE)',
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
  let blsUnemployment = null, blsCpiAllItems = null, blsCpiRent = null;
  let census = null, cdcDrugOverdoses = null;
  try {
    const bls = await fetchUSBLSData();
    blsUnemployment = bls.unemployment;
    blsCpiAllItems  = bls.cpiAllItems;
    blsCpiRent      = bls.cpiRent;
  } catch (e) { console.error(`[socialstats:US] ✗ BLS: ${e.message}`); }
  try { census          = await fetchUSCensusACS();          } catch (e) { console.error(`[socialstats:US] ✗ Census: ${e.message}`); }
  try { cdcDrugOverdoses = await fetchUSCDCDrugOverdoses();  } catch (e) { console.error(`[socialstats:US] ✗ CDC: ${e.message}`); }

  // 3. Canada supplements
  let boc = null, caCkan = null;
  try { boc    = await fetchCABoCData();    } catch (e) { console.error(`[socialstats:CA] ✗ Bank of Canada: ${e.message}`); }
  try { caCkan = await fetchCASupplements(); } catch (e) { console.error(`[socialstats:CA] ✗ CKAN: ${e.message}`); }

  // 4. UK supplements
  let ukCkan = null, onsTimeseries = null;
  try { ukCkan        = await fetchUKSupplements();   } catch (e) { console.error(`[socialstats:UK] ✗ CKAN: ${e.message}`); }
  try { onsTimeseries = await fetchUKONSTimeseries(); } catch (e) { console.error(`[socialstats:UK] ✗ ONS: ${e.message}`); }

  // 5. Australia supplements
  let abs = null, auCkan = null;
  try { abs    = await fetchAUABSData();     } catch (e) { console.error(`[socialstats:AU] ✗ ABS: ${e.message}`); }
  try { auCkan = await fetchAUSupplements(); } catch (e) { console.error(`[socialstats:AU] ✗ CKAN: ${e.message}`); }

  // 6. Assemble and save per-country documents
  const supplementsByJur = {
    US: { blsUnemployment, blsCpiAllItems, blsCpiRent, census, cdcDrugOverdoses },
    CA: { boc, caCkan },
    UK: { ukCkan, onsTimeseries },
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
