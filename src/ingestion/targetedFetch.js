/**
 * Targeted Fetch — JSON API Sources
 *
 * Dedicated fetchers using confirmed working government JSON APIs only.
 *
 * Canada (via bankofcanada.ca/valet + open.canada.ca CKAN):
 *   - CPI           Bank of Canada Valet series V41690973
 *   - unemployment  Statistics Canada LFS table 14-10-0017-01 (streaming ZIP/CSV)
 *                   NOTE: Bank of Canada Valet does not publish an unemployment series;
 *                   StatCan LFS is the primary and only programmatic source.
 *   - govtSpending  open.canada.ca CKAN datastore — Public Accounts of Canada
 *
 * United States (JSON APIs, no key required):
 *   - unemployment  BLS API v2  series LNS14000000
 *   - CPI           BLS API v2  series CUUR0000SA0 (CPI-U All Items, not seasonally adjusted)
 *   - drugOverdoses CDC Socrata xkb8-kh2a (VSRR provisional)
 *   - fedSpending   USAspending.gov /api/v2/spending/
 *   - medianRent    Census Bureau ACS 1-Year DP04_0134E
 *
 * United Kingdom (JSON/CSV APIs, no key required):
 *   - unemployment  ONS timeseries MGSX (ILO measure, seasonally adjusted)
 *   - CPI           ONS timeseries D7G7 (12-month rate)
 *   - homePrice     HM Land Registry HPI Linked Data API (average UK price)
 *   - bankRate      Bank of England IADB CSV API (series IUDBEDR) — returns CSV
 *
 * Australia (JSON/CSV APIs, no key required):
 *   - unemployment  ABS SDMX-JSON LF dataflow (M13.3.1599.20.AUS.M)
 *   - CPI           ABS SDMX-JSON CPI dataflow (3.10001.10.50.M)
 *   - bankRate      RBA F1 CSV (Cash Rate Target) — returns CSV
 *
 * Output:  output/targeted/targeted_{timestamp}.json
 * Run:     node src/ingestion/targetedFetch.js
 */

require('dotenv').config();
const axios      = require('axios');
const fs         = require('fs');
const path       = require('path');
const zlib       = require('zlib');
const { promisify } = require('util');

const OUTPUT_DIR  = path.resolve(__dirname, '../../output/targeted');
const TIMEOUT_MS  = 25000;
const BROWSER_UA  = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const FETCHED_AT  = new Date().toISOString();

const safeNum = v => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isNaN(n) ? null : n; };

function parseCSVLine(line) {
  const fields = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { fields.push(cur); cur = ''; }
    else { cur += c; }
  }
  fields.push(cur);
  return fields;
}

function result(country, stat, value, unit, date, source, sourceUrl, notes = '') {
  return { country, stat, value, unit, date, source, sourceUrl, notes, fetchedAt: FETCHED_AT };
}

// ─── CANADA ───────────────────────────────────────────────────────────────────

/**
 * CA CPI — Bank of Canada Valet API
 * Series V41690973 = CPI All-items (from Statistics Canada, re-published via BoC)
 * Endpoint: /valet/observations/{series}/json?recent=3
 */
async function fetchCA_CPI() {
  const SERIES = 'V41690973';
  const resp   = await axios.get(
    `https://www.bankofcanada.ca/valet/observations/${SERIES}/json?recent=3`,
    { timeout: TIMEOUT_MS }
  );
  const obs    = resp.data?.observations ?? [];
  const latest = [...obs].sort((a, b) => b.d.localeCompare(a.d))[0];
  const val    = safeNum(latest?.[SERIES]?.v);
  if (val == null) throw new Error('BoC Valet: no value for V41690973');
  return result('CA', 'cpi', val, 'index (2002=100, all-items)', latest.d,
    'Bank of Canada Valet API — CPI All-items, series V41690973 (sourced from Statistics Canada)',
    `https://www.bankofcanada.ca/valet/observations/${SERIES}/json`);
}

/**
 * CA Unemployment — Statistics Canada Labour Force Survey
 * Table 14-10-0017-01 (54 MB streaming ZIP/CSV)
 * NOTE: Bank of Canada Valet does not expose an unemployment rate series.
 *       StatCan LFS is the only government JSON/data API source.
 *       The ZIP uses compressedSize=0 (streaming format); inflateRaw feeds until error.
 */
