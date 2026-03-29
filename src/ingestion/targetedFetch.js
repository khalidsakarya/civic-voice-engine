/**
 * Targeted Fetch — JSON API Sources
 *
 * Dedicated fetchers using confirmed working government JSON APIs only.
 *
 * Canada (via bankofcanada.ca/valet + open.canada.ca CKAN + StatCan ZIP CSV):
 *   - CPI           Bank of Canada Valet series V41690973
 *   - unemployment  Statistics Canada LFS table 14-10-0017-01 (streaming ZIP/CSV)
 *                   NOTE: Bank of Canada Valet does not publish an unemployment series;
 *                   StatCan LFS is the primary and only programmatic source.
 *   - govtSpending  open.canada.ca CKAN datastore — Public Accounts of Canada
 *
 * Canada — Safety & Health (StatCan in-memory ZIP CSV + PHAC Health Infobase):
 *   - crimeRate     StatCan Crime Severity Index, table 35-10-0026-01
 *   - drugOverdoses PHAC Health Infobase SubstanceHarmsData.csv (opioid deaths)
 *   - roadFatalities StatCan road collisions by severity, table 23-10-0006-01
 *   - homicideRate  StatCan Homicide Survey, table 35-10-0068-01
 *   - lifeExpectancy StatCan complete life tables, table 13-10-0114-01
 *   - obesityRate   StatCan measured BMI (CCHS), table 13-10-0373-01
 *
 * Canada — Housing & Social (additional):
 *   - hospitalWaitTimes OECD.Stat HEALTH_PROC hip replacement median wait (days)
 *   - mentalHealthAccess OECD HEALTH_REAC psychiatrists per 100,000 population (CAN)
 *   - drugAddiction PHAC SubstanceHarmsData.csv opioid hospitalizations crude rate
 *   - medianGrossRent StatCan CMHC Rental Market Survey 34-10-0133-01 (avg 2BR, all CMAs)
 *   - schoolFunding StatCan education expenditures 37-10-0066-01 (CAD billions)
 *   - literacy      StatCan educational attainment 37-10-0130-01 (% ≥ upper secondary)
 *
 * United States — Economic (JSON APIs, no key required):
 *   - unemploymentRate     BLS API v2 series LNS14000000
 *   - cpiInflation         BLS API v2 series CUUR0000SA0 (CPI-U All Items, not seasonally adjusted)
 *   - drugOverdoseDeaths   CDC Socrata xkb8-kh2a (VSRR provisional)
 *   - federalAgencySpending USAspending.gov /api/v2/spending/
 *   - medianGrossRent      Census Bureau ACS 1-Year DP04_0134E
 *   - medianHomeValue      Census Bureau ACS 1-Year B25077_001E
 *   - bankRate             FRED FEDFUNDS (Effective Federal Funds Rate, monthly avg)
 *   - povertyRate          Census Bureau ACS 1-Year S1701_C03_001E
 *
 * United States — Safety & Health:
 *   - crimeRate            FBI CDE API summarized/national/violent-crime (cde.fbi.gov)
 *   - homicideRate         CDC NCHS VSRR Quarterly 489q-934x (age-adjusted, 12-month)
 *   - roadFatalities       NHTSA FARS / CDC NCHS nt65-c7a7 fallback
 *   - lifeExpectancy       CDC NCHS NVSR FTP Table01.xlsx (national life tables)
 *   - obesityRate          CDC BRFSS hn4x-zwk7 Q036 (adults with obesity, national)
 *   - hospitalWaitTimes    CMS Provider Data OP_18b median ED time (yv7e-xc69)
 *   - mentalHealthAccess   CDC PLACES swc5-untb DEPRESSION age-adjusted prevalence
 *   - drugAddiction        CDC NCHS VSRR Quarterly 489q-934x drug overdose death rate
 *
 * United States — Housing & Social:
 *   - homelessness         HUD AHAR PIT Count xlsb (2007–latest, national Total row)
 *   - newBuilds            FRED PERMIT (new privately-owned housing units authorised, SAAR)
 *   - graduationRate       Census ACS S1501_C02_014E (HS diploma or higher, adults 25+)
 *   - studentDebt          FRED SLOAS (total student loans outstanding, $ millions)
 *   - schoolFunding        NCES Digest Table 236.75 HTML (per-pupil current expenditure)
 *   - childPoverty         Census ACS S1701_C03_006E (% children in poverty)
 *   - immigration          Census ACS B05012_003E (total foreign-born population)
 *   - giniCoefficient      Census ACS B19083_001E (Gini coefficient, national)
 *   - minWageGap           FRED FEDMINNFRWG (federal minimum wage, $/hr)
 *   - literacy             Census ACS S1501_C02_015E (bachelor's degree or higher, 25+)
 *
 * United Kingdom (JSON/CSV APIs, no key required):
 *   - unemployment  ONS timeseries MGSX (ILO measure, seasonally adjusted)
 *   - CPI           ONS timeseries D7G7 (12-month rate)
 *   - homePrice     HM Land Registry HPI Linked Data API (average UK price)
 *   - bankRate      Bank of England IADB CSV API (series IUDBEDR) — returns CSV
 *
 * United Kingdom — Safety & Health (OHID Fingertips CSV + WHO GHO + DfT stream CSV):
 *   - crimeRate     OHID Fingertips indicator 11202 (violent crime/1k, police-recorded)
 *   - drugOverdoses OHID Fingertips indicator 92432 (drug deaths/100k, age-standardised)
 *   - homicideRate  WHO GHO VIOLENCE_HOMICIDERATE (UNODC intentional homicide/100k, GBR)
 *   - roadFatalities DfT dft-road-casualty-statistics-casualty-2023.csv (stream, sev=1)
 *   - lifeExpectancy WHO GHO WHOSIS_000001 (life expectancy at birth, both sexes, GBR)
 *   - obesityRate   OHID Fingertips indicator 93088 (overweight/obese adults 18+, HSE)
 *
 * United Kingdom — Housing & Social:
 *   - homelessness  MHCLG rough sleeping snapshot (gov.uk search → HTML report)
 *   - newBuilds     MHCLG housing supply indicators (gov.uk collection → HTML report)
 *   - graduationRate World Bank SE.TER.CUAT.BA.ZS (% adults 25+ with bachelor's+, GBR)
 *   - studentDebt   SLC student-loans-for-higher-and-further-education (gov.uk → HTML report)
 *   - childPoverty  OHID Fingertips indicator 93701 (children in poverty AHC %, DWP HBAI)
 *   - immigration   ONS LTIM provisional bulletin HTML (headline figure)
 *   - giniCoefficient ONS household income inequality bulletin → generator CSV
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
const inflateRaw = promisify(zlib.inflateRaw);

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

// ─── CANADA — SAFETY & HEALTH ─────────────────────────────────────────────────

/**
 * Shared in-memory ZIP/CSV fetcher for smaller StatCan tables (< ~50 MB compressed).
 * Uses inflateRaw; handles compressedSize=0 streaming ZIPs (inflateRaw ignores
 * trailing ZIP central-directory bytes after the DEFLATE end marker).
 */
async function fetchStatCanCSV(tableCode, label) {
  const url  = `https://www150.statcan.gc.ca/n1/tbl/csv/${tableCode}-eng.zip`;
  const resp = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const buf = Buffer.from(resp.data);
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error(`${label}: not a ZIP file`);
  const fnLen     = buf.readUInt16LE(26);
  const extLen    = buf.readUInt16LE(28);
  const compSize  = buf.readUInt32LE(18);
  const dataStart = 30 + fnLen + extLen;
  const compressed = buf.slice(dataStart, compSize > 0 ? dataStart + compSize : undefined);
  return (await inflateRaw(compressed)).toString('utf-8').replace(/^\uFEFF/, '');
}

/**
 * CA Crime Rate — Statistics Canada Police-reported crime, selected police services (table 35-10-0026-01)
 * Total Crime Severity Index for Canada, latest year. Index base year 2006=100.
 * Table 35-10-0026-01 contains a national Canada-level aggregate row with
 * Statistics = "Crime severity index". Only 320 KB compressed.
 * VALUE is at column index 10 (DGUID is present, shifting cols vs other StatCan tables).
 */
async function fetchCA_CrimeRate() {
  const csv = await fetchStatCanCSV('35100026', 'CA CSI');
  const lines  = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const statsIdx = header.findIndex(c => c === 'Statistics');

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[statsIdx] !== 'Crime severity index') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }

  if (bestValue === null) throw new Error('CA CSI: no Crime Severity Index found for Canada');
  return result('CA', 'crimeRate', bestValue, 'Crime Severity Index (2006=100)',
    bestDate,
    'Statistics Canada — Police-reported crime for selected police services, table 35-10-0026-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510002601');
}

/**
 * CA Drug Overdoses — PHAC Health Infobase Substance Harms Data
 * Total apparent opioid toxicity deaths, Canada, latest annual data.
 * Direct CSV download; no ZIP, no API key required.
 * URL: https://health-infobase.canada.ca/src/doc/SRHD/SubstanceHarmsData.csv
 */
async function fetchCA_DrugOverdoses() {
  const URL = 'https://health-infobase.canada.ca/src/doc/SRHD/SubstanceHarmsData.csv';
  const resp = await axios.get(URL, {
    timeout: 30000,
    responseType: 'text',
    headers: { 'User-Agent': BROWSER_UA },
  });
  const lines  = String(resp.data).replace(/^\uFEFF/, '').trim().split('\n');
  const header = parseCSVLine(lines[0]);

  // Column indices — structure: Substance,Source,Specific_Measure,Region,PRUID,
  //   Time_Period,Year_Quarter,Aggregator,Disaggregator,Unit,Value
  const subIdx  = header.findIndex(c => /substance/i.test(c));     // 0
  const srcIdx  = header.findIndex(c => /^source$/i.test(c));      // 1
  const smIdx   = header.findIndex(c => /specific_measure/i.test(c)); // 2
  const regIdx  = header.findIndex(c => /region/i.test(c));        // 3
  const tpIdx   = header.findIndex(c => /time_period/i.test(c));   // 5
  const yqIdx   = header.findIndex(c => /year_quarter/i.test(c));  // 6
  const aggIdx  = header.findIndex(c => /^aggregator$/i.test(c));  // 7
  const disIdx  = header.findIndex(c => /^disaggregator$/i.test(c)); // 8
  const unitIdx = header.findIndex(c => /^unit$/i.test(c));        // 9
  const valIdx  = header.findIndex(c => /^value$/i.test(c));       // 10

  let bestPeriod = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line);
    if (cols[subIdx]  !== 'Opioids')          continue;
    if (cols[srcIdx]  !== 'Deaths')            continue;
    if (cols[smIdx]   !== 'Overall numbers')   continue; // total, not breakdown
    if (!/canada/i.test(cols[regIdx] ?? ''))   continue;
    if (cols[tpIdx]   !== 'By year')           continue;
    if ((cols[aggIdx]  ?? '') !== '')           continue; // empty = no sub-aggregation
    if ((cols[disIdx]  ?? '') !== '')           continue; // empty = no disaggregation
    if (cols[unitIdx] !== 'Number')            continue; // count, not crude rate
    const yq  = cols[yqIdx] ?? '';
    const val = cols[valIdx];
    if (!val || val === '' || isNaN(parseFloat(val))) continue;
    if (yq > bestPeriod) { bestPeriod = yq; bestValue = parseFloat(val); }
  }

  if (bestValue === null) throw new Error('PHAC: no total opioid death count found for Canada (Overall numbers / By year / Number)');
  return result('CA', 'drugOverdoses', bestValue, 'apparent opioid toxicity deaths (annual total)',
    bestPeriod,
    'Public Health Agency of Canada — Substance-related Harms in Canada (Health Infobase)',
    'https://health-infobase.canada.ca/substance-related-harms/opioids-stimulants/',
    'Apparent accidental and undetermined opioid toxicity deaths; updated quarterly');
}

/**
 * CA Road Fatalities — Transport Canada National Collision Database (open.canada.ca)
 * Dynamically finds the latest English CSV year from the CKAN package, then streams
 * the file and counts rows where C_SEV = '1' (fatal collision severity).
 * Package: 1eb9eba7-71d1-4b30-9fb1-30cbdab7e63a
 */
async function fetchCA_RoadFatalities() {
  // Step 1: discover resources and find the latest English CSV year
  const pkgResp = await axios.get(
    'https://open.canada.ca/data/en/api/3/action/package_show',
    { params: { id: '1eb9eba7-71d1-4b30-9fb1-30cbdab7e63a' }, timeout: TIMEOUT_MS }
  );
  const resources = pkgResp.data?.result?.resources ?? [];
  const csvCandidates = resources
    .map(r => {
      const url = r.url ?? '';
      // Accept .csv files with English indicators (_en, dataset_en, or no language suffix)
      if (!url.toLowerCase().endsWith('.csv')) return null;
      if (url.includes('_fr') || url.includes('-fr') || url.includes('dataset_fr')) return null;
      // Extract 4-digit year from resource name or URL
      const m = (r.name ?? url).match(/\b(20\d{2}|19\d{2})\b/);
      return m ? { year: parseInt(m[1]), url } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.year - a.year);

  if (csvCandidates.length === 0) throw new Error('CA Road Fatalities: no English CSV found in TC CKAN package');
  const { year, url: csvUrl } = csvCandidates[0];

  // Step 2: stream CSV and count C_SEV = '1' (fatal collision) rows
  const resp = await axios.get(csvUrl, {
    responseType: 'stream',
    timeout: 120000,
    headers: { 'User-Agent': BROWSER_UA },
  });

  return new Promise((resolve, reject) => {
    let lineBuffer = '', header = null, sevIdx = -1, fatalCount = 0;

    function processText(text) {
      lineBuffer += text;
      const lines = lineBuffer.split('\n');
      lineBuffer  = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!header) {
          header = parseCSVLine(line);
          sevIdx = header.findIndex(c => c === 'C_SEV');
          continue;
        }
        // Fast split — TC collision CSVs use simple comma separation, no quoted fields
        const sev = line.split(',')[sevIdx] ?? '';
        if (sev === '1') fatalCount++;
      }
    }

    resp.data.on('data', chunk => processText(chunk.toString()));
    resp.data.on('end',  () => {
      processText('');
      if (fatalCount === 0) return reject(new Error(`CA Road Fatalities: C_SEV=1 count was 0 (year ${year})`));
      resolve(result(
        'CA', 'roadFatalities', fatalCount, `fatal road collisions (C_SEV=1, Transport Canada NCDB)`,
        String(year),
        `Transport Canada — National Collision Database ${year} (open.canada.ca)`,
        'https://open.canada.ca/data/dataset/1eb9eba7-71d1-4b30-9fb1-30cbdab7e63a',
        'Count of collisions where at least one fatality occurred (C_SEV=1); updated annually'
      ));
    });
    resp.data.on('error', reject);
  });
}

