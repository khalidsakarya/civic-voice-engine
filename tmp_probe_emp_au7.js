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
      } catch(e) {}
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
        if (typeMatch && typeMatch[1] === 's') {
          val = strings[parseInt(valMatch[1])] || '';
        } else {
          val = valMatch[1];
        }
      } else {
        const textMatch = cellContent.match(/<t[^>]*>([^<]*)<\/t>/);
        if (textMatch) val = textMatch[1];
      }
      while (cells.length < colIndex) cells.push('');
      cells[colIndex] = val;
    }
    if (cells.some(c => c !== '')) rows.push(cells);
  }
  return rows;
}

async function main() {
  const url = 'https://data.gov.au/data/dataset/252e144b-b975-4cc7-b7d6-5a4397fc4761/resource/f28f5882-e067-4f95-b3f2-60cc2d9fc076/download/aps-employment-release-tables-31-december-2025.xlsx';
  console.log('Downloading...');
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);
  const entries = extractZipEntries(buf);
  const strings = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8') || '');

  // Get sheet mapping (name -> rId -> file)
  const wbXml = entries['xl/workbook.xml']?.toString('utf8') || '';
  const wbRels = entries['xl/_rels/workbook.xml.rels']?.toString('utf8') || '';
  const sheetDefs = [...wbXml.matchAll(/<sheet name="([^"]+)"[^/]*sheetId="(\d+)" r:id="([^"]+)"/g)].map(m => ({
    name: m[1], sheetId: m[2], rId: m[3]
  }));
  const relMap = {};
  [...wbRels.matchAll(/Id="([^"]+)" Target="([^"]+)"/g)].forEach(m => relMap[m[1]] = m[2]);

  // Find Table 2 sheet
  const table2 = sheetDefs.find(s => s.name === 'Table 2');
  console.log('Table 2 def:', table2);
  if (!table2) { console.log('No Table 2'); return; }

  const sheetFile = relMap[table2.rId];
  console.log('Sheet file:', sheetFile);
  const sheetXml = entries[`xl/${sheetFile}`]?.toString('utf8') || entries[`xl/worksheets/${sheetFile}`]?.toString('utf8') || '';
  console.log('Sheet XML length:', sheetXml.length);

  const rows = parseSheet(sheetXml, strings);
  console.log('Row count:', rows.length);
  console.log('\nFirst 20 rows:');
  rows.slice(0, 20).forEach((r, i) => {
    console.log(`Row ${i+1}: ${r.slice(0, 8).join(' | ')}`);
  });
}
main().catch(e => console.error(e.message));