async function fetchCA_Unemployment() {
  const resp = await axios({
    method: 'GET',
    url: 'https://www150.statcan.gc.ca/n1/tbl/csv/14100017-eng.zip',
    responseType: 'stream',
    timeout: 120000,
    headers: { 'User-Agent': BROWSER_UA },
  });

  return new Promise((resolve, reject) => {
    const source   = resp.data;
    const inflater = zlib.createInflateRaw();

    let zipBuf = Buffer.alloc(0), zipHeaderDone = false;
    let compressedSize = 0, bytesWritten = 0;
    let lineBuffer = '', csvHeader = null, colIdx = {};
    let bestDate = '', bestValue = null, finished = false;

    function finish(err) {
      if (finished) return;
      finished = true;
      source.destroy();
      if (err) return reject(err);
      if (bestValue !== null) {
        return resolve(result(
          'CA', 'unemployment', bestValue,
          '% (3-month moving average, seasonally adjusted)',
          bestDate,
          'Statistics Canada — Labour Force Survey, table 14-10-0017-01',
          'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410001701',
          'BoC Valet has no unemployment series; StatCan LFS is primary source'
        ));
      }
      reject(new Error('StatCan LFS: no Canada unemployment rate found'));
    }

    function processChunk(chunk) {
      lineBuffer += chunk.toString('utf-8');
      const lines = lineBuffer.split('\n');
      lineBuffer  = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!csvHeader) {
          csvHeader = line;
          const cols = parseCSVLine(line.replace(/^\uFEFF/, ''));
          colIdx = {
            date:   cols.findIndex(c => c === 'REF_DATE'),
            geo:    cols.findIndex(c => c === 'GEO'),
            chars:  cols.findIndex(c => c.includes('Labour force characteristics')),
            gender: cols.findIndex(c => c === 'Gender' || c === 'Sex'),
            age:    cols.findIndex(c => c === 'Age group'),
            value:  cols.findIndex(c => c === 'VALUE'),
          };
          continue;
        }
        if (!line.includes('Canada') || !line.includes('Unemployment rate') || !line.includes('15 years and over')) continue;
        const cols   = parseCSVLine(line);
        if (cols[colIdx.geo] !== 'Canada') continue;
        if (!cols[colIdx.chars]?.includes('Unemployment rate')) continue;
        const gender = cols[colIdx.gender];
        if (gender !== 'Total - Gender' && gender !== 'Both sexes') continue;
        if (cols[colIdx.age] !== '15 years and over') continue;
        const val = cols[colIdx.value], date = cols[colIdx.date];
        if (!val || val === '..' || !date) continue;
        if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
      }
    }

    inflater.on('data', chunk => processChunk(chunk));
    inflater.on('end',  () => finish(null));
    inflater.on('error', () => finish(null)); // ZIP metadata after DEFLATE end

    source.on('data', chunk => {
      if (finished) return;
      if (zipHeaderDone) {
        if (compressedSize > 0) {
          const remaining = compressedSize - bytesWritten;
          if (remaining <= 0) return;
          const toWrite = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
          inflater.write(toWrite); bytesWritten += toWrite.length;
          if (bytesWritten >= compressedSize) inflater.end();
        } else {
          inflater.write(chunk); bytesWritten += chunk.length;
        }
        return;
      }
      zipBuf = Buffer.concat([zipBuf, chunk]);
      if (zipBuf.length < 30) return;
      if (zipBuf.readUInt32LE(0) !== 0x04034b50) { finish(new Error('Not a ZIP')); return; }
      const fnLen = zipBuf.readUInt16LE(26), extLen = zipBuf.readUInt16LE(28);
      compressedSize = zipBuf.readUInt32LE(18);
      const dataStart = 30 + fnLen + extLen;
      if (zipBuf.length < dataStart) return;
      zipHeaderDone = true;
      const initial = zipBuf.slice(dataStart); zipBuf = null;
      if (compressedSize > 0) {
        const toWrite = initial.length <= compressedSize ? initial : initial.slice(0, compressedSize);
        inflater.write(toWrite); bytesWritten += toWrite.length;
        if (bytesWritten >= compressedSize) inflater.end();
      } else {
        inflater.write(initial); bytesWritten += initial.length;
      }
    });
    source.on('end',   () => { if (!finished && zipHeaderDone) inflater.end(); else finish(new Error('Stream ended before ZIP header')); });
    source.on('error', err => finish(err));
  });
}

