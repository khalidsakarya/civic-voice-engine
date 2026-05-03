'use strict';
const axios = require('axios');
const zlib = require('zlib');

// Simple ZIP parser to read XLSX
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
      } catch(e) {}
      i = dataStart + compSize;
    } else { i++; }
  }
  return entries;
}

async function main() {
  // Download and parse the FWD Data Dictionary
  const r = await axios.get('https://data.opm.gov/FWD%20Data%20Dictionary.xlsx', {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    responseType: 'arraybuffer'
  });
  const buf = Buffer.from(r.data);
  const entries = extractZipEntries(buf);
  console.log('XLSX entries:', Object.keys(entries));

  // Parse shared strings
  const ssXml = entries['xl/sharedStrings.xml']?.toString('utf8') || '';
  const strings = [...ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
  console.log('\nShared strings (first 50):', strings.slice(0, 50));

  // Parse first sheet
  const sheet1 = entries['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
  const rows = [...sheet1.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(m => m[1]);
  console.log('\nRow count:', rows.length);

  // Print first 20 rows
  rows.slice(0, 20).forEach((rowXml, ri) => {
    const cells = [...rowXml.matchAll(/<c r="([^"]+)"[^>]*>[\s\S]*?<v>([^<]*)<\/v>/g)].map(m => {
      const ref = m[1];
      const val = m[2];
      const col = ref.replace(/[0-9]/g, '');
      return `${col}=${strings[parseInt(val)] || val}`;
    });
    console.log(`Row ${ri+1}:`, cells.join(' | '));
  });
}
main().catch(e => console.error(e.message));
