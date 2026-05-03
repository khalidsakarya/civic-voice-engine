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
    // Read record type (1 or 2 bytes)
    let type, typeLen;
    if (buf[i] & 0x80) {
      if (i + 1 >= buf.length) break;
      type = (buf[i] & 0x7F) | ((buf[i+1] & 0x7F) << 7);
      typeLen = 2;
    } else {
      type = buf[i];
      typeLen = 1;
    }
    i += typeLen;
    // Read size (varint 1-4 bytes)
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
  const records = readBiff12(buf);
  for (const rec of records) {
    if (rec.type === 0x13 && rec.data.length >= 5) {
      // BrtSSTItem: [fHighSurr:1][cch:4][UTF-16LE:cch*2]
      const cch = rec.data.readUInt32LE(1);
      if (rec.data.length >= 5 + cch * 2) {
        strings.push(rec.data.slice(5, 5 + cch * 2).toString('utf16le'));
      }
    }
  }
  return strings;
}

(async () => {
  const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', {
    timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer'
  });
  const buf = Buffer.from(r.data);
  const entries = parseZipEntries(buf);

  const ss = parseSharedStrings(entries['xl/sharedStrings.bin']);
  console.log('Shared strings count:', ss.length);
  console.log('First 30 strings:', ss.slice(0, 30));

  // Find "Total" or "United States" in strings
  const totalIdx = ss.findIndex(s => /^total$/i.test(s));
  const usIdx = ss.findIndex(s => /united states/i.test(s));
  console.log('"Total" string index:', totalIdx, '"United States" index:', usIdx);

  // Parse sheet1.bin
  const shBuf = entries['xl/worksheets/sheet1.bin'];
  const shRecs = readBiff12(shBuf);
  console.log('Sheet1 record count:', shRecs.length);

  // Log record type distribution
  const typeDist = {};
  for (const rec of shRecs) typeDist[rec.type] = (typeDist[rec.type] || 0) + 1;
  const topTypes = Object.entries(typeDist).sort((a,b) => b[1]-a[1]).slice(0, 20);
  console.log('Top record types:', topTypes.map(([t, c]) => `${t}(0x${parseInt(t).toString(16)})=${c}`));

  // Look for BrtCellNum variants (type 5) and BrtFmlaNum (type 9)
  // Also check sizes to understand structure
  const numRecords = shRecs.filter(r => r.type === 5 || r.type === 9);
  console.log('Numeric cell records count (type 5 & 9):', numRecords.length);
  if (numRecords.length > 0) {
    console.log('First numeric record size:', numRecords[0].data.length, 'hex:', numRecords[0].data.toString('hex'));
    // Try reading double from various offsets
    for (let off = 0; off <= numRecords[0].data.length - 8; off += 4) {
      const v = numRecords[0].data.readDoubleLE(off);
      if (isFinite(v) && v > 0 && v < 1e8) console.log(`  Double at offset ${off}:`, v);
    }
  }

  // Also look for type 2 (BrtCellRk) which stores compressed numbers
  const rkRecords = shRecs.filter(r => r.type === 2);
  console.log('RK cell records (type 2):', rkRecords.length);

  // Scan ALL cell records for large numeric values (600k-900k = total homeless)
  console.log('\nScanning for 600k-900k values in all numeric records...');
  for (const rec of shRecs) {
    if (rec.type === 5) {
      // BrtCellNum: Cell + double (8 bytes)
      for (let off = 0; off <= rec.data.length - 8; off += 4) {
        const v = rec.data.readDoubleLE(off);
        if (v >= 600000 && v <= 900000) {
          console.log(`  BrtCellNum type5 at offset ${off}: value=${v}, full_hex=${rec.data.toString('hex')}`);
        }
      }
    }
    if (rec.type === 9) {
      // BrtFmlaNum
      for (let off = 0; off <= rec.data.length - 8; off += 4) {
        const v = rec.data.readDoubleLE(off);
        if (v >= 600000 && v <= 900000) {
          console.log(`  BrtFmlaNum type9 at offset ${off}: value=${v}, full_hex=${rec.data.toString('hex')}`);
        }
      }
    }
  }

  // Check nearby records to find "Total" context
  for (let i = 0; i < shRecs.length; i++) {
    const rec = shRecs[i];
    // BrtCellIsst type 7: shared string reference
    if (rec.type === 7 && rec.data.length >= 12) {
      const isst = rec.data.readUInt32LE(8);
      if (isst === totalIdx || (ss[isst] && /total/i.test(ss[isst]))) {
        console.log(`\nFound "Total" cell at record ${i}, nearby records:`);
        for (let j = i-2; j <= i+10; j++) {
          if (j >= 0 && j < shRecs.length) {
            const r2 = shRecs[j];
            let note = '';
            if (r2.type === 5 || r2.type === 9) {
              for (let off = 0; off <= r2.data.length - 8; off += 4) {
                const v = r2.data.readDoubleLE(off);
                if (isFinite(v) && v > 100) note += ` double@${off}=${v}`;
              }
            }
            if (r2.type === 7 && r2.data.length >= 12) {
              const s = ss[r2.data.readUInt32LE(8)] ?? r2.data.readUInt32LE(8);
              note = ` str="${s}"`;
            }
            console.log(`  rec[${j}] type=${r2.type}(0x${r2.type.toString(16)}) size=${r2.data.length}${note}`);
          }
        }
      }
    }
    // Also check type 6 (BrtCellSt) for inline strings
    if (rec.type === 6 && rec.data.length >= 5) {
      // Inline string: [colRef 4 bytes?][cch 4 bytes][UTF-16LE]
      const cch = rec.data.readUInt32LE(0);
      if (cch < 100 && rec.data.length >= 4 + cch * 2) {
        const str = rec.data.slice(4, 4 + cch * 2).toString('utf16le');
        if (/total/i.test(str)) console.log(`Found inline string "Total" at record ${i}:`, str);
      }
    }
  }

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
