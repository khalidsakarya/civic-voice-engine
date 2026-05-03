'use strict';
const axios = require('axios');

async function main() {
  // Try to find FedScope/OPM API endpoints from the Blazor app
  // Blazor WebAssembly apps typically load from /_framework/ and call /api/ endpoints
  const attempts = [
    'https://data.opm.gov/_blazor/blazor.webassembly.js',
    'https://data.opm.gov/api/DashboardSummary',
    'https://data.opm.gov/api/charts/agency',
    'https://data.opm.gov/api/charts/employment',
    'https://data.opm.gov/api/data/agency',
  ];

  for (const url of attempts) {
    try {
      const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      console.log(`${url}: ${r.status}, len=${String(r.data).length}`);
      if (String(r.data).length < 500) console.log(String(r.data).substring(0, 300));
    } catch(e) { console.log(`${url}: ${e.response?.status || e.message}`); }
  }

  // Try data.opm.gov / FedScope download endpoint - check the page source for API calls
  const r = await axios.get('https://data.opm.gov/explore-data/data/data-downloads', {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = r.data;

  // Look for API URLs in scripts
  const scriptApiMatches = [...html.matchAll(/['"](\/api\/[^'"]+)['"]/g)].map(m => m[1]);
  console.log('\nScript API paths:', [...new Set(scriptApiMatches)].slice(0, 10));

  // Look for download links more carefully
  const allHrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
  const dataLinks = allHrefs.filter(h => h.includes('download') || h.includes('data') || h.includes('csv') || h.includes('xlsx'));
  console.log('\nData-related hrefs:', dataLinks.slice(0, 15));

  // Check for any JSON fetch/XHR targets
  const fetchTargets = [...html.matchAll(/fetch\s*\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  console.log('\nFetch targets:', fetchTargets.slice(0, 10));
}
main().catch(e => console.error(e.message));
