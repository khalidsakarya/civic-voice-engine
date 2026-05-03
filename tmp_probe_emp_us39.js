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

async function main() {
  // Get all XLSX links from the OMB historical tables page
  const r = await axios.get('https://www.whitehouse.gov/omb/budget/historical-tables/', {
    timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const html = r.data;

  const xlsxLinks = [...html.matchAll(/href="(https:\/\/www\.whitehouse\.gov\/wp-content\/[^"]*\.xlsx)"/gi)].map(m => m[1]);
  console.log('Total XLSX files:', xlsxLinks.length);

  // Find FTE-related files
  const fteLinks = xlsxLinks.filter(l => l.includes('17'));
  console.log('Table 17 files:', fteLinks);

  // Also look for any FTE employment text near links
  const fteSection = [...html.matchAll(/(?:FTE|Full.Time Equivalent)[^<]*<[^>]*href="([^"]+\.xlsx)"/gi)].map(m => m[1]);
  console.log('\nFTE section links:', fteSection);

  // Look at the actual FTE mentions with context
  const fteMentions = [...html.matchAll(/.{0,200}FTE.{0,200}/g)].map(m => m[0]);
  fteMentions.forEach(m => console.log('\nFTE context:', m.substring(0, 300)));

  // Download the ZIP to look for table 17 files
  console.log('\n\nDownloading hist_fy2027.zip...');
  try {
    const zipR = await axios.get('https://www.whitehouse.gov/wp-content/uploads/2026/04/hist_fy2027.zip', {
      timeout: 30000, responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const buf = Buffer.from(zipR.data);
    console.log('ZIP size:', buf.length, 'bytes');

    const entries = extractZipEntries(buf);
    console.log('ZIP entries:', Object.keys(entries).sort());
  } catch(e) { console.log('ZIP error:', e.message.substring(0, 80)); }
}
main().catch(e => console.error(e.message));
