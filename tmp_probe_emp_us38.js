'use strict';
const axios = require('axios');

async function main() {
  // Final probes for US - try OMB President's Budget FTE tables
  // The OMB publishes FTE counts in the "Budget of the United States Government"
  // as Appendix/Supplemental Materials
  const budgetUrls = [
    'https://www.whitehouse.gov/omb/budget/historical-tables/',
    'https://www.whitehouse.gov/omb/budget/fy2025/',
    'https://www.whitehouse.gov/omb/budget/appendix/',
  ];

  for (const url of budgetUrls) {
    try {
      const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url.split('/').filter(Boolean).pop()}: ${r.status}, len=${r.data.length}`);
      const xlsxLinks = [...r.data.matchAll(/href="([^"]*\.(?:xlsx|xls|csv|zip))"/gi)].map(m => m[1]);
      console.log('XLSX links:', xlsxLinks.slice(0, 5));
      const fteMentions = r.data.match(/.{0,50}FTE.{0,50}/g) || [];
      console.log('FTE mentions:', fteMentions.slice(0, 3));
    } catch(e) { console.log(url.split('/').filter(Boolean).pop() + ':', e.message.substring(0, 60)); }
  }

  // Try the OMB MAX budget data directly
  // OMB MAX has machine-readable budget data at max.omb.gov
  try {
    const r = await axios.get('https://max.omb.gov/maxportal/assets/public/appsdata/published_data_downloads/FY25_ActualsFY25APFull_Salaries_and_expenses.zip', { timeout: 10000 });
    console.log('\nOMB MAX data:', r.status);
  } catch(e) { console.log('\nOMB MAX:', e.message.substring(0, 60)); }

  // Try congress.gov for agency appropriations with FTE counts
  // The Congressional Budget Justification (CBJ) has FTE data
  // Check if congress.gov has it accessible
  try {
    const r = await axios.get('https://api.congress.gov/v3/committee?limit=1&api_key=DEMO_KEY', { timeout: 10000 });
    console.log('\nCongress.gov API:', r.status);
  } catch(e) { console.log('\nCongress.gov:', e.message.substring(0, 60)); }

  // Last resort: check the OMB "Federal Civilian Employment" data
  // on the FedStats website
  try {
    const r = await axios.get('https://www.fedstats.gov/', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('\nFedStats:', r.status, r.data.length);
  } catch(e) { console.log('\nFedStats:', e.message.substring(0, 60)); }
}
main().catch(e => console.error(e.message));
