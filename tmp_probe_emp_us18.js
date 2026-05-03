'use strict';
const axios = require('axios');

async function main() {
  // Get the full data downloads page source
  const r = await axios.get('https://data.opm.gov/explore-data/data/data-downloads', {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = r.data;

  // Print all hrefs
  const allHrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
  console.log('All hrefs:');
  allHrefs.forEach(h => console.log(' ', h));

  // Print any window. assignments or JS data
  const windowAssigns = [...html.matchAll(/window\.\w+\s*=\s*([^;]+);/gi)].map(m => m[0]);
  console.log('\nWindow assignments:', windowAssigns.slice(0, 5));

  // Check for downloadFileFromUrl calls
  const downloadCalls = [...html.matchAll(/downloadFileFromUrl[^;]+;/gi)].map(m => m[0]);
  console.log('\nDownload calls:', downloadCalls.slice(0, 5));

  // Print section around "FWD"
  const fwdIdx = html.indexOf('FWD');
  if (fwdIdx > -1) {
    console.log('\nAround FWD:', html.substring(fwdIdx - 200, fwdIdx + 300));
  }
}
main().catch(e => console.error(e.message));