/**
 * CA Government Spending — open.canada.ca CKAN Datastore
 * Dataset: Public Accounts of Canada – Authorities and Expenditures by Vote
 * Resource: 3bafde71-8cb8-460e-93e2-691295221063
 * Fetches all rows for the latest fiscal year and sums expenditures.
 */
async function fetchCA_GovtSpending() {
  const RESOURCE_ID = '3bafde71-8cb8-460e-93e2-691295221063';
  const BASE = 'https://open.canada.ca/data/en/api/3/action/datastore_search';

  // Step 1: find the latest fiscal year from the most-recent sorted records
  const probe = await axios.get(BASE, {
    params: { resource_id: RESOURCE_ID, sort: 'fy_ef desc', limit: 1 },
    timeout: TIMEOUT_MS,
  });
  const latestFY = probe.data?.result?.records?.[0]?.fy_ef;
  if (!latestFY) throw new Error('CA GovtSpending: could not determine latest fiscal year');

  // Step 2: fetch all rows for that fiscal year (single request — 578 rows in 2024-25)
  const resp = await axios.get(BASE, {
    params: {
      resource_id: RESOURCE_ID,
      filters: JSON.stringify({ fy_ef: latestFY }),
      limit: 2000,
    },
    timeout: TIMEOUT_MS,
  });

  const records = resp.data?.result?.records ?? [];
  if (records.length === 0) throw new Error(`CA GovtSpending: no records for ${latestFY}`);

  const totalCAD = records.reduce((sum, r) => sum + parseFloat(r.expenditures ?? 0), 0);
  const billions = parseFloat((totalCAD / 1e9).toFixed(2));
  const deptCount = new Set(records.map(r => r.org_name)).size;

  return result(
    'CA', 'govtSpending', billions, `CAD billions (${deptCount} departments, fiscal year ${latestFY})`,
    latestFY,
    'open.canada.ca — Public Accounts of Canada, Authorities and Expenditures by Vote',
    'https://open.canada.ca/data/en/dataset/a35cf382-690c-4221-a971-cf0fd189a46f',
    `Sum of ${records.length} vote-level expenditure rows for FY ${latestFY}`
  );
}

// ─── UNITED STATES ────────────────────────────────────────────────────────────

/**
 * US Unemployment — Bureau of Labor Statistics API v2
 * Series LNS14000000: Unemployment Rate, Seasonally Adjusted (CPS)
 * No API key required for single-series requests.
 */
async function fetchUS_Unemployment() {
  const SERIES = 'LNS14000000';
  const resp   = await axios.get(
    `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES}?latest=true`,
    { timeout: TIMEOUT_MS }
  );
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) throw new Error('BLS: no data for LNS14000000');
  const val    = safeNum(latest.value);
  const period = `${latest.periodName} ${latest.year}`;
  return result(
    'US', 'unemployment', val, '% (seasonally adjusted)',
    period,
    'Bureau of Labor Statistics — CPS Unemployment Rate, series LNS14000000',
    'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true'
  );
}

/**
 * US CPI — Bureau of Labor Statistics API v2
 * Series CUUR0000SA0: CPI-U All Items, Not Seasonally Adjusted (1982-84=100)
 * No API key required.
 */
async function fetchUS_CPI() {
  const SERIES = 'CUUR0000SA0';
  const resp   = await axios.get(
    `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES}?latest=true`,
    { timeout: TIMEOUT_MS }
  );
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) throw new Error('BLS: no data for CUUR0000SA0');
  const val    = safeNum(latest.value);
  const period = `${latest.periodName} ${latest.year}`;
  return result(
    'US', 'cpi', val, 'index (1982-84=100, not seasonally adjusted)',
    period,
    'Bureau of Labor Statistics — CPI-U All Items NSA, series CUUR0000SA0',
    'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0?latest=true'
  );
}

