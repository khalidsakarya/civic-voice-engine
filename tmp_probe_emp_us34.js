'use strict';
const axios = require('axios');

async function main() {
  // Try data.opm.gov SignalR/Blazor Server endpoint
  try {
    const r = await axios.post('https://data.opm.gov/_blazor/negotiate?negotiateVersion=1', {}, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    console.log('SignalR negotiate:', r.status, JSON.stringify(r.data).substring(0, 300));
  } catch(e) { console.log('SignalR negotiate:', e.response?.status, e.message.substring(0, 60)); }

  // Try a different approach: directly check the OMB "Federal Civilian Employment by Department" table
  // This is often published on OMB's website as a text table or data file
  // Check if there's a table at the OPM's existing HTML page with employment data
  // The "Federal Civilian Employment" page on OPM has tables for each executive department
  try {
    const r = await axios.get('https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/federal-civilian-employment/', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = r.data;
    // Try to find agency names in the HTML
    const agencyMatches = [...html.matchAll(/(Department of [A-Za-z\s,]+)\s*[\d,]+/gi)].map(m => m[0]);
    console.log('\nAgency matches:', agencyMatches.slice(0, 10));

    // Check if any scripts have data
    const scriptData = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
      .map(m => m[1])
      .filter(s => s.includes('Department') || s.includes('employ') || s.includes('count'));
    console.log('\nScript data count:', scriptData.length);
    if (scriptData[0]) console.log('Script data (first 300):', scriptData[0].substring(0, 300));
  } catch(e) { console.log('OPM Employment page:', e.message); }
}
main().catch(e => console.error(e.message));
