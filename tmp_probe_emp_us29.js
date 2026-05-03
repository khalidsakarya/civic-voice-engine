'use strict';
const axios = require('axios');

async function main() {
  // Check USAspending.gov for workforce data - DOGE integration in 2025
  // Try the workforce-related API endpoints
  const workforceEndpoints = [
    'https://api.usaspending.gov/api/v2/federal_workforce/agencies/',
    'https://api.usaspending.gov/api/v2/federal_workforce/overview/',
    'https://api.usaspending.gov/api/v2/workforce/agencies/',
    'https://api.usaspending.gov/api/v2/agency/097/workforce_size/',
  ];

  for (const url of workforceEndpoints) {
    try {
      const r = await axios.get(url, { timeout: 8000 });
      console.log(`${url.split('/api/v2/')[1]}: ${r.status}`, JSON.stringify(r.data).substring(0, 300));
    } catch(e) { console.log(`${url.split('/api/v2/')[1]}: ${e.response?.status || e.message.substring(0, 40)}`); }
  }

  // Try the USA Spending website directly for workforce data - check if there's a dedicated section
  try {
    const r = await axios.get('https://www.usaspending.gov/federal_workforce', {
      timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('\nUSAspending federal_workforce page len:', r.data.length);
  } catch(e) { console.log('\nUSAspending federal_workforce:', e.response?.status || e.message); }

  // Check the DOGE savings data (DOGE was tracking workforce reductions in 2025)
  try {
    const r = await axios.get('https://savings.doge.gov/api/agencies', { timeout: 10000 });
    console.log('\nDOGE savings agencies:', r.status, JSON.stringify(r.data).substring(0, 300));
  } catch(e) { console.log('\nDOGE savings agencies:', e.response?.status || e.message.substring(0, 50)); }

  try {
    const r = await axios.get('https://savings.doge.gov/', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('\nDOGE savings page len:', r.data.length);
    const links = [...r.data.matchAll(/href="([^"]+)"/gi)].map(m => m[1]).filter(h => h.includes('api') || h.includes('data'));
    console.log('Data links:', links.slice(0, 10));
  } catch(e) { console.log('\nDOGE savings:', e.response?.status || e.message.substring(0, 50)); }
}
main().catch(e => console.error(e.message));
