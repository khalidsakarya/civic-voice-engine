'use strict';
const axios = require('axios');
const zlib = require('zlib');

function extractZipEntries(buf) {
  const entries = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
      const fnLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const fn = buf.slice(i + 30, i + 30 + fnLen).toString('utf8');
      const compMethod = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const dataStart = i + 30 + fnLen + extraLen;
      const compData = buf.slice(dataStart, dataStart + compSize);
      try {
        entries[fn] = compMethod === 8 ? zlib.inflateRawSync(compData) : compData;
      } catch(e) { entries[fn] = compData; }
      i = dataStart + compSize;
    } else { i++; }
  }
  return entries;
}

async function main() {
  const url = 'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z1_fy2027.xlsx';
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);
  const entries = extractZipEntries(buf);

  const sheet1Xml = entries['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
  console.log('Sheet1 XML (first 2000):', sheet1Xml.substring(0, 2000));
}
main().catch(e => console.error(e.message));
