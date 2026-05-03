'use strict';
const axios = require('axios');
const zlib = require('zlib');

function extractZipEntriesFromCD(buf) {
  const entries = {};
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i+1] === 0x4B && buf[i+2] === 0x05 && buf[i+3] === 0x06) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) return entries;
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let pos = cdOffset;
  for (let e = 0; e < totalEntries; e++) {
    if (!(buf[pos] === 0x50 && buf[pos+1] === 0x4B && buf[pos+2] === 0x01 && buf[pos+3] === 0x02)) break;
    const compMethod = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const fnLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const fn = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
    const lfhFnLen = buf.readUInt16LE(localOffset + 26);
    const lfhExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lfhFnLen + lfhExtraLen;
    if (compSize > 0) {
      const compData = buf.slice(dataStart, dataStart + compSize);
      try { entries[fn] = compMethod === 8 ? zlib.inflateRawSync(compData) : compData; } catch(e) { entries[fn] = Buffer.alloc(0); }
    } else { entries[fn] = Buffer.alloc(0); }
    pos += 46 + fnLen + extraLen + commentLen;
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
  // Check if Table 17.1 or 17.2 exists with agency-level FTE
  const urls = [
    'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist17z1_fy2027.xlsx',
    'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist17z2_fy2027.xlsx',
    'https://www.whitehouse.gov/wp-content/uploads/2026/04/hist16z1_fy2027.xlsx', // confirmed works
  ];

  for (const url of urls) {
    console.log('\n--- Checking:', url.split('/').pop(), '---');
    try {
      const r = await axios.get(url, { timeout: 20000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
      const buf = Buffer.from(r.data);
      const entries = extractZipEntriesFromCD(buf);
      const strings = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8') || '');
      const sheet1 = entries['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
      const rows = parseSheet(sheet1, strings);
      console.log('Rows:', rows.length, '| Max cols:', Math.max(...rows.map(r => r.length)));
      // Header rows
      rows.slice(0, 6).forEach((r, i) => {
        if (r.length > 1) console.log(`Row ${i+1}:`, r.slice(0, 10).join(' | '));
      });
      // Last row
      if (rows.length > 10) console.log('Last row:', rows[rows.length - 2].slice(0, 10).join(' | '));
    } catch(e) { console.log('Error:', e.response?.status || e.message.substring(0, 60)); }
  }
}
main().catch(e => console.error(e.message));
