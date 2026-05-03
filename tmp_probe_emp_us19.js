'use strict';
const axios = require('axios');

async function main() {
  // USAspending.gov - check if they have workforce/employment endpoint
  const usaSpendingEndpoints = [
    'https://api.usaspending.gov/api/v2/agency/011/federal_account/?limit=1',
    'https://api.usaspending.gov/api/v2/agency/097/awards/count/',
  ];

  // Check the USAspending.gov website for workforce data section
  try {
    const r = await axios.get('https://www.usaspending.gov/agency', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('USAspending agency page len:', r.data.length);
    const keyTerms = ['workforce', 'employee', 'headcount', 'full-time'];
    for (const term of keyTerms) {
      if (r.data.toLowerCase().includes(term)) {
        const idx = r.data.toLowerCase().indexOf(term);
        console.log(`Found "${term}" at ${idx}:`, r.data.substring(Math.max(0, idx - 50), idx + 100));
      }
    }
  } catch(e) { console.log('USAspending agency:', e.message); }

  // Check if there's a workforce API
  const workforceUrls = [
    'https://api.usaspending.gov/api/v2/agency/097/workforce/?fiscal_year=2024',
    'https://api.usaspending.gov/api/v2/workforce/',
    'https://api.usaspending.gov/api/v2/agency/020/fte/',
  ];

  for (const url of workforceUrls) {
    try {
      const r = await axios.get(url, { timeout: 8000 });
      console.log(`${url}: ${r.status}`, JSON.stringify(r.data).substring(0, 200));
    } catch(e) { console.log(`${url}: ${e.response?.status || e.message}`); }
  }

  // Actually, try the OPM "FedScope" employment cube data at the new location
  // OPM moved to data.opm.gov - check if the cube data is available via their API
  // The Blazor app at data.opm.gov calls internal API endpoints
  // Let me try to find the actual API by checking the _framework or _blazor paths
  const blazorPaths = [
    'https://data.opm.gov/_framework/blazor.webassembly.js',
    'https://data.opm.gov/_content/MudBlazor/MudBlazor.min.js',
  ];

  for (const url of blazorPaths) {
    try {
      const r = await axios.head(url, { timeout: 5000 });
      console.log(`${url}: ${r.status}`);
    } catch(e) { console.log(`${url}: ${e.response?.status || e.message}`); }
  }
}
main().catch(e => console.error(e.message));
