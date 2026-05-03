'use strict';
const axios = require('axios');

async function main() {
  // Check FedScope Diversity Cubes dataset resources - they should have similar structure
  const r = await axios.get('https://catalog.data.gov/api/3/action/package_show?id=fedscope-diversity-cubes-714ca', { timeout: 15000 });
  const resources = r.data?.result?.resources || [];
  console.log('Resources count:', resources.length);
  resources.slice(0, 10).forEach(res => console.log(' ', res.name, '|', (res.url || '').substring(0, 120), '|', res.format));

  // Try to download one of the diversity cube files - they might be ZIP files with agency data
  const zipRes = resources.find(res => res.url && (res.format === 'ZIP' || res.url.includes('.zip')));
  const csvRes = resources.find(res => res.url && (res.format === 'CSV' || res.url.includes('.csv')));
  const downloadable = zipRes || csvRes || resources.find(res => res.url && res.url.startsWith('http'));

  if (downloadable) {
    console.log('\nTrying to download:', downloadable.url);
    try {
      const dr = await axios.head(downloadable.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log('Status:', dr.status, 'Size:', dr.headers['content-length']);
    } catch(e) { console.log('Head error:', e.message); }
  }

  // Check if there's an OPM EHRI employment dataset on data.gov
  const empSearch = await axios.get('https://catalog.data.gov/api/3/action/package_search?q=federal+employment+agency+headcount+OPM&rows=10', { timeout: 15000 });
  const empDatasets = empSearch.data?.result?.results || [];
  console.log('\nFederal employment datasets on data.gov:');
  empDatasets.forEach(d => {
    console.log(' -', d.title, '(' + d.name + ')');
    const downloadable = (d.resources || []).filter(r => r.format && ['CSV','XLSX','ZIP'].includes(r.format.toUpperCase()));
    if (downloadable.length) console.log('   Downloads:', downloadable.map(r => `${r.format}: ${(r.url||'').substring(0,80)}`));
  });
}
main().catch(e => console.error(e.message));
