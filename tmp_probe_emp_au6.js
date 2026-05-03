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
  const rowRegex = /<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowXml = rowMatch[2];
    const cells = {};
    const cellRegex = /<c r="([A-Z]+)\d+"[^>]*t="([^"]*)"[^>]*>[\s\S]*?<v>([^<]*)<\/v>/g;
    const cellRegex2 = /<c r="([A-Z]+)\d+"[^>]*>[\s\S]*?<v>([^<]*)<\/v>/g;
    let cellMatch;
    // Shared string cells (t="s")
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const col = cellMatch[1];
      const type = cellMatch[2];
      const val = cellMatch[3];
      cells[col] = type === 's' ? (strings[parseInt(val)] || val) : val;
    }
    // Numeric cells
    while ((cellMatch = cellRegex2.exec(rowXml)) !== null) {
      const col = cellMatch[1];
      if (!cells[col]) cells[col] = cellMatch[2];
    }
    rows.push(cells);
  }
  return rows;
}

async function main() {
  // Download APS Employment Data Dec 2025 from data.gov.au
  const packageId = '252e144b-b975-4cc7-b7d6-5a4397fc4761';
  const pkg = await axios.get(`https://data.gov.au/data/api/3/action/package_show?id=${packageId}`, { timeout: 15000 });
  const resources = pkg.data?.result?.resources || [];
  console.log('Resources:');
  resources.forEach(r => console.log(' ', r.name, '|', r.format, '|', (r.url || '').substring(0, 100)));

  // Find the Excel/CSV resources
  const xlsxRes = resources.find(r => r.url && (r.format || '').toLowerCase().includes('xls'));
  if (!xlsxRes) { console.log('No XLSX found'); return; }

  console.log('\nDownloading:', xlsxRes.url);
  const r = await axios.get(xlsxRes.url, {
    timeout: 30000, responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
  });
  const buf = Buffer.from(r.data);
  console.log('Downloaded:', buf.length, 'bytes');

  if (!(buf[0] === 0x50 && buf[1] === 0x4B)) {
    console.log('Not a ZIP/XLSX file. First bytes:', buf.slice(0, 20).toString('utf8'));
    return;
  }

  const entries = extractZipEntries(buf);
  console.log('XLSX entries:', Object.keys(entries).filter(k => k.startsWith('xl/')));

  const strings = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8') || '');
  console.log('Shared strings (first 30):', strings.slice(0, 30));

  // Get sheet names
  const wbXml = entries['xl/workbook.xml']?.toString('utf8') || '';
  const sheetNames = [...wbXml.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
  console.log('Sheet names:', sheetNames);

  // Parse sheet1
  const sheet1 = entries['xl/worksheets/sheet1.xml']?.toString('utf8') || '';
  const rows = parseSheet(sheet1, strings);
  console.log('\nFirst 15 rows of sheet1:');
  rows.slice(0, 15).forEach((r, i) => {
    const vals = Object.entries(r).map(([k, v]) => `${k}:${v}`).join(' | ');
    console.log(`Row ${i+1}: ${vals.substring(0, 200)}`);
  });
}
main().catch(e => console.error(e.message));
