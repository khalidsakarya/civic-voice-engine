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
      } catch(e) { entries[fn] = compData; }  // Store even if decompression fails
      i = dataStart + compSize;
    } else { i++; }
  }
  return entries;
}

function parseSharedStrings(xml) {
  return [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
}

function parseSheet(xml, strings) {
  const rows = [];
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowXml = rowMatch[1];
    const cells = [];
    const cellRegex = /<c r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const colStr = cellMatch[1];
      const attrs = cellMatch[3];
      const cellContent = cellMatch[4];
      const colIndex = colStr.split('').reduce((acc, c) => acc * 26 + c.charCodeAt(0) - 64, 0) - 1;
      const typeMatch = attrs.match(/t="([^"]+)"/);
      const valMatch = cellContent.match(/<v>([^<]*)<\/v>/);
      let val = '';
      if (valMatch) {
        if (typeMatch && typeMatch[1] === 's') val = strings[parseInt(valMatch[1])] || '';
        else val = valMatch[1];
      }
      while (cells.length < colIndex) cells.push('');
      cells[colIndex] = val;
    }
    if (cells.some(c => c !== '')) rows.push(cells);
  }
  return rows;
}

async function main() {
  // Download Table 16.1 - Total Executive Branch FTE (might have per-agency data)
  const url = 'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z1_fy2027.xlsx';
  console.log('Downloading Table 16.1...');
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);
  console.log('Downloaded:', buf.length, 'bytes');

  const entries = extractZipEntries(buf);
  console.log('XLSX entries:', Object.keys(entries));

  const strings = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8') || '');
  const sheet1Xml = entries['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
  const rows = parseSheet(sheet1Xml, strings);

  console.log('Rows:', rows.length);
  rows.slice(0, 20).forEach((r, i) => console.log(`Row ${i+1}:`, r.slice(0, 6).join(' | ')));

  // Check Table 16.2 for agency breakdown
  console.log('\n\nDownloading Table 16.2...');
  const r2 = await axios.get('https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z2_fy2027.xlsx', {
    timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const buf2 = Buffer.from(r2.data);
  const entries2 = extractZipEntries(buf2);
  const strings2 = parseSharedStrings(entries2['xl/sharedStrings.xml']?.toString('utf8') || '');
  const sheet1Xml2 = entries2['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
  const rows2 = parseSheet(sheet1Xml2, strings2);
  console.log('Rows:', rows2.length);
  rows2.slice(0, 20).forEach((r, i) => console.log(`Row ${i+1}:`, r.slice(0, 6).join(' | ')));
}
main().catch(e => console.error(e.message));
