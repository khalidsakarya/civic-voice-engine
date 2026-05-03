'use strict';
const axios = require('axios');

async function main() {
  // data.opm.gov data downloads page
  try {
    const r = await axios.get('https://data.opm.gov/explore-data/data/data-downloads', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    console.log('data.opm.gov downloads page len:', r.data.length);
    // Find download URLs
    const links = [...r.data.matchAll(/href="([^"]*(?:csv|zip|xlsx)[^"]*)"/gi)].map(m => m[1]);
    console.log('Download links:', links.slice(0, 15));

    // Also look for API endpoints
    const apiLinks = [...r.data.matchAll(/\/api\/[^"'\s]+/g)].map(m => m[0]);
    console.log('API paths:', [...new Set(apiLinks)].slice(0, 10));
  } catch(e) { console.log('data.opm.gov downloads:', e.message); }

  // Try the OPM FedScope employment by agency directly via their OLAP API
  // FedScope uses IBM Cognos but has a data cube endpoint
  // Try fetching the employment summary page that lists all agencies
  try {
    const r = await axios.get('https://www.fedscope.opm.gov/', {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('\nFedScope root status:', r.status, 'len:', r.data.length);
    const links = [...r.data.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
    console.log('Links:', links.slice(0, 20));
  } catch(e) { console.log('\nFedScope root:', e.message); }

  // Alternative: USAspending has an employee count via the "New DOGE" data or performance plans
  // Check: https://api.usaspending.gov/api/v2/agency/{code}/sub_agency/
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/097/sub_agency/?limit=5', { timeout: 10000 });
    console.log('\nSub-agency:', JSON.stringify(r.data).substring(0, 400));
  } catch(e) { console.log('\nSub-agency:', e.message); }
}
main().catch(e => console.error(e.message));
