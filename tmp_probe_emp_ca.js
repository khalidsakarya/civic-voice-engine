'use strict';
const axios = require('axios');

async function main() {
  // GC InfoBase employees — CKAN package for people management data
  // Try searching for employee/FTE data
  const searches = [
    'https://open.canada.ca/data/api/3/action/package_search?q=employees+department+full+time+equivalent&rows=5&fq=organization:treasury-board-of-canada-secretariat',
    'https://open.canada.ca/data/api/3/action/package_show?id=a35cf382-690c-4221-a971-cf0fd189a46f', // GC InfoBase
  ];

  // GC InfoBase has "Federal Programs - Actual and Planned Employees" resource
  const pkgRes = await axios.get('https://open.canada.ca/data/api/3/action/package_show?id=a35cf382-690c-4221-a971-cf0fd189a46f', { timeout: 15000 });
  const resources = pkgRes.data?.result?.resources || [];
  const empRes = resources.filter(r => r.name && (r.name.toLowerCase().includes('employee') || r.name.toLowerCase().includes('fte')));
  console.log('Employee-related resources in GC InfoBase:');
  empRes.forEach(r => console.log(' name:', r.name, '| url:', (r.url || '').substring(0, 100)));

  // Also look at "Federal Programs - Actual and Planned Employees"
  const empResource = resources.find(r => r.name && r.name.includes('Actual and Planned Employees') && r.url);
  if (empResource) {
    console.log('\nFetching employee CSV preview...');
    const resp = await axios.get(empResource.url, { timeout: 30000, responseType: 'text' });
    const lines = resp.data.split('\n').slice(0, 5);
    console.log('Headers:', lines[0]);
    console.log('Row 1:', lines[1]);
    console.log('Row 2:', lines[2]);
  }

  // Also check TBS GC InfoBase API directly
  try {
    const tbs = await axios.get('https://www.tbs-sct.gc.ca/ems-sgd/edb-bdd/index-eng.html#orgs/gov/gov/hist/people', { timeout: 10000 });
    console.log('\nTBS page status:', tbs.status, 'len:', tbs.data.length);
  } catch(e) { console.log('\nTBS page:', e.message); }
}
main().catch(e => console.error(e.message));
