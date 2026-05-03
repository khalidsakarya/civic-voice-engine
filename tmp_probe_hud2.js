require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const T = 25000;

function parseZipEntries(buf) {
  const entries = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i + 8);
      const compSize = buf.readUInt32LE(i + 18);
      const fnLen = buf.readUInt16LE(i + 26);
      const exLen = buf.readUInt16LE(i + 28);
      const name = buf.slice(i + 30, i + 30 + fnLen).toString('utf8');
      const dataStart = i + 30 + fnLen + exLen;
      const compressed = buf.slice(dataStart, dataStart + compSize);
      if (method === 0) entries[name] = compressed;
      else if (method === 8) { try { entries[name] = zlib.inflateRawSync(compressed); } catch (_) {} }
      i = dataStart + compSize;
    } else i++;
  }
  return entries;
}

(async () => {
  // Parse veteran PIT xlsx
  const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2011-2024-PIT-Veteran-Counts-by-State.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
  const buf = Buffer.from(r.data);
  const entries = parseZipEntries(buf);
  console.log('ZIP entries:', Object.keys(entries));

  const ss = entries['xl/sharedStrings.xml']?.toString('utf8') ?? '';
  // Extract shared strings
  const strings = [...ss.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
  console.log('First 30 strings:', strings.slice(0, 30));

  // Parse sheet1.xml
  const sheet1 = entries['xl/worksheets/sheet1.xml']?.toString('utf8') ?? '';
  // Find row with United States or Total
  const rows = sheet1.match(/<row[^>]*>.*?<\/row>/gs) ?? [];
  console.log('Total rows:', rows.length);

  // Find the last data row (likely national total)
  function getCellValue(cell, strings) {
    const t = cell.match(/t="(\w+)"/)?.[1];
    const v = cell.match(/<v>([^<]+)<\/v>/)?.[1];
    if (!v) return null;
    if (t === 's') return strings[parseInt(v)];
    return v;
  }

  // Find United States row
  let usRow = null;
  for (const row of rows) {
    const cells = row.match(/<c[^>]*>.*?<\/c>/gs) ?? [];
    const vals = cells.map(c => getCellValue(c, strings));
    if (vals.some(v => v && /united states/i.test(String(v)))) {
      usRow = vals;
      break;
    }
  }
  console.log('United States row:', usRow);

  // Also show last 3 rows
  const lastRows = rows.slice(-3).map(row => {
    const cells = row.match(/<c[^>]*>.*?<\/c>/gs) ?? [];
    return cells.map(c => getCellValue(c, strings));
  });
  console.log('Last 3 rows:', JSON.stringify(lastRows));

  // Now scan the xlsb for national total using BrtSSTItem approach
  console.log('\nScanning xlsb for "United States" in BrtSSTItem format...');
  const r2 = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
  const xlsbBuf = Buffer.from(r2.data);

  // In BIFF12, BrtSSTItem record stores strings as: [record_type 2B] [size varint] [XLWideString: 4B-len + UTF16LE chars]
  // Search for: 0D 00 00 00 [UTF-16LE "United States"] = 13 bytes of string data
  const usTF = Buffer.from('United States', 'utf16le');
  const lenPrefix = Buffer.alloc(4); lenPrefix.writeUInt32LE(13);
  const searchPat = Buffer.concat([lenPrefix, usTF]);

  let xlsbUsOffsets = [];
  for (let i = 0; i < xlsbBuf.length - searchPat.length; i++) {
    if (xlsbBuf.slice(i, i + searchPat.length).equals(searchPat)) xlsbUsOffsets.push(i);
  }
  console.log('"United States" (BrtSSTItem format) at offsets:', xlsbUsOffsets);

  // Also search directly for UTF-16LE United States (in case xlsb stores inline strings)
  const directBuf = Buffer.from('United States', 'utf16le');
  let directOffsets = [];
  for (let i = 0; i < xlsbBuf.length - directBuf.length; i++) {
    if (xlsbBuf.slice(i, i + directBuf.length).equals(directBuf)) directOffsets.push(i);
    if (directOffsets.length >= 5) break;
  }
  console.log('"United States" direct UTF-16LE at offsets:', directOffsets);

  if (directOffsets.length > 0 || xlsbUsOffsets.length > 0) {
    const off = (directOffsets[0] ?? xlsbUsOffsets[0]);
    console.log('Bytes around offset:', xlsbBuf.slice(Math.max(0, off-30), off+100).toString('hex'));
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
