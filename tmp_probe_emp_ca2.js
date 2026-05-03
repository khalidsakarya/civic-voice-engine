'use strict';
const axios = require('axios');

async function main() {
  // Get the FTE resource URLs in full
  const pkgRes = await axios.get('https://open.canada.ca/data/api/3/action/package_show?id=a35cf382-690c-4221-a971-cf0fd189a46f', { timeout: 15000 });
  const resources = pkgRes.data?.result?.resources || [];
  const fteRes = resources.filter(r => r.name && r.name.toLowerCase().includes('fte'));
  console.log('FTE resources:');
  fteRes.forEach(r => console.log(' name:', r.name, '\n  url:', r.url, '\n  format:', r.format));

  // Try the first FTE resource URL
  const first = fteRes.find(r => r.url && r.url.startsWith('http'));
  if (first) {
    // Fetch CKAN resource to get actual download URL
    const rid = first.url.split('/resource/')[1];
    console.log('\nResource ID:', rid);
    const resInfo = await axios.get(`https://open.canada.ca/data/api/3/action/resource_show?id=${rid}`, { timeout: 10000 });
    console.log('Resource show url:', resInfo.data?.result?.url);
    console.log('Resource show datastore_active:', resInfo.data?.result?.datastore_active);

    // Try datastore search
    try {
      const ds = await axios.get(`https://open.canada.ca/data/api/3/action/datastore_search?resource_id=${rid}&limit=3`, { timeout: 15000 });
      const fields = ds.data?.result?.fields?.map(f => f.id);
      console.log('\nDatastore fields:', fields);
      const rows = ds.data?.result?.records?.slice(0, 2);
      console.log('Sample rows:', JSON.stringify(rows, null, 2));
    } catch(e) { console.log('Datastore error:', e.message); }
  }
}
main().catch(e => console.error(e.message));
