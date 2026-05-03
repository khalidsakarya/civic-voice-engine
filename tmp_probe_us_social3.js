require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

async function probe(label, fn) {
  try { const v = await fn(); console.log(`OK  ${label}: ${JSON.stringify(v)}`); }
  catch (e) { console.log(`ERR ${label}: ${e.message?.slice(0, 120)}`); }
}

(async () => {
  // 1. HUD AHAR 2023 - more careful parse
  await probe('HUD AHAR 2023 parse all big numbers', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
    const html = r.data;
    // Find all numbers that could be the total (500k-800k range)
    const big = [...html.matchAll(/\b(\d[\d,]{4,})\b/g)].map(m => m[1]).filter(n => {
      const v = parseInt(n.replace(/,/g,''));
      return v > 400000 && v < 900000;
    });
    // Also look for key text context
    const ctx = [];
    const re2 = /(\d[\d,]+)\s*(people|persons|individuals|homeless)/gi;
    let m; while ((m = re2.exec(html)) !== null) ctx.push(m[0].slice(0,80));
    return { big_nums: [...new Set(big)].slice(0, 10), ctx: ctx.slice(0, 5) };
  });

  // 2. Try HUD exchange PIT data
  await probe('HUD PIT state xlsx 2023', async () => {
    const r = await axios.get('https://www.hudexchange.info/resource/5948/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us/', { timeout: T, headers: { 'User-Agent': UA } });
    return `status: ${r.status}, len: ${r.data?.length}`;
  });

  // 3. Try HUD API v1
  await probe('HUD open data API datasets', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar.html', { timeout: T, headers: { 'User-Agent': UA } });
    const html = r.data;
    // Look for CSV/XLS download links
    const links = [...html.matchAll(/href="([^"]*(?:csv|xls|xlsx|json)[^"]*)"/gi)].map(m => m[1]).slice(0, 5);
    return links;
  });

  // 4. data.gov EDFacts graduation rate
  await probe('data.gov EDFacts grad 2017-18 datastore', async () => {
    const r = await axios.get('https://catalog.data.gov/api/3/action/datastore_search?resource_id=2bf3e5b0-9a28-4c75-a359-ad584d5c8dea&limit=3', { timeout: T });
    const recs = r.data?.result?.records ?? [];
    return { count: r.data?.result?.total, sample: recs.slice(0, 1) };
  });

  // 5. Census ACS S1501 HS graduation rates
  await probe('Census ACS S1501_C02_014E 2023 (HS+ % for 25+)', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1/subject?get=S1501_C02_014E,S1501_C02_009E,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // 6. FRED SLEXPND verify - what is this series actually?
  await probe('FRED SLEXPND info', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=SLEXPND', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l);
    // Get first line (header) and last 3 data lines
    return { header: lines[0], recent: lines.slice(-3) };
  });

  // 7. Census ACS B14002 school enrollment
  await probe('Census ACS SLEXPND alternative: NCES IPEDS per pupil', async () => {
    // Try Census edfin with different syntax
    const r = await axios.get('https://api.census.gov/data/2021/edfin?get=MEMBERFY,PPEXPEND&for=us:1', { timeout: T });
    return r.data;
  });

  // 8. Census edfin API variables
  await probe('Census edfin 2022 API variables', async () => {
    const r = await axios.get('https://api.census.gov/data/2022/edfin/variables.json', { timeout: T });
    const vars = Object.keys(r.data?.variables ?? {});
    return vars.filter(v => v.includes('PP') || v.includes('EXPEND')).slice(0, 10);
  });

  // 9. DHS admissions: try a direct API
  await probe('DHS open data portal search', async () => {
    const r = await axios.get('https://www.dhs.gov/sites/default/files/2024-09/24_0927_ois_lpr_fr_2023.pdf', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status: ${r.status}, size: ${r.data?.byteLength}`;
  });

  // 10. FRED Immigration proxy: USIMMIG or similar
  await probe('FRED IMMLEGAL (legal immigration admissions)', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=IMMLEGAL', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    return lines.slice(-2);
  });

  // 11. Census nativity B05012_003E confirmed, but also check admissions proxy
  // DHS admissions from FRED? Not likely. Use census foreign-born as confirmed proxy.

  // 12. Check what S1501_C02_009E actually is
  await probe('Census ACS S1501 table description', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1/subject/variables/S1501_C02_009E.json', { timeout: T });
    return { label: r.data?.label, concept: r.data?.concept };
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
