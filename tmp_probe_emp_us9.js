'use strict';
const axios = require('axios');

async function main() {
  // FedScope analytics page for workforce composition (agency view)
  // Check if there's a public API that powers the charts
  try {
    const r = await axios.get('https://www.fedscope.opm.gov/explore-data/analytics/workforce-size-and-composition', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    console.log('FedScope analytics page len:', r.data.length);
    const apiMatches = [...r.data.matchAll(/https?:\/\/[^\s"']+api[^\s"']+/gi)].map(m => m[0]);
    console.log('API URLs found:', [...new Set(apiMatches)].slice(0, 10));
  } catch(e) { console.log('FedScope analytics:', e.message); }

  // data.opm.gov - check if there's a Blazor/API endpoint for employment data
  try {
    const r = await axios.get('https://data.opm.gov/api/v1/employment/agency', { timeout: 10000 });
    console.log('\nOPM employment API:', r.status, JSON.stringify(r.data).substring(0, 200));
  } catch(e) { console.log('\nOPM employment API:', e.message); }

  // Try usajobs.gov statistics
  try {
    const r = await axios.get('https://developer.usajobs.gov/api-reference/', { timeout: 10000 });
    console.log('\nUSAJOBS API page len:', r.data.length);
  } catch(e) { console.log('\nUSAJOBS:', e.message); }

  // Check BLS OES data - federal government employment by major group
  try {
    const r = await axios.get('https://api.bls.gov/publicAPI/v2/timeseries/data/CEU9091000001', { timeout: 10000 });
    console.log('\nBLS federal employment:', r.status);
    console.log(JSON.stringify(r.data?.Results?.series?.[0]?.data?.slice(0, 3), null, 2));
  } catch(e) { console.log('\nBLS:', e.message); }

  // Try the OPM FedScope CSV download endpoint (newer URL patterns)
  const opmCsvUrls = [
    'https://www.fedscope.opm.gov/datadefn/aehri_September2024.csv',
    'https://data.opm.gov/api/v2/employment/download?format=csv&agency=all',
    'https://data.opm.gov/data-downloads/employment',
  ];
  for (const url of opmCsvUrls) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url}: status=${r.status}, len=${r.data.length}`);
      console.log(String(r.data).substring(0, 200));
    } catch(e) { console.log(`\n${url}:`, e.message); }
  }
}
main().catch(e => console.error(e.message));
