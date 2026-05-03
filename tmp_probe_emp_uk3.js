'use strict';
const axios = require('axios');
const zlib = require('zlib');

// ODS is a ZIP file containing XML - parse it like XLSX
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
  const url = 'https://assets.publishing.service.gov.uk/media/66e1631138493bbcd79f4706/Statistical_tables_-_Civil_Service_Statistics_2024.ods';
  console.log('Downloading ODS...');
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);
  console.log('Downloaded:', buf.length, 'bytes');

  const entries = extractZipEntries(buf);
  console.log('ODS entries:', Object.keys(entries).slice(0, 20));

  // ODS content is in content.xml
  const contentXml = entries['content.xml']?.toString('utf8') || '';
  console.log('content.xml length:', contentXml.length);

  // Find table names
  const tableNames = [...contentXml.matchAll(/table:name="([^"]+)"/g)].map(m => m[1]);
  console.log('\nTable names:', tableNames.slice(0, 20));

  // Look for a table with department headcount (Table 2 or similar)
  // Find "Table 2" or employment by department
  const table2Idx = contentXml.indexOf('Table 2');
  if (table2Idx > -1) {
    console.log('\nTable 2 context:', contentXml.substring(table2Idx, table2Idx + 500));
  }

  // Extract all cell values from the first few tables
  // ODS uses <table:table-cell> with office:value or text:p
  const cells = [...contentXml.matchAll(/<text:p[^>]*>([^<]+)<\/text:p>/g)].map(m => m[1]);
  console.log('\nFirst 100 cell values:');
  cells.slice(0, 100).forEach((c, i) => process.stdout.write(`[${c}]`));
  console.log();
}
main().catch(e => console.error(e.message));
