'use strict';
const axios = require('axios');

async function main() {
  // Try performance.gov API - has agency data including FTE counts for strategic plans
  try {
    const r = await axios.get('https://api.performance.gov/api/v1/agencies', { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
    console.log('performance.gov agencies:', r.status);
    const agencies = r.data || [];
    if (Array.isArray(agencies)) {
      console.log('Count:', agencies.length);
      if (agencies[0]) {
        console.log('Keys:', Object.keys(agencies[0]));
        console.log('Sample:', JSON.stringify(agencies[0]).substring(0, 300));
      }
    } else {
      console.log(JSON.stringify(r.data).substring(0, 500));
    }
  } catch(e) { console.log('performance.gov agencies:', e.message.substring(0, 80)); }

  // Try USAFacts.org API
  try {
    const r = await axios.get('https://usafacts.org/data/', { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    console.log('\nUSAFacts page len:', r.data.length);
  } catch(e) { console.log('\nUSAFacts:', e.message); }

  // Try the OPM EHRI/FWD data via a SignalR connection token
  // Use the connectionToken from negotiate for LongPolling
  try {
    const neg = await axios.post('https://data.opm.gov/_blazor/negotiate?negotiateVersion=1', {}, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'text/plain;charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }
    });
    const token = neg.data?.connectionToken;
    console.log('\nToken:', token?.substring(0, 20));

    // Try LongPolling with token
    const lpUrl = `https://data.opm.gov/_blazor?id=${encodeURIComponent(token)}`;
    try {
      // Send handshake
      const hs = await axios.post(lpUrl, '{"protocol":"json","version":1}\x1e', {
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'text/plain;charset=UTF-8' }
      });
      console.log('LP handshake:', hs.status, String(hs.data).substring(0, 200));
    } catch(e) { console.log('LP handshake:', e.response?.status, e.message.substring(0, 60)); }
  } catch(e) { console.log('Negotiate:', e.message.substring(0, 60)); }

  // Try checking if there's a simpler JSON endpoint for OPM employment stats
  const opmJsonEndpoints = [
    'https://www.opm.gov/policy-data-oversight/data-analysis-documentation/federal-employment-reports/reports-publications/federal-civilian-employment/?data=json',
    'https://www.opm.gov/data/employment.json',
    'https://www.opm.gov/data/api/employment',
  ];
  for (const url of opmJsonEndpoints) {
    try {
      const r = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } });
      console.log(`\n${url.split('?')[0].split('/').pop()}: ${r.status}`, JSON.stringify(r.data).substring(0, 200));
    } catch(e) { process.stdout.write('.'); }
  }
  console.log('\n');
}
main().catch(e => console.error(e.message));