/**
 * US Drug Overdoses — CDC Socrata API
 * Dataset xkb8-kh2a: VSRR Provisional Drug Overdose Death Counts
 * Filters to national total, latest month, drug overdose deaths indicator.
 */
async function fetchUS_DrugOverdoses() {
  const resp = await axios.get(
    "https://data.cdc.gov/resource/xkb8-kh2a.json?$where=state='US'%20AND%20indicator='Number%20of%20Drug%20Overdose%20Deaths'&$order=year%20DESC,month%20DESC&$limit=1",
    { timeout: TIMEOUT_MS }
  );
  const row = resp.data?.[0];
  if (!row) throw new Error('CDC Socrata: no data returned');
  const val    = safeNum(row.data_value);
  const period = `${row.month}/${row.year} (provisional)`;
  return result(
    'US', 'drugOverdoses', val, 'deaths (provisional monthly count)',
    period,
    'CDC — VSRR Provisional Drug Overdose Death Counts (NCHS), Socrata xkb8-kh2a',
    'https://data.cdc.gov/resource/xkb8-kh2a.json',
    'Provisional; typically revised upward as death certificates are processed'
  );
}

/**
 * US Federal Spending — USAspending.gov API
 * POST /api/v2/spending/ — agency breakdown for current/latest fiscal year.
 * Walks back FY periods until a non-empty response is found.
 */
async function fetchUS_FedSpending() {
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
      const resp    = await axios.post(
        'https://api.usaspending.gov/api/v2/spending/',
        { type: 'agency', filters: { fy: String(fy), period } },
        { headers: { 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS }
      );
      const results = resp.data?.results ?? [];
      if (results.length === 0) continue;
      const total   = resp.data?.total ?? 0;
      const label   = `FY${fy} Period ${period}`;
      const trillions = parseFloat((total / 1e12).toFixed(3));
      return result(
        'US', 'fedSpending', trillions, `USD trillions (${results.length} agencies, ${label})`,
        label,
        `USAspending.gov — Agency Budget Authority, ${label}`,
        'https://api.usaspending.gov/api/v2/spending/',
        `${results.length} agencies; total = $${trillions}T`
      );
    } catch (err) {
      if (err.response?.status === 400) continue;
      throw err;
    }
  }
  throw new Error('USAspending: no data found for any recent fiscal period');
}

/**
 * US Median Gross Rent — Census Bureau ACS 1-Year API
 * Variable DP04_0134E: Median gross rent ($/month)
 * Uses most recent available ACS 1-Year year (tries current-2, then current-3).
 */
async function fetchUS_MedianRent() {
  const CURRENT_YEAR = new Date().getFullYear();
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const resp = await axios.get(
        `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP04_0134E,NAME&for=us:1`,
        { timeout: TIMEOUT_MS }
      );
      if (!Array.isArray(resp.data) || resp.data.length < 2) continue;
      const headers = resp.data[0];
      const vals    = resp.data[1];
      const rentIdx = headers.indexOf('DP04_0134E');
      const val     = safeNum(vals[rentIdx]);
      if (val == null || val < 0) continue;
      return result(
        'US', 'medianRent', val, '$/month (median gross rent)',
        String(yr),
        `U.S. Census Bureau — ACS 1-Year ${yr}, variable DP04_0134E`,
        `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP04_0134E&for=us:1`
      );
    } catch (err) {
      console.warn(`  Census ACS ${yr} failed: ${err.message?.slice(0, 60)}`);
    }
  }
  throw new Error('Census ACS: no median rent data found');
}

// ─── UNITED KINGDOM ───────────────────────────────────────────────────────────

/**
 * UK Unemployment — Office for National Statistics Timeseries API
 * Series MGSX: ILO unemployment rate, seasonally adjusted (Labour Market Survey)
 * No API key required.
 */
async function fetchUK_Unemployment() {
  const URL = 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const months = resp.data?.months ?? [];
  if (months.length === 0) throw new Error('ONS MGSX: no monthly data in response');
  const sorted = [...months].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const val = safeNum(latest?.value);
  if (val == null) throw new Error('ONS MGSX: could not parse value from latest month');
  return result('UK', 'unemployment', val, '% (ILO measure, seasonally adjusted)',
    latest.date,
    'Office for National Statistics — ILO unemployment rate, series MGSX',
    URL);
}

