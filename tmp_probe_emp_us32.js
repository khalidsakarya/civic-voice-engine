'use strict';
const axios = require('axios');

async function main() {
  // Try OMB "Appendix" data with FTE counts
  // The OMB publishes budget data at a structured API
  try {
    // Check if there's an OPM data portal with employment by agency
    const r = await axios.get('https://www.opm.gov/data/index.aspx', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    // Find all CSV links more carefully
    const html = r.data;

    // Find section titles and their nearby CSV links
    const sections = [...html.matchAll(/<h[234][^>]*>([^<]+)<\/h[234]>/gi)].map(m => m[1]);
    console.log('Sections:');
    sections.slice(0, 20).forEach(s => console.log(' ', s));

    // Check for employment-related CSVs
    const csvLinks = [...html.matchAll(/href='(\/data\/datasets\/Files\/\d+\/[^']+\.csv)'/gi)].map(m => `https://www.opm.gov${m[1]}`);
    console.log('\nAll CSV links:');
    csvLinks.forEach(l => console.log(' ', l));
  } catch(e) { console.log('OPM data index:', e.message); }

  // Try OPM "Employment and Trends" Excel file - direct URL guesses
  const directUrls = [
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/federal-civilian-employment/table-1.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/table-12.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/employment-trends-data/et2024.xlsx',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/employment-trends-data/2024.xlsx',
  ];

  for (const url of directUrls) {
    try {
      const r = await axios.head(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url.split('/').pop()}: ${r.status}, size=${r.headers['content-length']}`);
    } catch(e) { process.stdout.write(`.`); }
  }
  console.log();
}
main().catch(e => console.error(e.message));
