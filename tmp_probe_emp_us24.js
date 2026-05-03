'use strict';
const axios = require('axios');

async function main() {
  // Try FWD employment data files at data.opm.gov
  // The dictionary shows: Employment, Accessions, Separations data cubes
  const candidates = [
    'FWD%20Employment%20Data.zip',
    'FWD%20Employment.zip',
    'FWD_Employment.zip',
    'FWD%20Employment%20Cube.zip',
    'Employment%20Data.zip',
    'FWD%20Employment.csv',
    'FWD%20Employment.xlsx',
    // Try without spaces
    'FWDEmployment.zip',
    'FWDEmploymentData.zip',
    // Try with date patterns
    'FWD%20Employment%20September%202024.zip',
    'FWD%20Employment%20Dec%202024.zip',
    'FWD%20Employment%20March%202025.zip',
  ];

  for (const name of candidates) {
    const url = `https://data.opm.gov/${name}`;
    try {
      const r = await axios.head(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`${name}: ${r.status}, len=${r.headers['content-length']}`);
    } catch(e) { process.stdout.write('.'); }
  }
  console.log('\n');

  // Check the Blazor app's _blazor/init path
  try {
    const r = await axios.get('https://data.opm.gov/_blazor', { timeout: 5000 });
    console.log('_blazor:', r.status);
  } catch(e) { console.log('_blazor:', e.response?.status); }

  // Try to enumerate what .js or .wasm files are available
  const frameworkPaths = [
    '_framework/blazor.webassembly.js',
    '_framework/blazor.boot.json',
    '_framework/BlazorApp.wasm',
  ];
  for (const path of frameworkPaths) {
    try {
      const r = await axios.head(`https://data.opm.gov/${path}`, { timeout: 5000 });
      console.log(`${path}: ${r.status}, len=${r.headers['content-length']}`);
    } catch(e) { console.log(`${path}: ${e.response?.status}`); }
  }
}
main().catch(e => console.error(e.message));
