require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 30000;
const h = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== CANADA Gazette Part I — full parse ===');

  // Get ALL Part I 2025 issue dates
  await probe('CA Gazette Part I all 2025 issues', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/index-eng.html', { timeout: T, headers: h });
    const issues = (r.data.match(/\/rp-pr\/p1\/2025\/([\d-]+)\/html\/index-eng\.html/g)||[])
      .map(u => u.match(/2025\/([\d-]+)\//)?.[1])
      .filter(Boolean);
    return `count=${issues.length} issues=${JSON.stringify(issues)}`;
  });

  // Parse the March 15 OIC page content
  await probe('CA Gazette Part I March 15 OICs parsed', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-03-15/html/order-decret-eng.html', { timeout: T, headers: h });
    // Look for PC numbers and titles
    const pcItems = r.data.match(/P\.C\.\s*\d{4}-\d+[\s\S]{0,300}/g)?.slice(0,5).map(m=>m.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,150)) ?? [];
    const h3s = r.data.match(/<h3[^>]*>([^<]+)<\/h3>/gi)?.map(m=>m.replace(/<[^>]+>/g,'')).slice(0,5) ?? [];
    const allText = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(1000,3000);
    return `pc_items=${JSON.stringify(pcItems)} h3s=${JSON.stringify(h3s)} text=${allText}`;
  });

  // Try another Part I issue date (weekly, so try March 22, 2025)
  await probe('CA Gazette Part I March 22 OIC', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-03-22/html/order-decret-eng.html', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} isOIC=${r.data?.includes('ORDER')}`;
  });

  await probe('CA Gazette Part I April 5 OIC', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-04-05/html/order-decret-eng.html', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} isOIC=${r.data?.includes('ORDER')}`;
  });

  // Check Part I index for April to see what links exist
  await probe('CA Gazette Part I April 2025 index links', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-04-12/html/index-eng.html', { timeout: T, headers: h });
    const allLinks = r.data.match(/href="([^"]+\.html)"/g)?.map(m=>m.match(/href="([^"]+)"/)?.[1]).filter(l=>!l.includes('google') && !l.includes('cdn')).slice(0,15);
    return `links=${JSON.stringify(allLinks)}`;
  });

  console.log('\n=== AUSTRALIA APH Legislative Instruments ===');

  await probe('AU aph.gov.au legislative instruments page', async () => {
    const r = await axios.get('https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Legislative_Instruments', { timeout: T, headers: { 'User-Agent': UA } });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500);
    const tableRows = r.data.match(/<tr[\s\S]{0,2000}<\/tr>/gi)?.slice(0,3).map(m=>m.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,200)) ?? [];
    return `len=${r.data?.length} text=${text} rows=${JSON.stringify(tableRows.slice(0,2))}`;
  });

  // Try legislation.gov.au with specific data series IDs (known format)
  await probe('AU FRLI latest instruments series search', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/Results/1/0/0/0/0/0/0/0', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Try fetching AU legislation via data.gov.au for a working dataset
  await probe('AU data.gov.au registered instruments', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=legislative+instrument&rows=5&sort=metadata_modified+desc', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.slice(0,3).map(p=>p.title?.slice(0,50)).join(' | ')}`;
  });

  // Try the APH API for bills 2025 - different endpoint
  await probe('AU aph.gov.au Bills data API', async () => {
    const r = await axios.get('https://www.aph.gov.au/api/Bills?pageIndex=1&pageSize=10&db=Bills&introduced=01/01/2025', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  // AU PM website - pmc.gov.au has 212 bytes but maybe there's an API
  await probe('AU pmc.gov.au cabinet decisions', async () => {
    const r = await axios.get('https://www.pmc.gov.au/api/index', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  // Try legislation.gov.au direct content endpoint for instruments
  await probe('AU legislation.gov.au C2025A series', async () => {
    // Try fetching the details of a known 2025 instrument via content API
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00001', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} type=${r.headers['content-type']?.slice(0,40)}`;
  });

  await probe('AU legislation.gov.au XML for a known 2025 act', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00006/Download', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} type=${r.headers['content-type']?.slice(0,40)}`;
  });

  // Try the FRLI XML download for index
  await probe('AU legislation.gov.au /Browse XML', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/ByRegDate/Acts/InForce/0/0/Principal', {
      timeout: T,
      headers: { 'User-Agent': UA, Accept: 'application/xml, text/xml' }
    });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} len=${r.data?.length}`;
  });

  // Try ato.gov.au or comlaw equivalent
  await probe('AU legislation search via SerpAPI-style', async () => {
    // Try the old comlaw-style API
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00003', { timeout: T, headers: h });
    const title = r.data.match(/<title>([^<|]+)/)?.[1]?.trim();
    return `status=${r.status} len=${r.data?.length} title=${title}`;
  });

  console.log('\n=== UK - get UKSI CSV for count ===');

  await probe('UKSI CSV download count', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.csv?made-date-start=2024-07-05&sort=made-desc&results-count=1', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} len=${r.data?.length} snip=${r.data?.slice(0,200)}`;
  });

  await probe('UKSI total count via ?results-count=9999', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=9999', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g)||[]).length;
    return `entries_returned=${entries} len=${r.data?.length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
