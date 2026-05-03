'use strict';
const axios = require('axios');

async function main() {
  // UK Civil Service Statistics
  // https://www.gov.uk/government/collections/civil-service-statistics
  const resp = await axios.get('https://www.gov.uk/government/statistics/civil-service-statistics-2024', { timeout: 15000 });
  const html = resp.data;

  // Find CSV/XLSX download links
  const links = [...html.matchAll(/href="([^"]*(?:csv|xlsx|xls)[^"]*)"/gi)].map(m => m[1]);
  console.log('CSV/XLSX links:');
  links.slice(0, 10).forEach(l => console.log(' ', l));

  // Also check the assets.publishing.service.gov.uk
  const assetLinks = [...html.matchAll(/href="(https:\/\/assets\.publishing[^"]*(?:csv|xlsx)[^"]*)"/gi)].map(m => m[1]);
  console.log('\nAsset links:');
  assetLinks.slice(0, 10).forEach(l => console.log(' ', l));
}
main().catch(e => console.error(e.message));
