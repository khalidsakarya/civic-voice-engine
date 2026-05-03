'use strict';
const axios = require('axios');

async function main() {
  // OPM Employment Trends (monthly/quarterly) - Table E1 or similar
  // Try to find the right URL
  const urls = [
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/historical-tables/',
  ];

  for (const url of urls) {
    try {
      const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url.split('/').slice(-2,-1)}: status=${r.status}, len=${r.data.length}`);
      const csvLinks = [...r.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls|zip))"/gi)].map(m => m[1]);
      console.log('CSV/XLSX links:', csvLinks.slice(0, 10));
      const xlsxFullLinks = [...r.data.matchAll(/href="(https?:\/\/[^"]*\.(?:csv|xlsx|xls|zip))"/gi)].map(m => m[1]);
      console.log('Full CSV links:', xlsxFullLinks.slice(0, 5));

      // Look for text mentions of agency employment data
      const links = [...r.data.matchAll(/href="([^"]+)">([^<]+)<\/a>/gi)]
        .filter(m => m[2].toLowerCase().includes('agenc') || m[2].toLowerCase().includes('employ'))
        .slice(0, 10);
      links.forEach(m => console.log(' Link:', m[2], '->', m[1]));
    } catch(e) { console.log(`${url.split('/').slice(-2,-1)}:`, e.message); }
  }
}
main().catch(e => console.error(e.message));
