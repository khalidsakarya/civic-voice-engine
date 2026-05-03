'use strict';
const axios = require('axios');

async function main() {
  // Try the Blazor API endpoints on data.opm.gov
  // The Blazor app likely calls /api/ or /Employment/ endpoints
  const apiPaths = [
    '/api/EmploymentCube',
    '/api/Workforce',
    '/api/Analytics/Agency',
    '/api/employment/agencies/headcount',
    '/FWD/employment',
    '/api/v1/workforce/agencies',
    '/api/Charts/agency-employment',
  ];

  for (const path of apiPaths) {
    const url = `https://data.opm.gov${path}`;
    try {
      const r = await axios.get(url, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      console.log(`${path}: ${r.status}, len=${String(r.data).length}`);
      console.log(JSON.stringify(r.data).substring(0, 200));
    } catch(e) { console.log(`${path}: ${e.response?.status || e.message.substring(0, 40)}`); }
  }

  // Also try DOGE data
  try {
    const r = await axios.get('https://api.doge.gov/workforce/agencies', { timeout: 10000 });
    console.log('\nDOGE workforce:', r.status, JSON.stringify(r.data).substring(0, 300));
  } catch(e) { console.log('\nDOGE workforce:', e.message); }

  try {
    const r = await axios.get('https://doge.gov/workforce', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('\nDOGE.gov workforce page len:', r.data.length);
  } catch(e) { console.log('\nDOGE.gov:', e.message); }
}
main().catch(e => console.error(e.message));
