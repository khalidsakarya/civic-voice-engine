'use strict';
const axios = require('axios');

async function main() {
  // APSC APS employment data - try with longer timeout and different headers
  const urls = [
    'https://www.apsc.gov.au/our-work/publications/aps-employment-data',
    'https://www.apsc.gov.au/our-work/publications/aps-employment-data/aps-employment-data-31-december-2024',
    'https://www.apsc.gov.au/our-work/publications/aps-employment-data/aps-employment-data-30-june-2024',
    'https://www.apsc.gov.au/our-work/publications/aps-employment-data/aps-employment-data-31-march-2025',
  ];

  for (const url of urls) {
    try {
      const r = await axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      console.log(`\n${url.split('/').pop()}: status=${r.status}, len=${r.data.length}`);
      // Find CSV/XLSX links
      const csvLinks = [...r.data.matchAll(/href="([^"]*(?:csv|xlsx|xls)[^"]*)"/gi)].map(m => m[1]);
      console.log('CSV/XLSX links:', csvLinks.slice(0, 10));
      // Find file links
      const fileLinks = [...r.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls|zip))"/gi)].map(m => m[1]);
      console.log('File links:', fileLinks.slice(0, 10));
    } catch(e) { console.log(`${url.split('/').pop()}:`, e.message.substring(0, 60)); }
  }
}
main().catch(e => console.error(e.message));