/**
 * UK CPI Inflation — Office for National Statistics Timeseries API
 * Series D7G7: CPI 12-month rate (% change)
 * No API key required.
 */
async function fetchUK_CPI() {
  const URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/data';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const months = resp.data?.months ?? [];
  if (months.length === 0) throw new Error('ONS D7G7: no monthly data in response');
  const sorted = [...months].sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const val = safeNum(latest?.value);
  if (val == null) throw new Error('ONS D7G7: could not parse value from latest month');
  return result('UK', 'cpi', val, '% (CPI 12-month rate)',
    latest.date,
    'Office for National Statistics — CPI 12-month rate, series D7G7',
    URL);
}

/**
 * UK Home Prices — HM Land Registry UK HPI Linked Data API
 * Returns average UK house price for the latest available month.
 * No API key required.
 */
async function fetchUK_HomePrices() {
  const URL = 'https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month.json?_pageSize=1&_sort=-refMonth';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const item = (resp.data?.result?.items ?? [])[0];
  if (!item) throw new Error('LR HPI: no items returned');
  const price = item.averagePrice ?? item.averagePriceSA;
  if (price == null) throw new Error('LR HPI: no averagePrice in response');
  const about = item['_about'] ?? '';
  const monthMatch = about.match(/(\d{4}-\d{2})$/);
  const period = monthMatch ? monthMatch[1] : null;
  return result('UK', 'homePrice', safeNum(price), 'GBP (UK average house price)',
    period,
    'HM Land Registry — UK House Price Index, average price (England & Wales)',
    'https://landregistry.data.gov.uk/data/ukhpi/region/united-kingdom/month.json?_sort=-refMonth');
}

/**
 * UK Bank Rate — Bank of England IADB Statistical API
 * Series IUDBEDR: Official Bank Rate
 * NOTE: Returns CSV, not JSON. Parsed as last data row.
 */
async function fetchUK_BankRate() {
  const URL = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=now&SeriesCodes=IUDBEDR&CSVF=TT&UsingCodes=Y';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const lines = String(resp.data).trim().split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('SERIES') && !l.startsWith('DATE') && !l.startsWith('DESCR') && l.includes(','));
  if (lines.length === 0) throw new Error('BoE: no data rows in CSV response');
  const lastLine = lines[lines.length - 1];
  const [dateStr, rateStr] = lastLine.split(',');
  const val = safeNum(rateStr);
  if (val == null) throw new Error('BoE: could not parse rate from: ' + lastLine);
  return result('UK', 'bankRate', val, '% per annum (Official Bank Rate)',
    dateStr?.trim() ?? null,
    'Bank of England — Official Bank Rate, series IUDBEDR',
    'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?SeriesCodes=IUDBEDR');
}

// ─── AUSTRALIA ────────────────────────────────────────────────────────────────

/**
 * AU Unemployment — Australian Bureau of Statistics SDMX-JSON API
 * Dataflow LF, key M13.3.1599.20.AUS.M:
 *   M13=Unemployment rate, 3=Persons, 1599=All ages, 20=Seasonally adjusted, AUS, M=Monthly
 * No API key required. Requires Accept: application/vnd.sdmx.data+json header.
 */
async function fetchAU_Unemployment() {
  const CURRENT_YEAR = new Date().getFullYear();
  const URL = `https://api.data.abs.gov.au/data/LF/M13.3.1599.20.AUS.M?format=jsondata&startPeriod=${CURRENT_YEAR - 1}-01`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { Accept: 'application/vnd.sdmx.data+json' },
  });
  const ds         = resp.data?.data?.dataSets?.[0] ?? resp.data?.dataSets?.[0];
  const structures = resp.data?.data?.structures   ?? resp.data?.structures ?? [];
  const obsDim     = structures[0]?.dimensions?.observation?.[0];
  const sKeys      = Object.keys(ds?.series ?? {});
  if (sKeys.length === 0) throw new Error('ABS LF: no series in response');
  const obs  = ds.series[sKeys[0]].observations ?? {};
  const idxs = Object.keys(obs).map(Number).sort((a, b) => b - a);
  if (idxs.length === 0) throw new Error('ABS LF: no observations in series');
  const val    = safeNum(obs[idxs[0]]?.[0]);
  const period = obsDim?.values?.[idxs[0]]?.id ?? null;
  if (val == null) throw new Error('ABS LF: could not parse unemployment value');
  return result('AU', 'unemployment', val, '% (seasonally adjusted)',
    period,
    'Australian Bureau of Statistics — Labour Force Survey, series M13 (SDMX)',
    'https://api.data.abs.gov.au/data/LF/M13.3.1599.20.AUS.M');
}

