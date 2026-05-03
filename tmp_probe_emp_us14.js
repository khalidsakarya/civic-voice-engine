'use strict';
const axios = require('axios');

async function main() {
  // USAspending agency list with full agency details
  // Check if any field has employee/headcount data
  const r = await axios.get('https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&page=1&limit=50', { timeout: 15000 });
  const agencies = r.data?.results || [];
  console.log('Agency count:', agencies.length);

  // Check all agencies for employee_count or headcount fields
  const allKeys = new Set();
  agencies.forEach(a => Object.keys(a).forEach(k => allKeys.add(k)));
  console.log('All agency fields:', [...allKeys]);

  // Try the agency detail endpoint for a few agencies to see if there's employee data
  for (const code of ['011', '075', '012']) { // DOD, HHS, USDA
    try {
      const r2 = await axios.get(`https://api.usaspending.gov/api/v2/agency/${code}/`, { timeout: 10000 });
      const data = r2.data;
      console.log(`\nAgency ${code} (${data.name}) keys:`, Object.keys(data));
      if (data.employee_count !== undefined) console.log('  employee_count:', data.employee_count);
      if (data.fte_count !== undefined) console.log('  fte_count:', data.fte_count);
    } catch(e) { console.log(`Agency ${code}:`, e.message); }
  }

  // Also try the DOGE/workforce endpoint if it exists
  try {
    const r3 = await axios.get('https://api.usaspending.gov/api/v2/agency/011/workforce/', { timeout: 10000 });
    console.log('\nWorkforce endpoint:', JSON.stringify(r3.data).substring(0, 300));
  } catch(e) { console.log('\nWorkforce endpoint:', e.message); }

  // Check if there's a federal employees API elsewhere
  // Try the USAspending spending by award category to find employee headcount
  // Actually let's check the BLS series for individual agencies
  // BLS publishes by SIC/NAICS code, not by agency name

  // Try the OPM FedScope employment data download
  // New URL format at OPM
  const opmUrls = [
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/historical-tables/table-1-summary-of-federal-civilian-employment-1962-to-present/',
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/historical-tables/table-2-nondefense-executive-branch-civilian-employment-by-agency-1993-to-present/',
  ];
  for (const url of opmUrls) {
    try {
      const r4 = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\nOPM historical table len: ${r4.data.length}`);
      const csvLinks = [...r4.data.matchAll(/href="([^"]*\.(?:csv|xlsx|xls))"/gi)].map(m => m[1]);
      console.log('CSV links:', csvLinks.slice(0, 5));
      // Check for table data directly in HTML
      const tableMatch = r4.data.match(/<table[^>]*>([\s\S]{0,2000})<\/table>/i);
      if (tableMatch) console.log('Table excerpt:', tableMatch[1].replace(/<[^>]+>/g, ' ').substring(0, 300));
    } catch(e) { console.log(`OPM table: ${e.message}`); }
  }
}
main().catch(e => console.error(e.message));
