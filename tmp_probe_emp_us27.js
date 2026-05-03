'use strict';
const axios = require('axios');

async function main() {
  // Check "Employment of Veterans" dataset - might have agency breakdown with total headcount
  const r = await axios.get('https://catalog.data.gov/api/3/action/package_show?id=employment-of-veterans-in-the-federal-executive-branch', { timeout: 15000 });
  const resources = r.data?.result?.resources || [];
  console.log('Veterans employment resources:');
  resources.slice(0, 10).forEach(res => console.log(' ', res.name, '|', (res.url || '').substring(0, 120), '|', res.format));

  // Check the OPM dataset on data.gov
  const r2 = await axios.get('https://catalog.data.gov/api/3/action/package_show?id=office-of-personnel-management-opm', { timeout: 15000 });
  const resources2 = r2.data?.result?.resources || [];
  console.log('\nOPM dataset resources:');
  resources2.slice(0, 10).forEach(res => console.log(' ', res.name, '|', (res.url || '').substring(0, 120), '|', res.format));

  // Try downloading the first accessible resource from employment of veterans
  const csvRes = resources.find(res => res.url && (res.format === 'CSV' || res.format === 'XLSX'));
  if (csvRes) {
    try {
      const dr = await axios.get(csvRes.url, { timeout: 15000, responseType: 'text', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const lines = dr.data.split('\n').slice(0, 5);
      console.log('\nVeterans employment CSV:');
      lines.forEach((l, i) => console.log(`[${i}]`, l.substring(0, 150)));
    } catch(e) { console.log('Veterans CSV:', e.message); }
  }
}
main().catch(e => console.error(e.message));
