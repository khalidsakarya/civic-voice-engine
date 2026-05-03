'use strict';
const axios = require('axios');

async function main() {
  // Use SignalR LongPolling to get FWD employment data from data.opm.gov
  // First negotiate
  const neg = await axios.post('https://data.opm.gov/_blazor/negotiate?negotiateVersion=1', {}, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Content-Type': 'text/plain;charset=UTF-8' }
  });
  console.log('Negotiate status:', neg.status);
  const connToken = neg.data?.connectionToken;
  const connId = neg.data?.connectionId;
  console.log('Connection token:', connToken?.substring(0, 20), 'Connection ID:', connId);

  // Start the connection with LongPolling
  const startUrl = `https://data.opm.gov/_blazor?id=${connId}`;
  try {
    const startResp = await axios.post(startUrl, '\x1e{}', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'text/plain;charset=UTF-8',
      }
    });
    console.log('\nStart response status:', startResp.status, 'data:', String(startResp.data).substring(0, 200));
  } catch(e) { console.log('\nStart:', e.response?.status, e.message.substring(0, 100)); }

  // Try the LongPolling GET endpoint to receive messages
  try {
    const pollResp = await axios.get(startUrl, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    console.log('\nPoll response status:', pollResp.status, 'data:', String(pollResp.data).substring(0, 500));
  } catch(e) { console.log('\nPoll:', e.response?.status, e.message.substring(0, 100)); }
}
main().catch(e => console.error(e.message));
