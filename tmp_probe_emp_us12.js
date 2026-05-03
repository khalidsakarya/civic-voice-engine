'use strict';
const axios = require('axios');

async function main() {
  // Sample remaining OPM CSV links to find one with agency employment counts
  const csvLinks = [
    'https://www.opm.gov/data/datasets/Files/107/7dedfaba-87ed-41ae-9993-7a13d90bfcbb.csv',
    'https://www.opm.gov/data/datasets/Files/110/928fc767-965b-4c10-bd70-dd4fa8ed5b24.csv',
    'https://www.opm.gov/data/datasets/Files/113/32d6a612-7e5b-4c5b-a684-0732f538954b.csv',
    'https://www.opm.gov/data/datasets/Files/116/38e9ad4a-cfd2-4114-b211-94b92b281875.csv',
    'https://www.opm.gov/data/datasets/Files/119/f1725b6a-5d14-4b9a-b14c-ce00af729183.csv',
    'https://www.opm.gov/data/datasets/Files/261/38e5dfad-2417-4a5b-bf6d-cf9dd5328c10.csv',
    'https://www.opm.gov/data/datasets/Files/328/0c524923-746c-4916-a916-1db4da53db2f.csv',
  ];

  for (const url of csvLinks) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const firstLine = r.data.split('\n')[0];
      console.log(`${url.split('/').slice(-2,-1)}: ${firstLine.substring(0, 100)}`);
    } catch(e) { console.log(`Error: ${e.message}`); }
  }

  // Try Congress.gov API for agency FTE data
  // Check if OPM publishes "Employment and Trends" report in CSV
  try {
    const r = await axios.get('https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('\nOPM Employment Trends page len:', r.data.length);
    const csvLinks2 = [...r.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls|zip))"/gi)].map(m => m[1]);
    console.log('CSV/XLSX links:', csvLinks2.slice(0, 10));
    const txtLinks = [...r.data.matchAll(/href="([^"]*\.(?:txt|dat))"/gi)].map(m => m[1]);
    console.log('TXT links:', txtLinks.slice(0, 5));
    // Full URL links
    const fullLinks = [...r.data.matchAll(/href="(https?:\/\/[^"]*(?:csv|xlsx|zip|download)[^"]*)"/gi)].map(m => m[1]);
    console.log('Full links:', fullLinks.slice(0, 10));
  } catch(e) { console.log('\nOPM Trends:', e.message); }
}
main().catch(e => console.error(e.message));
