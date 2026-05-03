'use strict';
const axios = require('axios');

async function main() {
  // Try OPM FedScope data via their newer API (Blazor WebAssembly typically hits /api endpoints)
  const baseUrls = [
    'https://data.opm.gov/api/Agency',
    'https://data.opm.gov/api/Employment',
    'https://data.opm.gov/api/employment/agencies',
    'https://data.opm.gov/api/workforce',
  ];

  for (const url of baseUrls) {
    try {
      const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      console.log(`${url}: ${r.status}`, JSON.stringify(r.data).substring(0, 200));
    } catch(e) { console.log(`${url}: ${e.response?.status || e.message}`); }
  }

  // OMB Budget data with FTE - check MAX.gov or OMB data
  try {
    const r = await axios.get('https://www.whitehouse.gov/omb/budget/', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('\nOMB budget page len:', r.data.length);
    const csvLinks = [...r.data.matchAll(/href="([^"]*\.csv)"/gi)].map(m => m[1]);
    console.log('CSV links:', csvLinks.slice(0, 5));
  } catch(e) { console.log('\nOMB budget:', e.message); }

  // Check usaspending.gov for an FTE field in the program activity endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/097/program_activity/?limit=3', { timeout: 10000 });
    const results = r.data?.results || [];
    if (results[0]) console.log('\nProgram activity keys:', Object.keys(results[0]));
  } catch(e) { console.log('\nProgram activity:', e.message); }

  // Check if USAspending has a federal workforce endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/reporting/agencies/overview/?page=1&limit=3', { timeout: 10000 });
    console.log('\nReporting agencies overview keys:', Object.keys(r.data?.results?.[0] || {}));
    console.log(JSON.stringify(r.data?.results?.[0], null, 2).substring(0, 400));
  } catch(e) { console.log('\nReporting agencies:', e.message); }
}
main().catch(e => console.error(e.message));
