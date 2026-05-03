'use strict';
const axios = require('axios');

async function main() {
  // Check OPM FedScope page - the actual data publication page
  try {
    const r = await axios.get('https://www.opm.gov/policy-data-oversight/data-analysis-documentation/fedscope/', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    console.log('FedScope page len:', r.data.length);
    // Find data download links
    const links = [...r.data.matchAll(/href="([^"]+)"/gi)].map(m => m[1])
      .filter(h => !h.startsWith('#') && !h.startsWith('/cdn') && !h.startsWith('/css'));
    const contentLinks = links.filter(h =>
      h.includes('employ') || h.includes('download') || h.includes('cube') ||
      h.includes('.zip') || h.includes('.csv') || h.includes('.xlsx') ||
      h.includes('fedscope') || h.includes('data')
    );
    console.log('Relevant links:', contentLinks.slice(0, 20));

    // Print full list of non-nav links
    const contentLinksAll = links.filter(h => h.length > 5 && !h.includes('opm.gov/policy') && !h.includes('opm.gov/about'));
    console.log('\nAll content links:');
    contentLinksAll.slice(0, 30).forEach(l => console.log(' ', l));
  } catch(e) { console.log('FedScope page:', e.message); }
}
main().catch(e => console.error(e.message));
