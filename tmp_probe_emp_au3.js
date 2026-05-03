'use strict';
const axios = require('axios');

async function main() {
  // Try data.gov.au for APSC employment data
  try {
    const r = await axios.get('https://data.gov.au/api/3/action/package_search?q=APS+employment+agency&rows=10', { timeout: 15000 });
    const results = r.data?.result?.results || [];
    console.log('data.gov.au APS datasets:', results.length);
    results.forEach(d => {
      console.log(' -', d.title, '(' + d.name + ')');
      const downloads = (d.resources || []).filter(r => r.format && ['CSV','XLSX','XLS','ZIP','ODS'].includes(r.format.toUpperCase()));
      downloads.slice(0, 3).forEach(dl => console.log('   ', dl.format, ':', (dl.url || '').substring(0, 100)));
    });
  } catch(e) { console.log('data.gov.au:', e.message); }

  // Try APSC direct CSV
  try {
    const r = await axios.get('https://www.apsc.gov.au/sites/default/files/2024-07/aps-employment-data-31-march-2024.xlsx', {
      timeout: 20000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('\nAPSC XLSX downloaded:', r.data.byteLength, 'bytes');
  } catch(e) { console.log('\nAPSC XLSX:', e.message.substring(0, 60)); }

  // Try APSC API or data portal
  try {
    const r = await axios.get('https://api.apsc.gov.au/employment', { timeout: 10000 });
    console.log('\nAPSC API:', r.status);
  } catch(e) { console.log('\nAPSC API:', e.message.substring(0, 50)); }

  // Try Australian Institute of Health and Welfare data or ABS data
  // ABS (Australian Bureau of Statistics) has employment data
  try {
    const r = await axios.get('https://api.data.abs.gov.au/data/ABS,EMP_CLSFN_OCCUPATION/all?startPeriod=2024&format=jsondata&detail=DataOnly&dimensionAtObservation=AllDimensions', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    console.log('\nABS API:', r.status);
  } catch(e) { console.log('\nABS API:', e.message.substring(0, 50)); }

  // Check if APSC has a different URL pattern for the employment data
  const apscUrls = [
    'https://www.apsc.gov.au/employment-data',
    'https://www.apsc.gov.au/aps-employment-data',
    'https://data.apsc.gov.au/employment',
  ];
  for (const url of apscUrls) {
    try {
      const r = await axios.head(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url}: ${r.status}`);
    } catch(e) { console.log(`\n${url}: ${e.response?.status || e.message.substring(0, 40)}`); }
  }
}
main().catch(e => console.error(e.message));
