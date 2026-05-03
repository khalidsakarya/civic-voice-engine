'use strict';
const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');

async function main() {
  const url = 'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z1_fy2027.xlsx';
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);

  // Debug the ZIP structure
  let i = 0;
  let count = 0;
  while (i < buf.length - 4 && count < 20) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x03 && buf[i+3] === 0x04) {
      const compMethod = buf.readUInt16LE(i + 8);
      const crc32 = buf.readUInt32LE(i + 14);
      const compSize = buf.readUInt32LE(i + 18);
      const uncompSize = buf.readUInt32LE(i + 22);
      const fnLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      const fn = buf.slice(i + 30, i + 30 + fnLen).toString('utf8');
      const dataStart = i + 30 + fnLen + extraLen;
      console.log(`Entry: "${fn}" | method=${compMethod} | compSize=${compSize} | uncompSize=${uncompSize} | dataStart=${dataStart}`);

      if (compMethod === 8) {
        const compData = buf.slice(dataStart, dataStart + compSize);
        try {
          const decompressed = zlib.inflateRawSync(compData);
          console.log('  Decompressed OK:', decompressed.length, 'bytes, preview:', decompressed.toString('utf8').substring(0, 100));
        } catch(e) {
          console.log('  Decompress FAILED:', e.message);
          // Try inflateSync instead (with zlib header)
          try {
            const decompressed2 = zlib.inflateSync(compData);
            console.log('  inflateSync OK:', decompressed2.length, 'bytes');
          } catch(e2) { console.log('  inflateSync also failed:', e2.message); }
        }
      } else {
        const rawData = buf.slice(dataStart, dataStart + compSize);
        console.log('  Stored raw:', rawData.toString('utf8').substring(0, 100));
      }

      i = dataStart + compSize;
      count++;
    } else { i++; }
  }
}
main().catch(e => console.error(e.message));
