'use strict';
const axios = require('axios');

async function main() {
  // USAspending.gov - check if toptier agencies have employee_count
  const resp = await axios.get('https://api.usaspending.gov/api/v2/references/toptier_agencies/?sort=budget_authority_amount&order=desc&page=1&limit=5', { timeout: 15000 });
  const agencies = resp.data?.results || [];
  console.log('Sample agency keys:', Object.keys(agencies[0] || {}));
  console.log('Sample:', JSON.stringify(agencies[0], null, 2));

  // Check agency endpoint for employee count
  if (agencies[0]?.toptier_code) {
    const code = agencies[0].toptier_code;
    const aResp = await axios.get(`https://api.usaspending.gov/api/v2/agency/${code}/`, { timeout: 15000 });
    console.log('\nAgency detail keys:', Object.keys(aResp.data || {}));
    console.log('Agency detail:', JSON.stringify(aResp.data, null, 2).substring(0, 1000));
  }

  // OPM FedScope data - check data.gov
  try {
    const opm = await axios.get('https://api.data.gov/ed/collegescorecard/v1/schools?fields=id,school.name&per_page=1&api_key=DEMO_KEY', { timeout: 10000 });
    // just testing connectivity
  } catch(e) {}

  // Try OPM FedScope directly - employment cube
  try {
    const opmResp = await axios.get('https://www.fedscope.opm.gov/ibmcognos/bi/v1/disp?b_action=cognosViewer&ui.action=run&ui.object=%2fcontent%2ffolder%5b%40name%3d%27Workforce+Analysis%27%5d', { timeout: 10000 });
    console.log('\nFedScope status:', opmResp.status);
  } catch(e) { console.log('\nFedScope:', e.message); }
}
main().catch(e => console.error(e.message));
