'use strict';
const axios = require('axios');

async function main() {
  // Try USAspending agency budget authority by year with FTE count
  // Check if there's an FTE field in the agency overview endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/020/overview/', { timeout: 15000 });
    console.log('Overview keys:', Object.keys(r.data || {}));
    console.log(JSON.stringify(r.data, null, 2).substring(0, 500));
  } catch(e) { console.log('Overview:', e.message); }

  // Check agency budgetary resources endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/020/budgetary_resources/', { timeout: 15000 });
    console.log('\nBudgetary resources keys:', Object.keys(r.data || {}));
    const fyData = r.data?.agency_data_by_year?.[0];
    console.log('FY data keys:', fyData ? Object.keys(fyData) : 'none');
  } catch(e) { console.log('Budgetary:', e.message); }

  // Try OPM data via a different path
  // OPM publishes FedScope employment data zip files
  // URL pattern: https://www.fedscope.opm.gov/datadefn/aehri_<Month><Year>.zip
  const testUrls = [
    'https://www.fedscope.opm.gov/datadefn/',
    'https://www.opm.gov/data/index.aspx',
    'https://data.opm.gov/',
  ];
  for (const url of testUrls) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url}: status=${r.status}, len=${r.data.length}`);
      if (r.data.includes('csv') || r.data.includes('download')) {
        const lines = r.data.split('\n').filter(l => l.includes('csv') || l.includes('download')).slice(0, 5);
        lines.forEach(l => console.log(' ', l.substring(0, 150)));
      }
    } catch(e) { console.log(`\n${url}:`, e.message); }
  }
}
main().catch(e => console.error(e.message));
