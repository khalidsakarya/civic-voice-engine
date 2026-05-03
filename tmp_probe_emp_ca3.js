'use strict';
const axios = require('axios');

async function main() {
  // Fetch the FTE CSV directly
  const url = 'https://open.canada.ca/data/dataset/a35cf382-690c-4221-a971-cf0fd189a46f/resource/64774bc1-c90a-4ae2-a3ac-d9b50673a895/download/rbpo_rppo_en.csv';
  console.log('Fetching CSV...');
  const resp = await axios.get(url, { timeout: 30000, responseType: 'text' });
  const lines = resp.data.split('\n').slice(0, 8);
  console.log('Lines:');
  lines.forEach((l, i) => console.log(`[${i}] ${l}`));

  // Count unique orgs in the data
  const allLines = resp.data.split('\n').filter(l => l.trim());
  console.log('\nTotal lines:', allLines.length);

  // Parse header
  const header = allLines[0].split(',');
  console.log('\nHeaders:', header);

  // Show a few rows
  console.log('\nSample rows:');
  allLines.slice(1, 5).forEach(l => console.log(l));
}
main().catch(e => console.error(e.message));
