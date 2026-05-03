'use strict';
const axios = require('axios');

async function main() {
  // Read blazor.webassembly.js to find API endpoint URLs
  try {
    const r = await axios.get('https://data.opm.gov/_framework/blazor.webassembly.js', {
      timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const js = r.data;
    console.log('JS length:', js.length);

    // Find API-related strings
    const apiMatches = [...js.matchAll(/"(\/api\/[^"]+)"/g)].map(m => m[1]);
    console.log('API paths in JS:', [...new Set(apiMatches)].slice(0, 20));

    // Find any URL patterns
    const urlMatches = [...js.matchAll(/"(https?:\/\/[^"]+)"/g)].map(m => m[1]);
    console.log('\nFull URLs:', urlMatches.slice(0, 10));

    // Find download-related strings
    const dlMatches = [...js.matchAll(/"([^"]*(?:download|Employment|Cube|FWD|csv|zip)[^"]*)"/gi)].map(m => m[1]);
    console.log('\nDownload-related strings:', [...new Set(dlMatches)].slice(0, 15));
  } catch(e) { console.log('blazor.js:', e.message); }
}
main().catch(e => console.error(e.message));