/**
 * CA Homicide Rate — Statistics Canada Homicide Survey (table 35-10-0068-01)
 * Homicide rate per 100,000 population, Canada, latest year.
 */
async function fetchCA_HomicideRate() {
  const csv    = await fetchStatCanCSV('35100068', 'CA Homicide');
  const lines  = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  // Dimension column is named "Homicides" in this table (not "Statistics")
  const statsIdx = header.findIndex(c => c === 'Homicides');

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes('Canada') || !line.toLowerCase().includes('rate')) continue;
    const cols = parseCSVLine(line);
    if (cols[geoIdx] !== 'Canada') continue;
    const statsVal = statsIdx >= 0 ? (cols[statsIdx] ?? '') : '';
    // Exact value: "Homicide rates per 100,000 population"
    if (!statsVal.toLowerCase().includes('homicide rates per')) continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }

  if (bestValue === null) throw new Error('CA Homicide Rate: no "Homicide rates per 100,000 population" found for Canada');
  return result('CA', 'homicideRate', bestValue, 'per 100,000 population',
    bestDate,
    'Statistics Canada — Homicide Survey, table 35-10-0068-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3510006801');
}

/**
 * CA Life Expectancy — Statistics Canada complete life tables (table 13-10-0114-01)
 * Life expectancy at birth, both sexes, Canada, latest three-year period.
 */
async function fetchCA_LifeExpectancy() {
  const csv    = await fetchStatCanCSV('13100114', 'CA Life Expectancy');
  const lines  = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const sexIdx   = header.findIndex(c => /^sex$/i.test(c));
  // Age column: "Age (x)" in StatCan life tables; value "0" = at birth
  const ageIdx   = header.findIndex(c => /^age/i.test(c) && c !== 'GEO');
  // Life table element column: "Life table functions" or "Statistics"
  const elemIdx  = header.findIndex(c =>
    /element|statistic|function|characteristic/i.test(c) && c !== 'GEO' && c !== 'VALUE'
  );

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes('Canada') || !line.toLowerCase().includes('expectanc')) continue;
    const cols = parseCSVLine(line);
    if (cols[geoIdx] !== 'Canada') continue;
    if (sexIdx  >= 0 && !/both/i.test(cols[sexIdx]  ?? '')) continue;
    if (ageIdx  >= 0) {
      const age = (cols[ageIdx] ?? '').trim();
      // Accept "0", "0 years", "At birth" — reject any other age
      if (!/^0$/.test(age) && !/^0 /.test(age) && !/birth/i.test(age)) continue;
    }
    if (elemIdx >= 0 && !cols[elemIdx]?.toLowerCase().includes('expectanc')) continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }

  if (bestValue === null) throw new Error('CA Life Expectancy: no at-birth value found for Canada (both sexes)');
  return result('CA', 'lifeExpectancy', bestValue, 'years (life expectancy at birth, both sexes)',
    bestDate,
    'Statistics Canada — Complete life tables, Canada, provinces and territories, table 13-10-0114-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1310011401');
}

/**
 * CA Obesity Rate — Statistics Canada measured BMI, CCHS (table 13-10-0373-01)
 * Obesity rate (BMI ≥ 30) for adults 18–79, both sexes, Canada, latest survey cycle.
 */
async function fetchCA_ObesityRate() {
  const csv    = await fetchStatCanCSV('13100373', 'CA Obesity');
  const lines  = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const sexIdx   = header.findIndex(c => /^sex$/i.test(c));
  const ageIdx   = header.findIndex(c => /^age/i.test(c) && c !== 'GEO');
  // "Measured characteristics" or similar — contains BMI category names
  const charIdx  = header.findIndex(c =>
    /characteristic|measure|bmi|weight/i.test(c) && c !== 'GEO' && c !== 'VALUE'
  );

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.includes('Canada') || !line.toLowerCase().includes('obe')) continue;
    const cols = parseCSVLine(line);
    if (cols[geoIdx] !== 'Canada') continue;
    if (sexIdx  >= 0 && !/both/i.test(cols[sexIdx]  ?? '')) continue;
    if (ageIdx  >= 0 && !cols[ageIdx]?.includes('18'))       continue; // adults 18–79
    if (charIdx >= 0) {
      const ch = (cols[charIdx] ?? '').toLowerCase();
      if (!ch.includes('obe')) continue;
      if (ch.includes('overweight')) continue; // skip combined "overweight and obese"
    }
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }

  if (bestValue === null) throw new Error('CA Obesity Rate: no adult obesity rate found for Canada (both sexes, 18–79)');
  return result('CA', 'obesityRate', bestValue, '% obese (BMI ≥ 30, adults 18–79, both sexes)',
    bestDate,
    'Statistics Canada — Direct measures of body weight and height (CCHS), table 13-10-0373-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1310037301');
}

// ─── CANADA — Housing & Social ────────────────────────────────────────────────

/**
 * CA Homelessness — Statistics Canada Shelter Capacity Survey (table 14-10-0353-01)
 * Number of beds in emergency shelters nationally; used as a proxy for shelter demand.
 * Filter: Emergency shelter, Total target population, Number of beds, Canada.
 * Columns (DGUID present): VALUE at index 12.
 */
async function fetchCA_Homelessness() {
  const csv = await fetchStatCanCSV('14100353', 'CA Homelessness');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const typeIdx  = header.findIndex(c => /type of shelter/i.test(c));
  const popIdx   = header.findIndex(c => /target population/i.test(c));
  const statIdx  = header.findIndex(c => /^statistics$/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[typeIdx] !== 'Emergency shelter') continue;
    if (cols[popIdx]  !== 'Total, target population') continue;
    if (cols[statIdx] !== 'Number of beds') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Homelessness: no emergency shelter bed count found');
  return result('CA', 'homelessness', bestValue, 'emergency shelter beds (capacity)',
    bestDate,
    'Statistics Canada — Shelter Capacity Survey, table 14-10-0353-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410035301',
    'Total number of beds in emergency shelters nationally (shelter capacity proxy)');
}

/**
 * CA New Builds — Statistics Canada / CMHC housing starts (table 34-10-0135-01)
 * Monthly total housing starts (all units), unadjusted, Canada.
 * Columns (DGUID present): Housing estimates(3) | Type of unit(4) | Seasonal adjustment(5) | VALUE(12)
 */
async function fetchCA_NewBuilds() {
  const csv = await fetchStatCanCSV('34100135', 'CA Housing Starts');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const estIdx   = header.findIndex(c => /housing estimates/i.test(c));
  const typeIdx  = header.findIndex(c => /type of unit/i.test(c));
  const seasIdx  = header.findIndex(c => /seasonal adjustment/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[estIdx]  !== 'Housing starts') continue;
    if (cols[typeIdx] !== 'Total units')    continue;
    if (cols[seasIdx] !== 'Unadjusted')     continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA New Builds: no housing starts found');
  return result('CA', 'newBuilds', bestValue, 'new housing starts (total units, monthly)',
    bestDate,
    'Statistics Canada / CMHC — Housing starts, under construction and completions, table 34-10-0135-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410013501');
}

/**
 * CA Graduation Rate — Statistics Canada education attainment by age group (table 37-10-0130-01)
 * Percentage of population aged 25–64 with at least upper secondary education (high school or above).
 * Columns (DGUID present): Education attainment level(3) | Age group(4) | Gender(5) | VALUE(12)
 */
async function fetchCA_GraduationRate() {
  const csv = await fetchStatCanCSV('37100130', 'CA Grad Rate');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const eduIdx   = header.findIndex(c => /education attainment/i.test(c));
  const ageIdx   = header.findIndex(c => /age group/i.test(c));
  const genIdx   = header.findIndex(c => /gender/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[eduIdx] !== 'Upper secondary or above') continue;
    if (cols[ageIdx] !== 'Total, 25 to 64 years')   continue;
    if (cols[genIdx] !== 'Total - Gender')           continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Grad Rate: no upper secondary attainment found');
  return result('CA', 'graduationRate', bestValue, '% adults (25–64) with upper secondary or above',
    bestDate,
    'Statistics Canada — Educational attainment of the population, table 37-10-0130-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3710013001',
    '% of 25–64 year olds with at least a high school diploma (upper secondary) per OECD definitions');
}

/**
 * CA Student Debt — Statistics Canada average government student loans (table 37-10-0046-01)
 * Average federal/provincial government student loan per Canadian undergraduate borrower (current dollars).
 * Columns (DGUID present): Level of study(3) | VALUE(10)
 */
async function fetchCA_StudentDebt() {
  const csv = await fetchStatCanCSV('37100046', 'CA Student Debt');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const lvlIdx   = header.findIndex(c => /level of study/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[lvlIdx] !== 'Canadian undergraduate') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Student Debt: no undergraduate loan amount found');
  return result('CA', 'studentDebt', bestValue, 'average government student loan per borrower (CAD)',
    bestDate,
    'Statistics Canada — Average government student loans, table 37-10-0046-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3710004601',
    'Average annual government (federal + provincial) student loan per Canadian undergraduate borrower');
}

/**
 * CA Child Poverty — Statistics Canada low income statistics by age (table 11-10-0135-01)
 * Percentage of persons under 18 years in low income using Low Income Measure after-tax (LIM-AT).
 * Columns (DGUID present): Persons in low income(3) | Low income lines(4) | Statistics(5) | VALUE(12)
 */
async function fetchCA_ChildPoverty() {
  const csv = await fetchStatCanCSV('11100135', 'CA Child Poverty');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const persIdx  = header.findIndex(c => /persons in low income/i.test(c));
  const lineIdx  = header.findIndex(c => /low income lines/i.test(c));
  const statIdx  = header.findIndex(c => /^statistics$/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[persIdx] !== 'Persons under 18 years') continue;
    if (cols[lineIdx] !== 'Low income measure after tax') continue;
    if (cols[statIdx] !== 'Percentage of persons in low income') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Child Poverty: no LIM-AT % found for under-18');
  return result('CA', 'childPoverty', bestValue, '% children under 18 in low income (LIM-AT)',
    bestDate,
    'Statistics Canada — Low income statistics by age, sex and economic family type, table 11-10-0135-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110013501',
    'Percentage of persons under 18 years in low income using Low Income Measure after tax (LIM-AT)');
}

/**
 * CA Immigration — Statistics Canada components of population change (table 17-10-0008-01)
 * Annual count of immigrants (permanent residents) admitted to Canada, latest fiscal year.
 * Columns (DGUID present): Components of population growth(3) | VALUE(10)
 */
async function fetchCA_Immigration() {
  const csv = await fetchStatCanCSV('17100008', 'CA Immigration');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const compIdx  = header.findIndex(c => /components of population/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[compIdx] !== 'Immigrants') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Immigration: no immigrant count found');
  return result('CA', 'immigration', bestValue, 'immigrants admitted (persons)',
    bestDate,
    'Statistics Canada — Components of population change, table 17-10-0008-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1710000801');
}

/**
 * CA Gini Coefficient — Statistics Canada income distribution (table 11-10-0134-01)
 * Gini coefficient of adjusted after-tax income, Canada, latest year.
 * Columns (DGUID present): Income concept(3) | VALUE(10)
 */
