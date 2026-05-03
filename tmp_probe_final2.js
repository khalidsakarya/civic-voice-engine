require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

async function probe(label, fn) {
  try { const v = await fn(); console.log(`OK  ${label}: ${JSON.stringify(v).slice(0,300)}`); }
  catch (e) { console.log(`ERR ${label}: ${e.message?.slice(0, 100)}`); }
}

(async () => {
  // NAEP Nations Report Card API - 4th grade reading national average score
  await probe('NAEP NDE 4th grade reading national', async () => {
    const r = await axios.get('https://www.nationsreportcard.gov/Datavisualization/GetChartData', {
      timeout: T,
      params: { subject: 'reading', grade: '4', stattype: 'MN:MN', year: '2024', jurisdiction: 'NP' },
      headers: { 'User-Agent': UA }
    });
    return r.data;
  });

  await probe('NAEP API endpoint 2', async () => {
    const r = await axios.get('https://www.nationsreportcard.gov/api/api/data/FINDBOOKMARK/Mfol0/0?subject=R&grade=4&stattype=MN:MN&jurisdiction=NP&subscale=RRPCM', {
      timeout: T, headers: { 'User-Agent': UA }
    });
    return r.data;
  });

  // NCES Digest per-pupil table
  await probe('NCES Digest d23 per-pupil table', async () => {
    const r = await axios.get('https://nces.ed.gov/programs/digest/d23/tables/dt23_236.65.asp', { timeout: T, headers: { 'User-Agent': UA } });
    // Extract key number - look for $XX,XXX pattern
    const matches = [...r.data.matchAll(/\$?\s*([\d,]+)\s*(?:per student|per pupil)/gi)];
    const numbers = [...r.data.matchAll(/\b(1[0-9],\d{3})\b/g)].map(m => m[1]).slice(0,5);
    return { len: r.data.length, per_pupil_matches: matches.slice(0,3).map(m=>m[0]), numbers };
  });

  await probe('NCES Digest d22 per-pupil table', async () => {
    const r = await axios.get('https://nces.ed.gov/programs/digest/d22/tables/dt22_236.65.asp', { timeout: T, headers: { 'User-Agent': UA } });
    const numbers = [...r.data.matchAll(/\b(1[0-9],\d{3})\b/g)].map(m => m[1]).slice(0,5);
    return { len: r.data.length, numbers };
  });

  // NCES per-pupil via a different table
  await probe('NCES Digest Table 2 per pupil expenditure', async () => {
    const r = await axios.get('https://nces.ed.gov/programs/digest/d23/tables/dt23_236.75.asp', { timeout: T, headers: { 'User-Agent': UA } });
    const numbers = [...r.data.matchAll(/\b(1[0-9],\d{3})\b/g)].map(m => m[1]).slice(0,5);
    return { len: r.data.length, numbers };
  });

  // HUD AHAR 2024 HTML - check for links to data files
  await probe('HUD AHAR 2024 page links', async () => {
    const r = await axios.get('https://www.huduser.gov/portal/datasets/ahar/2024-ahar-part-1-pit-estimates-of-homelessness-in-the-us.html', { timeout: T, headers: { 'User-Agent': UA } });
    const html = r.data;
    const links = [...html.matchAll(/href="([^"]*(?:xlsx|xls|csv|json)[^"]*)"/gi)].map(m => m[1]).slice(0, 10);
    const allLinks = [...html.matchAll(/href="([^"#][^"]*)"/gi)].map(m => m[1]).filter(l => l.includes('2024') || l.includes('2023')).slice(0, 10);
    return { data_links: links, year_links: allLinks };
  });

  // BEA API with GUEST key - try GetParameterValues
  await probe('BEA API NIPA GetParameterValues', async () => {
    const r = await axios.get('https://apps.bea.gov/api/data', {
      timeout: T,
      params: { UserID: 'GUEST', method: 'GetParameterValues', datasetname: 'NIPA', ParameterName: 'TableName', ResultFormat: 'json' }
    });
    return JSON.stringify(r.data).slice(0, 300);
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
