'use strict';
const axios = require('axios');

async function main() {
  // Try different paths on data.opm.gov for employment data downloads
  const paths = [
    // Try data files at root
    '/FWD%20Employment%20December%202024.xlsx',
    '/FWD%20Employment%20September%202024.xlsx',
    '/FWD%20Employment%20June%202024.xlsx',
    '/FWD%20Employment%20March%202024.xlsx',
    // Try download subdirectory
    '/downloads/FWD%20Employment%20December%202024.xlsx',
    '/downloads/employment',
    '/downloads/FWD_Employment_Dec2024.xlsx',
    // Try api paths for FWD files
    '/api/files/employment',
    '/files/FWD_Employment.xlsx',
    '/data/employment',
  ];

  for (const path of paths) {
    const url = `https://data.opm.gov${path}`;
    try {
      const r = await axios.head(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 200) {
        console.log(`✓ ${path}: ${r.status}, len=${r.headers['content-length']}, type=${r.headers['content-type']}`);
      }
    } catch(e) { process.stdout.write('.'); }
  }
  console.log('\nDone probing.\n');

  // Alternative: try to access the OPM FWD files via a different naming convention
  // The data dictionary file is "FWD Data Dictionary.xlsx" - what about the actual data?
  // Maybe "FWD Employment Data.xlsx" etc.
  const moreFiles = [
    '/FWD%20Full%20Data%20Employment.xlsx',
    '/FWD%20Data%20Employment.xlsx',
    '/FWD%20Workforce%20Employment.xlsx',
    '/FWD%20EHRI%20Employment%20Data.xlsx',
    '/Employment%20Data.xlsx',
    '/EHRI%20Employment%20Data.xlsx',
    '/FWD%20Federal%20Workforce%20Employment.xlsx',
  ];

  for (const path of moreFiles) {
    const url = `https://data.opm.gov${path}`;
    try {
      const r = await axios.head(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 200) {
        console.log(`✓ ${path}: ${r.status}, len=${r.headers['content-length']}`);
      }
    } catch(e) { process.stdout.write('.'); }
  }
  console.log('\nDone.\n');

  // Final fallback: try OMB "FY2025 Object Class" or president's budget data with FTE
  // Check if there are downloadable files on whitehouse.gov OMB budget
  try {
    const r = await axios.get('https://www.whitehouse.gov/omb/budget/', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = r.data;
    const xlsLinks = [...html.matchAll(/href="([^"]*\.(?:xlsx|xls|csv|zip))"/gi)].map(m => m[1]);
    console.log('OMB budget XLSX links:', xlsLinks.slice(0, 10));

    // Look for FTE mentions
    const fteLinks = [...html.matchAll(/href="([^"]+)"[^>]*>[^<]*(?:FTE|employment|workforce|headcount)[^<]*/gi)].map(m => m[0]);
    console.log('FTE links:', fteLinks.slice(0, 5));
  } catch(e) { console.log('OMB budget:', e.message); }
}
main().catch(e => console.error(e.message));