async function fetchCA_GiniCoefficient() {
  const csv = await fetchStatCanCSV('11100134', 'CA Gini');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx   = header.findIndex(c => c === 'GEO');
  const dateIdx  = header.findIndex(c => c === 'REF_DATE');
  const valueIdx = header.findIndex(c => c === 'VALUE');
  const incIdx   = header.findIndex(c => /income concept/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada')) continue;
    if (cols[incIdx] !== 'Adjusted after-tax income') continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Gini: no after-tax Gini found');
  return result('CA', 'giniCoefficient', bestValue, 'Gini coefficient (adjusted after-tax income)',
    bestDate,
    'Statistics Canada — Gini coefficients of adjusted market, total and after-tax income, table 11-10-0134-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1110013401');
}

/**
 * CA Minimum Wage — Employment & Social Development Canada federal minimum wage
 * Current federal minimum wage (CAD/hr), via open.canada.ca CKAN datastore.
 * Resource: 2ddfbfd4-8347-467d-b6d5-797c5421f4fb  Jurisdiction code: FJ
 * Date format: "DD-Mon-YY"  (2-digit year: <50 → 2000+, ≥50 → 1900+)
 */
async function fetchCA_MinWageGap() {
  const resp = await axios.get(
    'https://open.canada.ca/data/en/api/3/action/datastore_search',
    {
      params: {
        resource_id: '2ddfbfd4-8347-467d-b6d5-797c5421f4fb',
        filters: JSON.stringify({ Jurisdiction: 'FJ' }),
        limit: 200,
      },
      timeout: TIMEOUT_MS,
    }
  );
  const records = resp.data?.result?.records ?? [];
  if (records.length === 0) throw new Error('CA MinWage: no federal jurisdiction records found');

  const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  function parseWageDate(ds) {
    const [d, m, y] = (ds ?? '').split('-');
    if (!d || !m || !y) return new Date(0);
    const yr = parseInt(y);
    return new Date(yr < 50 ? 2000 + yr : 1900 + yr, MONTHS[m] ?? 0, parseInt(d));
  }

  // Sort by actual date descending; skip rows with 'NA' wages
  records.sort((a, b) => parseWageDate(b['Effective Date']) - parseWageDate(a['Effective Date']));
  const latest = records.find(r => r['Minimum Wage'] && r['Minimum Wage'] !== 'NA');
  if (!latest) throw new Error('CA MinWage: no valid federal minimum wage found');

  const rateNum = safeNum(latest['Minimum Wage']);
  if (rateNum === null) throw new Error(`CA MinWage: cannot parse rate "${latest['Minimum Wage']}"`);
  const iso = parseWageDate(latest['Effective Date']).toISOString().slice(0, 10);

  return result('CA', 'minWageGap', rateNum, 'federal minimum wage (CAD/hr)',
    iso,
    'Employment and Social Development Canada — General Historical Minimum Wage (Federal Jurisdiction)',
    'https://open.canada.ca/data/en/dataset/390ee890-59bb-4f34-a37c-9732781ef8a0');
}

// ─── CANADA — Housing & Social (additional) ───────────────────────────────────

/**
 * CA Hospital Wait Times — OECD.Stat HEALTH_PROC (hip replacement median wait, days)
 * Median wait time for total hip replacement in Canada (days from referral to procedure).
 * OECD SDMX-JSON: REF_AREA=CAN, MEASURE=WAIT_MEDIAN, MEDICAL_PROCEDURE=CM8151_8153
 */
async function fetchCA_HospitalWaitTimes() {
  const URL = 'https://stats.oecd.org/sdmx-json/data/HEALTH_PROC/CAN.WAIT_MEDIAN.../all?startTime=2022&endTime=2024&dimensionAtObservation=allDimensions';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
  const d       = resp.data?.data ?? resp.data;
  const structs = d.structures ?? [];
  const ds      = (d.dataSets ?? [])[0];
  if (!ds) throw new Error('CA HospitalWaitTimes: no dataSets in OECD HEALTH_PROC response');

  const seriesDims = structs[0]?.dimensions?.series ?? [];
  const obsDims    = structs[0]?.dimensions?.observation ?? [];
  const timeDim    = obsDims.find(dd => dd.id === 'TIME_PERIOD');
  const timeVals   = (timeDim?.values ?? []).map(v => v.id);

  const refAreaDim = seriesDims.find(dd => dd.id === 'REF_AREA');
  const measureDim = seriesDims.find(dd => dd.id === 'MEASURE');
  const procDim    = seriesDims.find(dd => dd.id === 'MEDICAL_PROCEDURE');
  const canIdx     = (refAreaDim?.values ?? []).findIndex(v => v.id === 'CAN');
  const medianIdx  = (measureDim?.values ?? []).findIndex(v => v.id === 'WAIT_MEDIAN');
  const hipIdx     = (procDim?.values ?? []).findIndex(v => v.id === 'CM8151_8153');
  const refPos  = seriesDims.findIndex(dd => dd.id === 'REF_AREA');
  const measPos = seriesDims.findIndex(dd => dd.id === 'MEASURE');
  const procPos = seriesDims.findIndex(dd => dd.id === 'MEDICAL_PROCEDURE');

  if (canIdx < 0 || medianIdx < 0 || hipIdx < 0) throw new Error('CA HospitalWaitTimes: CAN/WAIT_MEDIAN/CM8151_8153 not found in OECD HEALTH_PROC dimensions');

  let bestTime = '', bestVal = null;
  for (const [key, val] of Object.entries(ds.series ?? {})) {
    const parts = key.split(':').map(Number);
    if (parts[refPos] !== canIdx)   continue;
    if (parts[measPos] !== medianIdx) continue;
    if (parts[procPos] !== hipIdx)   continue;
    for (const [obsKey, obsVal] of Object.entries(val.observations ?? {})) {
      const t = timeVals[parseInt(obsKey)] ?? '';
      if (t > bestTime) { bestTime = t; bestVal = obsVal[0]; }
    }
  }
  if (bestVal === null) throw new Error('CA HospitalWaitTimes: no hip replacement median wait found');
  return result('CA', 'hospitalWaitTimes', bestVal,
    'median days from referral to total hip replacement procedure (Canada)',
    bestTime,
    'OECD Health Statistics — HEALTH_PROC WAIT_MEDIAN hip replacement (CM8151_8153)',
    URL,
    'Median days from specialist referral to procedure (total hip replacement); OECD Health Statistics');
}

/**
 * CA Mental Health Access — OECD HEALTH_REAC: psychiatrists per 100,000 population (Canada)
 * VAR=EMPLPSYS (practising psychiatrists), UNIT=DENSPPNB (density per 1,000 pop), COU=CAN
 * Multiply by 100 to express as per 100,000.
 */
async function fetchCA_MentalHealthAccess() {
  const URL = 'https://stats.oecd.org/sdmx-json/data/HEALTH_REAC/CAN.PSYADM.PT_POP/all?startTime=2018&endTime=2023&dimensionAtObservation=allDimensions';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
  const d       = resp.data?.data ?? resp.data;
  const structs = d.structures ?? [];
  const ds      = (d.dataSets ?? [])[0];
  if (!ds) throw new Error('CA MentalHealthAccess: no dataSets in OECD HEALTH_REAC response');

  const seriesDims = structs[0]?.dimensions?.series ?? [];
  const obsDims    = structs[0]?.dimensions?.observation ?? [];
  const timeDim    = obsDims.find(dd => dd.id === 'TIME_PERIOD');
  const timeVals   = (timeDim?.values ?? []).map(v => v.id);

  const varDim  = seriesDims.find(dd => dd.id === 'VAR');
  const unitDim = seriesDims.find(dd => dd.id === 'UNIT');
  const couDim  = seriesDims.find(dd => dd.id === 'COU');
  const psyIdx  = (varDim?.values ?? []).findIndex(v => v.id === 'EMPLPSYS');
  const denIdx  = (unitDim?.values ?? []).findIndex(v => v.id === 'DENSPPNB');
  const canIdx  = (couDim?.values ?? []).findIndex(v => v.id === 'CAN');
  const varPos  = seriesDims.findIndex(dd => dd.id === 'VAR');
  const unitPos = seriesDims.findIndex(dd => dd.id === 'UNIT');
  const couPos  = seriesDims.findIndex(dd => dd.id === 'COU');

  if (psyIdx < 0 || denIdx < 0 || canIdx < 0) throw new Error('CA MentalHealthAccess: EMPLPSYS/DENSPPNB/CAN not found in OECD HEALTH_REAC dimensions');

  let bestTime = '', bestVal = null;
  for (const [key, val] of Object.entries(ds.series ?? {})) {
    const parts = key.split(':').map(Number);
    if (parts[varPos]  !== psyIdx) continue;
    if (parts[unitPos] !== denIdx) continue;
    if (parts[couPos]  !== canIdx) continue;
    for (const [obsKey, obsVal] of Object.entries(val.observations ?? {})) {
      const t = timeVals[parseInt(obsKey)] ?? '';
      if (t > bestTime) { bestTime = t; bestVal = obsVal[0]; }
    }
  }
  if (bestVal === null) throw new Error('CA MentalHealthAccess: no psychiatrist density found for Canada');
  const per100k = Math.round(bestVal * 100 * 10) / 10;
  return result('CA', 'mentalHealthAccess', per100k,
    'practising psychiatrists per 100,000 population (Canada)',
    bestTime,
    'OECD Health Statistics — HEALTH_REAC EMPLPSYS density per 1,000 population (CAN)',
    URL,
    'Practising psychiatrists per 100,000 population; density from OECD Health at a Glance (HEALTH_REAC EMPLPSYS DENSPPNB)');
}

/**
 * CA Drug Addiction — PHAC Health Infobase Substance Harms Data
 * Opioid-related hospitalizations (crude rate per 100,000), Canada, latest annual year.
 * Same CSV as drugOverdoses; different Source filter (Hospitalizations vs Deaths).
 */
async function fetchCA_DrugAddiction() {
  const URL  = 'https://health-infobase.canada.ca/src/doc/SRHD/SubstanceHarmsData.csv';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const lines = String(resp.data).split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CA DrugAddiction: empty PHAC SubstanceHarmsData.csv');

  const header = parseCSVLine(lines[0]);
  const substanceIdx = header.findIndex(c => c === 'Substance');
  const sourceIdx    = header.findIndex(c => c === 'Source');
  const measureIdx   = header.findIndex(c => c === 'Specific_Measure');
  const regionIdx    = header.findIndex(c => c === 'Region');
  const timePeriodIdx= header.findIndex(c => c === 'Time_Period');
  const yearQtrIdx   = header.findIndex(c => c === 'Year_Quarter');
  const aggIdx       = header.findIndex(c => c === 'Aggregator');
  const disaggIdx    = header.findIndex(c => c === 'Disaggregator');
  const unitIdx      = header.findIndex(c => c === 'Unit');
  const valueIdx     = header.findIndex(c => c === 'Value');

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (cols[substanceIdx] !== 'Opioids')          continue;
    if (cols[sourceIdx]    !== 'Hospitalizations')  continue;
    if (cols[measureIdx]   !== 'Overall numbers')   continue;
    if (cols[regionIdx]    !== 'Canada')            continue;
    if (cols[timePeriodIdx] !== 'By year')          continue;
    if (cols[aggIdx] || cols[disaggIdx])            continue; // skip disaggregated
    if (cols[unitIdx]      !== 'Crude rate')        continue;
    const date = cols[yearQtrIdx], val = parseFloat(cols[valueIdx]);
    if (!date || isNaN(val)) continue;
    // year-only dates sort correctly as strings; skip "(Jan to Sep)" partial years
    if (date.includes('(')) continue;
    if (date > bestDate) { bestDate = date; bestValue = val; }
  }
  if (bestValue === null) throw new Error('CA DrugAddiction: no opioid hospitalization crude rate found');
  return result('CA', 'drugAddiction', bestValue,
    'opioid-related hospitalizations (crude rate per 100,000 population, Canada)',
    bestDate,
    'PHAC Health Infobase — Opioid- and Stimulant-related Harms in Canada (SubstanceHarmsData.csv)',
    URL,
    'Opioid-related hospitalizations, crude rate per 100,000 population; annual; distinct from opioid deaths (drugOverdoses)');
}

/**
 * CA Median Gross Rent — Statistics Canada CMHC Rental Market Survey (table 34-10-0133-01)
 * Simple average of two-bedroom private apartment rents across all CMAs/urban centres, latest year.
 * Table is ~10 MB uncompressed; streamed via inflateRaw.
 * Columns: REF_DATE(0) GEO(1) DGUID(2) Type of structure(3) Type of unit(4) ... VALUE(11)
 */
async function fetchCA_MedianGrossRent() {
  const resp = await axios({
    method: 'GET',
    url: 'https://www150.statcan.gc.ca/n1/tbl/csv/34100133-eng.zip',
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
    // date -> {sum, count} for average rent
    const rentByDate = {};
    let finished = false;

    function finish(err) {
      if (finished) return;
      finished = true;
      source.destroy();
      if (err) return reject(err);
      const dates = Object.keys(rentByDate).sort().reverse();
      if (dates.length === 0) return reject(new Error('CA MedianGrossRent: no two-bedroom rent data found'));
      const latest = dates[0];
      const { sum, count } = rentByDate[latest];
      const avg = Math.round(sum / count);
      return resolve(result('CA', 'medianGrossRent', avg,
        'average monthly rent, 2-bedroom private apartments, all CMAs (CAD)',
        latest,
        'Statistics Canada / CMHC — Rental Market Survey, table 34-10-0133-01',
        'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3410013301',
        'Simple average of 2-bedroom row/apt rents across all Canadian urban centres surveyed; no Canada-level aggregate in source table'));
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
            date:      cols.findIndex(c => c === 'REF_DATE'),
            structure: cols.findIndex(c => /type of structure/i.test(c)),
            unit:      cols.findIndex(c => /type of unit/i.test(c)),
            value:     cols.findIndex(c => c === 'VALUE'),
          };
          continue;
        }
        // Quick scan — skip rows that clearly don't match
        if (!line.includes('Row and apartment') || !line.includes('Two bedroom')) continue;
        const cols = parseCSVLine(line);
        if (!cols[colIdx.structure]?.includes('Row and apartment')) continue;
        if (cols[colIdx.unit] !== 'Two bedroom units') continue;
        const val  = parseFloat(cols[colIdx.value]);
        const date = cols[colIdx.date];
        if (isNaN(val) || val === 0 || !date) continue;
        if (!rentByDate[date]) rentByDate[date] = { sum: 0, count: 0 };
        rentByDate[date].sum   += val;
        rentByDate[date].count += 1;
      }
    }

    inflater.on('data', chunk => processChunk(chunk));
    inflater.on('end',  () => finish(null));
    inflater.on('error', () => finish(null));

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
 * CA School Funding — Statistics Canada education expenditures (table 37-10-0066-01)
 * Total public and private elementary and secondary education expenditures, Canada, latest year.
 * Value in thousands of dollars; SCALAR_FACTOR=thousands means multiply VALUE×1000 for total dollars.
 */
async function fetchCA_SchoolFunding() {
  const csv   = await fetchStatCanCSV('37100066', 'CA SchoolFunding');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx    = header.findIndex(c => c === 'GEO');
  const dateIdx   = header.findIndex(c => c === 'REF_DATE');
  const valueIdx  = header.findIndex(c => c === 'VALUE');
  const typeIdx   = header.findIndex(c => /type of expenditures/i.test(c));
  const scalarIdx = header.findIndex(c => /scalar_factor/i.test(c));

  const TARGET = 'Public and private elementary and secondary education expenditures';
  let bestDate = '', bestValue = null, bestScalar = 'thousands';
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (cols[geoIdx]  !== 'Canada')  continue;
    if (cols[typeIdx] !== TARGET)    continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); bestScalar = cols[scalarIdx] || 'thousands'; }
  }
  if (bestValue === null) throw new Error('CA SchoolFunding: no education expenditure found');
  // Convert to billions: value is in thousands of dollars
  const scaleFactor = bestScalar === 'thousands' ? 1000 : bestScalar === 'millions' ? 1e6 : 1;
  const totalDollars = bestValue * scaleFactor;
  const billions = parseFloat((totalDollars / 1e9).toFixed(2));
  return result('CA', 'schoolFunding', billions,
    'total public & private elementary/secondary education expenditures (CAD billions)',
    bestDate,
    'Statistics Canada — Elementary and secondary school expenditures, table 37-10-0066-01',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3710006601',
    'Includes public and private elementary and secondary education expenditures; current dollars');
}

/**
 * CA Literacy — Statistics Canada educational attainment (table 37-10-0130-01)
 * Percentage of adults aged 25–64 with upper secondary or above (high school completion rate proxy).
 * Same table as graduationRate; different education level filter.
 * Source: OECD Education at a Glance (EAG), re-published by Statistics Canada.
 */
