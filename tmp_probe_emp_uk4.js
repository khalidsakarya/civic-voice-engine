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

// Parse ODS rows from content.xml table section
function parseOdsTable(contentXml, tableName) {
  // Find the table section
  const tableStartRegex = new RegExp(`table:name="${tableName}"[^>]*>`, 'i');
  const tableStart = contentXml.search(tableStartRegex);
  if (tableStart === -1) return [];

  // Find next </table:table>
  const tableEndStr = '</table:table>';
  const tableEnd = contentXml.indexOf(tableEndStr, tableStart);
  const tableXml = contentXml.substring(tableStart, tableEnd + tableEndStr.length);

  // Parse rows
  const rows = [];
  const rowRegex = /<table:table-row[^>]*>([\s\S]*?)<\/table:table-row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
    const rowXml = rowMatch[1];
    const cells = [];

    // Parse cells - handle repeated cells
    const cellRegex = /<table:table-cell([^>]*)>([\s\S]*?)<\/table:table-cell>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
      const attrs = cellMatch[1];
      const cellContent = cellMatch[2];

      // Get repeat count
      const repeatMatch = attrs.match(/table:number-columns-repeated="(\d+)"/);
      const repeat = repeatMatch ? parseInt(repeatMatch[1]) : 1;

      // Skip huge repeats (empty cells at end of row)
      if (repeat > 50) break;

      // Get value
      const valMatch = attrs.match(/office:value="([^"]+)"/);
      const textMatch = cellContent.match(/<text:p[^>]*>([^<]*)<\/text:p>/);
      const val = valMatch ? valMatch[1] : (textMatch ? textMatch[1] : '');

      for (let r = 0; r < Math.min(repeat, 20); r++) cells.push(val);
    }

    if (cells.some(c => c !== '')) rows.push(cells);
  }
  return rows;
}

async function main() {
  const url = 'https://assets.publishing.service.gov.uk/media/66e1631138493bbcd79f4706/Statistical_tables_-_Civil_Service_Statistics_2024.ods';
  console.log('Downloading ODS...');
  const r = await axios.get(url, { timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
  const buf = Buffer.from(r.data);
  const entries = extractZipEntries(buf);
  const contentXml = entries['content.xml'].toString('utf8');

  // Parse table_20 - employment by government department
  console.log('Parsing table_20...');
  const rows = parseOdsTable(contentXml, 'table_20');
  console.log('Row count:', rows.length);
  rows.slice(0, 15).forEach((r, i) => console.log(`Row ${i}:`, r.slice(0, 8).join(' | ')));

  // Also check table_8 "Civil Service employment; profession by government department"
  // and see which table has total headcount by department
  console.log('\n\nParsing table_8...');
  const rows8 = parseOdsTable(contentXml, 'table_8');
  console.log('Row count:', rows8.length);
  rows8.slice(0, 10).forEach((r, i) => console.log(`Row ${i}:`, r.slice(0, 8).join(' | ')));
}
main().catch(e => console.error(e.message));
