require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 25000;

(async () => {
  // 1. Parse 2024-HIC-Counts-by-State.csv
  try {
    const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2024-HIC-Counts-by-State.csv', { timeout: T, headers: { 'User-Agent': UA } });
    const lines = r.data.trim().split('\n');
    console.log('HIC CSV headers:', lines[0]?.slice(0, 300));
    console.log('HIC CSV row 1:', lines[1]?.slice(0, 200));
    console.log('HIC CSV row 2:', lines[2]?.slice(0, 200));
    // Look for a total/national row
    const totalRow = lines.find(l => /united states|national|total/i.test(l));
    console.log('HIC CSV total row:', totalRow?.slice(0, 300));
    console.log('HIC CSV rows:', lines.length);
  } catch(e) { console.log('HIC CSV err:', e.message); }

  // 2. Try PIT Veteran xlsx
  try {
    const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2011-2024-PIT-Veteran-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    console.log('Veteran PIT xlsx status:', r.status, 'size:', r.data?.byteLength);
  } catch(e) { console.log('Veteran PIT xlsx err:', e.message); }

  // 3. Try to find national total from xlsb by searching for uint8 string patterns
  try {
    const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    const buf = Buffer.from(r.data);
    console.log('PIT xlsb size:', buf.byteLength);
    // Search for "United States" as UTF-16LE
    const searchStr = 'United States';
    const searchBuf = Buffer.from(searchStr, 'utf16le');
    let found = -1;
    for (let i = 0; i < buf.length - searchBuf.length; i++) {
      if (buf.slice(i, i + searchBuf.length).equals(searchBuf)) { found = i; break; }
    }
    console.log('UTF-16LE "United States" at offset:', found);
    if (found > 0) {
      // Print 200 bytes around it as hex
      console.log('Context bytes (hex):', buf.slice(Math.max(0, found-20), found+100).toString('hex'));
    }
    // Also search for "Total" UTF-16LE
    const totBuf = Buffer.from('Total', 'utf16le');
    let totFound = [];
    for (let i = 0; i < buf.length - totBuf.length; i++) {
      if (buf.slice(i, i + totBuf.length).equals(totBuf)) totFound.push(i);
      if (totFound.length >= 3) break;
    }
    console.log('"Total" UTF-16LE at offsets:', totFound);
  } catch(e) { console.log('xlsb parse err:', e.message); }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