async function fetchCA_Literacy() {
  const csv   = await fetchStatCanCSV('37100130', 'CA Literacy');
  const lines = csv.split('\n');
  const header = parseCSVLine(lines[0]);
  const geoIdx  = header.findIndex(c => c === 'GEO');
  const dateIdx = header.findIndex(c => c === 'REF_DATE');
  const valueIdx= header.findIndex(c => c === 'VALUE');
  const eduIdx  = header.findIndex(c => /education attainment/i.test(c));
  const ageIdx  = header.findIndex(c => /age group/i.test(c));
  const genIdx  = header.findIndex(c => /gender/i.test(c));

  let bestDate = '', bestValue = null;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i].trim());
    if (!cols[geoIdx]?.startsWith('Canada'))                   continue;
    if (cols[eduIdx] !== 'Upper secondary or above')           continue;
    if (cols[ageIdx] !== 'Total, 25 to 64 years')             continue;
    if (cols[genIdx] !== 'Total - Gender')                     continue;
    const val = cols[valueIdx], date = cols[dateIdx];
    if (!val || val === '..' || val === '' || !date) continue;
    if (date > bestDate) { bestDate = date; bestValue = parseFloat(val); }
  }
  if (bestValue === null) throw new Error('CA Literacy: no upper-secondary attainment found');
  return result('CA', 'literacy', bestValue,
    '% adults (25–64) with upper secondary or above (high school completion proxy)',
    bestDate,
    'Statistics Canada — Educational attainment of the population, table 37-10-0130-01 (OECD EAG)',
    'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3710013001',
    '% of 25–64 year olds with at least upper secondary education; used as literacy proxy (PIAAC data not available via API)');
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
    { timeout: 60000 }   // BLS public API can be slow; use generous timeout
  );
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) throw new Error('BLS: no data for LNS14000000');
  const val    = safeNum(latest.value);
  const period = `${latest.periodName} ${latest.year}`;
  return result(
    'US', 'unemploymentRate', val, '% (seasonally adjusted)',
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
    { timeout: 60000 }   // BLS public API can be slow; use generous timeout
  );
  const latest = resp.data?.Results?.series?.[0]?.data?.[0];
  if (!latest) throw new Error('BLS: no data for CUUR0000SA0');
  const val    = safeNum(latest.value);
  const period = `${latest.periodName} ${latest.year}`;
  return result(
    'US', 'cpiInflation', val, 'index (1982-84=100, not seasonally adjusted)',
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
    'US', 'drugOverdoseDeaths', val, 'deaths (provisional monthly count)',
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
        'US', 'federalAgencySpending', trillions, `USD trillions (${results.length} agencies, ${label})`,
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
        'US', 'medianGrossRent', val, '$/month (median gross rent)',
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

/**
 * US Median Home Value — Census Bureau ACS 1-Year API
 * Variable B25077_001E: Median value (dollars) of owner-occupied housing units.
 * Tries the two most recent available ACS 1-Year vintages.
 */
async function fetchUS_MedianHomeValue() {
  const CURRENT_YEAR = new Date().getFullYear();
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const resp = await axios.get(
        `https://api.census.gov/data/${yr}/acs/acs1?get=B25077_001E,NAME&for=us:1`,
        { timeout: TIMEOUT_MS }
      );
      if (!Array.isArray(resp.data) || resp.data.length < 2) continue;
      const headers = resp.data[0];
      const vals    = resp.data[1];
      const idx     = headers.indexOf('B25077_001E');
      const val     = safeNum(vals[idx]);
      if (val == null || val <= 0) continue;
      return result(
        'US', 'medianHomeValue', val, 'USD (median owner-occupied home value)',
        String(yr),
        `U.S. Census Bureau — ACS 1-Year ${yr}, variable B25077_001E`,
        `https://api.census.gov/data/${yr}/acs/acs1?get=B25077_001E&for=us:1`
      );
    } catch (err) {
      console.warn(`  Census ACS B25077 ${yr} failed: ${err.message?.slice(0, 60)}`);
    }
  }
  throw new Error('Census ACS: no median home value data found');
}

/**
 * US Bank Rate (Federal Funds Rate) — Federal Reserve / FRED public CSV
 * Series FEDFUNDS: Effective Federal Funds Rate (monthly average, %).
 * No API key required; FRED public CSV endpoint.
 */
async function fetchUS_BankRate() {
  const URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
    responseType: 'text',
  });
  const lines = String(resp.data).trim().split('\n').filter(l => l.trim() && !l.startsWith('DATE'));
  if (lines.length === 0) throw new Error('US BankRate: empty FRED FEDFUNDS response');
  // Find the latest non-null value scanning from end
  let bestDate = '', bestVal = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const [date, val] = lines[i].split(',');
    const v = parseFloat(val);
    if (!isNaN(v) && v >= 0) { bestDate = date?.trim(); bestVal = v; break; }
  }
  if (bestVal === null) throw new Error('US BankRate: no valid FEDFUNDS value found');
  return result(
    'US', 'bankRate', bestVal, '% (effective federal funds rate, monthly avg)',
    bestDate,
    'Federal Reserve — Effective Federal Funds Rate (FRED series FEDFUNDS)',
    URL,
    'Monthly average of daily effective federal funds rate; set by FOMC'
  );
}

/**
 * US Poverty Rate — Census Bureau ACS 1-Year Subject Tables API
 * Variable S1701_C03_001E: Percent below poverty level, all persons.
 * Tries the two most recent available ACS 1-Year vintages.
 */
async function fetchUS_PovertyRate() {
  const CURRENT_YEAR = new Date().getFullYear();
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3]) {
    try {
      const resp = await axios.get(
        `https://api.census.gov/data/${yr}/acs/acs1/subject?get=S1701_C03_001E,NAME&for=us:1`,
        { timeout: TIMEOUT_MS }
      );
      if (!Array.isArray(resp.data) || resp.data.length < 2) continue;
      const headers = resp.data[0];
      const vals    = resp.data[1];
      const idx     = headers.indexOf('S1701_C03_001E');
      const val     = safeNum(vals[idx]);
      if (val == null || val < 0) continue;
      return result(
        'US', 'povertyRate', val, '% of population below poverty level',
        String(yr),
        `U.S. Census Bureau — ACS 1-Year ${yr}, S1701 Poverty Status in the Past 12 Months`,
        `https://api.census.gov/data/${yr}/acs/acs1/subject?get=S1701_C03_001E&for=us:1`
      );
    } catch (err) {
      console.warn(`  Census ACS S1701 ${yr} failed: ${err.message?.slice(0, 60)}`);
    }
  }
  throw new Error('Census ACS: no poverty rate data found');
}

// ─── UNITED STATES — Safety & Health ─────────────────────────────────────────

/**
 * US Crime Rate — FBI Uniform Crime Reporting / Crime Data Explorer API
 * National violent crime rate per 100,000 population.
 * Source: https://cde.fbi.gov/api/summarized/national/violent-crime
 */
async function fetchUS_CrimeRate() {
  const URL = 'https://cde.fbi.gov/api/summarized/national/violent-crime?from=2020&to=2023';
  const resp = await axios.get(URL, {
    timeout: 60000,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const data = Array.isArray(resp.data) ? resp.data : (resp.data?.data ?? []);
  if (!data.length) throw new Error('FBI CDE: no violent crime data returned');
  const sorted = [...data].sort((a, b) => b.data_year - a.data_year);
  const latest = sorted[0];
  const rate = safeNum(latest.rate);
  if (rate == null) throw new Error('FBI CDE: could not parse violent crime rate');
  return result(
    'US', 'crimeRate', rate, 'violent crimes per 100,000 population',
    String(latest.data_year),
    'FBI Uniform Crime Reporting — National Violent Crime Rate (UCR/NIBRS)',
    URL,
    'Includes murder, non-negligent manslaughter, rape, robbery, aggravated assault'
  );
}

/**
 * US Homicide Rate — CDC NCHS VSRR Quarterly Provisional Estimates
 * Dataset 489q-934x: cause_of_death=Homicide, rate_type=Age-adjusted.
 * 12-month age-adjusted homicide death rate per 100,000 population.
 */
async function fetchUS_HomicideRate() {
  const BASE = 'https://data.cdc.gov/resource/489q-934x.json';
  const resp = await axios.get(BASE, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
    params: {
      cause_of_death: 'Homicide',
      time_period: '12 months ending with quarter',
      rate_type: 'Age-adjusted',
      '$order': 'year_and_quarter DESC',
      '$limit': 5,
    },
  });
  const rows = resp.data ?? [];
  const best = rows.find(r => r.rate_overall && parseFloat(r.rate_overall) > 0);
  if (!best) throw new Error('CDC VSRR 489q: no homicide rate found');
  const val = parseFloat(parseFloat(best.rate_overall).toFixed(1));
  return result(
    'US', 'homicideRate', val,
    'homicide deaths per 100,000 population (age-adjusted, 12-month)',
    best.year_and_quarter,
    'CDC NCHS — VSRR Quarterly Provisional Estimates (489q-934x)',
    'https://data.cdc.gov/resource/489q-934x.json',
    '12-month age-adjusted provisional homicide death rate; latest complete quarter'
  );
}

/**
 * US Road Fatalities — NHTSA Fatality Analysis Reporting System (FARS)
 * Fetches total annual traffic fatalities from the NHTSA FARS API.
 * Iterates years from most-recent-2 back to 2018 to find the latest available data.
 * Falls back to CDC NCHS Injury Mortality (nt65-c7a7, Motor vehicle traffic) if blocked.
 */
async function fetchUS_RoadFatalities() {
  const CURRENT_YEAR = new Date().getFullYear();
  // Try NHTSA FARS API for recent years (data typically 2 years behind)
  for (const yr of [CURRENT_YEAR - 2, CURRENT_YEAR - 3, CURRENT_YEAR - 4]) {
    try {
      // FARS GetCrashesByState with state=0 (national), aggregate deaths
      const resp = await axios.get(`https://api.nhtsa.gov/FARS/${yr}/GetCrashesByState`, {
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
        params: { state: 0 },
      });
      const data = resp.data?.Results ?? resp.data?.results ?? resp.data;
      if (Array.isArray(data) && data.length > 0) {
        // Sum fatalities across all entries if state-level
        const totalFatalities = data.reduce((s, r) => s + (parseInt(r.TotalFatalities ?? r.totalfatalities ?? r.fatalities ?? 0)), 0);
        if (totalFatalities > 0) {
          return result(
            'US', 'roadFatalities', totalFatalities,
            'annual road traffic fatalities',
            String(yr),
            'NHTSA — Fatality Analysis Reporting System (FARS)',
            `https://api.nhtsa.gov/FARS/${yr}/GetCrashesByState`,
            'NHTSA FARS official annual traffic fatality count'
          );
        }
      }
    } catch (_) { /* try next year */ }
  }
  // Fallback: CDC NCHS Injury Mortality — Motor vehicle traffic, Unintentional, All Ages
  const BASE = 'https://data.cdc.gov/resource/nt65-c7a7.json';
  const resp2 = await axios.get(BASE, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
    params: {
      injury_mechanism: 'Motor vehicle traffic',
      injury_intent: 'Unintentional',
      sex: 'Both sexes',
      race: 'All races',
      age_years: 'All Ages',
      '$order': 'year DESC',
      '$limit': 1,
    },
  });
  const row = resp2.data?.[0];
  if (!row) throw new Error('CDC NCHS: no motor vehicle traffic death data found');
  const deaths = parseInt(row.deaths);
  if (!deaths) throw new Error('CDC NCHS: could not parse motor vehicle deaths');
  return result(
    'US', 'roadFatalities', deaths,
    'annual road traffic fatalities',
    row.year,
    'CDC NCHS — Injury Mortality: United States, nt65-c7a7 (Motor vehicle traffic, Unintentional)',
    'https://data.cdc.gov/resource/nt65-c7a7.json',
    'CDC NCHS injury mortality; latest year available in dataset'
  );
}

/**
 * US Life Expectancy — CDC NCHS National Vital Statistics Reports (NVSR)
 * Parses the most recent "United States Life Tables" Excel file from CDC FTP.
 * Life expectancy at birth (both sexes, all races) is in row 4, column index 6
 * of Table01.xlsx in the latest NVSR volume directory (e.g. NVSR/74-06/).
 * The file is an xlsx (ZIP+XML), parsed with built-in Node.js zlib.
 */
