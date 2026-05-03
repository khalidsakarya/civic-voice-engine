'use strict';
const axios = require('axios');

async function main() {
  // Check USAspending agency employees endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/020/employees/', { timeout: 15000 });
    console.log('Employees endpoint keys:', Object.keys(r.data));
    console.log(JSON.stringify(r.data, null, 2).substring(0, 500));
  } catch(e) { console.log('employees endpoint:', e.message); }

  // OPM FedScope - check data.gov package
  try {
    const r = await axios.get('https://catalog.data.gov/api/3/action/package_search?q=OPM+fedscope+employment+federal&rows=5', { timeout: 15000 });
    const datasets = r.data?.result?.results || [];
    datasets.forEach(d => console.log('\nDataset:', d.name, '-', d.title));
    if (datasets[0]) {
      const resources = datasets[0].resources || [];
      resources.slice(0, 5).forEach(r => console.log('  resource:', r.name, r.url?.substring(0, 100)));
    }
  } catch(e) { console.log('data.gov:', e.message); }

  // OPM FedScope cube data endpoint
  try {
    // FedScope employment data available via OPM open data
    const r = await axios.get('https://www.opm.gov/data/datasets/', { timeout: 15000 });
    console.log('\nOPM data page len:', r.data.length);
    const csvLinks = [...r.data.matchAll(/href="([^"]*(?:csv|xlsx)[^"]*)"/gi)].map(m => m[1]);
    console.log('CSV links:', csvLinks.slice(0, 5));
  } catch(e) { console.log('OPM:', e.message); }

  // Try USAJobs API
  // Try BLS federal employment by agency - not directly available via API

  // Check OPM FedScope employment CSV (annual)
  // https://www.fedscope.opm.gov/datadefn/aehri_September2024.zip
  // Try the direct FedScope employment summary
  try {
    const r = await axios.get('https://www.fedscope.opm.gov/employment.asp', { timeout: 10000 });
    console.log('\nFedScope emp page len:', r.data.length);
    const links = [...r.data.matchAll(/href="([^"]*(?:csv|zip|xlsx)[^"]*)"/gi)].map(m => m[1]);
    console.log('Links:', links.slice(0, 10));
  } catch(e) { console.log('FedScope emp:', e.message); }
}
main().catch(e => console.error(e.message));
