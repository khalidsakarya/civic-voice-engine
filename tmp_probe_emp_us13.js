'use strict';
const axios = require('axios');

async function main() {
  // Try OPM FedScope employment data via data.gov CKAN
  try {
    const r = await axios.get('https://catalog.data.gov/api/3/action/package_search?q=OPM+federal+employment+agency+full+time&rows=10&fq=organization:opm-gov', { timeout: 15000 });
    const results = r.data?.result?.results || [];
    console.log('OPM datasets on data.gov:');
    results.forEach(d => {
      console.log(' -', d.name, ':', d.title);
      const csvRes = (d.resources || []).filter(r => r.format === 'CSV' || r.format === 'XLSX' || r.format === 'ZIP');
      if (csvRes.length) console.log('   Resources:', csvRes.slice(0,3).map(r => r.url?.substring(0, 80)));
    });
  } catch(e) { console.log('data.gov search:', e.message); }

  // Try FedScope employment cube - look for the actual cube files
  // The FedScope data is published quarterly at this pattern:
  // https://www.fedscope.opm.gov/datadefn/FACTDATA_MAR2024.TXT.zip
  // Let me try different URL patterns
  const cubeUrls = [
    'https://www.fedscope.opm.gov/datadefn/FACTDATA_MAR2024.TXT.zip',
    'https://www.fedscope.opm.gov/datadefn/FACTDATA_SEP2024.TXT.zip',
    'https://www.fedscope.opm.gov/datadefn/FACTDATA_DEC2023.TXT.zip',
  ];

  for (const url of cubeUrls) {
    try {
      const r = await axios.head(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`\n${url}: ${r.status}, Content-Length: ${r.headers['content-length']}`);
    } catch(e) { console.log(`\n${url}: ${e.response?.status || e.message}`); }
  }

  // Try the FWD data dictionary to understand the data structure
  try {
    const r = await axios.get('https://data.opm.gov/FWD Data Dictionary.xlsx', { timeout: 10000 });
    console.log('\nFWD dict: status=', r.status);
  } catch(e) { console.log('\nFWD dict:', e.message); }
}
main().catch(e => console.error(e.message));
