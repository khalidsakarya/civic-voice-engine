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

(async () => {
  const r = await axios.get('https://www.huduser.gov/portal/sites/default/files/xls/2007-2024-PIT-Counts-by-State.xlsb', {
    timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer'
  });
  const buf = Buffer.from(r.data);
  const entries = parseZipEntries(buf);

  // Examine sheet1.bin first 100 bytes as hex
  const sh = entries['xl/worksheets/sheet1.bin'];
  console.log('sheet1 first 100 bytes:', sh.slice(0, 100).toString('hex'));

  // Examine sharedStrings.bin
  const ss = entries['xl/sharedStrings.bin'];
  console.log('sharedStrings first 100 bytes:', ss?.slice(0, 100).toString('hex'));
  console.log('sharedStrings size:', ss?.length);

  // Try to read BIFF12 records from sharedStrings.bin more carefully
  // BIFF12 format: records are: [RecordType (1-2 bytes)] [RecordSize (1-4 bytes, varint)] [data]
  // RecordType encoding: if first byte < 0x80, it's a 1-byte type; else 2-byte
  // RecordSize encoding: similar varint, 1-4 bytes
  if (ss) {
    let i = 0;
    let count = 0;
    while (i < ss.length && count < 20) {
      // Read record type
      let type, typeLen;
      if (ss[i] & 0x80) {
        if (i + 1 >= ss.length) break;
        type = (ss[i] & 0x7F) | ((ss[i+1]) << 7);
        typeLen = 2;
      } else {
        type = ss[i];
        typeLen = 1;
      }
      // Read record size (varint, up to 4 bytes)
      let size = 0;
      let sizeLen = 0;
      for (let b = 0; b < 4; b++) {
        if (i + typeLen + b >= ss.length) break;
        const byte = ss[i + typeLen + b];
        size |= (byte & 0x7F) << (7 * b);
        sizeLen++;
        if (!(byte & 0x80)) break;
      }
      const dataStart = i + typeLen + sizeLen;
      const data = ss.slice(dataStart, dataStart + size);
      console.log(`Record type=0x${type.toString(16)} (${type}) size=${size} data=${data.slice(0,20).toString('hex')}`);

      // BrtSSTItem type: check various possible values
      if (type === 0x13 || type === 19) {
        // Read XLWideString: 4-byte len + UTF-16LE
        if (data.length >= 4) {
          const len = data.readUInt32LE(0);
          const str = data.slice(4, 4 + len*2).toString('utf16le');
          console.log('  -> String:', str);
        }
      }

      i = dataStart + size;
      count++;
    }
  }

  console.log('\nSheet1 first few records:');
  if (sh) {
    let i = 0;
    let count = 0;
    while (i < sh.length && count < 30) {
      let type, typeLen;
      if (sh[i] & 0x80) {
        if (i + 1 >= sh.length) break;
        type = (sh[i] & 0x7F) | ((sh[i+1]) << 7);
        typeLen = 2;
      } else {
        type = sh[i];
        typeLen = 1;
      }
      let size = 0, sizeLen = 0;
      for (let b = 0; b < 4; b++) {
        if (i + typeLen + b >= sh.length) break;
        const byte = sh[i + typeLen + b];
        size |= (byte & 0x7F) << (7 * b);
        sizeLen++;
        if (!(byte & 0x80)) break;
      }
      const dataStart = i + typeLen + sizeLen;
      const data = sh.slice(dataStart, dataStart + size);
      console.log(`Record type=0x${type.toString(16)} (${type}) size=${size} data=${data.slice(0,16).toString('hex')}`);
      i = dataStart + size;
      count++;
    }
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
