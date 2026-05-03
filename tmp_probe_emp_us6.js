'use strict';
const axios = require('axios');

async function main() {
  // OPM data page - look for employment by agency datasets
  const r = await axios.get('https://www.opm.gov/data/index.aspx', { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = r.data;

  // Find all CSV links on page
  const csvLinks = [...html.matchAll(/href='(\/data\/datasets\/Files\/[^']+\.csv)'/gi)].map(m => `https://www.opm.gov${m[1]}`);
  console.log('CSV links found:', csvLinks.length);
  csvLinks.slice(0, 15).forEach(l => console.log(' ', l));

  // Find dataset sections/titles
  const titleMatches = [...html.matchAll(/<h[23][^>]*>([^<]+)<\/h[23]>/gi)].map(m => m[1].trim());
  console.log('\nSection headers:');
  titleMatches.slice(0, 20).forEach(t => console.log(' ', t));

  // Also look around FedScope employment summary
  // Sample the first CSV
  if (csvLinks[0]) {
    try {
      console.log('\nSampling:', csvLinks[0]);
      const csvR = await axios.get(csvLinks[0], { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const lines = csvR.data.split('\n').slice(0, 5);
      lines.forEach((l, i) => console.log(`[${i}]`, l.substring(0, 120)));
    } catch(e) { console.log('Sample CSV error:', e.message); }
  }
}
main().catch(e => console.error(e.message));
