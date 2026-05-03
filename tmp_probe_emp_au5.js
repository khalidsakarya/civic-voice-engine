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
  // Search data.gov.au for more recent APSC APS employment data
  // Try finding 2023 or 2024 datasets
  const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=APS+Employment+Data&sort=metadata_modified+desc&rows=10', { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const results = r.data?.result?.results || [];
  console.log('Recent APS Employment datasets:');
  results.forEach(d => {
    console.log('\n -', d.title, '| modified:', d.metadata_modified);
    const dlRes = (d.resources || []).filter(r => r.url && (r.format || '').toLowerCase().match(/csv|xlsx|xls|zip|ods/));
    dlRes.slice(0, 3).forEach(dl => console.log('   ', dl.format, ':', dl.url?.substring(0, 120)));
  });

  // Try to get the most recent dataset (first result)
  const recent = results.find(d => {
    const dlRes = (d.resources || []).filter(r => r.url && r.url.startsWith('http'));
    return dlRes.length > 0;
  });
  if (recent) {
    const xlsxRes = (recent.resources || []).find(r => r.url && (r.format || '').toLowerCase().includes('xls'));
    if (xlsxRes) {
      console.log('\n\nTrying to download:', xlsxRes.url);
      try {
        const r2 = await axios.get(xlsxRes.url, {
          timeout: 30000,
          responseType: 'arraybuffer',
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' }
        });
        const buf = Buffer.from(r2.data);
        console.log('Downloaded:', buf.length, 'bytes, magic:', buf.slice(0, 4).toString('hex'));

        if (buf[0] === 0x50 && buf[1] === 0x4B) {
          // ZIP-based XLSX
          const entries = extractZipEntries(buf);
          const ssXml = entries['xl/sharedStrings.xml']?.toString('utf8') || '';
          const strings = [...ssXml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(m => m[1]);
          console.log('Sheet names in workbook:');
          const wbXml = entries['xl/workbook.xml']?.toString('utf8') || '';
          const sheetNames = [...wbXml.matchAll(/name="([^"]+)"/g)].map(m => m[1]);
          console.log(sheetNames);
          console.log('Shared strings (first 30):', strings.slice(0, 30));
        }
      } catch(e) { console.log('Download error:', e.message.substring(0, 80)); }
    }
  }
}
main().catch(e => console.error(e.message));
