require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

(async () => {
  // 1. HUD AHAR - get context around 666666
  const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2023-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
  const html = r.data;
  const idx = html.indexOf('666');
  if (idx >= 0) {
    console.log('Context around 666:', html.slice(Math.max(0, idx-200), idx+200));
  }

  // Also look for any mention of total PIT
  const pitMatch = html.match(/(?:pit|point.in.time|total homeless|all homeless)[^<]{0,200}/gi);
  if (pitMatch) console.log('PIT mentions:', pitMatch.slice(0, 3));

  // Look for any number with surrounding text
  const numRe = /(\d{3},\d{3})[^<]{0,100}(?:homeless|sheltered|unsheltered)/gi;
  const numMatches = [...html.matchAll(numRe)];
  console.log('Num + homeless context:', numMatches.map(m => m[0].slice(0, 150)));

  // Also try different AHAR URL for 2024
  try {
    const r2 = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2024-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
    const html2 = r2.data;
    const big2 = [...html2.matchAll(/\b(\d[\d,]{5,})\b/g)].map(m => m[1]).filter(n => {
      const v = parseInt(n.replace(/,/g,''));
      return v > 400000 && v < 1000000;
    });
    console.log('2024 AHAR big nums:', [...new Set(big2)].slice(0, 10));
  } catch(e) { console.log('2024 AHAR error:', e.message); }

  // FRED SLEXPND - get the series info JSON
  try {
    const r3 = await axios.get('https://api.stlouisfed.org/fred/series?series_id=SLEXPND&api_key=&file_type=json', { timeout: T });
    console.log('SLEXPND info:', JSON.stringify(r3.data).slice(0, 300));
  } catch(e) { console.log('SLEXPND info err:', e.message); }

  // Try FRED observation for SLEXPND (already got 4250)
  // Let me check another series: A955RC1Q027SBEA (state/local educ spending, BEA)
  try {
    const r4 = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=A955RC1Q027SBEA', { timeout: T });
    const lines = r4.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length-1].split(',');
    console.log('A955RC1Q027SBEA (S&L educ SAAR):', { date: last[0], value: last[1] });
    console.log('A955RC1Q027SBEA header:', lines[0]);
  } catch(e) { console.log('A955RC1Q027SBEA err:', e.message); }

  // Census edfin 2021
  try {
    const r5 = await axios.get('https://api.census.gov/data/2021/edfin?get=PPEXPEND,MEMBERFY&for=us:1', { timeout: T });
    console.log('Census edfin 2021 PPEXPEND:', r5.data);
  } catch(e) { console.log('Census edfin 2021 err:', e.message); }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
