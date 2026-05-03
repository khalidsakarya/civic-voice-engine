'use strict';
const axios = require('axios');

async function main() {
  // OPM publishes "Employment Trends" quarterly - check for downloadable Excel tables
  // The OPM Employment Trends reports are at specific URLs
  const urls = [
    // Known OPM employment trends reports (Excel/PDF)
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/federal-civilian-employment/',
  ];

  for (const url of urls) {
    try {
      const r = await axios.get(url, { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
      const html = r.data;
      console.log('Page len:', html.length);

      // Find all links in the page
      const links = [...html.matchAll(/href="([^"]+)"/gi)].map(m => m[1]);
      console.log('All links count:', links.length);
      links.forEach(l => console.log(' ', l));
    } catch(e) { console.log('Error:', e.message); }
  }

  // Try to access one of the OPM employment trend reports directly
  // These are typically at opm.gov in PDF or Excel format with specific filename patterns
  const directFiles = [
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/2024/09/September-2024.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/2024/12/December-2024.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/2024/september/Sept-2024.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/2024/september-2024.xlsx',
  ];

  for (const url of directFiles) {
    try {
      const r = await axios.head(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url.split('/').pop()}: ${r.status}, len=${r.headers['content-length']}`);
    } catch(e) { process.stdout.write('.'); }
  }
}
main().catch(e => console.error(e.message));
