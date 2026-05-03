require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

function parseZip(buf) {
  const entries = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i+8), compSize = buf.readUInt32LE(i+18);
      const fnLen = buf.readUInt16LE(i+26), exLen = buf.readUInt16LE(i+28);
      const name = buf.slice(i+30, i+30+fnLen).toString('utf8');
      const dataStart = i+30+fnLen+exLen;
      const compressed = buf.slice(dataStart, dataStart+compSize);
      if (method === 0) entries[name] = compressed;
      else if (method === 8) { try { entries[name] = zlib.inflateRawSync(compressed); } catch(_) {} }
      i = dataStart + compSize;
    } else i++;
  }
  return entries;
}

(async () => {
  const url = 'https://www.england.nhs.uk/statistics/wp-content/uploads/sites/2/2025/07/Incomplete-Commissioner-Mar25-XLSX-4M-revised.xlsx';
  const r = await axios.get(url, {timeout: 60000, headers: {'User-Agent': UA}, responseType: 'arraybuffer'});
  const buf = Buffer.from(r.data);
  const entries = parseZip(buf);
  const ss = entries['xl/sharedStrings.xml'].toString('utf8');
  const strings = [...ss.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(m => m[1]);
  const totalIdx = strings.indexOf('Total');
  console.log('totalIdx:', totalIdx);

  const sh1 = entries['xl/worksheets/sheet1.xml'].toString('utf8');
  // Check what quote character is used in the XML
  const sampleRow = sh1.slice(0, 500);
  console.log('Sample XML:', sampleRow.replace(/\n/g, ' '));

  // Try regex with unescaped quotes (as they'd appear in the actual file)
  const rowMatches = [];
  const rowRe = /<row[^>]*>(.*?)<\/row>/gs;
  let rm;
  while ((rm = rowRe.exec(sh1)) !== null) {
    rowMatches.push(rm[1]);
    if (rowMatches.length >= 50) break;
  }
  console.log('Rows found with unattributed regex:', rowMatches.length);

  // Search for Total in each row content
  for (let ri = 0; ri < rowMatches.length; ri++) {
    const rowContent = rowMatches[ri];
    // Look for cells with value = totalIdx
    const checkRe = new RegExp('<v>' + totalIdx + '<\\/v>', 'g');
    if (checkRe.test(rowContent)) {
      console.log('Found Total in row index', ri);
      // Extract columns
      const cellRe = /<c r="([^"]+)"[^>]*(?:t="([^"]+)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g;
      const cells = [];
      let cm;
      while ((cm = cellRe.exec(rowContent)) !== null) cells.push(cm);
      const colMap = {};
      for (const c of cells) {
        const col = c[1].replace(/\d/g, '');
        colMap[col] = c[2] === 's' ? strings[parseInt(c[3])] : c[3];
      }
      console.log('DE:', colMap['DE'], 'DG:', colMap['DG'], 'DH:', colMap['DH']);
      break;
    }
  }
})().catch(e => console.error(e.message));
