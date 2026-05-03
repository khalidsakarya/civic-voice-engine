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

function readBiff12(buf) {
  const records = [];
  let i = 0;
  while (i < buf.length - 2) {
    let type, typeLen;
    if (buf[i] & 0x80) { type = (buf[i] & 0x7F) | ((buf[i+1] & 0x7F) << 7); typeLen = 2; }
    else { type = buf[i]; typeLen = 1; }
    i += typeLen;
    let size = 0, sizeLen = 0;
    for (let b = 0; b < 4 && i + b < buf.length; b++) {
      const byte = buf[i + b];
      size |= (byte & 0x7F) << (7 * b);
      sizeLen++;
      if (!(byte & 0x80)) break;
    }
    i += sizeLen;
    if (i + size > buf.length) break;
    records.push({ type, data: buf.slice(i, i + size) });
    i += size;
  }
  return records;
}

function parseSharedStrings(buf) {
  const strings = [];
  for (const rec of readBiff12(buf)) {
    if (rec.type === 0x13 && rec.data.length >= 5) {
      const cch = rec.data.readUInt32LE(1);
      if (rec.data.length >= 5 + cch * 2) strings.push(rec.data.slice(5, 5 + cch * 2).toString('utf16le'));
    }
  }
  return strings;
}

function decodeRk(rkVal) {
  const fX100 = rkVal & 1;
  const fInt = (rkVal >> 1) & 1;
  let val;
  if (fInt) {
    // Signed integer in bits 2-31
    val = rkVal >> 2; // arithmetic right shift preserves sign
    // Handle sign properly
    if (rkVal & 0x80000000) val = (rkVal | 0) >> 2;
  } else {
    // Double: bits 2-31 are upper bits of mantissa
    const tmp = Buffer.allocUnsafe(8);
    tmp.fill(0);
    tmp.writeUInt32LE(rkVal & 0xFFFFFFFC, 4);
    val = tmp.readDoubleLE(0);
  }
  if (fX100) val /= 100;
  return val;
}

(async () => {
  const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', {
    timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer'
  });
  const buf = Buffer.from(r.data);
  const entries = parseZipEntries(buf);

  const ss = parseSharedStrings(entries['xl/sharedStrings.bin']);
  console.log('Shared strings count:', ss.length);
  const totalIdx = ss.findIndex(s => s === 'Total');
  console.log('"Total" index:', totalIdx, '=', ss[totalIdx]);

  // Parse the CoC-level sheet (sheet1) - this is by CoC, not by state
  // Let's find which sheet has "Total" row for states
  // The xlsb has many sheets - let's try sheet19 (state-level?)

  const shNames = Object.keys(entries).filter(k => k.includes('worksheets/sheet'));
  console.log('Available sheets:', shNames);

  // Try to find the national total by scanning all sheets
  for (const shName of shNames.slice(0, 5)) {
    const shBuf = entries[shName];
    if (!shBuf) continue;

    const shRecs = readBiff12(shBuf);

    // Find rows with "Total" as first string cell (isst=totalIdx)
    let currentRow = -1;
    let rowRkVals = [];
    let foundTotalRow = false;
    let totalRowVals = [];

    for (let i = 0; i < shRecs.length; i++) {
      const rec = shRecs[i];
      if (rec.type === 0) { // BrtRowHdr
        if (foundTotalRow && rowRkVals.length > 0) {
          totalRowVals = rowRkVals;
          break;
        }
        rowRkVals = [];
        currentRow = rec.data.readUInt32LE(0);
        foundTotalRow = false;
      }
      // BrtCellIsst (type 7): check if it references "Total"
      if (rec.type === 7 && rec.data.length >= 12) {
        const isst = rec.data.readUInt32LE(8);
        if (isst === totalIdx) foundTotalRow = true;
      }
      // BrtCellRk (type 2): decode RK value
      if (rec.type === 2 && foundTotalRow) {
        if (rec.data.length >= 12) {
          const rkVal = rec.data.readUInt32LE(8);
          rowRkVals.push(decodeRk(rkVal));
        } else if (rec.data.length >= 8) {
          const rkVal = rec.data.readUInt32LE(4);
          rowRkVals.push(decodeRk(rkVal));
        }
      }
    }

    if (totalRowVals.length > 0) {
      console.log(`\nSheet ${shName}: Found "Total" row with ${totalRowVals.length} RK values`);
      console.log('First 20 values:', totalRowVals.slice(0, 20));
      // Find values in 600k-900k range (total homeless)
      const bigVals = totalRowVals.filter(v => v >= 600000 && v <= 900000);
      console.log('Values in 600k-900k range:', bigVals);
    } else {
      console.log(`Sheet ${shName}: no "Total" row found (records: ${shRecs.length})`);
    }
  }

  // Also check sheet4 which might be the state-level PIT sheet
  for (const shName of shNames.slice(5)) {
    const shBuf = entries[shName];
    if (!shBuf) continue;

    const shRecs = readBiff12(shBuf);

    // Quick check: does this sheet have a "Total" row?
    let hasTotalRow = shRecs.some(rec => rec.type === 7 && rec.data.length >= 12 && rec.data.readUInt32LE(8) === totalIdx);

    if (hasTotalRow) {
      console.log(`\n${shName} has "Total" row! Parsing...`);
      let currentRow = -1;
      let rowRkVals = [];
      let foundTotalRow = false;
      let totalRowVals = [];

      for (let i = 0; i < shRecs.length; i++) {
        const rec = shRecs[i];
        if (rec.type === 0) {
          if (foundTotalRow && rowRkVals.length > 0) { totalRowVals = rowRkVals; break; }
          rowRkVals = [];
          foundTotalRow = false;
        }
        if (rec.type === 7 && rec.data.length >= 12) {
          const isst = rec.data.readUInt32LE(8);
          if (isst === totalIdx) foundTotalRow = true;
        }
        if (rec.type === 2 && foundTotalRow) {
          const offset = rec.data.length >= 12 ? 8 : 4;
          if (rec.data.length >= offset + 4) rowRkVals.push(decodeRk(rec.data.readUInt32LE(offset)));
        }
      }

      if (totalRowVals.length > 0) {
        console.log(`Total row values (first 30):`, totalRowVals.slice(0, 30));
        const bigVals = totalRowVals.filter(v => v >= 600000 && v <= 900000);
        console.log('Values in 600k-900k range:', bigVals);
      }
    }
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
