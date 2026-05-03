'use strict';
const axios = require('axios');

async function main() {
  // OPM historical table 2 - nondefense agencies
  try {
    const r = await axios.get('https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/historical-tables/table-2-nondefense-executive-branch-civilian-employment-by-agency-1993-to-present/', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    console.log('OPM table 2 len:', r.data.length);
    const csvLinks = [...r.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls))"/gi)].map(m => m[1]);
    console.log('CSV links:', csvLinks.slice(0, 5));

    // Look for table in HTML
    const tables = r.data.match(/<table[\s\S]*?<\/table>/gi) || [];
    console.log('Tables found:', tables.length);
    if (tables[0]) {
      const text = tables[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.log('Table 0 excerpt:', text.substring(0, 500));
    }
  } catch(e) { console.log('OPM table 2:', e.message); }
}
main().catch(e => console.error(e.message));
