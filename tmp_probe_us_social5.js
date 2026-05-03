require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 20000;

async function probe(label, fn) {
  try { const v = await fn(); console.log(`OK  ${label}: ${JSON.stringify(v)}`); }
  catch (e) { console.log(`ERR ${label}: ${e.message?.slice(0, 120)}`); }
}

(async () => {
  // HUD PIT data file URLs
  await probe('HUD PIT Excel 2007-2023', async () => {
    const r = await axios.get('https://www.hudexchange.info/resources/documents/2007-2023-PIT-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status: ${r.status}, size: ${r.data?.byteLength}`;
  });

  await probe('HUD PIT Excel 2007-2024', async () => {
    const r = await axios.get('https://www.hudexchange.info/resources/documents/2007-2024-PIT-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status: ${r.status}, size: ${r.data?.byteLength}`;
  });

  // data.gov HUD homelessness
  await probe('data.gov HUD PIT search', async () => {
    const r = await axios.get('https://catalog.data.gov/api/3/action/package_search?q=point+in+time+homeless+HUD&rows=3', { timeout: T });
    return r.data?.result?.results?.map(d => ({ title: d.title.slice(0,60), id: d.id }))?.slice(0, 3);
  });

  // Try USICH or NAEH
  await probe('HUD open.fema.gov homeless', async () => {
    const r = await axios.get('https://www.opendata.hud.gov/resource/homelessness.json', { timeout: T, headers: { 'User-Agent': UA } });
    return String(r.data).slice(0, 200);
  });

  // ArcGIS HUD open data
  await probe('HUD ArcGIS PIT data', async () => {
    const r = await axios.get('https://hudgis-hud.opendata.arcgis.com/api/v2/datasets?q=homeless+pit&page[size]=3', { timeout: T, headers: { 'User-Agent': UA } });
    return r.data?.data?.slice(0, 2)?.map(d => ({ title: d.attributes?.name, url: d.attributes?.url }));
  });

  // BEA API for education spending (GUEST key)
  await probe('BEA NIPA T31300 education 2023', async () => {
    const r = await axios.get('https://apps.bea.gov/api/data', {
      timeout: T,
      params: { UserID: 'GUEST', method: 'GetData', datasetname: 'NIPA', TableName: 'T31300', Frequency: 'A', Year: '2023', ResultFormat: 'json' }
    });
    const rows = r.data?.BEAAPI?.Results?.Data ?? [];
    const educ = rows.find(d => d.LineDescription?.toLowerCase().includes('education'));
    return { row: educ, total_rows: rows.length };
  });

  // BEA API - check if GUEST key actually works
  await probe('BEA API datasets list', async () => {
    const r = await axios.get('https://apps.bea.gov/api/data?UserID=GUEST&method=GetDataSetList&ResultFormat=json', { timeout: T });
    return r.data?.BEAAPI?.Results?.Dataset?.slice(0, 2)?.map(d => d.DatasetName);
  });

  // NCES ElSi API - per pupil expenditure
  await probe('NCES ELSI public schools finance', async () => {
    const r = await axios.get('https://nces.ed.gov/ccd/elsi/json.aspx?a=1&s1=PPE_TOT&y=2022', { timeout: T, headers: { 'User-Agent': UA } });
    return String(r.data).slice(0, 200);
  });

  // Census Annual Survey of School System Finances (F-33) summary
  await probe('Census F-33 API 2020 per pupil', async () => {
    const r = await axios.get('https://api.census.gov/data/2020/edfin?get=PPEXPEND&for=us:1', { timeout: T });
    return r.data;
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
