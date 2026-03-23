/**
 * Live Data Fetch — Civic Voice Engine
 *
 * Fetches real-time data from all confirmed working government API sources:
 *   CA — Bank of Canada Valet (exchange rates, Bank Rate, CORRA, bond yields)
 *   US — BLS (unemployment), Census ACS (median rent), CDC (drug overdose deaths),
 *         USAspending (federal agency spending FY2025)
 *   UK — ONS timeseries (CPI inflation, unemployment)
 *   AU — ABS SDMX-JSON (CPI, unemployment / labour force)
 *
 * Each record shape: { country, metric, value, unit, date, source, sourceUrl, fetchedAt }
 *
 * Output: output/socialstats/live_fetch_{timestamp}.json
 *
 * Run: node src/ingestion/liveFetch.js
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/socialstats');
const TIMEOUT_MS = 25000;
const BROWSER_UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const FETCHED_AT = new Date().toISOString();

const safeNum = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? null : n; };

// ─── Record builder ────────────────────────────────────────────────────────────

function record(country, metric, value, unit, date, source, sourceUrl) {
  return { country, metric, value: value ?? null, unit, date: date ?? null, source, sourceUrl, fetchedAt: FETCHED_AT };
}

// ─── CA: Bank of Canada Valet ─────────────────────────────────────────────────

async function fetchBoCRates() {
  const BASE = 'https://www.bankofcanada.ca/valet/observations';
  const SERIES = {
    'FXUSDCAD':           { metric: 'exchangeRate_USDCAD',   unit: 'CAD per USD',         source: 'Bank of Canada — USD/CAD daily exchange rate' },
    'V122530':            { metric: 'bankRate',               unit: '% per annum',          source: 'Bank of Canada — Bank Rate (V122530)' },
    'CORRA_RATE_AT_TRIM': { metric: 'corraOvernightRate',     unit: '% per annum',          source: 'Bank of Canada — CORRA overnight rate (trimmed)' },
    'BD.CDN.2YR.DQ.YLD':  { metric: 'gocBondYield_2yr',      unit: '% per annum',          source: 'Bank of Canada — GoC 2-year benchmark bond yield' },
    'BD.CDN.10YR.DQ.YLD': { metric: 'gocBondYield_10yr',     unit: '% per annum',          source: 'Bank of Canada — GoC 10-year benchmark bond yield' },
  };

  const results = await Promise.allSettled(
    Object.keys(SERIES).map(s => axios.get(`${BASE}/${s}/json?recent=3`, { timeout: TIMEOUT_MS }))
  );

  const records = [];
  const keys = Object.keys(SERIES);
  for (let i = 0; i < keys.length; i++) {
    const seriesId = keys[i];
    const meta     = SERIES[seriesId];
    const r        = results[i];
    if (r.status === 'rejected') {
      console.warn(`  [CA] BoC ${seriesId} failed: ${r.reason?.response?.status ?? r.reason?.message?.slice(0, 60)}`);
      continue;
    }
    const obs    = r.value.data?.observations ?? [];
    const sorted = [...obs].sort((a, b) => b.d.localeCompare(a.d));
    const latest = sorted[0];
    const val    = safeNum(latest?.[seriesId]?.v);
    if (val == null) { console.warn(`  [CA] BoC ${seriesId}: no value`); continue; }
    console.log(`  [CA] ${meta.metric}: ${val} (${latest.d})`);
    records.push(record('CA', meta.metric, val, meta.unit, latest.d, meta.source, `https://www.bankofcanada.ca/valet/observations/${seriesId}/json`));
  }
  return records;
}

// ─── US: BLS — unemployment rate ──────────────────────────────────────────────

async function fetchBLSUnemployment() {
  const resp   = await axios.get('https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true', { timeout: TIMEOUT_MS });
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) throw new Error('BLS: no data returned');
  const val    = safeNum(latest.value);
  const period = `${latest.periodName} ${latest.year}`;
  console.log(`  [US] unemploymentRate: ${val}% (${period})`);
  return [record('US', 'unemploymentRate', val, '% of labour force (seasonally adjusted)', period,
    'U.S. Bureau of Labor Statistics — CPS series LNS14000000',
    'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true')];
}

// ─── US: BLS — CPI-U all items and rent index ─────────────────────────────────

async function fetchBLSCPI() {
  const SERIES = {
    'CUSR0000SA0':  { metric: 'cpiAllItems',  unit: 'index (1982-84=100, SA)' },
    'CUSR0000SEHA': { metric: 'cpiRentIndex', unit: 'index (1982-84=100, NSA)' },
  };
  const results = await Promise.allSettled(
    Object.keys(SERIES).map(s => axios.get(`https://api.bls.gov/publicAPI/v1/timeseries/data/${s}?latest=true`, { timeout: TIMEOUT_MS }))
  );
  const records = [];
  const keys = Object.keys(SERIES);
  for (let i = 0; i < keys.length; i++) {
    const seriesId = keys[i];
    const meta     = SERIES[seriesId];
    const r        = results[i];
    if (r.status === 'rejected') { console.warn(`  [US] BLS ${seriesId} failed`); continue; }
    const latest = r.value.data?.Results?.series?.[0]?.data?.[0];
    if (!latest) continue;
    const val    = safeNum(latest.value);
    const period = `${latest.periodName} ${latest.year}`;
    console.log(`  [US] ${meta.metric}: ${val} (${period})`);
    records.push(record('US', meta.metric, val, meta.unit, period,
      `U.S. Bureau of Labor Statistics — series ${seriesId}`,
      `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}?latest=true`));
  }
  return records;
}

// ─── US: Census ACS — median gross rent ───────────────────────────────────────

async function fetchCensusRent() {
  const CURRENT_YEAR = new Date().getFullYear();
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const resp = await axios.get(
        `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP04_0134E,DP04_0089E,DP03_0119PE,NAME&for=us:1`,
        { timeout: TIMEOUT_MS }
      );
      if (!Array.isArray(resp.data) || resp.data.length < 2) continue;
      const headers = resp.data[0];
      const vals    = resp.data[1];
      const obj     = {};
      headers.forEach((h, i) => { obj[h] = vals[i]; });

      const rent      = safeNum(obj['DP04_0134E']);
      const homeValue = safeNum(obj['DP04_0089E']);
      const poverty   = safeNum(obj['DP03_0119PE']);
      const sourceUrl = `https://api.census.gov/data/${yr}/acs/acs1/profile`;
      const source    = `U.S. Census Bureau — ACS 1-Year ${yr}`;

      console.log(`  [US] medianGrossRent: $${rent}/mo (${yr} ACS)`);
      console.log(`  [US] medianHomeValue: $${homeValue?.toLocaleString()} (${yr} ACS)`);
      console.log(`  [US] povertyRate: ${poverty}% (${yr} ACS)`);

      return [
        record('US', 'medianGrossRent',  rent,      '$/month (ACS 1-Year)',               String(yr), source, sourceUrl),
        record('US', 'medianHomeValue',  homeValue, '$ owner-occupied housing units (ACS)', String(yr), source, sourceUrl),
        record('US', 'povertyRate',      poverty,   '% below federal poverty level (ACS)', String(yr), source, sourceUrl),
      ];
    } catch (err) {
      console.warn(`  [US] Census ACS ${yr} failed: ${err.message?.slice(0, 60)}`);
    }
  }
  return [];
}

// ─── US: CDC — drug overdose deaths (VSRR provisional) ───────────────────────

async function fetchCDCDrugOverdoses() {
  const resp = await axios.get(
    "https://data.cdc.gov/resource/xkb8-kh2a.json?$where=state='US'%20AND%20indicator='Number%20of%20Drug%20Overdose%20Deaths'&$order=year%20DESC,month%20DESC&$limit=1",
    { timeout: TIMEOUT_MS }
  );
  const row = resp.data?.[0];
  if (!row) throw new Error('CDC: no data returned');
  const val    = safeNum(row.data_value);
  const period = `${row.month}/${row.year}`;
  console.log(`  [US] drugOverdoseDeaths: ${val?.toLocaleString()} (${period} provisional)`);
  return [record('US', 'drugOverdoseDeaths', val, 'deaths (provisional monthly count)', period,
    'CDC — VSRR Provisional Drug Overdose Death Counts (NCHS)',
    'https://data.cdc.gov/resource/xkb8-kh2a.json')];
}

// ─── US: USAspending — federal agency spending FY2025 ─────────────────────────

async function fetchUSASpending() {
  const now       = new Date();
  const month     = now.getMonth() + 1;
  const curFY     = month >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  const curPeriod = month >= 10 ? month - 9 : month + 3;

  for (const { fy, period } of [
    { fy: curFY,     period: Math.max(1, curPeriod - 1) },
    { fy: curFY - 1, period: 12 },
    { fy: curFY - 2, period: 12 },
  ]) {
    try {
      const resp = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'agency', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      const results = resp.data?.results ?? [];
      if (results.length === 0) continue;
      const total = resp.data?.total ?? 0;
      const label = `FY${fy} Period ${period}`;
      console.log(`  [US] federalSpendingTotal: $${(total / 1e12).toFixed(2)}T (${label}, ${results.length} agencies)`);

      const agencyRecords = results
        .sort((a, b) => (b.amount || 0) - (a.amount || 0))
        .slice(0, 15)
        .map(a => ({
          agency:    a.name,
          amountUSD: safeNum(a.amount),
          pctOfTotal: total > 0 ? parseFloat(((a.amount / total) * 100).toFixed(2)) : null,
        }));

      const rec = record('US', 'federalAgencySpending', total, 'USD total obligations', label,
        `USAspending.gov — agency budget authority ${label}`,
        'https://api.usaspending.gov/api/v2/spending/');
      rec.topAgencies  = agencyRecords;
      rec.agencyCount  = results.length;
      return [rec];
    } catch (err) {
      if (err.response?.status === 400) continue;
      throw err;
    }
  }
  return [];
}

// ─── CA: World Bank — unemployment rate (ILO modeled) ────────────────────────

async function fetchCAUnemployment() {
  const resp = await axios.get(
    'https://api.worldbank.org/v2/country/CA/indicator/SL.UEM.TOTL.ZS?format=json&mrv=3',
    { timeout: TIMEOUT_MS }
  );
  const rows = (resp.data[1] ?? []).filter(d => d.value != null);
  if (rows.length === 0) throw new Error('World Bank: no unemployment data for CA');
  const latest = rows[0]; // already sorted most-recent first
  const val    = safeNum(latest.value);
  console.log(`  [CA] unemploymentRate: ${val}% (${latest.date} ILO modeled)`);
  return [record('CA', 'unemploymentRate', val, '% of labour force (ILO modeled estimate)',
    String(latest.date),
    'World Bank — ILO modeled unemployment estimate for Canada (SL.UEM.TOTL.ZS)',
    'https://api.worldbank.org/v2/country/CA/indicator/SL.UEM.TOTL.ZS')];
}

// ─── CA: Bank of Canada Valet — CPIX YoY inflation ───────────────────────────

async function fetchCACpiInflation() {
  // ATOM_V41693242 = CPI excluding 8 most volatile components, % change YoY (unadjusted)
  const resp = await axios.get(
    'https://www.bankofcanada.ca/valet/observations/ATOM_V41693242/json?recent=3',
    { timeout: TIMEOUT_MS }
  );
  const obs    = resp.data?.observations ?? [];
  const sorted = [...obs].sort((a, b) => b.d.localeCompare(a.d));
  const latest = sorted[0];
  const val    = safeNum(latest?.['ATOM_V41693242']?.v);
  if (val == null) throw new Error('BoC CPIX: no value in response');
  console.log(`  [CA] cpiInflation (CPIX): ${val}% (${latest.d})`);
  return [record('CA', 'cpiInflation', val, '% YoY (CPI excluding volatile components)',
    latest.d,
    'Bank of Canada — CPIX YoY (excludes 8 volatile components), series ATOM_V41693242',
    'https://www.bankofcanada.ca/valet/observations/ATOM_V41693242/json')];
}

// ─── CA: OECD IDD — relative poverty rate ─────────────────────────────────────

async function fetchCAPovertyRate() {
  // IDD = Income Distribution Database
  // POVERTY_RATE50_WG = poverty at 50% median income threshold, working-age groups
  const resp = await axios.get(
    'https://stats.oecd.org/sdmx-json/data/IDD/CAN.POVERTY_RATE50_WG.TOTAL.AGEHD.D_CUR/all?lastNObservations=3',
    { timeout: TIMEOUT_MS }
  );
  const ds     = resp.data.data?.dataSets?.[0];
  const struct = resp.data.data?.structures?.[0];
  const tDim   = struct?.dimensions?.observation?.[0];
  if (!ds) throw new Error('OECD IDD: no dataSets in response');

  // Find obs with a non-null value, prefer latest by key index (highest = most recent)
  const firstSeries = Object.values(ds.series ?? {})[0];
  if (!firstSeries) throw new Error('OECD IDD: no series found');
  const obs        = firstSeries.observations ?? {};
  const sortedIdx  = Object.keys(obs).map(Number).sort((a, b) => b - a);
  const latestIdx  = sortedIdx.find(i => obs[i]?.[0] != null);
  if (latestIdx === undefined) throw new Error('OECD IDD: all observations are null');

  const val    = safeNum(obs[latestIdx][0]);
  const period = tDim?.values?.[latestIdx]?.id ?? String(latestIdx);
  console.log(`  [CA] povertyRate (OECD relative): ${val}% (${period})`);
  return [record('CA', 'povertyRate', val, '% below 50% of median income (OECD relative poverty)',
    period,
    'OECD — Relative poverty rate, Income Distribution Database (IDD)',
    'https://stats.oecd.org/Index.aspx?DataSetCode=IDD')];
}

// ─── UK: HM Land Registry — average house price (UK HPI linked data) ─────────

async function fetchUKHousePrices() {
  // Linked Data API: sort by refMonth desc, take first item (latest month)
  const resp = await axios.get(
    'https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month.json?_pageSize=1&_sort=-refMonth',
    { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }
  );
  const item = (resp.data?.result?.items ?? [])[0];
  if (!item) throw new Error('LR HPI: no items returned');
  const price = item.averagePrice ?? item.averagePriceSA;
  if (price == null) throw new Error('LR HPI: no averagePrice in response');
  // refMonth is a URI like "http://…/month/2025-12" — extract the date part
  const about = item['_about'] ?? '';
  const monthMatch = about.match(/(\d{4}-\d{2})$/);
  const period = monthMatch ? monthMatch[1] : null;
  console.log(`  [UK] medianHomeValue (avg): £${Number(price).toLocaleString()} (${period})`);
  return [record('UK', 'medianHomeValue', safeNum(price), 'GBP (UK average house price, LR HPI)',
    period,
    'HM Land Registry — UK House Price Index, average price (England & Wales)',
    'https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month.json?_sort=-refMonth')];
}

// ─── UK: Bank of England — Official Bank Rate ─────────────────────────────────

async function fetchUKBankRate() {
  // BoE IADB statistical API returns CSV: "DATE,IUDBEDR\n02 Jan 2026,3.75\n..."
  const resp = await axios.get(
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TT&UsingCodes=Y',
    { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } }
  );
  const lines = String(resp.data).trim().split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('SERIES') && !l.startsWith('DATE') && !l.startsWith('DESCR') && l.includes(','));
  if (lines.length === 0) throw new Error('BoE: no data rows in CSV');
  const lastLine = lines[lines.length - 1];
  const [dateStr, rateStr] = lastLine.split(',');
  const val = safeNum(rateStr);
  if (val == null) throw new Error('BoE: could not parse rate from: ' + lastLine);
  console.log(`  [UK] bankRate: ${val}% (${dateStr?.trim()})`);
  return [record('UK', 'bankRate', val, '% per annum (Official Bank Rate)',
    dateStr?.trim() ?? null,
    'Bank of England — Official Bank Rate, series IUDBEDR',
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?SeriesCodes=IUDBEDR')];
}

// ─── UK: ONS IPHRP — private rental price index ───────────────────────────────

async function fetchUKPrivateRentalIndex() {
  // L522 = Index of Private Housing Rental Prices (UK, 2015=100)
  // Note: this is an index, not a GBP value — no GBP-denominated median is
  // available via open API (ONS publishes median rents in Excel bulletins only)
  const resp = await axios.get(
    'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/l522/data',
    { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } }
  );
  const months = (resp.data?.months ?? []).sort((a, b) => b.date.localeCompare(a.date));
  const latest = months[0];
  if (!latest) throw new Error('ONS IPHRP: no monthly data in L522');
  const val = safeNum(latest.value);
  console.log(`  [UK] medianGrossRent (IPHRP index): ${val} (${latest.date})`);
  return [record('UK', 'medianGrossRent', val, 'Private Rental Price Index (UK, 2015=100)',
    latest.date,
    'Office for National Statistics — Index of Private Housing Rental Prices (IPHRP), series L522',
    'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/l522/data')];
}

// ─── UK: OECD IDD — relative poverty rate ─────────────────────────────────────

async function fetchUKPovertyRate() {
  const resp = await axios.get(
    'https://stats.oecd.org/sdmx-json/data/IDD/GBR.POVERTY_RATE50_WG.TOTAL.AGEHD.D_CUR/all?lastNObservations=5',
    { timeout: TIMEOUT_MS }
  );
  const ds     = resp.data.data?.dataSets?.[0];
  const struct = resp.data.data?.structures?.[0];
  const tDim   = struct?.dimensions?.observation?.[0];
  if (!ds) throw new Error('OECD IDD GBR: no dataSets');
  const firstSeries = Object.values(ds.series ?? {})[0];
  if (!firstSeries) throw new Error('OECD IDD GBR: no series');
  const obs       = firstSeries.observations ?? {};
  const sortedIdx = Object.keys(obs).map(Number).sort((a, b) => b - a);
  const latestIdx = sortedIdx.find(i => obs[i]?.[0] != null);
  if (latestIdx === undefined) throw new Error('OECD IDD GBR: all observations null');
  const val    = safeNum(obs[latestIdx][0]);
  const period = tDim?.values?.[latestIdx]?.id ?? String(latestIdx);
  console.log(`  [UK] povertyRate (OECD relative): ${val}% (${period})`);
  return [record('UK', 'povertyRate', val, '% below 50% of median income (OECD relative poverty)',
    period,
    'OECD — Relative poverty rate, Income Distribution Database (IDD)',
    'https://stats.oecd.org/Index.aspx?DataSetCode=IDD')];
}

// ─── UK: ONS timeseries — CPI and unemployment ────────────────────────────────

async function fetchONSTimeseries() {
  const HEADERS = { 'User-Agent': BROWSER_UA, Accept: 'application/json' };
  const SERIES = {
    cpiInflation: {
      url:    'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/data',
      metric: 'cpiInflation',
      unit:   '% (12-month rate)',
      source: 'Office for National Statistics — CPI 12-month rate, series D7G7',
    },
    unemploymentRate: {
      url:    'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data',
      metric: 'unemploymentRate',
      unit:   '% (ILO measure, seasonally adjusted)',
      source: 'Office for National Statistics — ILO unemployment rate, series MGSX',
    },
  };

  const records = [];
  for (const [key, meta] of Object.entries(SERIES)) {
    try {
      const resp   = await axios.get(meta.url, { timeout: TIMEOUT_MS, headers: HEADERS });
      const months = resp.data?.months ?? [];
      if (months.length === 0) { console.warn(`  [UK] ONS ${key}: no monthly data`); continue; }
      const sorted = [...months].sort((a, b) => b.date.localeCompare(a.date));
      const latest = sorted[0];
      const val    = safeNum(latest?.value);
      console.log(`  [UK] ${meta.metric}: ${val} (${latest?.date})`);
      records.push(record('UK', meta.metric, val, meta.unit, latest?.date ?? null, meta.source, meta.url));
    } catch (err) {
      console.warn(`  [UK] ONS ${key} failed: ${err.response?.status ?? err.message?.slice(0, 60)}`);
    }
  }
  return records;
}

// ─── AU: ABS SDMX-JSON — CPI and labour force ────────────────────────────────

async function fetchABSData() {
  const CURRENT_YEAR = new Date().getFullYear();
  // Key format uses actual code IDs (not positional indices).
  // CPI: MEASURE.INDEX.TSEST.REGION.FREQ — quarterly key 404s; monthly works fine.
  //   3=YoY%, 10001=All groups, 10=Original, 50=Australia, M=Monthly
  // LF: MEASURE.SEX.AGE.TSEST.REGION.FREQ
  //   M13=Unemployment rate, 3=Persons, 1599=All ages, 20=SA, AUS=Australia, M=Monthly
  const DATAFLOWS = {
    cpiInflation: {
      url:    `https://api.data.abs.gov.au/data/CPI/3.10001.10.50.M?format=jsondata&startPeriod=${CURRENT_YEAR - 1}-01`,
      metric: 'cpiInflation',
      unit:   '% change from corresponding month of previous year',
      source: 'Australian Bureau of Statistics — CPI All Groups YoY%, CPI dataflow (SDMX)',
      srcUrl: 'https://api.data.abs.gov.au/data/CPI/3.10001.10.50.M',
    },
    unemploymentRate: {
      url:    `https://api.data.abs.gov.au/data/LF/M13.3.1599.20.AUS.M?format=jsondata&startPeriod=${CURRENT_YEAR - 1}-01`,
      metric: 'unemploymentRate',
      unit:   '% (seasonally adjusted)',
      source: 'Australian Bureau of Statistics — Labour Force Survey, series M13 (SDMX)',
      srcUrl: 'https://api.data.abs.gov.au/data/LF/M13.3.1599.20.AUS.M',
    },
  };

  const records = [];
  for (const [key, meta] of Object.entries(DATAFLOWS)) {
    try {
      const resp = await axios.get(meta.url, {
        timeout: TIMEOUT_MS,
        headers: { Accept: 'application/vnd.sdmx.data+json' },
      });
      // ABS SDMX-JSON v2: dataSets at data.data.dataSets OR data.dataSets;
      // structures at data.data.structures (array)
      const ds         = resp.data?.data?.dataSets?.[0] ?? resp.data?.dataSets?.[0];
      const structures = resp.data?.data?.structures   ?? resp.data?.structures ?? [];
      const obsDim     = structures[0]?.dimensions?.observation?.[0];
      const sKeys      = Object.keys(ds?.series ?? {});
      if (sKeys.length === 0) { console.warn(`  [AU] ABS ${key}: no series`); continue; }
      const obs  = ds.series[sKeys[0]].observations ?? {};
      const idxs = Object.keys(obs).map(Number).sort((a, b) => b - a);
      if (idxs.length === 0) { console.warn(`  [AU] ABS ${key}: no observations`); continue; }
      const val    = safeNum(obs[idxs[0]]?.[0]);
      const period = obsDim?.values?.[idxs[0]]?.id ?? null;
      console.log(`  [AU] ${meta.metric}: ${val} (${period})`);
      records.push(record('AU', meta.metric, val, meta.unit, period, meta.source, meta.srcUrl));
    } catch (err) {
      console.warn(`  [AU] ABS ${key} failed: ${err.response?.status ?? err.message?.slice(0, 60)}`);
    }
  }
  return records;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  console.log(`[livefetch] Starting live data fetch at ${FETCHED_AT}\n`);

  const allRecords = [];

  console.log('[CA] Bank of Canada Valet — exchange rates & interest rates');
  try { allRecords.push(...await fetchBoCRates()); } catch (e) { console.error(`  [CA] BoC fetch error: ${e.message}`); }

  console.log('\n[CA] World Bank ILO — unemployment rate');
  try { allRecords.push(...await fetchCAUnemployment()); } catch (e) { console.error(`  [CA] WB unemployment error: ${e.message}`); }

  console.log('\n[CA] Bank of Canada Valet — CPIX inflation (ATOM_V41693242)');
  try { allRecords.push(...await fetchCACpiInflation()); } catch (e) { console.error(`  [CA] BoC CPIX error: ${e.message}`); }

  console.log('\n[CA] OECD IDD — relative poverty rate');
  try { allRecords.push(...await fetchCAPovertyRate()); } catch (e) { console.error(`  [CA] OECD poverty error: ${e.message}`); }

  console.log('\n[US] BLS — unemployment rate');
  try { allRecords.push(...await fetchBLSUnemployment()); } catch (e) { console.error(`  [US] BLS unemployment error: ${e.message}`); }

  console.log('\n[US] BLS — CPI all items + rent index');
  try { allRecords.push(...await fetchBLSCPI()); } catch (e) { console.error(`  [US] BLS CPI error: ${e.message}`); }

  console.log('\n[US] Census ACS — median rent, home value, poverty rate');
  try { allRecords.push(...await fetchCensusRent()); } catch (e) { console.error(`  [US] Census error: ${e.message}`); }

  console.log('\n[US] CDC — drug overdose deaths (VSRR provisional)');
  try { allRecords.push(...await fetchCDCDrugOverdoses()); } catch (e) { console.error(`  [US] CDC error: ${e.message}`); }

  console.log('\n[US] USAspending — federal agency spending FY2025');
  try { allRecords.push(...await fetchUSASpending()); } catch (e) { console.error(`  [US] USAspending error: ${e.message}`); }

  console.log('\n[UK] HM Land Registry — average house price');
  try { allRecords.push(...await fetchUKHousePrices()); } catch (e) { console.error(`  [UK] LR HPI error: ${e.message}`); }

  console.log('\n[UK] Bank of England — Official Bank Rate');
  try { allRecords.push(...await fetchUKBankRate()); } catch (e) { console.error(`  [UK] BoE rate error: ${e.message}`); }

  console.log('\n[UK] ONS IPHRP — private rental price index (L522)');
  try { allRecords.push(...await fetchUKPrivateRentalIndex()); } catch (e) { console.error(`  [UK] ONS rental error: ${e.message}`); }

  console.log('\n[UK] OECD IDD — relative poverty rate');
  try { allRecords.push(...await fetchUKPovertyRate()); } catch (e) { console.error(`  [UK] OECD poverty error: ${e.message}`); }

  console.log('\n[UK] ONS — CPI inflation + unemployment');
  try { allRecords.push(...await fetchONSTimeseries()); } catch (e) { console.error(`  [UK] ONS error: ${e.message}`); }

  console.log('\n[AU] ABS — CPI inflation + unemployment rate');
  try { allRecords.push(...await fetchABSData()); } catch (e) { console.error(`  [AU] ABS error: ${e.message}`); }

  // ── Save output ─────────────────────────────────────────────────────────────
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `live_fetch_${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ fetchedAt: FETCHED_AT, recordCount: allRecords.length, records: allRecords }, null, 2));

  // ── Print summary table ──────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(100));
  console.log(' LIVE FETCH RESULTS');
  console.log('─'.repeat(100));
  console.log(` ${'JUR'.padEnd(4)} ${'Metric'.padEnd(28)} ${'Value'.padEnd(16)} ${'Date'.padEnd(18)} Source`);
  console.log('─'.repeat(100));
  for (const r of allRecords) {
    const val = r.value != null
      ? (r.metric.includes('Spending') || r.metric.includes('Value') || r.metric.includes('Rent') ? `$${Number(r.value).toLocaleString()}` : String(r.value))
      : '—';
    console.log(` ${r.country.padEnd(4)} ${r.metric.padEnd(28)} ${val.padEnd(16)} ${(r.date ?? '—').padEnd(18)} ${r.source.slice(0, 38)}`);
  }
  console.log('─'.repeat(100));
  console.log(`\n[livefetch] ${allRecords.length} records saved → ${outPath}`);
  return allRecords;
}

module.exports = { main };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[livefetch] Fatal:', err.message); process.exit(1); });
}