/**
 * AU CPI — Australian Bureau of Statistics SDMX-JSON API
 * Dataflow CPI, key 3.10001.10.50.M:
 *   3=YoY%, 10001=All groups, 10=Original, 50=Australia, M=Monthly
 * No API key required.
 */
async function fetchAU_CPI() {
  const CURRENT_YEAR = new Date().getFullYear();
  const URL = `https://api.data.abs.gov.au/data/CPI/3.10001.10.50.M?format=jsondata&startPeriod=${CURRENT_YEAR - 1}-01`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { Accept: 'application/vnd.sdmx.data+json' },
  });
  const ds         = resp.data?.data?.dataSets?.[0] ?? resp.data?.dataSets?.[0];
  const structures = resp.data?.data?.structures   ?? resp.data?.structures ?? [];
  const obsDim     = structures[0]?.dimensions?.observation?.[0];
  const sKeys      = Object.keys(ds?.series ?? {});
  if (sKeys.length === 0) throw new Error('ABS CPI: no series in response');
  const obs  = ds.series[sKeys[0]].observations ?? {};
  const idxs = Object.keys(obs).map(Number).sort((a, b) => b - a);
  if (idxs.length === 0) throw new Error('ABS CPI: no observations in series');
  const val    = safeNum(obs[idxs[0]]?.[0]);
  const period = obsDim?.values?.[idxs[0]]?.id ?? null;
  if (val == null) throw new Error('ABS CPI: could not parse CPI value');
  return result('AU', 'cpi', val, '% change from corresponding month of previous year',
    period,
    'Australian Bureau of Statistics — CPI All Groups YoY%, CPI dataflow (SDMX)',
    'https://api.data.abs.gov.au/data/CPI/3.10001.10.50.M');
}

/**
 * AU Cash Rate Target — Reserve Bank of Australia F1 Statistical Table
 * URL: https://www.rba.gov.au/statistics/tables/csv/f1-data.csv
 * NOTE: Returns CSV, not JSON. Filters rows matching DD-Mon-YYYY date format.
 *       Column index 1 = Cash Rate Target.
 */
async function fetchAU_BankRate() {
  const MONTH_MAP = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const resp = await axios.get(
    'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv',
    { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } }
  );
  const lines = String(resp.data).split('\n')
    .map(l => l.trim())
    .filter(l => /^\d{2}-[A-Za-z]{3}-\d{4}/.test(l));
  if (lines.length === 0) throw new Error('RBA F1: no data rows found');
  const lastLine = lines[lines.length - 1];
  const parts = lastLine.split(',');
  const dateStr = parts[0].trim();
  const val = safeNum(parts[1]);
  if (val == null) throw new Error('RBA F1: could not parse rate from: ' + lastLine);
  const [dd, mon, yyyy] = dateStr.split('-');
  const isoDate = `${yyyy}-${MONTH_MAP[mon] ?? '??'}-${dd}`;
  return result('AU', 'bankRate', val, '% per annum (Cash Rate Target)',
    isoDate,
    'Reserve Bank of Australia — Cash Rate Target, F1 Statistical Table (daily)',
    'https://www.rba.gov.au/statistics/tables/csv/f1-data.csv');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const FETCHERS = [
  { label: 'CA  CPI           (Bank of Canada Valet V41690973)',         fn: fetchCA_CPI },
  { label: 'CA  Unemployment   (StatCan LFS 14-10-0017-01, stream ZIP)', fn: fetchCA_Unemployment },
  { label: 'CA  Govt Spending  (open.canada.ca CKAN Public Accounts)',   fn: fetchCA_GovtSpending },
  { label: 'US  Unemployment   (BLS API LNS14000000)',                   fn: fetchUS_Unemployment },
  { label: 'US  CPI            (BLS API CUUR0000SA0)',                   fn: fetchUS_CPI },
  { label: 'US  Drug Overdoses (CDC Socrata xkb8-kh2a)',                 fn: fetchUS_DrugOverdoses },
  { label: 'US  Fed Spending   (USAspending.gov /api/v2/spending/)',     fn: fetchUS_FedSpending },
  { label: 'US  Median Rent    (Census ACS DP04_0134E)',                 fn: fetchUS_MedianRent },
  { label: 'UK  Unemployment   (ONS timeseries MGSX)',                   fn: fetchUK_Unemployment },
  { label: 'UK  CPI            (ONS timeseries D7G7)',                   fn: fetchUK_CPI },
  { label: 'UK  Home Prices    (LR HPI Linked Data API)',                fn: fetchUK_HomePrices },
  { label: 'UK  Bank Rate      (BoE IADB CSV series IUDBEDR)',           fn: fetchUK_BankRate },
  { label: 'AU  Unemployment   (ABS SDMX-JSON LF/M13.3.1599.20.AUS.M)', fn: fetchAU_Unemployment },
  { label: 'AU  CPI            (ABS SDMX-JSON CPI/3.10001.10.50.M)',    fn: fetchAU_CPI },
  { label: 'AU  Bank Rate      (RBA F1 CSV — Cash Rate Target)',         fn: fetchAU_BankRate },
];

