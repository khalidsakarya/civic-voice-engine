require('dotenv').config();
const axios = require('axios');
const T = 20000;

(async () => {
  // data.gov CoC homeless dataset
  try {
    const r = await axios.get('https://catalog.data.gov/api/3/action/datastore_search?resource_id=c2bbf21f-e342-4cd0-9c2e-8a414fec4966&limit=3', { timeout: T });
    console.log('CoC dataset:', JSON.stringify(r.data?.result?.records?.slice(0, 2)));
    console.log('CoC total:', r.data?.result?.total);
    console.log('CoC fields:', r.data?.result?.fields?.map(f => f.id)?.slice(0, 20));
  } catch(e) { console.log('CoC err:', e.message); }

  // Try package show to find resource IDs for CoC data
  try {
    const r = await axios.get('https://catalog.data.gov/api/3/action/package_show?id=c2bbf21f-e342-4cd0-9c2e-8a414fec4966', { timeout: T });
    const resources = r.data?.result?.resources?.map(res => ({ name: res.name, id: res.id, format: res.format, url: res.url }));
    console.log('CoC resources:', JSON.stringify(resources?.slice(0, 5)));
  } catch(e) { console.log('CoC package err:', e.message); }

  // Census edfin check - which years are available
  for (const yr of [2019, 2018, 2017]) {
    try {
      const r = await axios.get(`https://api.census.gov/data/${yr}/edfin?get=PPEXPEND&for=us:1`, { timeout: 8000 });
      console.log(`Census edfin ${yr} PPEXPEND:`, r.data);
      break;
    } catch(e) { console.log(`Census edfin ${yr} err:`, e.message.slice(0, 60)); }
  }

  // Check FRED for a per-pupil series
  try {
    const r = await axios.get('https://fred.stlouisfed.org/graph/fredgraph.csv?id=HPERE', { timeout: T });
    const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
    const last = lines[lines.length-1].split(',');
    console.log('FRED HPERE:', { date: last[0], value: last[1] });
  } catch(e) { console.log('FRED HPERE err:', e.message); }

  // FRED public education spending per pupil (search common series IDs)
  for (const id of ['PEREDUEXPSE', 'EDUEXPSE', 'K12PPEXP']) {
    try {
      const r = await axios.get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, { timeout: 8000 });
      const lines = r.data.trim().split('\n').filter(l => l && !l.startsWith('DATE'));
      const last = lines[lines.length-1].split(',');
      console.log(`FRED ${id}:`, { date: last[0], value: last[1] });
    } catch(e) { console.log(`FRED ${id} err:`, e.message.slice(0,50)); }
  }

  // Check what SLEXPND actually is by fetching the series page title
  try {
    const r = await axios.get('https://fred.stlouisfed.org/series/SLEXPND', { timeout: T });
    const title = r.data?.match(/<title>([^<]+)<\/title>/)?.[1];
    const units = r.data?.match(/Units:.*?<.*?>(.*?)</s)?.[0]?.slice(0, 200);
    console.log('SLEXPND page title:', title?.slice(0, 150));
  } catch(e) { console.log('SLEXPND page err:', e.message); }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
