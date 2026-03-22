/**
 * Government API Audit — Civic Voice Engine
 *
 * Probes all official government APIs for CA / US / UK / AU.
 * For each source reports:
 *   - What data is available
 *   - Latest date of available data
 *   - Whether an API key is required
 *   - HTTP status / reachability
 *
 * Output: output/audit/api_audit_{timestamp}.json  (machine-readable)
 *         output/audit/api_audit_{timestamp}.md     (markdown table)
 *
 * Run: node src/audit/govApiAudit.js
 */

require('dotenv').config();
const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/audit');
const TIMEOUT_MS = 20000;
const BROWSER_UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';

// ─── Probe definitions ────────────────────────────────────────────────────────

const PROBES = [

  // ══════════════════════════════════════════════════════════════════════════
  // CANADA
  // ══════════════════════════════════════════════════════════════════════════

  {
    country: 'CA',
    source:  'Bank of Canada — Valet API',
    sourceUrl: 'bankofcanada.ca/valet',
    requiresKey: false,
    updateFrequency: 'Daily / Weekly / Monthly',
    dataDescription: 'Exchange rates (CAD vs 25+ currencies), Bank Rate, overnight/prime rates, ' +
                     'bond yields (2y/5y/10y/30y), mortgage rates, monetary aggregates (M1B/M2/M3), ' +
                     'commodity prices. ~300 series.',
    probe: async () => {
      // Fetch USD/CAD rate + list series count
      const [obsResp, listResp] = await Promise.allSettled([
        axios.get('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1', { timeout: TIMEOUT_MS }),
        axios.get('https://www.bankofcanada.ca/valet/lists/series/json', { timeout: TIMEOUT_MS }),
      ]);
      const obs         = obsResp.status === 'fulfilled' ? obsResp.value.data?.observations?.[0] : null;
      const seriesCount = listResp.status === 'fulfilled' ? Object.keys(listResp.value.data?.series ?? {}).length : null;
      if (!obs && obsResp.status === 'rejected') throw obsResp.reason;
      return {
        latestDate:  obs?.d ?? null,
        seriesCount,
        sample: `USD/CAD: ${obs?.FXUSDCAD?.v ?? 'n/a'} (${obs?.d ?? '?'}); ${seriesCount ?? '?'} series available`,
      };
    },
  },

  {
    country: 'CA',
    source:  'Statistics Canada — Web Data Service (WDS)',
    sourceUrl: 'statcan.gc.ca',
    requiresKey: false,
    updateFrequency: 'Daily / Monthly / Quarterly / Annual',
    dataDescription: 'Labour force (unemployment, employment, participation), CPI (all items + components), ' +
                     'New Housing Price Index, GDP (quarterly/annual), import/export trade, ' +
                     'crime severity index, income statistics, demographic estimates. ' +
                     '4,000+ tables / 100,000+ vectors.',
    probe: async () => {
      const WDS_BASE = 'https://www150.statcan.gc.ca/t1/tbl1/en/dtbl/getDataFromVectorsAndLatestNPeriods';
      // Try GET first, then POST (WDS supports both formats)
      const tryGet = async (vectorId) => {
        const r = await axios.get(`${WDS_BASE}/v${vectorId}/1`, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
        return r.data?.object ?? [];
      };
      const tryPost = async (vectorId) => {
        const r = await axios.post(WDS_BASE, JSON.stringify([{ vectorId, latestN: 1 }]),
          { headers: { 'Content-Type': 'application/json', 'User-Agent': BROWSER_UA }, timeout: TIMEOUT_MS });
        return r.data?.object ?? [];
      };

      let unempSeries = [], cpiSeries = [];
      try { unempSeries = await tryGet(2064705);  } catch (_) { try { unempSeries = await tryPost(2064705);  } catch (_2) {} }
      try { cpiSeries   = await tryGet(41690914); } catch (_) { try { cpiSeries   = await tryPost(41690914); } catch (_2) {} }

      if (unempSeries.length === 0 && cpiSeries.length === 0) {
        throw new Error('StatCan WDS returned no data (GET + POST both 404)');
      }
      const latestRefPer = unempSeries[0]?.vectorDataPoint?.[0]?.refPer ?? cpiSeries[0]?.vectorDataPoint?.[0]?.refPer ?? null;
      return {
        latestDate: latestRefPer,
        sample: [
          unempSeries.length > 0 ? `Unemployment rate: ${unempSeries[0]?.vectorDataPoint?.[0]?.value ?? 'n/a'}%` : null,
          cpiSeries.length   > 0 ? `CPI (2002=100): ${cpiSeries[0]?.vectorDataPoint?.[0]?.value ?? 'n/a'}` : null,
        ].filter(Boolean).join(' | '),
      };
    },
  },

  {
    country: 'CA',
    source:  'open.canada.ca — CKAN Open Government Portal',
    sourceUrl: 'open.canada.ca',
    requiresKey: false,
    updateFrequency: 'Varies (quarterly proactive disclosure, annual reports)',
    dataDescription: 'Federal grants & contributions (proactive disclosure), government contracts, ' +
                     'travel & hospitality expenses, immigration (IRCC), homelessness (ESDC), ' +
                     'Main Estimates, access-to-information logs. 90,000+ datasets.',
    probe: async () => {
      const resp = await axios.get(
        'https://open.canada.ca/data/api/3/action/package_search?rows=1&sort=metadata_modified+desc',
        { timeout: TIMEOUT_MS }
      );
      const result = resp.data?.result;
      const pkg    = result?.results?.[0];
      return {
        latestDate:   pkg?.metadata_modified?.slice(0, 10) ?? null,
        totalDatasets: result?.count ?? null,
        sample: `Most recently updated: "${pkg?.title?.slice(0, 60) ?? 'n/a'}"`,
      };
    },
  },

  {
    country: 'CA',
    source:  'canada.ca — Open Government (organisation list)',
    sourceUrl: 'canada.ca',
    requiresKey: false,
    updateFrequency: 'Varies',
    dataDescription: 'Same CKAN backend as open.canada.ca; canada.ca is the main federal portal. ' +
                     'Lists all federal departments and agencies publishing open data. ' +
                     'Includes health-infobase, IRCC, DND, Transport Canada datasets.',
    probe: async () => {
      const resp = await axios.get(
        'https://open.canada.ca/data/api/3/action/organization_list',
        { timeout: TIMEOUT_MS }
      );
      const orgs = resp.data?.result ?? [];
      return {
        latestDate:   new Date().toISOString().slice(0, 10),
        sample: `${orgs.length} federal departments/agencies publishing open data`,
        note: 'canada.ca serves as entry point; data API is at open.canada.ca/data/api/',
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UNITED STATES
  // ══════════════════════════════════════════════════════════════════════════

  {
    country: 'US',
    source:  'BLS — Public Data API',
    sourceUrl: 'bls.gov',
    requiresKey: false,
    updateFrequency: 'Monthly (most series)',
    dataDescription: 'Unemployment rate (CPS, state/metro), CPI (all items + components, 35 areas), ' +
                     'Producer Price Index, wages & earnings by industry/occupation, ' +
                     'Job Openings (JOLTS), productivity & costs, mass layoffs. ' +
                     '500,000+ series. v1 free (no key, 10 series/call, 3yr history); ' +
                     'v2 requires free registration (50 series/call, 20yr history).',
    probe: async () => {
      // v1 API: single series, no key required
      const resp = await axios.get(
        'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true',
        { timeout: TIMEOUT_MS }
      );
      const latest = resp.data?.Results?.series?.[0]?.data?.[0];
      if (!latest) throw new Error('BLS returned no data');
      return {
        latestDate: `${latest.periodName} ${latest.year}`,
        sample:     `Unemployment rate: ${latest.value}% (${latest.periodName} ${latest.year}); v1 no-key confirmed`,
        apiVersion: 'v1 (no key); v2 requires free registration at bls.gov/developers/',
      };
    },
  },

  {
    country: 'US',
    source:  'BEA — National Economic Accounts API',
    sourceUrl: 'bea.gov',
    requiresKey: true,
    updateFrequency: 'Quarterly (GDP advance/revised/final); Annual (industry accounts)',
    dataDescription: 'GDP (quarterly, advance/revised/final), GNP, national income accounts, ' +
                     'personal income & consumer spending, corporate profits, ' +
                     'international trade in goods & services, fixed assets, ' +
                     'state & metropolitan area GDP, industry GDP (by 2-digit NAICS). ' +
                     'DEMO_KEY available for dataset discovery; data queries require free key.',
    probe: async () => {
      const resp = await axios.get(
        'https://apps.bea.gov/api/data?UserID=DEMO_KEY&method=getdatasetlist&ResultFormat=JSON',
        { timeout: TIMEOUT_MS }
      );
      const datasets = resp.data?.BEAAPI?.Results?.Dataset ?? [];
      // Also probe NIPA for GDP latest date
      let gdpDate = null;
      try {
        const gdpResp = await axios.get(
          'https://apps.bea.gov/api/data?UserID=DEMO_KEY&method=GetData&datasetname=NIPA&TableName=T10101&Frequency=Q&Year=X&ResultFormat=JSON',
          { timeout: TIMEOUT_MS }
        );
        const data = gdpResp.data?.BEAAPI?.Results?.Data ?? [];
        if (data.length > 0) {
          const sorted = [...data].sort((a, b) => b.TimePeriod.localeCompare(a.TimePeriod));
          gdpDate = sorted[0]?.TimePeriod ?? null;
        }
      } catch (_) {}
      return {
        latestDate: gdpDate,
        datasetCount: datasets.length,
        datasets: datasets.map(d => d.DatasetName).join(', '),
        sample: `${datasets.length} datasets: ${datasets.map(d => d.DatasetName).slice(0, 5).join(', ')}...`,
        note: 'DEMO_KEY works for dataset list; register free at apps.bea.gov/API/signup/',
      };
    },
  },

  {
    country: 'US',
    source:  'Census Bureau — American Community Survey API',
    sourceUrl: 'census.gov',
    requiresKey: false,
    updateFrequency: 'Annual (ACS 1-Year: Sep release); Every 10yr (Decennial)',
    dataDescription: 'Demographics, housing costs (median rent/home value), household income, ' +
                     'poverty rate, employment & occupations, educational attainment, ' +
                     'immigration (foreign-born population), health insurance coverage. ' +
                     'Available by state / county / census tract / block group. ' +
                     'No key required (rate-limited); free key at api.census.gov/data/key_signup.html.',
    probe: async () => {
      // Try ACS 2024 first
      for (const yr of [2024, 2023, 2022]) {
        try {
          const resp = await axios.get(
            `https://api.census.gov/data/${yr}/acs/acs1/profile?get=DP03_0051E,DP04_0134E,NAME&for=us:1`,
            { timeout: TIMEOUT_MS }
          );
          if (Array.isArray(resp.data) && resp.data.length >= 2) {
            const vals = resp.data[1];
            return {
              latestDate: String(yr),
              sample: `${yr} ACS — Median household income: $${Number(vals[0]).toLocaleString()}, Median gross rent: $${Number(vals[1]).toLocaleString()}/mo`,
            };
          }
        } catch (_) {}
      }
      return { latestDate: null, sample: 'ACS endpoint not responding' };
    },
  },

  {
    country: 'US',
    source:  'CDC — Socrata Open Data API (data.cdc.gov)',
    sourceUrl: 'cdc.gov',
    requiresKey: false,
    updateFrequency: 'Weekly (VSRR provisional); Monthly / Annual (WONDER, NHANES)',
    dataDescription: 'Drug overdose deaths (VSRR provisional monthly counts), all-cause mortality, ' +
                     'disease surveillance (COVID-19, influenza, RSV), vaccination coverage (NIS), ' +
                     'NHANES health & nutrition data, BRFSS behavioural risk factors, ' +
                     'cancer statistics (USCS), environmental health, STI/HIV surveillance. ' +
                     '1,000+ datasets on Socrata platform.',
    probe: async () => {
      // VSRR drug overdose deaths
      const resp = await axios.get(
        'https://data.cdc.gov/resource/xkb8-kh2a.json?$where=state=%27US%27%20AND%20indicator=%27Number%20of%20Drug%20Overdose%20Deaths%27&$order=year%20DESC,month%20DESC&$limit=1',
        { timeout: TIMEOUT_MS }
      );
      const row = resp.data?.[0];
      // catalog check for total count
      let catalogCount = null;
      try {
        const cat = await axios.get('https://data.cdc.gov/api/catalog/v1?limit=1', { timeout: TIMEOUT_MS });
        catalogCount = cat.data?.resultSetSize ?? null;
      } catch (_) {}
      return {
        latestDate:    row ? `${row.month}/${row.year}` : null,
        sample:        row ? `Drug overdose deaths (US, ${row.month}/${row.year}): ${Number(row.data_value).toLocaleString()}` : 'n/a',
        catalogCount,
        note: 'App-token optional but not required for public datasets',
      };
    },
  },

  {
    country: 'US',
    source:  'USAspending.gov API',
    sourceUrl: 'usaspending.gov',
    requiresKey: false,
    updateFrequency: 'Monthly (30-day reporting lag)',
    dataDescription: 'Federal contracts (award details, NAICS code, vendor), grants (recipient, CFDA), ' +
                     'direct payments, loans — by agency, sub-agency, geography, and recipient. ' +
                     'Total agency budget authority by fiscal year and period. ' +
                     'Agency financial assistance awards. Full data back to FY2001.',
    probe: async () => {
      // Use agency budget endpoint to find latest available fiscal period
      const month     = new Date().getMonth() + 1;
      const curFY     = month >= 10 ? new Date().getFullYear() + 1 : new Date().getFullYear();
      const curPeriod = month >= 10 ? month - 9 : month + 3;

      let latest = null, totalObl = null, agencyCount = 0;
      for (const { fy, period } of [
        { fy: curFY, period: Math.max(1, curPeriod - 1) },
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
          latest    = `FY${fy} Period ${period}`;
          totalObl  = resp.data?.total;
          agencyCount = results.length;
          break;
        } catch (_) {}
      }
      if (!latest) throw new Error('USAspending returned no data for any period');
      return {
        latestDate: latest,
        agencyCount,
        totalObligations: totalObl ? `$${(totalObl / 1e12).toFixed(2)}T` : null,
        sample: `${agencyCount} agencies; total obligations: ${totalObl ? '$' + (totalObl / 1e12).toFixed(2) + 'T' : 'n/a'} (${latest})`,
      };
    },
  },

  {
    country: 'US',
    source:  'Federal Reserve — FRED API (St. Louis Fed)',
    sourceUrl: 'federalreserve.gov',
    requiresKey: true,
    updateFrequency: 'Daily / Weekly / Monthly depending on series',
    dataDescription: 'Federal Funds Rate, treasury yields (1m–30y), SOFR, money supply (M1/M2), ' +
                     'bank assets & liabilities, consumer credit, mortgage rates (30y fixed), ' +
                     'unemployment (UNRATE), PCE inflation, GDP, housing starts, ' +
                     'financial stress indices (STLFSI). 800,000+ series from 100+ sources.',
    probe: async () => {
      // Try without key to confirm key is required
      let keyRequired = true;
      let latestDate  = null;
      let sample      = null;
      try {
        const resp = await axios.get(
          'https://api.stlouisfed.org/fred/series/observations?series_id=DFF&api_key=DEMO_KEY&file_type=json&limit=1&sort_order=desc',
          { timeout: TIMEOUT_MS }
        );
        // If DEMO_KEY works for FRED
        const obs = resp.data?.observations?.[0];
        if (obs) {
          latestDate = obs.date;
          sample = `Fed Funds Rate (DFF): ${obs.value}% on ${obs.date}`;
          keyRequired = true; // confirmed — DEMO_KEY still a key
        }
      } catch (err) {
        // 400/403 confirms key required
        if (err.response?.status === 400 || err.response?.status === 403) {
          keyRequired = true;
          sample = 'Key required — register free at fred.stlouisfed.org/docs/api/api_key.html';
        } else {
          // Try the Board of Governors data download (no API key)
          try {
            const boardResp = await axios.get(
              'https://www.federalreserve.gov/releases/h15/20250101/h15.xml',
              { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } }
            );
            if (boardResp.status === 200) {
              latestDate = '2025';
              sample = 'Federal Reserve Board H.15 data (interest rates) accessible as XML/CSV';
              keyRequired = false;
            }
          } catch (_) {}
        }
      }
      return { latestDate, sample, keyRequired };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // UNITED KINGDOM
  // ══════════════════════════════════════════════════════════════════════════

  {
    country: 'UK',
    source:  'ONS — Statistical API v1',
    sourceUrl: 'ons.gov.uk',
    requiresKey: false,
    updateFrequency: 'Monthly / Quarterly / Annual',
    dataDescription: 'CPI / RPI / CPIH inflation (timeseries), GDP (quarterly), ' +
                     'labour market (unemployment/wages/vacancies), trade in goods & services, ' +
                     'population estimates, house prices (HPI), crime (England & Wales). ' +
                     '~10,000+ timeseries; query by series ID or browse datasets.',
    probe: async () => {
      // ONS timeseries data is served at www.ons.gov.uk/{category}/timeseries/{id}/data
      // with Accept: application/json — the api.ons.gov.uk/v1/timeseries path does not exist.
      // D7G7 = CPI 12-month rate, L55O = Unemployment rate (LMS)
      const candidates = [
        { url: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/data', label: 'CPI 12-month rate (D7G7)' },
        { url: 'https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms/data', label: 'Unemployment rate (MGSX/LMS)' },
        { url: 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/czbh/data', label: 'RPI All Items (CZBH)' },
      ];
      const JSON_HEADERS = { 'User-Agent': BROWSER_UA, Accept: 'application/json' };
      let lastErr = null;
      for (const { url, label } of candidates) {
        try {
          const resp = await axios.get(url, { timeout: TIMEOUT_MS, headers: JSON_HEADERS });
          const months = resp.data?.months ?? [];
          if (months.length === 0) continue;
          const latest = months.sort((a, b) => b.date.localeCompare(a.date))[0];
          return {
            latestDate: latest?.date ?? null,
            sample: latest ? `${label}: ${latest.value}% (${latest.label})` : 'n/a',
            description: resp.data?.description?.title ?? null,
            note: 'Served via www.ons.gov.uk/{category}/timeseries/{id}/data with Accept: application/json',
          };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr ?? new Error('All ONS timeseries endpoints returned no data');
    },
  },

  {
    country: 'UK',
    source:  'ONS — Beta API v1 (api.beta.ons.gov.uk)',
    sourceUrl: 'api.beta.ons.gov.uk',
    requiresKey: false,
    updateFrequency: 'Monthly / Quarterly',
    dataDescription: 'Next-generation ONS API with improved dataset discovery and navigation. ' +
                     'Same underlying data as v1 but structured as browsable datasets with editions/versions. ' +
                     'Covers CPIH, GDP, migration (LTIMs), labour market, population. ' +
                     'In active development — not all datasets fully migrated.',
    probe: async () => {
      const resp = await axios.get(
        'https://api.beta.ons.gov.uk/v1/datasets',
        { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } }
      );
      const items = resp.data?.items ?? [];
      const count = resp.data?.total_count ?? items.length;
      return {
        latestDate: new Date().toISOString().slice(0, 10),
        datasetCount: count,
        sample: `${count} datasets available; examples: ${items.slice(0, 3).map(d => d.id ?? d.title).join(', ')}`,
      };
    },
  },

  {
    country: 'UK',
    source:  'data.gov.uk — CKAN API',
    sourceUrl: 'data.gov.uk',
    requiresKey: false,
    updateFrequency: 'Varies by publisher',
    dataDescription: 'ONS economic datasets, Land Registry House Price Index, DfT road casualties, ' +
                     'Home Office crime & policing, MHCLG homelessness & planning, ' +
                     'NHS Digital health statistics, Environment Agency, HMRC tax receipts, ' +
                     'Student Loans Company balances. 50,000+ datasets.',
    probe: async () => {
      // Note: CDN often 403s non-browser UAs in bulk runs
      const resp = await axios.get(
        'https://data.gov.uk/api/3/action/package_search?rows=1&sort=metadata_modified+desc',
        { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } }
      );
      const result = resp.data?.result;
      const pkg    = result?.results?.[0];
      return {
        latestDate:    pkg?.metadata_modified?.slice(0, 10) ?? null,
        totalDatasets: result?.count ?? null,
        sample: `Most recent: "${(pkg?.title ?? 'n/a').slice(0, 60)}"`,
        note: 'Cloudflare CDN may block automated requests; use User-Agent: Mozilla/5.0',
      };
    },
  },

  {
    country: 'UK',
    source:  'Bank of England — Statistical Database (IADB)',
    sourceUrl: 'bankofengland.co.uk',
    requiresKey: false,
    updateFrequency: 'Daily (interest rates) / Monthly (money supply, lending)',
    dataDescription: 'Official Bank Rate, overnight SONIA rate, sterling exchange rate index (ERI), ' +
                     'gilt yields (2y/5y/10y), money supply (M4, Divisia), ' +
                     'bank lending to households & businesses, consumer credit, ' +
                     'mortgage approvals, inflation report (MPC minutes). ' +
                     '40,000+ series. Data served as CSV/Excel via IADB portal; ' +
                     'limited JSON via /boeapps/database/fromshowcolumns.asp endpoint.',
    probe: async () => {
      // BOE IADB: download Bank Rate series as CSV to get latest date
      const resp = await axios.get(
        'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes&Datefrom=01/Jan/2025&Dateto=now&SeriesCodes=IUDBEDR,IUDSNPY&UsingCodes=Y',
        { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA }, responseType: 'text' }
      );
      const lines = String(resp.data).split('\n').filter(l => l.trim() && !l.startsWith('D'));
      const latest = lines[lines.length - 1];
      const parts  = latest?.split(',');
      return {
        latestDate: parts?.[0]?.trim() ?? null,
        sample:     parts ? `Bank Rate: ${parts[1]?.trim()}%, SONIA: ${parts[2]?.trim()}%` : 'n/a',
        format:     'CSV/Excel download (no native JSON REST API)',
        note:       'No JSON REST API; use /boeapps/database/_iadb-FromShowColumns.asp?csv.x=yes for CSV exports',
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // AUSTRALIA
  // ══════════════════════════════════════════════════════════════════════════

  {
    country: 'AU',
    source:  'ABS — SDMX-JSON API',
    sourceUrl: 'abs.gov.au',
    requiresKey: false,
    updateFrequency: 'Monthly (LF, building) / Quarterly (CPI, GDP, RPPI) / Annual (population)',
    dataDescription: 'Labour Force Survey (unemployment rate, employment, participation, hours worked), ' +
                     'Consumer Price Index (all groups + 11 categories, 8 capital cities), ' +
                     'National Accounts (GDP expenditure/income/production, quarterly), ' +
                     'Residential Property Price Index (8 cities), ' +
                     'International Trade (goods & services), Building Approvals, ' +
                     'Australian Demographic Statistics. 100+ dataflows.',
    probe: async () => {
      // CPI latest + LF latest
      const [cpiResp, lfResp] = await Promise.allSettled([
        axios.get(
          'https://api.data.abs.gov.au/data/CPI/1.10001.10.50.Q/?format=jsondata&startPeriod=2024-Q1',
          { timeout: TIMEOUT_MS, headers: { Accept: 'application/vnd.sdmx.data+json' } }
        ),
        axios.get(
          'https://api.data.abs.gov.au/data/LF/1.3.1599.20.M/?format=jsondata&startPeriod=2025-01',
          { timeout: TIMEOUT_MS, headers: { Accept: 'application/vnd.sdmx.data+json' } }
        ),
      ]);

      let cpiDate = null, lfDate = null, cpiVal = null, lfVal = null;

      if (cpiResp.status === 'fulfilled') {
        try {
          const ds   = cpiResp.value.data?.data?.dataSets?.[0];
          const dim  = cpiResp.value.data?.data?.structure?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD');
          const sKeys = Object.keys(ds?.series ?? {});
          if (sKeys.length > 0) {
            const obs   = ds.series[sKeys[0]].observations ?? {};
            const idxs  = Object.keys(obs).map(Number).sort((a, b) => b - a);
            if (idxs.length > 0) {
              cpiDate = dim?.values?.[idxs[0]]?.id ?? null;
              cpiVal  = obs[idxs[0]]?.[0] ?? null;
            }
          }
        } catch (_) {}
      }

      if (lfResp.status === 'fulfilled') {
        try {
          const ds  = lfResp.value.data?.data?.dataSets?.[0];
          const dim = lfResp.value.data?.data?.structure?.dimensions?.observation?.find(d => d.id === 'TIME_PERIOD');
          const sKeys = Object.keys(ds?.series ?? {});
          if (sKeys.length > 0) {
            const obs  = ds.series[sKeys[0]].observations ?? {};
            const idxs = Object.keys(obs).map(Number).sort((a, b) => b - a);
            if (idxs.length > 0) {
              lfDate = dim?.values?.[idxs[0]]?.id ?? null;
              lfVal  = obs[idxs[0]]?.[0] ?? null;
            }
          }
        } catch (_) {}
      }

      return {
        latestDate:   lfDate ?? cpiDate,
        sample:       [
          lfVal  != null ? `Unemployment rate: ${lfVal}% (${lfDate})` : null,
          cpiVal != null ? `CPI index: ${cpiVal} (${cpiDate})` : null,
        ].filter(Boolean).join(' | ') || 'n/a',
      };
    },
  },

  {
    country: 'AU',
    source:  'Reserve Bank of Australia — Statistical Tables',
    sourceUrl: 'rba.gov.au',
    requiresKey: false,
    updateFrequency: 'Daily (cash rate) / Monthly (financial aggregates) / Quarterly (inflation)',
    dataDescription: 'Cash Rate Target and actual cash rate, AUD exchange rates (vs 25 currencies), ' +
                     'housing lending rates (variable/fixed), business lending rates, ' +
                     'money supply (M1/M3/broad money), credit growth (housing/business/personal), ' +
                     'bank balance sheets, bond yields, RBA balance sheet, ' +
                     'consumer inflation expectations. Extensive CSV/Excel tables.',
    probe: async () => {
      // RBA cash rate history — CSV table A2
      const resp = await axios.get(
        'https://www.rba.gov.au/statistics/tables/csv/a2-data.csv',
        { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA }, responseType: 'text' }
      );
      const lines = String(resp.data).split('\n').filter(l => l.trim() && !l.startsWith('Title') && !l.startsWith('Description') && !l.startsWith('Frequency') && !l.startsWith('Type') && !l.startsWith('Units') && !l.startsWith('Source') && !l.startsWith('Publication') && !l.startsWith('Series'));
      const dataLines = lines.filter(l => /^\d{4}/.test(l.trim()));
      const latest = dataLines[dataLines.length - 1];
      const parts  = latest?.split(',');
      return {
        latestDate: parts?.[0]?.trim() ?? null,
        sample:     parts ? `Cash rate target: ${parts[1]?.trim() ?? 'n/a'}%` : 'n/a',
        format:     'CSV/Excel download; no JSON REST API',
        note:       'RBA has no JSON REST API. Data available as CSV via rba.gov.au/statistics/tables/csv/*.csv',
      };
    },
  },

  {
    country: 'AU',
    source:  'data.gov.au — CKAN API',
    sourceUrl: 'data.gov.au',
    requiresKey: false,
    updateFrequency: 'Varies by publisher',
    dataDescription: 'ABS survey data, AIHW health & welfare datasets, ' +
                     'BITRE transport & infrastructure, DHA immigration & visa statistics, ' +
                     'ASIC corporate regulatory data, APRA prudential data, ' +
                     'state police recorded crime, road fatalities, ' +
                     'specialist homelessness services (AIHW). 20,000+ datasets.',
    probe: async () => {
      const resp = await axios.get(
        'https://data.gov.au/data/api/3/action/package_search?rows=1&sort=metadata_modified+desc',
        { timeout: TIMEOUT_MS, maxRedirects: 10, headers: { 'User-Agent': BROWSER_UA } }
      );
      const result = resp.data?.result;
      const pkg    = result?.results?.[0];
      return {
        latestDate:    pkg?.metadata_modified?.slice(0, 10) ?? null,
        totalDatasets: result?.count ?? null,
        sample: `Most recent: "${(pkg?.title ?? 'n/a').slice(0, 60)}"`,
      };
    },
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runProbe(probe) {
  const start = Date.now();
  try {
    const result = await probe.probe();
    return {
      country:         probe.country,
      source:          probe.source,
      sourceUrl:       probe.sourceUrl,
      requiresKey:     result.keyRequired ?? probe.requiresKey,
      dataDescription: probe.dataDescription,
      updateFrequency: probe.updateFrequency,
      latestDate:      result.latestDate   ?? null,
      sample:          result.sample       ?? null,
      note:            result.note         ?? probe.note ?? null,
      status:          'OK',
      responseMs:      Date.now() - start,
      extra:           Object.fromEntries(
        Object.entries(result).filter(([k]) => !['latestDate', 'sample', 'note', 'keyRequired'].includes(k))
      ),
    };
  } catch (err) {
    const status = err.response?.status;
    return {
      country:         probe.country,
      source:          probe.source,
      sourceUrl:       probe.sourceUrl,
      requiresKey:     probe.requiresKey,
      dataDescription: probe.dataDescription,
      updateFrequency: probe.updateFrequency,
      latestDate:      null,
      sample:          null,
      note:            probe.note ?? null,
      status:          status ? `HTTP ${status}` : `ERROR: ${err.message.slice(0, 80)}`,
      responseMs:      Date.now() - start,
      extra:           {},
    };
  }
}

// ─── Table renderer ───────────────────────────────────────────────────────────

function truncate(str, n) {
  if (!str) return '—';
  return String(str).length > n ? String(str).slice(0, n - 1) + '…' : String(str);
}

function pad(str, n, right = false) {
  const s = str == null ? '' : String(str);
  return right ? s.padStart(n) : s.padEnd(n);
}

function printTable(results) {
  const COL = {
    country:   4,
    source:    42,
    data:      52,
    latest:    13,
    key:        4,
    status:    12,
  };

  const SEP = `${'─'.repeat(COL.country + 2)}┼${'─'.repeat(COL.source + 2)}┼${'─'.repeat(COL.data + 2)}┼${'─'.repeat(COL.latest + 2)}┼${'─'.repeat(COL.key + 2)}┼${'─'.repeat(COL.status + 2)}`;

  const row = (c, s, d, l, k, st) =>
    ` ${pad(c, COL.country)} │ ${pad(s, COL.source)} │ ${pad(d, COL.data)} │ ${pad(l, COL.latest)} │ ${pad(k, COL.key)} │ ${pad(st, COL.status)}`;

  console.log('\n' + '═'.repeat(SEP.length));
  console.log(' GOVERNMENT API AUDIT — Civic Voice Engine');
  console.log('═'.repeat(SEP.length));
  console.log(row('JUR', 'Source', 'Data Available', 'Latest Date', 'Key?', 'Status'));
  console.log(SEP);

  let lastCountry = '';
  for (const r of results) {
    if (r.country !== lastCountry && lastCountry !== '') console.log(SEP);
    lastCountry = r.country;
    const keyStr = r.requiresKey ? 'Yes' : 'No';
    const descShort = truncate(r.dataDescription?.split(',').slice(0, 3).join(','), COL.data);
    console.log(row(r.country, truncate(r.source, COL.source), descShort, truncate(r.latestDate, COL.latest), keyStr, truncate(r.status, COL.status)));
    if (r.sample) {
      console.log(row('', '', truncate(`  → ${r.sample}`, COL.data + COL.source + 3), '', '', ''));
    }
  }
  console.log('═'.repeat(SEP.length));
}

function buildMarkdown(results) {
  const header = `| Country | Source | Data Available | Latest Date | Key Required | Status | Update Frequency |
|---|---|---|---|---|---|---|`;

  const rows = results.map(r => {
    const desc  = (r.dataDescription ?? '').replace(/\|/g, '\\|').slice(0, 120);
    const date  = r.latestDate ?? '—';
    const key   = r.requiresKey ? '**Yes**' : 'No';
    const st    = r.status;
    const freq  = r.updateFrequency ?? '—';
    return `| ${r.country} | [${r.source}](https://${r.sourceUrl}) | ${desc} | ${date} | ${key} | ${st} | ${freq} |`;
  });

  const now = new Date().toISOString().slice(0, 10);
  return `# Government API Audit\n_Generated: ${now}_\n\n${header}\n${rows.join('\n')}\n`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[audit] Probing ${PROBES.length} government API sources across CA / US / UK / AU...`);
  console.log('[audit] Running probes (may take 60–90 seconds)...\n');

  // Run all probes — sequential to avoid hammering APIs
  const results = [];
  for (const probe of PROBES) {
    process.stdout.write(`  [${probe.country}] ${probe.source.slice(0, 50).padEnd(50)} ...`);
    const result = await runProbe(probe);
    const icon   = result.status === 'OK' ? '✓' : '✗';
    process.stdout.write(` ${icon} (${result.responseMs}ms)\n`);
    results.push(result);
  }

  printTable(results);

  // ── Save outputs ────────────────────────────────────────────────────────
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  const jsonPath = path.join(OUTPUT_DIR, `api_audit_${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\n[audit] JSON saved → ${jsonPath}`);

  const mdPath = path.join(OUTPUT_DIR, `api_audit_${ts}.md`);
  fs.writeFileSync(mdPath, buildMarkdown(results));
  console.log(`[audit] Markdown saved → ${mdPath}`);

  // Summary
  const ok       = results.filter(r => r.status === 'OK').length;
  const keyNeeded = results.filter(r => r.requiresKey).length;
  const free      = results.length - keyNeeded;
  console.log(`\n[audit] Summary: ${results.length} APIs probed — ${ok} reachable, ${free} free (no key), ${keyNeeded} require key.`);

  return results;
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[audit] Fatal:', err.message); process.exit(1); });