async function fetchUS_LifeExpectancy() {
  const FTP_BASE = 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR/';

  // Parse a ZIP buffer into a map of entry name → decompressed Buffer
  function parseZipEntries(buf) {
    const entries = {};
    let i = 0;
    while (i < buf.length - 4) {
      if (buf.readUInt32LE(i) === 0x04034b50) {
        const method   = buf.readUInt16LE(i + 8);
        const compSize = buf.readUInt32LE(i + 18);
        const fnLen    = buf.readUInt16LE(i + 26);
        const exLen    = buf.readUInt16LE(i + 28);
        const name     = buf.slice(i + 30, i + 30 + fnLen).toString('utf8');
        const dataStart = i + 30 + fnLen + exLen;
        const compressed = buf.slice(dataStart, dataStart + compSize);
        if (method === 0) entries[name] = compressed;
        else if (method === 8) {
          try { entries[name] = zlib.inflateRawSync(compressed); } catch (_) {}
        }
        i = dataStart + compSize;
      } else i++;
    }
    return entries;
  }

  const FTP_HOST = 'https://ftp.cdc.gov';

  // Get directory listing to find available NVSR volumes
  const listResp = await axios.get(FTP_BASE, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  // HREFs are root-relative paths like /pub/.../NVSR/74-06/ — prepend host to make absolute
  const hrefRe = /HREF="([^"]+\/NVSR\/(\d+-\d+)\/)"(?!.*Parent)/gi;
  const dirMatches = [];
  let hm;
  while ((hm = hrefRe.exec(listResp.data)) !== null) dirMatches.push(FTP_HOST + hm[1]);
  if (!dirMatches.length) throw new Error('CDC NVSR FTP: could not list NVSR directories');

  // Try candidate NVSR dirs in reverse (most recent first), skip state-level dirs (e.g. 73-07)
  const candidates = dirMatches.slice().reverse();

  for (const dirUrl of candidates) {
    try {
      const dirList = await axios.get(dirUrl, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
      // Find Table01.xlsx (national life tables) — skip if only state-code files (e.g. AK1.xlsx)
      const fileRe2 = /HREF="([^"]+\.xlsx)"/gi;
      const files = [];
      let fm2;
      while ((fm2 = fileRe2.exec(dirList.data)) !== null) files.push(fm2[1]);
      const tblFile = files.find(f => /table0?1\.xlsx$/i.test(f.split('/').pop()));
      if (!tblFile) continue;

      const xlsxResp = await axios.get(FTP_HOST + tblFile, {
        timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': BROWSER_UA },
      });
      const entries = parseZipEntries(Buffer.from(xlsxResp.data));
      const ss  = entries['xl/sharedStrings.xml']?.toString('utf8') ?? '';
      const strings = (ss.match(/<t[^>]*>([^<]*)<\/t>/g) ?? []).map(m => m.replace(/<[^>]+>/g, ''));
      const s1  = entries['xl/worksheets/sheet1.xml']?.toString('utf8') ?? '';
      const rowMatches = s1.match(/<row[^>]*>.*?<\/row>/gs) ?? [];

      // Row index 3 (0-based) = first data row (age 0). Last numeric column = ex (LE at birth).
      for (let ri = 2; ri < Math.min(rowMatches.length, 6); ri++) {
        const row = rowMatches[ri];
        const cells = [];
        for (const cell of (row.match(/<c[^>]*>.*?<\/c>/gs) ?? [])) {
          const isStr = /t="s"/.test(cell);
          const v = cell.match(/<v>([^<]+)<\/v>/)?.[1];
          cells.push(v != null ? (isStr ? (strings[parseInt(v)] ?? '') : v) : '');
        }
        // Find last numeric cell (should be ex, life expectancy column)
        const numericCells = cells.filter(c => /^\d{2,3}\.\d/.test(c));
        if (numericCells.length === 0) continue;
        const leVal = parseFloat(numericCells[numericCells.length - 1]);
        if (leVal > 60 && leVal < 100) {
          // Extract NVSR volume from dir URL to approximate data year
          const volMatch = dirUrl.match(/NVSR\/(\d+)-(\d+)\//);
          const nvsr = volMatch ? `NVSR ${volMatch[1]}, No. ${volMatch[2]}` : dirUrl;
          // NVSR 72-12 = US Life Tables 2021 (76.4 yrs), NVSR 74-06 = 2023 (78.4 yrs)
          // Data year = NVSR vol + 1949  (72+1949=2021, 74+1949=2023)
          const dataYearApprox = volMatch ? String(parseInt(volMatch[1]) + 1949) : 'latest';
          return result(
            'US', 'lifeExpectancy', Math.round(leVal * 10) / 10,
            'years (life expectancy at birth, both sexes, all races)',
            dataYearApprox,
            `CDC NCHS — National Vital Statistics Reports (${nvsr}), United States Life Tables`,
            dirUrl,
            'Parsed from Table01.xlsx (national life table); row 0, final ex column'
          );
        }
      }
    } catch (_) { /* try next dir */ }
  }
  throw new Error('CDC NVSR FTP: could not parse life expectancy from any NVSR Table01.xlsx');
}

/**
 * US Obesity Rate — CDC Behavioral Risk Factor Surveillance System (BRFSS)
 * Dataset hn4x-zwk7 (chronicdata.cdc.gov): Nutrition, Physical Activity, and Obesity.
 * Question Q036: "Percent of adults aged 18 years and older who have obesity".
 * Stratification: Total (all adults), US national.
 */
async function fetchUS_ObesityRate() {
  const URL = 'https://chronicdata.cdc.gov/resource/hn4x-zwk7.json?' +
    'LocationAbbr=US' +
    '&questionid=Q036' +
    '&StratificationCategory1=Total' +
    '&$order=YearStart+DESC' +
    '&$limit=1';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const row = resp.data?.[0];
  if (!row) throw new Error('CDC BRFSS: no obesity data for US national (Q036)');
  const val = safeNum(row.data_value);
  if (val == null) throw new Error('CDC BRFSS: could not parse obesity rate');
  return result(
    'US', 'obesityRate', val,
    '% adults 18+ with obesity (BRFSS age-adjusted)',
    row.yearstart,
    'CDC — Behavioral Risk Factor Surveillance System (BRFSS), hn4x-zwk7 Q036',
    URL,
    'BRFSS self-reported; "Have obesity" defined as BMI ≥ 30; national estimate'
  );
}

/**
 * US Hospital Wait Times — CMS Provider Data, Timely and Effective Care
 * Measure OP_18b: Average (median) time patients spent in the ED before leaving
 * (for visits resulting in discharge). Aggregates across all reporting hospitals
 * to produce a national median-of-medians in minutes.
 * Dataset: yv7e-xc69 (data.cms.gov provider-data API).
 */
async function fetchUS_HospitalWaitTimes() {
  const BASE = 'https://data.cms.gov/provider-data/api/1/datastore/query/yv7e-xc69/0';
  const PAGE = 500;
  const scores = [];
  let offset = 0, total = Infinity, period = '';

  while (offset < total) {
    const resp = await axios.get(BASE, {
      timeout: TIMEOUT_MS,
      params: {
        'conditions[0][property]': 'measure_id',
        'conditions[0][value]': 'OP_18b',
        limit: PAGE,
        offset,
      },
    });
    const results = resp.data?.results ?? [];
    if (offset === 0) {
      total = resp.data?.count ?? results.length;
      const r0 = results[0];
      if (r0) period = `${r0.start_date} – ${r0.end_date}`;
    }
    for (const r of results) {
      const v = parseFloat(r.score);
      if (!isNaN(v) && v > 0) scores.push(v);
    }
    if (results.length < PAGE) break;
    offset += PAGE;
  }

  if (scores.length === 0) throw new Error('CMS OP_18b: no hospital scores found');
  scores.sort((a, b) => a - b);
  const median = scores[Math.floor(scores.length / 2)];

  return result(
    'US', 'hospitalWaitTimes', median,
    'minutes (national median ED time, arrival to discharge — OP_18b)',
    period,
    'CMS Provider Data — Timely and Effective Care, measure OP_18b',
    'https://data.cms.gov/provider-data/dataset/yv7e-xc69',
    `Median of ${scores.length} hospital-reported medians for OP_18b; lower is better`
  );
}

/**
 * US Mental Health Access — CDC PLACES Dataset (swc5-untb)
 * Measure DEPRESSION: "Depression among adults" — age-adjusted prevalence (%)
 * national estimate (stateabbr='US'). SAMHSA NSDUH API (api.samhsa.gov) returns 403.
 */
async function fetchUS_MentalHealthAccess() {
  const BASE = 'https://data.cdc.gov/resource/swc5-untb.json';
  const resp = await axios.get(BASE, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
    params: {
      measureid: 'DEPRESSION',
      stateabbr: 'US',
      data_value_type: 'Age-adjusted prevalence',
      '$order': 'year DESC',
      '$limit': 3,
    },
  });
  const rows = resp.data ?? [];
  const best = rows.find(r => r.data_value && parseFloat(r.data_value) > 0);
  if (!best) throw new Error('CDC PLACES: no depression prevalence found for US national');
  const val = parseFloat(parseFloat(best.data_value).toFixed(1));
  return result(
    'US', 'mentalHealthAccess', val,
    '% adults with diagnosed depression (age-adjusted prevalence)',
    best.year,
    'CDC PLACES — Depression among adults, BRFSS-based model (swc5-untb)',
    'https://data.cdc.gov/resource/swc5-untb.json',
    'CDC PLACES national estimate; SAMHSA NSDUH is primary source but API unavailable programmatically'
  );
}

/**
 * US Drug Addiction — CDC NCHS VSRR Quarterly Provisional Estimates
 * Dataset 489q-934x: cause_of_death=Drug overdose, rate_type=Age-adjusted.
 * 12-month age-adjusted drug overdose death rate per 100,000 population.
 * SAMHSA NSDUH API (api.samhsa.gov) returns 403 programmatically.
 */
async function fetchUS_DrugAddiction() {
  const BASE = 'https://data.cdc.gov/resource/489q-934x.json';
  const resp = await axios.get(BASE, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
    params: {
      cause_of_death: 'Drug overdose',
      time_period: '12 months ending with quarter',
      rate_type: 'Age-adjusted',
      '$order': 'year_and_quarter DESC',
      '$limit': 5,
    },
  });
  const rows = resp.data ?? [];
  const best = rows.find(r => r.rate_overall && parseFloat(r.rate_overall) > 0);
  if (!best) throw new Error('CDC VSRR 489q: no drug overdose rate found');
  const val = parseFloat(parseFloat(best.rate_overall).toFixed(1));
  return result(
    'US', 'drugAddiction', val,
    'drug overdose deaths per 100,000 population (age-adjusted, 12-month)',
    best.year_and_quarter,
    'CDC NCHS — VSRR Quarterly Provisional Estimates (489q-934x)',
    'https://data.cdc.gov/resource/489q-934x.json',
    '12-month age-adjusted provisional drug overdose death rate; SAMHSA NSDUH unavailable via API'
  );
}

// ─── US HOUSING & SOCIAL ──────────────────────────────────────────────────────

/**
 * US Homelessness — HUD Annual Homeless Assessment Report (AHAR) PIT Count
 * Downloads the xlsb from the AHAR 2024 page, parses ZIP+BIFF12 records to
 * extract the national "Total" row "Overall Homeless" count (2nd RK value).
 * No JSON/CSV API exists; HUD publishes PIT data in xlsb format only.
 */
async function fetchUS_Homelessness() {
  const PAGE_URL = 'https://www.huduser.gov/portal/datasets/ahar/2024-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html';
  const pageResp = await axios.get(PAGE_URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const linkMatch = pageResp.data.match(/href="([^"]*PIT-Counts-by-State\.xlsb[^"]*)"/i);
  if (!linkMatch) throw new Error('HUD AHAR: no PIT-Counts-by-State.xlsb link found');
  const xlsbUrl = linkMatch[1].startsWith('http') ? linkMatch[1] : 'https://www.huduser.gov' + linkMatch[1];
  const yearMatch = xlsbUrl.match(/\d{4}-(\d{4})-PIT/);
  const dataYear = yearMatch ? yearMatch[1] : 'latest';

  const fileResp = await axios.get(xlsbUrl, {
    timeout: 90000, headers: { 'User-Agent': BROWSER_UA }, responseType: 'arraybuffer',
  });

  // --- ZIP parser (xlsb is a ZIP container) ---
  function unzip(b) {
    const e = {};
    let i = 0;
    while (i < b.length - 4) {
      if (b.readUInt32LE(i) !== 0x04034b50) { i++; continue; }
      const method = b.readUInt16LE(i + 8);
      const cSize  = b.readUInt32LE(i + 18);
      const fnLen  = b.readUInt16LE(i + 26);
      const exLen  = b.readUInt16LE(i + 28);
      const name   = b.slice(i + 30, i + 30 + fnLen).toString('utf8');
      const ds     = i + 30 + fnLen + exLen;
      const raw    = b.slice(ds, ds + cSize);
      if (method === 0) e[name] = raw;
      else if (method === 8) { try { e[name] = zlib.inflateRawSync(raw); } catch (_) {} }
      i = ds + cSize;
    }
    return e;
  }

  // --- BIFF12 record reader ---
  function biff12(b) {
    const recs = [];
    let i = 0;
    while (i < b.length - 2) {
      let type, tl;
      if (b[i] & 0x80) { type = (b[i] & 0x7F) | ((b[i + 1] & 0x7F) << 7); tl = 2; }
      else { type = b[i]; tl = 1; }
      i += tl;
      let sz = 0, sl = 0;
      for (let k = 0; k < 4 && i + k < b.length; k++) {
        sz |= (b[i + k] & 0x7F) << (7 * k); sl++;
        if (!(b[i + k] & 0x80)) break;
      }
      i += sl;
      if (i + sz > b.length) break;
      recs.push({ type, d: b.slice(i, i + sz) });
      i += sz;
    }
    return recs;
  }

  // --- RK number decoder ---
  function rkVal(v) {
    const fX100 = v & 1, fInt = (v >> 1) & 1;
    let n = fInt ? ((v | 0) >> 2) : (() => {
      const t = Buffer.allocUnsafe(8); t.fill(0);
      t.writeUInt32LE(v & 0xFFFFFFFC, 4); return t.readDoubleLE(0);
    })();
    return fX100 ? n / 100 : n;
  }

  const entries = unzip(Buffer.from(fileResp.data));

  // Parse shared strings (BrtSSTItem = 0x13: [flag:1][cch:4][utf16le:cch*2])
  const ss = [];
  for (const rec of biff12(entries['xl/sharedStrings.bin'] ?? Buffer.alloc(0))) {
    if (rec.type === 0x13 && rec.d.length >= 5) {
      const cch = rec.d.readUInt32LE(1);
      if (rec.d.length >= 5 + cch * 2) ss.push(rec.d.slice(5, 5 + cch * 2).toString('utf16le'));
    }
  }
  const totalIdx = ss.findIndex(s => s === 'Total');
  if (totalIdx < 0) throw new Error('HUD AHAR xlsb: "Total" string not found');

  // Parse sheet1.bin: find "Total" row, collect RK values
  // Layout: col0=label(str), col1=CoC-count(RK), col2=Overall Homeless(RK), ...
  const sh1 = entries['xl/worksheets/sheet1.bin'];
  if (!sh1) throw new Error('HUD AHAR xlsb: sheet1.bin not found');
  const shRecs = biff12(sh1);
  let inTotal = false, rkList = [];
  for (const rec of shRecs) {
    if (rec.type === 0) { if (inTotal && rkList.length) break; rkList = []; inTotal = false; }
    if (rec.type === 7 && rec.d.length >= 12 && rec.d.readUInt32LE(8) === totalIdx) inTotal = true;
    if (rec.type === 2 && inTotal) {
      const off = rec.d.length >= 12 ? 8 : 4;
      if (rec.d.length >= off + 4) rkList.push(rkVal(rec.d.readUInt32LE(off)));
    }
  }
  if (rkList.length < 2) throw new Error(`HUD AHAR xlsb: Total row too short (${rkList.length} values)`);
  const total = Math.round(rkList[1]); // col1=CoC count, col2=Overall Homeless
  if (total < 100000 || total > 2000000) throw new Error(`HUD AHAR xlsb: implausible value ${total}`);

  return result('US', 'homelessness', total,
    'people experiencing homelessness (HUD PIT January count, national total)',
    dataYear,
    'HUD — Annual Homeless Assessment Report (AHAR), Point-in-Time (PIT) Count',
    PAGE_URL,
    'Parsed from HUD PIT-Counts-by-State.xlsb; sheet1 "Total" row, "Overall Homeless" column');
}

/**
 * US New Builds — FRED PERMIT series
 * Monthly new privately-owned housing units authorised by building permits (SAAR, thousands).
 * Source: U.S. Census Bureau / U.S. Department of Housing and Urban Development.
 */
async function fetchUS_NewBuilds() {
  const URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=PERMIT';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const lines = resp.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
  const last = lines[lines.length - 1].split(',');
  const val = safeNum(last[1]);
  if (!val) throw new Error('FRED PERMIT: could not parse value');
  return result('US', 'newBuilds', val,
    'thousands of new privately-owned housing units authorised (SAAR, monthly)',
    last[0],
    'U.S. Census Bureau / HUD via FRED — New Privately-Owned Housing Units Authorized (PERMIT)',
    URL,
    'Seasonally adjusted annual rate; latest monthly observation');
}

/**
 * US Graduation Rate — Census Bureau American Community Survey
 * Table S1501: Educational Attainment — S1501_C02_014E = % adults 25+ with HS diploma or higher.
 * Best programmatic proxy for national graduation rate (NCES CCD ACGR ~87% but no national API).
 */
async function fetchUS_GraduationRate() {
  const YEAR = 2023;
  const URL = `https://api.census.gov/data/${YEAR}/acs/acs1/subject?get=S1501_C02_014E,NAME&for=us:1`;
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS });
  const val = safeNum(resp.data?.[1]?.[0]);
  if (val == null) throw new Error('Census ACS S1501: no value returned');
  return result('US', 'graduationRate', val,
    '% adults 25 and over with high school diploma or higher (ACS 1-year)',
    String(YEAR),
    'U.S. Census Bureau — American Community Survey 1-Year, Table S1501 (S1501_C02_014E)',
    URL,
    'Adult educational attainment proxy; NCES CCD 4-year ACGR ~87% but no public national API');
}

