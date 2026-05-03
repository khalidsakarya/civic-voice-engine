'use strict';
const axios = require('axios');
const zlib = require('zlib');

// Need a better ZIP parser that handles the data descriptor pattern (sizes in Central Directory)
function listZipEntries(buf) {
  const entries = [];
  // Find End of Central Directory
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65536); i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) {
      eocdOffset = i; break;
    }
  }
  if (eocdOffset === -1) {
    console.log('No EOCD found!');
    return entries;
  }
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  console.log('EOCD at:', eocdOffset, '| CD offset:', cdOffset, '| Total entries:', totalEntries);

  let pos = cdOffset;
  for (let e = 0; e < totalEntries && pos < buf.length; e++) {
    if (!(buf[pos] === 0x50 && buf[pos+1] === 0x4B && buf[pos+2] === 0x01 && buf[pos+3] === 0x02)) break;
    const fnLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const fn = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
    entries.push(fn);
    pos += 46 + fnLen + extraLen + commentLen;
  }
  return entries;
}

async function main() {
  console.log('Downloading OMB hist ZIP...');
  const r = await axios.get('https://www.whitehouse.gov/wp-content/uploads/2026/04/hist_fy2027.zip', {
    timeout: 60000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const buf = Buffer.from(r.data);
  console.log('ZIP size:', buf.length, 'bytes');

  const entries = listZipEntries(buf);
  console.log('\nAll entries:');
  entries.forEach(e => console.log(' ', e));

  // Filter for FTE / employment related files
  const fteFiles = entries.filter(e => e.toLowerCase().includes('16') || e.toLowerCase().includes('17') || e.toLowerCase().includes('18'));
  console.log('\nFTE-related (16/17/18):', fteFiles);
}
main().catch(e => console.error(e.message));
