'use strict';
const axios = require('axios');

async function main() {
  // UK Civil Service Statistics 2024
  const pages = [
    'https://www.gov.uk/government/statistics/civil-service-statistics-2024',
    'https://www.gov.uk/government/collections/civil-service-statistics',
  ];

  for (const url of pages) {
    try {
      const r = await axios.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      console.log(`\n${url.split('/').pop()}: status=${r.status}, len=${r.data.length}`);

      // Find CSV/XLSX download links
      const csvLinks = [...r.data.matchAll(/href="(https:\/\/assets\.publishing[^"]*(?:csv|ods|xlsx|xls)[^"]*)"/gi)].map(m => m[1]);
      console.log('CSV/XLSX links:');
      csvLinks.slice(0, 10).forEach(l => console.log(' ', l));

      // Find all GOV.UK asset links
      const assetLinks = [...r.data.matchAll(/href="(https:\/\/assets\.publishing[^"]+)"/gi)].map(m => m[1]);
      console.log('Asset links:');
      assetLinks.slice(0, 10).forEach(l => console.log(' ', l));
    } catch(e) { console.log(`${url.split('/').pop()}:`, e.message); }
  }
}
main().catch(e => console.error(e.message));
