'use strict';
const axios = require('axios');

async function main() {
  // Try data.opm.gov FWD files directly
  const paths = [
    'https://data.opm.gov/FWD%20Data%20Dictionary.xlsx',
    'https://data.opm.gov/FWD%20Employment%20Data.xlsx',
    'https://data.opm.gov/FWD_Employment.csv',
    'https://data.opm.gov/FWD-Employment.csv',
  ];

  for (const url of paths) {
    try {
      const r = await axios.head(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`${url.split('/').pop()}: ${r.status}, len=${r.headers['content-length']}, type=${r.headers['content-type']}`);
    } catch(e) { console.log(`${url.split('/').pop()}: ${e.response?.status || e.message.substring(0, 40)}`); }
  }

  // Check OPM FWD data dictionary to understand file structure
  try {
    const r = await axios.get('https://data.opm.gov/FWD%20Data%20Dictionary.xlsx', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      responseType: 'arraybuffer'
    });
    console.log('\nFWD Data Dictionary downloaded! Size:', r.data.byteLength, 'bytes');
    // It's an XLSX - let's see the first few bytes
    const buf = Buffer.from(r.data);
    console.log('First 4 bytes (zip magic):', buf.slice(0, 4).toString('hex'));
  } catch(e) { console.log('\nFWD Data Dictionary:', e.response?.status || e.message); }

  // Try the OMB President's Budget data with FTE counts
  // The OMB provides agency budget data at max.gov
  // Check if there's an accessible API
  try {
    const r = await axios.get('https://www.whitehouse.gov/wp-json/wp/v2/pages?search=budget+fte&per_page=3', { timeout: 10000 });
    const pages = r.data || [];
    pages.forEach(p => console.log('\nOMB WP page:', p.title?.rendered, '-', p.link));
  } catch(e) { console.log('\nOMB WP API:', e.message); }
}
main().catch(e => console.error(e.message));
