require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

(async () => {
  // 1. Full list of HUD AHAR 2024 data file links
  const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2024-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
  const html = r.data;
  const links = [...html.matchAll(/href="([^"]*(?:xlsx|xls|xlsb|csv|json)[^"]*)"/gi)].map(m => m[1]);
  console.log('All data links:', JSON.stringify(links));

  // 2. NCES Digest dt23_236.75 - parse national per-pupil
  const r2 = await axios.get('https://nces.ed.gov/programs/digest/d23/tables/dt23_236.75.asp', { timeout: T, headers: { 'User-Agent': UA } });
  const html2 = r2.data;
  // Find "United States" row, extract numbers
  const usIdx = html2.search(/United States/i);
  if (usIdx > 0) {
    const segment = html2.slice(usIdx, usIdx + 1000);
    console.log('US row segment:', segment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
    // Extract numbers in range $10k-$25k
    const nums = [...segment.matchAll(/\b(1[0-9],\d{3}|2[0-5],\d{3})\b/g)].map(m => m[1]);
    console.log('Per-pupil numbers near US row:', nums.slice(0, 10));
  }

  // 3. Try HIC State xlsx to see structure
  try {
    const r3 = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-HIC-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    console.log('HIC xlsx status:', r3.status, 'size:', r3.data?.byteLength);
  } catch(e) { console.log('HIC xlsx err:', e.message); }

  // 4. Try PIT counts xlsb - just check if downloadable
  try {
    const r4 = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    console.log('PIT xlsb status:', r4.status, 'size:', r4.data?.byteLength, 'type:', r4.headers?.['content-type']);
  } catch(e) { console.log('PIT xlsb err:', e.message); }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
