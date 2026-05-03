'use strict';
const axios = require('axios');

async function main() {
  // Try the old IBM Cognos FedScope API which still might be running
  try {
    const r = await axios.get('https://www.fedscope.opm.gov/ibmcognos/bi/v1/disp?b_action=cognosViewer&ui.action=run', {
      timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('IBM Cognos status:', r.status, 'len:', r.data.length);
  } catch(e) { console.log('IBM Cognos:', e.response?.status, e.message.substring(0, 50)); }

  // Try the FedScope employment data via the EHRI API
  // EHRI = Enterprise Human Resources Integration
  try {
    const r = await axios.get('https://data.opm.gov/api/FWD/Agencies', { timeout: 8000, headers: { 'Accept': 'application/json' } });
    console.log('\nFWD/Agencies:', r.status, JSON.stringify(r.data).substring(0, 200));
  } catch(e) { console.log('\nFWD/Agencies:', e.response?.status); }

  // Try USAspending API v2 search for employee headcount data
  // Check if there's a /personnel or /workforce endpoint
  try {
    const r = await axios.get('https://api.usaspending.gov/api/v2/', { timeout: 10000 });
    console.log('\nUSAspending API v2 root:', r.status);
    console.log(JSON.stringify(r.data).substring(0, 500));
  } catch(e) { console.log('\nUSAspending v2 root:', e.message); }

  // Final approach: check if USAspending has a "federal_workforce" collection
  // Or check the BEA (Bureau of Economic Analysis) API for agency employment
  try {
    const r = await axios.get('https://apps.bea.gov/api/data/?UserID=DEMO_KEY&method=GetData&datasetname=Regional&TableName=SAGDP2N&LineCode=90&Year=2023&GeoFips=US&ResultFormat=json', { timeout: 10000 });
    console.log('\nBEA API:', r.status, JSON.stringify(r.data).substring(0, 200));
  } catch(e) { console.log('\nBEA API:', e.message); }
}
main().catch(e => console.error(e.message));
