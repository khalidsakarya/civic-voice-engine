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

(async () => {
  // 1. Parse HUD AHAR HTML for national total homeless
  await probe('HUD AHAR 2023 HTML parse', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
    const html = r.data;
    // Look for total homeless number (typically 600k+)
    const patterns = [
      /(\d{3},\d{3})\s*people\s*experienced\s*homelessness/i,
      /total.*?(\d{3},\d{3})/i,
      /(\d{3},\d{3})\s*individuals/i,
      /point.in.time.*?(\d{3},\d{3})/i,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) return { match: p.toString(), value: m[1] };
    }
    // Extract all 6-digit numbers
    const nums = [...html.matchAll(/\b(\d{3},\d{3})\b/g)].map(m => m[1]);
    return { sample_nums: nums.slice(0, 10) };
  });

  // 2. Try HUD open data API
  await probe('HUD open data API endpoint', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2023-PIT-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status: ${r.status}, size: ${r.data?.byteLength}`;
  });

  // 3. HUD data via HUD Exchange
  await probe('HUD PIT CSV download', async () => {
    const r = await axios.get('https://www.hudexchange.info/programs/coc/coc-homeless-populations-and-subpopulations-reports/download/', { timeout: T, headers: { 'User-Agent': UA } });
    return `status: ${r.status}`;
  });

  // 4. Graduation rate: try data.gov NCES dataset
  await probe('data.gov NCES ACGR search', async () => {
    const r = await axios.get('https://catalog.data.gov/api/3/action/package_search?q=adjusted+cohort+graduation+rate&rows=3', { timeout: T });
    return r.data?.result?.results?.map(d => ({ title: d.title, id: d.id }))?.slice(0, 3);
  });

  // 5. NCES ACGR via data.ed.gov
  await probe('data.ed.gov ACGR search', async () => {
    const r = await axios.get('https://api.ed.gov/data/v1/datasets?keyword=graduation+rate&per_page=5', { timeout: T, headers: { 'User-Agent': UA } });
    return r.data?.slice ? r.data.slice(0, 200) : String(r.data).slice(0, 200);
  });

  // 6. FRED SEOUTFGRTQ (high school graduation rate) - check if exists
  await probe('FRED HSGRRT (high school grad rate)', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=HSGRRT', { timeout: T, headers: { 'User-Agent': UA } });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length - 1].split(',');
    return { date: last[0], value: last[1] };
  });

  // 7. World Bank high school completion (SE.SEC.CUAT.UP.ZS) - shorter timeout retry
  await probe('World Bank SE.SEC.CUAT.UP.ZS USA (secondary completion)', async () => {
    const r = await axios.get('https://api.worldbank.org/v2/country/US/indicator/SE.SEC.CUAT.UP.ZS?format=json&mrv=3&per_page=3', { timeout: 15000 });
    const rows = r.data?.[1]?.filter(d => d.value != null) ?? [];
    return rows.slice(0, 2).map(d => ({ date: d.date, value: d.value }));
  });

  // 8. Census ACS S1501_C02_009E - high school diploma or higher
  await probe('Census ACS S1501_C02_009E 2023 (HS diploma+ %)', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1/subject?get=S1501_C02_009E,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // 9. Per pupil expenditure: FRED PPEDUEXP or similar
  await probe('FRED PPEDUEXP (per pupil expenditure)', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=PPEDUEXP', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length - 1].split(',');
    return { date: last[0], value: last[1] };
  });

  // 10. Census edfin per pupil expenditure
  await probe('Census edfin 2022 per pupil (PPEXPEND)', async () => {
    const r = await axios.get('https://api.census.gov/data/2022/edfin?get=MEMBERFY,PPEXPEND,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // 11. Literacy: Census ACS B992701 (English-speaking ability)
  await probe('Census ACS S1601 (language at home) 2023', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1/subject?get=S1601_C01_001E,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // 12. Census ACS S1501_C02_015E (bachelor+) already confirmed = 36.2%
  // Use S1501_C02_009E (HS+) as literacy proxy

  // 13. Check FRED for graduation rate
  await probe('FRED GRADRATE or similar', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=GRADRATE', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length - 1].split(',');
    return { date: last[0], value: last[1] };
  });

  // 14. Check NCES digest table via data.gov
  await probe('data.gov NCES digest datastore', async () => {
    const r = await axios.get('https://catalog.data.gov/api/3/action/datastore_search?resource_id=nces-acgr-2023&limit=2', { timeout: T });
    return String(r.data).slice(0, 200);
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
