'use strict';
const axios = require('axios');

async function main() {
  // FedScope Employment Cubes on data.gov
  const r = await axios.get('https://catalog.data.gov/api/3/action/package_show?id=fedscope-employment-cubes-ffdfd', { timeout: 15000 });
  const resources = r.data?.result?.resources || [];
  console.log('Resources count:', resources.length);
  resources.slice(0, 10).forEach(res => console.log(' ', res.name, '|', (res.url || '').substring(0, 120), '|', res.format));

  // Find the most recent annual cube
  const csvRes = resources.filter(res => res.format === 'ZIP' || res.format === 'CSV');
  console.log('\nCSV/ZIP resources:');
  csvRes.slice(0, 5).forEach(res => console.log(' ', res.name, '|', (res.url || '').substring(0, 120)));

  // Try downloading the FedScope employment cube
  // It's available as a ZIP with CSV files inside
  // Let's check what data.gov has directly
  const zipRes = resources.find(res => res.format === 'ZIP' && res.url);
  if (zipRes) {
    console.log('\nZIP resource:', zipRes.url);
    // Don't download the ZIP - too large. Check if there's an API
  }

  // Try OPM EHRI API - check if there's a REST API
  try {
    const opmApi = await axios.get('https://data.opm.gov/api/v1/employment?format=json&limit=1', { timeout: 10000 });
    console.log('\nOPM API:', opmApi.status, JSON.stringify(opmApi.data).substring(0, 200));
  } catch(e) { console.log('\nOPM API:', e.message); }

  // Fedscope OLAP - check cube API
  try {
    // FedScope uses IBM Cognos - try the cube data endpoint
    const cubeResp = await axios.post('https://www.fedscope.opm.gov/datadefn/aehri_September2024_Agency.csv', {}, { timeout: 10000 });
    console.log('\nCube CSV:', cubeResp.status);
  } catch(e) { console.log('\nCube CSV:', e.message); }

  // Check the actual fedscope employment cube CSV format
  // They publish aggregate employment data by agency
  try {
    const empData = await axios.get('https://raw.githubusercontent.com/GSA/data/master/employment/fedscope_employment.csv', { timeout: 10000 });
    console.log('\nGSA employment CSV:', empData.status);
    console.log(empData.data.substring(0, 300));
  } catch(e) { console.log('\nGSA employment CSV:', e.message); }
}
main().catch(e => console.error(e.message));
