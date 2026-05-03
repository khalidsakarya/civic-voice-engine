require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

async function probe(label, fn) {
  try { const v = await fn(); console.log(`OK  ${label}: ${JSON.stringify(v)}`); }
  catch (e) { console.log(`ERR ${label}: ${e.message?.slice(0, 100)}`); }
}

(async () => {
  // 1. HudExchange CoC populations page - look for national total
  await probe('HudExchange CoC HTML parse', async () => {
    const r = await axios.get('https://www.hudexchange.info/programs/coc/coc-homeless-populations-and-subpopulations-reports/', { timeout: T, headers: { 'User-Agent': UA } });
    const html = r.data;
    // Look for large numbers (500k-900k range)
    const big = [...html.matchAll(/\b(\d[\d,]{5,8})\b/g)].map(m => m[1]).filter(n => {
      const v = parseInt(n.replace(/,/g,''));
      return v > 400000 && v < 900000;
    });
    return { big: [...new Set(big)].slice(0, 10), len: html.length };
  });

  // 2. FRED SLGEDU or SLEDU for state/local education spending
  for (const id of ['SLGEDU', 'SLEDU', 'SLXEDU', 'GCFDSA065NDSA', 'G160181A112NBEA']) {
    await probe(`FRED ${id}`, async () => {
      const r = await axios.get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { timeout: 8000 });
      const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
      const last = lines[lines.length-1].split(',');
      return { date: last[0], value: last[1] };
    });
  }

  // 3. A955RC1Q027SBEA series page title to understand what it is
  await probe('FRED A955RC1Q027SBEA page', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/series/A955RC1Q027SBEA', { timeout: T });
    const title = r.data?.match(/<title>([^<]+)/)?.[1];
    // Look for unit description in page
    const unitMatch = r.data?.match(/Billions of Dollars|Millions of Dollars|Percent|Ratio/)?.[0];
    return { title: title?.slice(0, 120), unit: unitMatch };
  });

  // 4. Census ACS B14007 (school enrollment - K-12 public)
  await probe('Census ACS B14007_003E 2023 (public K-12 enrollment)', async () => {
    const r = await axios.get('https://api.census.gov/data/2023/acs/acs1?get=B14007_003E,NAME&for=us:1', { timeout: T });
    return r.data;
  });

  // 5. FRED per-pupil for K-12 specifically (state level)
  await probe('FRED MIEDUEXP (Michigan edu exp per pupil as example)', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MIEDUEXP', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length-1].split(',');
    return { date: last[0], value: last[1] };
  });

  // Per-pupil FRED series format: {2-letter state}EDUEXP e.g. USEDUEXP
  await probe('FRED USEDUEXP (national per pupil)', async () => {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=USEDUEXP', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length-1].split(',');
    return { date: last[0], value: last[1] };
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