/**
 * US Student Debt — FRED SLOAS series
 * Total outstanding student loans (Federal + private, $ millions), FRBNY/Board of Governors.
 */
async function fetchUS_StudentDebt() {
  const URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=SLOAS';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const lines = resp.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
  const last = lines[lines.length - 1].split(',');
  const val = safeNum(last[1]);
  if (!val) throw new Error('FRED SLOAS: could not parse value');
  return result('US', 'studentDebt', val,
    'millions of dollars (total student loans outstanding)',
    last[0],
    'Federal Reserve / FRBNY via FRED — Student Loans Outstanding (SLOAS)',
    URL,
    'Total outstanding student loan balances; studentaid.gov portfolio data not available via API');
}

/**
 * US School Funding — NCES Digest of Education Statistics Table 236.75
 * Current expenditure per pupil in fall enrollment for public K–12 schools, national average.
 * Parsed from HTML table (no JSON API); most recent school year shown first.
 */
async function fetchUS_SchoolFunding() {
  for (const digest of ['d23', 'd22', 'd21']) {
    try {
      const url = `https://nces.ed.gov/programs/digest/${digest}/tables/dt${digest.slice(1)}_236.75.asp`;
      const resp = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
      const html = resp.data;
      const usIdx = html.search(/United States/i);
      if (usIdx < 0) continue;
      const segment = html.slice(usIdx, usIdx + 1000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      // First dollar amount after "United States" = most recent year's per-pupil expenditure
      const m = segment.match(/\$\s*([\d,]+)/);
      if (!m) continue;
      const val = safeNum(m[1]);
      if (!val || val < 5000 || val > 30000) continue;
      // Derive school year from digest year e.g. d23 → 2022-23
      const yr = parseInt(digest.slice(1));
      const schoolYear = `${2000 + yr - 1}-${String(yr).padStart(2, '0')}`;
      return result('US', 'schoolFunding', val,
        'USD per pupil (public K-12 current expenditure per student in fall enrollment)',
        schoolYear,
        `NCES — Digest of Education Statistics Table 236.75 (${digest.toUpperCase()})`,
        url,
        'Most recent school-year figure from NCES Digest table; parsed from HTML (no JSON API)');
    } catch (_) { /* try next digest year */ }
  }
  throw new Error('NCES Digest 236.75: could not parse per-pupil expenditure from any digest year');
}

/**
 * US Child Poverty — Census Bureau ACS Table S1701
 * S1701_C03_006E = % related children under 18 years below poverty level.
 */
async function fetchUS_ChildPoverty() {
  const YEAR = 2023;
  const URL = `https://api.census.gov/data/${YEAR}/acs/acs1/subject?get=S1701_C03_006E,NAME&for=us:1`;
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS });
  const val = safeNum(resp.data?.[1]?.[0]);
  if (val == null) throw new Error('Census ACS S1701: no value returned');
  return result('US', 'childPoverty', val,
    '% related children under 18 below poverty level (ACS 1-year)',
    String(YEAR),
    'U.S. Census Bureau — American Community Survey 1-Year, Table S1701 (S1701_C03_006E)',
    URL);
}

/**
 * US Immigration — Census Bureau ACS Table B05012
 * B05012_003E = total foreign-born population (nativity proxy for immigration).
 * DHS Yearbook LPR admissions data not accessible via programmatic API.
 */
async function fetchUS_Immigration() {
  const YEAR = 2023;
  const URL = `https://api.census.gov/data/${YEAR}/acs/acs1?get=B05012_003E,NAME&for=us:1`;
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS });
  const val = safeNum(resp.data?.[1]?.[0]);
  if (val == null) throw new Error('Census ACS B05012: no value returned');
  return result('US', 'immigration', val,
    'total foreign-born population (nativity count, ACS 1-year)',
    String(YEAR),
    'U.S. Census Bureau — American Community Survey 1-Year, Table B05012 (B05012_003E)',
    URL,
    'DHS Yearbook LPR admissions not accessible via API; Census ACS nativity used as proxy');
}

/**
 * US Gini Coefficient — Census Bureau ACS Table B19083
 * B19083_001E = Gini Index of Income Inequality, national estimate.
 */
async function fetchUS_GiniCoefficient() {
  const YEAR = 2023;
  const URL = `https://api.census.gov/data/${YEAR}/acs/acs1?get=B19083_001E,NAME&for=us:1`;
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS });
  const val = safeNum(resp.data?.[1]?.[0]);
  if (val == null) throw new Error('Census ACS B19083: no value returned');
  return result('US', 'giniCoefficient', val,
    'Gini coefficient (0 = perfect equality, 1 = perfect inequality, ACS 1-year)',
    String(YEAR),
    'U.S. Census Bureau — American Community Survey 1-Year, Table B19083 (B19083_001E)',
    URL);
}

/**
 * US Minimum Wage — FRED FEDMINNFRWG series
 * Federal minimum wage ($/hr); source: U.S. Department of Labor.
 */
async function fetchUS_MinWageGap() {
  const URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDMINNFRWG';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const lines = resp.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
  const last = lines[lines.length - 1].split(',');
  const val = safeNum(last[1]);
  if (!val) throw new Error('FRED FEDMINNFRWG: could not parse value');
  return result('US', 'minWageGap', val,
    'USD/hour (federal minimum wage)',
    last[0],
    'U.S. Department of Labor via FRED — Federal Minimum Wage (FEDMINNFRWG)',
    URL,
    'Current federal minimum wage; many states have higher minimum wages');
}

/**
 * US Literacy — Census Bureau ACS Table S1501
 * S1501_C02_015E = % adults 25+ with bachelor's degree or higher.
 * Used as higher education attainment proxy (NCES PIAAC functional literacy ~79%
 * at Level 2+ in 2023 but no programmatic API is available).
 */
async function fetchUS_Literacy() {
  const YEAR = 2023;
  const URL = `https://api.census.gov/data/${YEAR}/acs/acs1/subject?get=S1501_C02_015E,NAME&for=us:1`;
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS });
  const val = safeNum(resp.data?.[1]?.[0]);
  if (val == null) throw new Error('Census ACS S1501: no value returned');
  return result('US', 'literacy', val,
    "% adults 25 and over with bachelor's degree or higher (ACS 1-year)",
    String(YEAR),
    'U.S. Census Bureau — American Community Survey 1-Year, Table S1501 (S1501_C02_015E)',
    URL,
    "Higher education attainment proxy; NCES PIAAC 2023 measures functional literacy (~79% Level 2+) but has no programmatic API");
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

// ─── UNITED KINGDOM — Safety & Health ─────────────────────────────────────────

/**
 * UK Crime Rate — OHID Fingertips API
 * Indicator 11202: Violent crime offences per 1,000 population (police-recorded)
 * England (E92000001), Persons, latest annual period
 * No API key required; requires browser-like User-Agent.
 */
async function fetchUK_CrimeRate() {
  const INDICATOR = 11202;
  const URL = `https://fingertips.phe.org.uk/api/all_data/csv/by_indicator_id?indicator_ids=${INDICATOR}&child_area_type_id=15&parent_area_code=E92000001`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: 'text/csv,*/*' },
  });
  const lines = String(resp.data).split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Fingertips 11202: no data rows');
  const header    = parseCSVLine(lines[0]);
  const areaIdx   = header.findIndex(h => h === 'Area Code');
  const sexIdx    = header.findIndex(h => h === 'Sex');
  const periodIdx = header.findIndex(h => h === 'Time period');
  const valueIdx  = header.findIndex(h => h === 'Value');
  if (areaIdx < 0 || periodIdx < 0 || valueIdx < 0)
    throw new Error(`Fingertips 11202: missing columns. Header: ${lines[0].slice(0, 100)}`);
  const rows = lines.slice(1).map(l => parseCSVLine(l))
    .filter(r => r[areaIdx] === 'E92000001' && (sexIdx < 0 || r[sexIdx] === 'Persons') && r[valueIdx] && r[valueIdx] !== '');
  if (rows.length === 0) throw new Error('Fingertips 11202: no England/Persons rows found');
  rows.sort((a, b) => b[periodIdx].localeCompare(a[periodIdx]));
  const latest = rows[0];
  const val    = safeNum(latest[valueIdx]);
  if (val === null) throw new Error(`Fingertips 11202: cannot parse value "${latest[valueIdx]}"`);
  return result('UK', 'crimeRate', val, 'violent crime offences per 1,000 population (police-recorded, England)',
    latest[periodIdx],
    'OHID Fingertips — Violent crime offences per 1,000 population (indicator 11202)',
    URL);
}

/**
 * UK Drug Overdoses — OHID Fingertips API
 * Indicator 92432: Deaths from drug misuse, age-standardised rate per 100,000 (England)
 * England (E92000001), Persons, latest 3-year rolling period
 * No API key required; requires browser-like User-Agent.
 */
async function fetchUK_DrugOverdoses() {
  const INDICATOR = 92432;
  const URL = `https://fingertips.phe.org.uk/api/all_data/csv/by_indicator_id?indicator_ids=${INDICATOR}&child_area_type_id=15&parent_area_code=E92000001`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: 'text/csv,*/*' },
  });
  const lines = String(resp.data).split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Fingertips 92432: no data rows');
  const header    = parseCSVLine(lines[0]);
  const areaIdx   = header.findIndex(h => h === 'Area Code');
  const sexIdx    = header.findIndex(h => h === 'Sex');
  const periodIdx = header.findIndex(h => h === 'Time period');
  const valueIdx  = header.findIndex(h => h === 'Value');
  if (areaIdx < 0 || periodIdx < 0 || valueIdx < 0)
    throw new Error(`Fingertips 92432: missing columns. Header: ${lines[0].slice(0, 100)}`);
  const rows = lines.slice(1).map(l => parseCSVLine(l))
    .filter(r => r[areaIdx] === 'E92000001' && (sexIdx < 0 || r[sexIdx] === 'Persons') && r[valueIdx] && r[valueIdx] !== '');
  if (rows.length === 0) throw new Error('Fingertips 92432: no England/Persons rows found');
  rows.sort((a, b) => b[periodIdx].localeCompare(a[periodIdx]));
  const latest = rows[0];
  const val    = safeNum(latest[valueIdx]);
  if (val === null) throw new Error(`Fingertips 92432: cannot parse value "${latest[valueIdx]}"`);
  return result('UK', 'drugOverdoses', val, 'deaths from drug misuse per 100,000 (age-standardised, England)',
    latest[periodIdx],
    'OHID Fingertips — Deaths from drug misuse, age-standardised rate (indicator 92432)',
    URL);
}

/**
 * UK Homicide Rate — WHO Global Health Observatory API (UNODC data)
 * Indicator VIOLENCE_HOMICIDERATE: Intentional homicides per 100,000 population (UK)
 * Both sexes, latest available year. WHO publishes UNODC data with ~2-year lag.
 */
async function fetchUK_HomicideRate() {
  const URL = "https://ghoapi.azureedge.net/api/VIOLENCE_HOMICIDERATE?$filter=SpatialDim eq 'GBR'";
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const records = resp.data?.value ?? [];
  if (records.length === 0) throw new Error('WHO GHO VIOLENCE_HOMICIDERATE: no data for GBR');
  // Prefer both-sexes dimension; fall back to all records
  const both = records.filter(r => !r.Dim1 || r.Dim1 === 'BTSX' || r.Dim1 === 'SEX_BTSX');
  const src  = both.length > 0 ? both : records;
  src.sort((a, b) => (b.TimeDim ?? 0) - (a.TimeDim ?? 0));
  const latest = src[0];
  const val    = safeNum(latest.NumericValue ?? latest.Value);
  if (val === null) throw new Error('WHO GHO VIOLENCE_HOMICIDERATE: cannot parse value');
  return result('UK', 'homicideRate', val, 'intentional homicides per 100,000 population (UNODC/WHO)',
    String(latest.TimeDim),
    'WHO Global Health Observatory — Intentional homicide rate VIOLENCE_HOMICIDERATE (UNODC data), GBR',
    'https://ghoapi.azureedge.net/api/VIOLENCE_HOMICIDERATE');
}

