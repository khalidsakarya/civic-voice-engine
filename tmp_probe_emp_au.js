'use strict';
const axios = require('axios');

async function main() {
  // APSC APS employment data
  const resp = await axios.get('https://www.apsc.gov.au/our-work/publications/aps-employment-data', { timeout: 20000 });
  const html = resp.data;

  // Find CSV/XLSX links
  const links = [...html.matchAll(/href="([^"]*(?:csv|xlsx|xls)[^"]*)"/gi)].map(m => m[1]);
  console.log('CSV/XLSX links:');
  links.slice(0, 15).forEach(l => console.log(' ', l));

  // Also find any .csv references
  const csvLinks = [...html.matchAll(/https?:\/\/[^\s"'<>]*\.csv/gi)].map(m => m[0]);
  console.log('\nInline CSV URLs:');
  csvLinks.slice(0, 10).forEach(l => console.log(' ', l));
}
main().catch(e => console.error(e.message));
