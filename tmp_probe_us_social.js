require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

async function probe(label, fn) {
  try {
    const v = await fn();
    console.log(`OK  ${label}: ${JSON.stringify(v)}`);
  } catch (e) {
    console.log(`ERR ${label}: ${e.message?.slice(0, 120)}`);
  }
}

async function fredLast(series) {
  const r = await axios.get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`, { timeout: T, headers: { 'User-Agent': UA } });
  const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
  const last = lines[lines.length - 1].split(',');
  return { date: last[0], value: parseFloat(last[1]) };
}

async function censusACS1(year, vars) {
  const r = await axios.get(`https://api.census.gov/data/${year}/acs/acs1?get=${vars},NAME&for=us:1`, { timeout: T });
  return { header: r.data[0], values: r.data[1] };
}

async function censusACS1Subject(year, vars) {
  const r = await axios.get(`https://api.census.gov/data/${year}/acs/acs1/subject?get=${vars},NAME&for=us:1`, { timeout: T });
  return { header: r.data[0], values: r.data[1] };
}

(async () => {
  // newBuilds: Census Building Permits Survey BPS (new residential) or FRED
  await probe('FRED HOUST (housing starts, thousands)', () => fredLast('HOUST'));
  await probe('FRED PERMIT (new building permits, thousands)', () => fredLast('PERMIT'));

  // Census BPS API for housing starts
  await probe('Census BPS new residential 2023', async () => {
    const r = await axios.get('https://www.census.gov/construction/bps/json/metro/stfips_2023.json', { timeout: T, headers: { 'User-Agent': UA } });
    return r.data?.slice ? r.data.slice(0, 2) : String(r.data).slice(0, 200);
  });

  // studentDebt: FRED SLOAS (student loans outstanding, billions)
  await probe('FRED SLOAS (student loans outstanding)', () => fredLast('SLOAS'));

  // minWage: FRED FEDMINNFRWG
  await probe('FRED FEDMINNFRWG (federal minimum wage)', () => fredLast('FEDMINNFRWG'));

  // graduation rate: NCES Common Core via Urban Institute
  await probe('Urban NCES CCD dropout/grad rate national 2022', async () => {
    const r = await axios.get('https://educationdata.urban.org/api/v1/schools/ccd/enrollment/2022/?grade=99&sex=99&race=99&level_of_education=1', { timeout: T, headers: { 'User-Agent': UA } });
    return { status: r.status, count: r.data?.count, first: r.data?.results?.[0] };
  });

  // NCES graduation rate: try ACGR via Urban
  await probe('Urban NCES CCD ACGR 2022-23', async () => {
    const r = await axios.get('https://educationdata.urban.org/api/v1/schools/ccd/dropout-completion/2023/', { timeout: T, headers: { 'User-Agent': UA } });
    return { status: r.status, count: r.data?.count, first: r.data?.results?.[0] };
  });

  // NCES grad rate alternative: World Bank SE.SEC.CUAT.UP.ZS (upper secondary completion %)
  await probe('World Bank SE.SEC.CUAT.UP.ZS USA', async () => {
    const r = await axios.get('https://api.worldbank.org/v2/country/US/indicator/SE.SEC.CUAT.UP.ZS?format=json&mrv=5&per_page=5', { timeout: T });
    const rows = r.data?.[1]?.filter(d => d.value != null) ?? [];
    return rows.slice(0, 2).map(d => ({ date: d.date, value: d.value }));
  });

  // NCES school funding: Census Annual Survey of School System Finances (F-33)
  await probe('Census F-33 school finance 2022 API', async () => {
    const r = await axios.get('https://api.census.gov/data/2022/edfin?get=MEMBERFY,TOTALEXP,NAME&for=state:*', { timeout: T });
    return r.data?.slice(0, 2);
  });

  // NCES per pupil expenditure: Census ACS B14002 or NCES digest
  await probe('FRED SLEXPND (state & local education expenditure)', () => fredLast('SLEXPND'));

  // homelessness: HUD AHAR API
  await probe('HUD AHAR national total 2023', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
    return `HTML length: ${r.data?.length}, status: ${r.status}`;
  });

  // HUD programmatic API attempt
  await probe('HUD exchange API homelessness', async () => {
    const r = await axios.get('https://www.hudexchange.info/resource/3031/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us/', { timeout: T, headers: { 'User-Agent': UA } });
    return `HTML length: ${r.data?.length}`;
  });

  // USICH Federal Strategic Plan — try HUD open data
  await probe('HUD Open Data homelessness CSV 2023', async () => {
    const r = await axios.get('https://opendata.dc.gov/datasets/homelessness', { timeout: T });
    return String(r.data).slice(0, 150);
  });

  // DHS immigration admissions: try FRED or Census
  await probe('Census ACS B05012_003E 2023 (foreign-born)', () => censusACS1(2023, 'B05012_003E'));

  // DHS LPR admissions: try data.gov CKAN
  await probe('DHS yearbook LPR 2023 via data.gov', async () => {
    const r = await axios.get('https://catalog.data.gov/api/3/action/datastore_search?resource_id=immigration_lpr&limit=3', { timeout: T, headers: { 'User-Agent': UA } });
    return String(r.data).slice(0, 200);
  });

  // literacy: NCES PIAAC — try data.gov or census
  await probe('World Bank SE.ADT.LITR.ZS USA (adult literacy %)', async () => {
    const r = await axios.get('https://api.worldbank.org/v2/country/US/indicator/SE.ADT.LITR.ZS?format=json&mrv=5&per_page=5', { timeout: T });
    const rows = r.data?.[1]?.filter(d => d.value != null) ?? [];
    return rows.slice(0, 2).map(d => ({ date: d.date, value: d.value }));
  });

  // Census educational attainment as literacy proxy
  await probe('Census ACS B15003_001E (educ attainment base 25+) 2023', () => censusACS1(2023, 'B15003_001E,B15003_002E,B15003_017E'));
  await probe('Census ACS S1501 (educational attainment) 2023', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1/subject?get=S1501_C02_015E,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // student debt: try studentaid.gov
  await probe('StudentAid FSA portfolio API', async () => {
    const r = await axios.get('https://studentaid.gov/data-center/student/portfolio', { timeout: T, headers: { 'User-Agent': UA } });
    return `status: ${r.status}, length: ${r.data?.length}`;
  });

  await probe('StudentAid data center API JSON', async () => {
    const r = await axios.get('https://studentaid.gov/sites/default/files/fsawg/datacenter/library/PortfolioSummary.xls', { timeout: T, headers: { 'User-Agent': UA } });
    return `status: ${r.status}, length: ${r.data?.length}, type: ${r.headers?.['content-type']}`;
  });

  // FRED student loan series
  await probe('FRED NEXALTOTL (student loans total outstanding)', () => fredLast('NEXALTOTL'));

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
