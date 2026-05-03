'use strict';
const axios = require('axios');

async function main() {
  // Try data.gov.au with correct API endpoint (they use a different CKAN)
  const dataSources = [
    'https://data.gov.au/data/api/3/action/package_search?q=APS+employment+agency&rows=5',
    'https://data.gov.au/data/api/3/action/package_search?q=APSC+employment+department&rows=5',
    'https://data.gov.au/data/api/3/action/package_search?q=australian+public+service+employment+statistics&rows=5',
  ];

  for (const url of dataSources) {
    try {
      const r = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const count = r.data?.result?.count || 0;
      const results = r.data?.result?.results || [];
      console.log(`\n${url.split('q=')[1]?.split('&')[0]}: ${count} results`);
      results.forEach(d => {
        const dlRes = (d.resources || []).filter(r => r.url && (r.format || '').toUpperCase().match(/CSV|XLSX|XLS|ZIP|ODS/));
        if (dlRes.length) {
          console.log(' -', d.title);
          dlRes.slice(0, 2).forEach(dl => console.log('   ', dl.format, ':', (dl.url || '').substring(0, 100)));
        }
      });
    } catch(e) { console.log(`Search:`, e.message.substring(0, 60)); }
  }

  // Try ABS (Australian Bureau of Statistics) API for government employment
  try {
    // ABS has employment data by industry - government/public administration
    const r = await axios.get('https://data.api.abs.gov.au/rest/data/ABS,LABOUR_FORCE_DETAILED,1.0.0/all?startPeriod=2023&format=jsondata', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    console.log('\nABS Labour Force API:', r.status);
  } catch(e) { console.log('\nABS Labour Force:', e.message.substring(0, 50)); }

  // Try APSC with a POST request or different URL patterns
  const apscCandidates = [
    'https://www.apsc.gov.au/node/1234',  // Try a direct node
  ];

  // Check if there's an APSC data portal
  try {
    const r = await axios.get('https://www.apsc.gov.au/data-and-reporting', {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      }
    });
    console.log('\nAPSC data page len:', r.data.length);
    const links = [...r.data.matchAll(/href="([^"]+(?:csv|xlsx|xls|zip)[^"]*)"[^>]*>/gi)].map(m => m[1]);
    console.log('CSV/XLSX links:', links.slice(0, 10));
  } catch(e) { console.log('\nAPSC data page:', e.message.substring(0, 50)); }
}
main().catch(e => console.error(e.message));
