'use strict';
const axios = require('axios');

async function main() {
  // Federal Civilian Employment page - has quarterly data by agency
  const url = 'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/federal-civilian-employment/';
  try {
    const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('Federal Civilian Employment page len:', r.data.length);
    const csvLinks = [...r.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls|zip))"/gi)].map(m => m[1]);
    console.log('CSV/XLSX links:', csvLinks.slice(0, 10));

    // Look for embedded data or links
    const links = [...r.data.matchAll(/href="([^"]+)"/gi)].map(m => m[1]).filter(h =>
      h.includes('xls') || h.includes('csv') || h.includes('download') || h.includes('.pdf') || h.includes('table')
    );
    console.log('Related links:', links.slice(0, 10));

    // Look for data tables in HTML
    const tables = r.data.match(/<table[\s\S]*?<\/table>/gi) || [];
    console.log('Tables found:', tables.length);
    if (tables[0]) {
      const text = tables[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      console.log('Table excerpt:', text.substring(0, 800));
    }
  } catch(e) { console.log('Error:', e.message); }
}
main().catch(e => console.error(e.message));