async function main() {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(` TARGETED FETCH — JSON API Sources`);
  console.log(` Started: ${FETCHED_AT}`);
  console.log(`${'═'.repeat(80)}\n`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const { label, fn } of FETCHERS) {
    process.stdout.write(`  Fetching ${label}... `);
    const start = Date.now();
    try {
      const r = await fn();
      results.push({ ...r, ok: true });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✓  ${elapsed}s`);
    } catch (err) {
      results.push({ country: label.slice(0,2).trim(), stat: label, value: null, date: null, error: err.message, ok: false });
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`✗  ${elapsed}s  → ${err.message?.slice(0, 70)}`);
    }
  }

  // ── Save output ─────────────────────────────────────────────────────────────
  const ts      = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `targeted_${ts}.json`);
  const payload = { fetchedAt: FETCHED_AT, count: results.length, results };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  // ── Print summary table ──────────────────────────────────────────────────────
  const ok      = results.filter(r => r.ok);
  const failed  = results.filter(r => !r.ok);

  const COL = { cty: 4, stat: 16, value: 20, date: 22, source: 0 };
  const LINE = '─'.repeat(100);
  console.log(`\n${LINE}`);
  console.log(` ${'JUR'.padEnd(COL.cty)} ${'STAT'.padEnd(COL.stat)} ${'VALUE'.padEnd(COL.value)} ${'DATE'.padEnd(COL.date)} SOURCE`);
  console.log(LINE);

  for (const r of results) {
    if (!r.ok) {
      console.log(` ${'ERR'.padEnd(COL.cty)} ${String(r.stat ?? '').slice(0,16).padEnd(COL.stat)} ${'—'.padEnd(COL.value)} ${'—'.padEnd(COL.date)} ${r.error?.slice(0, 50)}`);
      continue;
    }
    const valStr = r.value != null ? String(r.value) : '—';
    const datStr = r.date  != null ? String(r.date)  : '—';
    const srcStr = (r.source ?? '').slice(0, 46);
    console.log(` ${r.country.padEnd(COL.cty)} ${r.stat.padEnd(COL.stat)} ${valStr.padEnd(COL.value)} ${datStr.padEnd(COL.date)} ${srcStr}`);
  }

  console.log(LINE);
  console.log(`\n  ✓ ${ok.length} succeeded  ✗ ${failed.length} failed`);
  console.log(`  Saved → ${outPath}\n`);

  if (failed.length > 0) {
    console.log('  Failed:');
    failed.forEach(r => console.log(`    • ${r.stat ?? r.country}: ${r.error}`));
    console.log();
  }

  return results;
}

module.exports = { main };

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => { console.error('[targetedFetch] Fatal:', err.message); process.exit(1); });
}