/**
 * UK Road Fatalities — Department for Transport Road Casualty Statistics 2023
 * File: dft-road-casualty-statistics-casualty-2023.csv (~10 MB)
 * Streams CSV and counts rows where casualty_severity == 1 (fatal).
 * No API key required.
 */
async function fetchUK_RoadFatalities() {
  const CSV_URL = 'https://data.dft.gov.uk/road-accidents-safety-data/dft-road-casualty-statistics-casualty-2023.csv';
  const resp = await axios.get(CSV_URL, {
    responseType: 'stream',
    timeout: 120000,
    headers: { 'User-Agent': BROWSER_UA },
  });
  return new Promise((resolve, reject) => {
    let lineBuffer = '', header = null, sevIdx = -1, fatalCount = 0;
    function processText(text) {
      lineBuffer += text;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (!header) {
          header = parseCSVLine(line);
          sevIdx = header.findIndex(c => c === 'casualty_severity');
          continue;
        }
        // DfT CSVs use simple comma separation with no quoted commas in severity column
        const sev = line.split(',')[sevIdx] ?? '';
        if (sev === '1') fatalCount++;
      }
    }
    resp.data.on('data',  chunk => processText(chunk.toString()));
    resp.data.on('end',   () => {
      processText('');
      if (fatalCount === 0) return reject(new Error('UK Road Fatalities: casualty_severity=1 count was 0 — check CSV column name'));
      resolve(result(
        'UK', 'roadFatalities', fatalCount, 'road deaths (casualty_severity=1, DfT 2023)',
        '2023',
        'Department for Transport — Road Casualty Statistics 2023 (dft-road-casualty-statistics-casualty-2023.csv)',
        CSV_URL,
        'Count of casualties with severity=1 (fatal); updated annually'
      ));
    });
    resp.data.on('error', reject);
  });
}

/**
 * UK Life Expectancy — WHO Global Health Observatory API
 * Indicator WHOSIS_000001: Life expectancy at birth (years), United Kingdom
 * Both sexes, latest available year. WHO estimate, typically 2-year lag.
 */
async function fetchUK_LifeExpectancy() {
  const URL = "https://ghoapi.azureedge.net/api/WHOSIS_000001?$filter=SpatialDim eq 'GBR'";
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const records = resp.data?.value ?? [];
  if (records.length === 0) throw new Error('WHO GHO WHOSIS_000001: no data for GBR');
  // Prefer both-sexes dimension
  const both = records.filter(r => !r.Dim1 || r.Dim1 === 'BTSX' || r.Dim1 === 'SEX_BTSX');
  const src  = both.length > 0 ? both : records;
  src.sort((a, b) => (b.TimeDim ?? 0) - (a.TimeDim ?? 0));
  const latest = src[0];
  const val    = safeNum(latest.NumericValue ?? latest.Value);
  if (val === null) throw new Error('WHO GHO WHOSIS_000001: cannot parse value');
  return result('UK', 'lifeExpectancy', val, 'years at birth, both sexes (WHO estimate, GBR)',
    String(latest.TimeDim),
    'WHO Global Health Observatory — Life expectancy at birth WHOSIS_000001, GBR',
    'https://ghoapi.azureedge.net/api/WHOSIS_000001');
}

/**
 * UK Obesity Rate — OHID Fingertips API
 * Indicator 93088: Adults classified as overweight or obese (%), Health Survey for England
 * England (E92000001), Persons (18+), latest annual period
 * No API key required; requires browser-like User-Agent.
 */
async function fetchUK_ObesityRate() {
  const INDICATOR = 93088;
  const URL = `https://fingertips.phe.org.uk/api/all_data/csv/by_indicator_id?indicator_ids=${INDICATOR}&child_area_type_id=15&parent_area_code=E92000001`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: 'text/csv,*/*' },
  });
  const lines = String(resp.data).split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Fingertips 93088: no data rows');
  const header    = parseCSVLine(lines[0]);
  const areaIdx   = header.findIndex(h => h === 'Area Code');
  const sexIdx    = header.findIndex(h => h === 'Sex');
  const periodIdx = header.findIndex(h => h === 'Time period');
  const valueIdx  = header.findIndex(h => h === 'Value');
  if (areaIdx < 0 || periodIdx < 0 || valueIdx < 0)
    throw new Error(`Fingertips 93088: missing columns. Header: ${lines[0].slice(0, 100)}`);
  const rows = lines.slice(1).map(l => parseCSVLine(l))
    .filter(r => r[areaIdx] === 'E92000001' && (sexIdx < 0 || r[sexIdx] === 'Persons') && r[valueIdx] && r[valueIdx] !== '');
  if (rows.length === 0) throw new Error('Fingertips 93088: no England/Persons rows found');
  rows.sort((a, b) => b[periodIdx].localeCompare(a[periodIdx]));
  const latest = rows[0];
  const val    = safeNum(latest[valueIdx]);
  if (val === null) throw new Error(`Fingertips 93088: cannot parse value "${latest[valueIdx]}"`);
  return result('UK', 'obesityRate', val, '% adults 18+ overweight or obese (Health Survey for England)',
    latest[periodIdx],
    'OHID Fingertips — Overweight or obese adults 18+, % (indicator 93088)',
    URL);
}

// ─── UNITED KINGDOM — Housing & Social ────────────────────────────────────────

/**
 * UK Homelessness — MHCLG Rough Sleeping Snapshot
 * Annual single-night autumn count of people sleeping rough in England.
 * Source: gov.uk search API → latest HTML report → headline figure.
 * No API key required.
 */
