require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');
const UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';

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

// BIFF12 record parser
function parseBiff12Records(buf) {
  const records = [];
  let i = 0;
  while (i < buf.length - 2) {
    // Record type: 2 bytes LE (or 1 byte if high bit is 0)
    let recType, typeLen;
    if ((buf[i] & 0x80) === 0) {
      recType = buf[i]; typeLen = 1;
    } else {
      recType = (buf[i] & 0x7F) | ((buf[i+1] & 0x7F) << 7); typeLen = 2;
    }
    i += typeLen;
    if (i >= buf.length) break;

    // Record size: varint
    let recSize = 0, sizeLen = 0;
    for (let b = 0; b < 4; b++) {
      if (i + b >= buf.length) break;
      const byte = buf[i + b];
      recSize |= (byte & 0x7F) << (7 * b);
      sizeLen++;
      if ((byte & 0x80) === 0) break;
    }
    i += sizeLen;

    if (i + recSize > buf.length) break;
    const data = buf.slice(i, i + recSize);
    records.push({ type: recType, data });
    i += recSize;
  }
  return records;
}

// Parse shared strings from sharedStrings.bin
function parseSharedStrings(buf) {
  const records = parseBiff12Records(buf);
  const strings = [];
  for (const rec of records) {
    // BrtSSTItem = 0x0013 (19) — contains a rich text string
    if (rec.type === 0x0013 || rec.type === 19) {
      // XLWideString: 4-byte count + UTF-16LE chars
      if (rec.data.length >= 4) {
        const len = rec.data.readUInt32LE(0);
        if (rec.data.length >= 4 + len * 2) {
          const str = rec.data.slice(4, 4 + len * 2).toString('utf16le');
          strings.push(str);
        }
      }
    }
  }
  return strings;
}

// Parse sheet1.bin for cell values
function parseSheet(sheetBuf, sharedStrings) {
  const records = parseBiff12Records(sheetBuf);
  const cells = [];
  let currentRow = -1;

  for (const rec of records) {
    // BrtRowHdr = 0x0000 (0)
    if (rec.type === 0) {
      currentRow = rec.data.length >= 4 ? rec.data.readUInt32LE(0) : -1;
    }
    // BrtCellNum = 0x0005 (5) — numeric cell
    else if (rec.type === 5) {
      if (rec.data.length >= 12) {
        const col = rec.data.readUInt32LE(0) & 0x3FFF;
        const val = rec.data.readDoubleLE(4);
        cells.push({ row: currentRow, col, val, type: 'num' });
      }
    }
    // BrtCellIsst = 0x00FD (253) — shared string cell
    else if (rec.type === 0xFD || rec.type === 253) {
      if (rec.data.length >= 8) {
        const col = rec.data.readUInt32LE(0) & 0x3FFF;
        const idx = rec.data.readUInt32LE(4);
        cells.push({ row: currentRow, col, val: sharedStrings[idx] ?? idx, type: 'str' });
      }
    }
    // BrtCellSt = 0x00FE (254) — inline string
    else if (rec.type === 0xFE || rec.type === 254) {
      if (rec.data.length >= 8) {
        const col = rec.data.readUInt32LE(0) & 0x3FFF;
        const len = rec.data.readUInt32LE(4);
        if (rec.data.length >= 8 + len * 2) {
          const str = rec.data.slice(8, 8 + len * 2).toString('utf16le');
          cells.push({ row: currentRow, col, val: str, type: 'str' });
        }
      }
    }
  }
  return cells;
}

(async () => {
  const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', {
    timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer'
  });
  const buf = Buffer.from(r.data);
  console.log('xlsb size:', buf.byteLength);

  // Check ZIP magic number
  console.log('First bytes:', buf.slice(0, 4).toString('hex'));

  const entries = parseZipEntries(buf);
  console.log('ZIP entries:', Object.keys(entries).slice(0, 20));

  // Parse shared strings
  const ssBin = entries['xl/sharedStrings.bin'];
  const sharedStrings = ssBin ? parseSharedStrings(ssBin) : [];
  console.log('Shared strings count:', sharedStrings.length);
  console.log('First 20 strings:', sharedStrings.slice(0, 20));

  // Parse sheet1
  const sheetBin = entries['xl/worksheets/sheet1.bin'];
  if (!sheetBin) {
    console.log('No sheet1.bin');
  } else {
    console.log('sheet1.bin size:', sheetBin.length);
    const cells = parseSheet(sheetBin, sharedStrings);
    console.log('Total cells parsed:', cells.length);

    // Reconstruct rows
    const rows = {};
    for (const cell of cells) {
      if (!rows[cell.row]) rows[cell.row] = [];
      rows[cell.row][cell.col] = cell.val;
    }

    const rowNums = Object.keys(rows).map(Number).sort((a,b) => a-b);
    console.log('Row count:', rowNums.length);
    console.log('First row:', rows[rowNums[0]]?.slice(0, 5));
    console.log('Second row:', rows[rowNums[1]]?.slice(0, 5));

    // Find "Total" or "United States" row
    let totalRow = null;
    for (const rn of rowNums) {
      const row = rows[rn];
      if (row && row.some(v => typeof v === 'string' && /(total|united states)/i.test(v))) {
        console.log(`Found key row ${rn}:`, JSON.stringify(row?.slice(0, 10)));
        totalRow = row;
      }
    }

    // Show last few rows
    const lastNums = rowNums.slice(-5);
    for (const rn of lastNums) {
      console.log(`Row ${rn}:`, JSON.stringify(rows[rn]?.slice(0, 8)));
    }
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