async function fetchUK_Homelessness() {
  // Step 1: Find latest rough sleeping snapshot publication via gov.uk search
  const SEARCH_URL = 'https://www.gov.uk/api/search.json?q=rough+sleeping+snapshot+england&count=1';
  const searchResp = await axios.get(SEARCH_URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const link = searchResp.data?.results?.[0]?.link;
  if (!link) throw new Error('UK homelessness: no rough sleeping publication found via gov.uk search');

  // Step 2: Fetch HTML report (URL pattern: /statistics/{slug}/{slug})
  const slug = link.split('/').pop();
  const reportUrl = 'https://www.gov.uk' + link + '/' + slug;
  const htmlResp = await axios.get(reportUrl, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const text = String(htmlResp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Step 3: Parse headline count
  const m = text.match(/estimated to be sleeping rough on a single night[^.]*?is\s+([\d,]+)/i)
         ?? text.match(/sleeping rough[^.]*?(?:is|are)\s+([\d,]+)/i);
  if (!m) throw new Error('UK homelessness: rough sleeping count not found in HTML report');
  const val = parseInt(m[1].replace(/,/g, ''), 10);
  if (isNaN(val)) throw new Error('UK homelessness: invalid rough sleeping count: ' + m[1]);

  // Step 4: Extract period from "autumn YYYY"
  const periodM = text.match(/autumn\s+(\d{4})/i) ?? slug.match(/autumn-(\d{4})/);
  const period  = periodM ? 'Autumn ' + periodM[1] : null;

  return result('UK', 'homelessness', val,
    'people estimated to be sleeping rough on a single night in England (autumn snapshot)',
    period,
    'MHCLG — Rough Sleeping Snapshot in England (annual)',
    reportUrl,
    'Annual single-night count, autumn, across all English local authorities; not a continuous count');
}

/**
 * UK New Builds — MHCLG Housing Supply: Indicators of New Supply
 * Quarterly new build dwelling completions (not seasonally adjusted) for England.
 * Source: gov.uk house-building-statistics collection → latest HTML report.
 * No API key required.
 */
async function fetchUK_NewBuilds() {
  // Step 1: Get latest publication from gov.uk collection
  const COLL_URL = 'https://www.gov.uk/api/content/government/collections/house-building-statistics';
  const collResp = await axios.get(COLL_URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const docs = collResp.data?.links?.documents ?? [];
  if (docs.length === 0) throw new Error('UK newBuilds: no documents in house-building-statistics collection');
  const firstApiUrl = docs[0]?.api_url;
  if (!firstApiUrl) throw new Error('UK newBuilds: no api_url on first document');
  const slug = firstApiUrl.split('/').pop();

  // Step 2: Fetch HTML report (URL pattern: /statistics/{slug}/{slug})
  const reportUrl = 'https://www.gov.uk/government/statistics/' + slug + '/' + slug;
  const htmlResp = await axios.get(reportUrl, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const text = String(htmlResp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Step 3: Parse new build dwelling completions
  const m = text.match(/([\d,]+)\s+new\s+build\s+dwelling\s+completions[^.]*?in\s+(\d{4}\s+Q\d)/i);
  if (!m) throw new Error('UK newBuilds: new build dwelling completions figure not found in HTML report');
  const val = parseInt(m[1].replace(/,/g, ''), 10);
  if (isNaN(val)) throw new Error('UK newBuilds: invalid completions count: ' + m[1]);

  return result('UK', 'newBuilds', val,
    'new build dwelling completions in England (not seasonally adjusted)',
    m[2],
    'MHCLG — Housing supply: indicators of new supply, England (quarterly, building control)',
    reportUrl,
    'Building control reported completions; not seasonally adjusted');
}

/**
 * UK Graduation Rate — World Bank Education Statistics (SE.TER.CUAT.BA.ZS)
 * % of adults aged 25+ who have attained at least a bachelor's degree or equivalent (UK).
 * Source: World Bank Open Data API, indicator SE.TER.CUAT.BA.ZS (GBR).
 * No API key required.
 */
async function fetchUK_GraduationRate() {
  const URL = 'https://api.worldbank.org/v2/country/GBR/indicator/SE.TER.CUAT.BA.ZS?format=json&mrv=5';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  const items = (resp.data?.[1] ?? []).filter(x => x.value !== null);
  if (items.length === 0) throw new Error('World Bank GBR SE.TER.CUAT.BA.ZS: no data returned');
  items.sort((a, b) => b.date.localeCompare(a.date));
  const latest = items[0];
  const val    = Math.round(latest.value * 10) / 10;
  return result('UK', 'graduationRate', val,
    '% adults 25+ with at least bachelor\'s degree or equivalent (UK)',
    String(latest.date),
    'World Bank / UNESCO UIS — Educational attainment, bachelor\'s or above, SE.TER.CUAT.BA.ZS',
    URL,
    'Population aged 25+, not 16-64; sourced from World Bank Education Statistics (UNESCO Institute for Statistics)');
}

/**
 * UK Student Debt — Student Loans Company (SLC) via gov.uk statistics HTML report
 * Publication: "Student loans in England" (SLC collection on gov.uk)
 * Retrieves HE ICR + FE outstanding loan balance from latest HTML report.
 * No API key required.
 */
async function fetchUK_StudentDebt() {
  // Step 1: Get latest publication from SLC collection
  const COLL_URL = 'https://www.gov.uk/api/content/government/collections/student-loans-for-higher-and-further-education';
  const collResp = await axios.get(COLL_URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const docs = collResp.data?.links?.documents ?? [];
  // Skip "uk-comparisons" docs; find latest "student-loans-in-england-..." publication
  const latestDoc = docs.find(d => /\/statistics\/student-loans-in-england-\d/.test(d.api_url ?? ''));
  if (!latestDoc) throw new Error('UK studentDebt: no student-loans-in-england doc in SLC collection');
  const slug = latestDoc.api_url.split('/').pop();

  // Step 2: Get attachment list for the publication
  const pubResp = await axios.get(latestDoc.api_url, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const atts = pubResp.data?.details?.attachments ?? [];

  // Find the main HTML report (relative URL, contains "financial-year", no binary content_type)
  const reportAtt = atts.find(a =>
    !a.content_type &&
    typeof a.url === 'string' &&
    a.url.startsWith('/') &&
    /financial.year/i.test(a.url) &&
    !/correction|tables|definitions|pre.release|income.contingent/i.test(a.url)
  );
  if (!reportAtt) throw new Error('UK studentDebt: HTML report attachment not found in publication');

  // Step 3: Fetch HTML report and parse outstanding balances
  const reportUrl = 'https://www.gov.uk' + reportAtt.url;
  const htmlResp = await axios.get(reportUrl, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const text = String(htmlResp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const heM = text.match(/Higher\s+education\s+ICR\s+student\s+loan\s+balance\s+totals\s+\u00a3([\d,.]+)\s*billion/i);
  if (!heM) throw new Error('UK studentDebt: HE ICR balance not found in HTML report');
  const feM = text.match(/Further\s+education\s+student\s+loan\s+balance\s+totals\s+\u00a3([\d,.]+)\s*billion/i);

  const heBn  = parseFloat(heM[1].replace(/,/g, ''));
  const feBn  = feM ? parseFloat(feM[1].replace(/,/g, '')) : 0;
  const total = Math.round((heBn + feBn) * 1e9);

  // Extract period from slug, e.g. "student-loans-in-england-2024-to-2025" → "2024/2025"
  const periodM = slug.match(/(\d{4})-to-(\d{4})/);
  const period  = periodM ? periodM[1] + '/' + periodM[2] : null;

  return result('UK', 'studentDebt', total,
    'total outstanding student loan balance, HE ICR + FE (GBP)',
    period,
    'Student Loans Company (SLC) — Student Loans in England (annual statistics)',
    reportUrl,
    'HE Income-Contingent Repayment loans + Further Education loans; published annually by SLC via gov.uk');
}

/**
 * UK Child Poverty — OHID Fingertips API
 * Indicator 93701: Children in poverty (after housing costs), % of children under 16.
 * England (E92000001), latest annual period (DWP HBAI, via Fingertips).
 * No API key required; requires browser-like User-Agent.
 */
async function fetchUK_ChildPoverty() {
  const INDICATOR = 93701;
  const URL = `https://fingertips.phe.org.uk/api/all_data/csv/by_indicator_id?indicator_ids=${INDICATOR}&child_area_type_id=15&parent_area_code=E92000001`;
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Accept: 'text/csv,*/*' },
  });
  const lines = String(resp.data).split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('Fingertips 93701: no data rows');
  const header    = parseCSVLine(lines[0]);
  const areaIdx   = header.findIndex(h => h === 'Area Code');
  const sexIdx    = header.findIndex(h => h === 'Sex');
  const periodIdx = header.findIndex(h => h === 'Time period');
  const valueIdx  = header.findIndex(h => h === 'Value');
  if (areaIdx < 0 || periodIdx < 0 || valueIdx < 0)
    throw new Error(`Fingertips 93701: missing columns. Header: ${lines[0].slice(0, 100)}`);
  const rows = lines.slice(1).map(l => parseCSVLine(l))
    .filter(r => r[areaIdx] === 'E92000001' && (sexIdx < 0 || r[sexIdx] === 'Persons') && r[valueIdx] && r[valueIdx] !== '');
  if (rows.length === 0) throw new Error('Fingertips 93701: no England/Persons rows found');
  rows.sort((a, b) => b[periodIdx].localeCompare(a[periodIdx]));
  const latest = rows[0];
  const val    = safeNum(latest[valueIdx]);
  if (val === null) throw new Error(`Fingertips 93701: cannot parse value "${latest[valueIdx]}"`);
  return result('UK', 'childPoverty', val,
    '% children under 16 in poverty after housing costs (England)',
    latest[periodIdx],
    'OHID Fingertips / DWP HBAI — Children in poverty after housing costs (indicator 93701)',
    URL,
    'DWP Households Below Average Income (HBAI) measure; % of children in families below 60% median income AHC');
}

/**
 * UK Immigration — ONS Long-Term International Migration Provisional Bulletin
 * Headline total long-term immigration figure from the latest LTIM provisional release HTML.
 * Source: ONS bulletin HTML (no JSON API available for this series).
 * No API key required.
 */
async function fetchUK_Immigration() {
  const URL = 'https://www.ons.gov.uk/peoplepopulationandcommunity/populationandmigration/internationalmigration/bulletins/longterminternationalmigrationprovisional/latest';
  const resp = await axios.get(URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const text = String(resp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // Parse headline total immigration figure
  const m = text.match(/total\s+long.term\s+immigration\s+for\s+the\s+most\s+recent\s+period\s+is\s+([\d,]+)/i);
  if (!m) throw new Error('UK immigration: headline figure not found in ONS LTIM bulletin');
  const val = parseInt(m[1].replace(/,/g, ''), 10);
  if (isNaN(val)) throw new Error('UK immigration: invalid immigration count: ' + m[1]);

  // Extract period — find latest "year ending Month YYYY" mention in the text
  const yeMatches = text.match(/year\s+ending\s+(?:June|March|September|December)\s+\d{4}/gi) ?? [];
  yeMatches.sort().reverse();
  const period = yeMatches[0] ?? null;

  return result('UK', 'immigration', val,
    'total long-term immigrants arriving in UK (provisional estimate, rolling year)',
    period,
    'Office for National Statistics — Long-Term International Migration (LTIM), provisional estimates',
    URL,
    'Rolling year-ending estimate; provisional figures subject to revision; ONS LTIM methodology');
}

/**
 * UK Gini Coefficient — ONS Household Income Inequality Bulletin (generator CSV)
 * Fetches the latest bulletin HTML, extracts the dynamic generator CSV link for Figure 1,
 * downloads the CSV, and parses the "Year","Gini, Disposable income" data table.
 * Source: ONS Household Income Inequality Financial Year bulletin.
 * No API key required.
 */
async function fetchUK_GiniCoefficient() {
  // Step 1: Fetch ONS household income inequality bulletin (latest)
  const BULLETIN_URL = 'https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/incomeandwealth/bulletins/householdincomeinequalityfinancial/latest';
  const bulletinResp = await axios.get(BULLETIN_URL, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
  });
  const html = String(bulletinResp.data);

  // Step 2: Extract first generator CSV link (e.g. /generator?uri=...&format=csv&...)
  const genMatch = html.match(/href="(\/generator\?[^"]*format=csv[^"]*)"/);
  if (!genMatch) throw new Error('UK giniCoefficient: no generator CSV link found in ONS bulletin');
  const csvUrl = 'https://www.ons.gov.uk' + genMatch[1];

  // Step 3: Download CSV and parse the Gini data table
  const csvResp = await axios.get(csvUrl, {
    timeout: TIMEOUT_MS,
    headers: { 'User-Agent': BROWSER_UA },
  });
  const lines = String(csvResp.data).split('\n').filter(l => l.trim());

  // Find header row: "Year","Gini, Disposable income",...
  const headerIdx = lines.findIndex(l => l.includes('"Year"') && l.includes('"Gini'));
  if (headerIdx < 0) throw new Error('UK giniCoefficient: Gini data table header not found in CSV');

  // Data rows look like: "FYE 2024","32.9","34.4","31.4"
  const dataRows = lines.slice(headerIdx + 1).filter(l => /^\s*"?FYE\s+\d{4}/.test(l));
  if (dataRows.length === 0) throw new Error('UK giniCoefficient: no FYE data rows in generator CSV');

  const lastRow = dataRows[dataRows.length - 1];
  const parts   = lastRow.split(',').map(p => p.replace(/"/g, '').trim());
  const year    = parts[0]; // e.g. "FYE 2024"
  const val     = safeNum(parts[1]);
  if (val === null) throw new Error('UK giniCoefficient: cannot parse Gini value from row: ' + lastRow);

  return result('UK', 'giniCoefficient', val,
    'Gini coefficient of equivalised disposable income (0–100 scale, UK)',
    year,
    'Office for National Statistics — Household Income Inequality, Financial Year (generator CSV)',
    BULLETIN_URL,
    'Financial year ending (April–March); 0–100 scale (multiply by 0.01 for 0–1 scale); from annual ETB bulletin');
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
  { label: 'CA  CPI            (Bank of Canada Valet V41690973)',          fn: fetchCA_CPI },
  { label: 'CA  Unemployment    (StatCan LFS 14-10-0017-01, stream ZIP)',  fn: fetchCA_Unemployment },
  { label: 'CA  Govt Spending   (open.canada.ca CKAN Public Accounts)',    fn: fetchCA_GovtSpending },
  { label: 'CA  Crime Rate      (StatCan CSI 35-10-0026-01)',              fn: fetchCA_CrimeRate },
  { label: 'CA  Drug Overdoses  (PHAC Health Infobase SubstanceHarms)',    fn: fetchCA_DrugOverdoses },
  { label: 'CA  Road Fatalities (StatCan 23-10-0006-01)',                  fn: fetchCA_RoadFatalities },
  { label: 'CA  Homicide Rate   (StatCan Homicide Survey 35-10-0068-01)', fn: fetchCA_HomicideRate },
  { label: 'CA  Life Expectancy (StatCan life tables 13-10-0114-01)',      fn: fetchCA_LifeExpectancy },
  { label: 'CA  Obesity Rate    (StatCan CCHS BMI 13-10-0373-01)',         fn: fetchCA_ObesityRate },
  { label: 'CA  Homelessness   (StatCan Shelter Capacity 14-10-0353-01)',  fn: fetchCA_Homelessness },
  { label: 'CA  New Builds     (StatCan/CMHC Housing Starts 34-10-0135)', fn: fetchCA_NewBuilds },
  { label: 'CA  Grad Rate      (StatCan Educ Attainment 37-10-0130-01)',  fn: fetchCA_GraduationRate },
  { label: 'CA  Student Debt   (StatCan Avg Student Loans 37-10-0046-01)',fn: fetchCA_StudentDebt },
  { label: 'CA  Child Poverty  (StatCan LIM-AT under-18 11-10-0135-01)', fn: fetchCA_ChildPoverty },
  { label: 'CA  Immigration    (StatCan Pop Components 17-10-0008-01)',   fn: fetchCA_Immigration },
  { label: 'CA  Gini Coeff     (StatCan After-tax Gini 11-10-0134-01)',  fn: fetchCA_GiniCoefficient },
  { label: 'CA  Min Wage       (ESDC Federal Min Wage CKAN)',             fn: fetchCA_MinWageGap },
  { label: 'CA  Hospital Wait  (OECD HEALTH_PROC hip replacement median)', fn: fetchCA_HospitalWaitTimes },
  { label: 'CA  Mental Health  (OECD HEALTH_REAC psychiatrists/100k)',     fn: fetchCA_MentalHealthAccess },
  { label: 'CA  Drug Addiction (PHAC SubstanceHarms opioid hospitaliz.)',  fn: fetchCA_DrugAddiction },
  { label: 'CA  Median Rent    (StatCan CMHC 34-10-0133-01 avg 2BR)',      fn: fetchCA_MedianGrossRent },
  { label: 'CA  School Funding (StatCan ed spending 37-10-0066-01)',       fn: fetchCA_SchoolFunding },
  { label: 'CA  Literacy       (StatCan educ attainment 37-10-0130-01)',   fn: fetchCA_Literacy },
  { label: 'US  Unemployment   (BLS LNS14000000 → unemploymentRate)',    fn: fetchUS_Unemployment },
  { label: 'US  CPI            (BLS CUUR0000SA0 → cpiInflation)',        fn: fetchUS_CPI },
  { label: 'US  Drug Overdoses (CDC Socrata xkb8-kh2a → drugOverdoseDeaths)', fn: fetchUS_DrugOverdoses },
  { label: 'US  Fed Spending   (USAspending.gov → federalAgencySpending)', fn: fetchUS_FedSpending },
  { label: 'US  Median Rent    (Census ACS DP04_0134E → medianGrossRent)', fn: fetchUS_MedianRent },
  { label: 'US  Median Home    (Census ACS B25077_001E → medianHomeValue)', fn: fetchUS_MedianHomeValue },
  { label: 'US  Bank Rate      (FRED FEDFUNDS → bankRate)',              fn: fetchUS_BankRate },
  { label: 'US  Poverty Rate   (Census ACS S1701_C03_001E → povertyRate)', fn: fetchUS_PovertyRate },
  { label: 'US  Crime Rate     (FBI CDE violent-crime → crimeRate)',       fn: fetchUS_CrimeRate },
  { label: 'US  Homicide Rate  (CDC VSRR 489q Homicide → homicideRate)',    fn: fetchUS_HomicideRate },
  { label: 'US  Road Fatalities(NHTSA FARS / CDC nt65 → roadFatalities)',  fn: fetchUS_RoadFatalities },
  { label: 'US  Life Expectancy(CDC NVSR FTP Table01.xlsx → lifeExpectancy)', fn: fetchUS_LifeExpectancy },
  { label: 'US  Obesity Rate   (CDC BRFSS hn4x-zwk7 Q036 → obesityRate)', fn: fetchUS_ObesityRate },
  { label: 'US  Hospital Waits (CMS OP_18b national median → hospitalWaitTimes)', fn: fetchUS_HospitalWaitTimes },
  { label: 'US  Mental Health  (CDC PLACES DEPRESSION → mentalHealthAccess)', fn: fetchUS_MentalHealthAccess },
  { label: 'US  Drug Addiction (CDC VSRR 489q Drug OD → drugAddiction)',   fn: fetchUS_DrugAddiction },
  { label: 'US  Homelessness  (HUD AHAR PIT xlsb → homelessness)',         fn: fetchUS_Homelessness },
  { label: 'US  New Builds    (FRED PERMIT housing permits → newBuilds)',   fn: fetchUS_NewBuilds },
  { label: 'US  Grad Rate     (Census ACS S1501_C02_014E → graduationRate)',fn: fetchUS_GraduationRate },
  { label: 'US  Student Debt  (FRED SLOAS outstanding loans → studentDebt)',fn: fetchUS_StudentDebt },
  { label: 'US  School Funding(NCES Digest 236.75 per-pupil → schoolFunding)',fn: fetchUS_SchoolFunding },
  { label: 'US  Child Poverty (Census ACS S1701_C03_006E → childPoverty)', fn: fetchUS_ChildPoverty },
  { label: 'US  Immigration   (Census ACS B05012_003E → immigration)',      fn: fetchUS_Immigration },
  { label: 'US  Gini Coeff    (Census ACS B19083_001E → giniCoefficient)', fn: fetchUS_GiniCoefficient },
  { label: 'US  Min Wage      (FRED FEDMINNFRWG → minWageGap)',             fn: fetchUS_MinWageGap },
  { label: 'US  Literacy      (Census ACS S1501_C02_015E → literacy)',      fn: fetchUS_Literacy },
  { label: 'UK  Unemployment   (ONS timeseries MGSX)',                   fn: fetchUK_Unemployment },
  { label: 'UK  CPI            (ONS timeseries D7G7)',                   fn: fetchUK_CPI },
  { label: 'UK  Home Prices    (LR HPI Linked Data API)',                fn: fetchUK_HomePrices },
  { label: 'UK  Bank Rate      (BoE IADB CSV series IUDBEDR)',           fn: fetchUK_BankRate },
  { label: 'UK  Crime Rate     (Fingertips indicator 11202)',            fn: fetchUK_CrimeRate },
  { label: 'UK  Drug Overdoses (Fingertips indicator 92432)',            fn: fetchUK_DrugOverdoses },
  { label: 'UK  Homicide Rate  (WHO GHO VIOLENCE_HOMICIDERATE GBR)',    fn: fetchUK_HomicideRate },
  { label: 'UK  Road Fatalities(DfT casualty-2023.csv severity=1)',     fn: fetchUK_RoadFatalities },
  { label: 'UK  Life Expectancy(WHO GHO WHOSIS_000001 GBR)',            fn: fetchUK_LifeExpectancy },
  { label: 'UK  Obesity Rate   (Fingertips indicator 93088)',            fn: fetchUK_ObesityRate },
  { label: 'UK  Homelessness  (MHCLG rough sleeping snapshot, HTML)',   fn: fetchUK_Homelessness },
  { label: 'UK  New Builds    (MHCLG housing supply indicators, HTML)', fn: fetchUK_NewBuilds },
  { label: 'UK  Grad Rate     (World Bank SE.TER.CUAT.BA.ZS, GBR)',    fn: fetchUK_GraduationRate },
  { label: 'UK  Student Debt  (SLC student-loans-for-HE-FE, HTML)',    fn: fetchUK_StudentDebt },
  { label: 'UK  Child Poverty (Fingertips indicator 93701)',            fn: fetchUK_ChildPoverty },
  { label: 'UK  Immigration   (ONS LTIM provisional bulletin, HTML)',   fn: fetchUK_Immigration },
  { label: 'UK  Gini Coeff    (ONS ETB bulletin generator CSV)',        fn: fetchUK_GiniCoefficient },
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
