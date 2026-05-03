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
  console.log('=== AUSTRALIA details page parsing ===');

  await probe('AU Details page parse structure', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00003', { timeout: T, headers: h });
    const title = r.data.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim()
      ?? r.data.match(/<title>([^<|]+)/)?.[1]?.trim();
    // Look for registration date
    const regDate = r.data.match(/(?:Registration|Registered|Start Date)[:\s]*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i)?.[1]
      ?? r.data.match(/(\d{1,2}\s+\w+\s+\d{4})/)?.[1];
    const type = r.data.match(/(?:Type|Document Type)[:\s]*([A-Za-z ]+Act|Instrument|Regulation)/i)?.[1];
    // Extract JSON-LD or metadata
    const jsonLd = r.data.match(/<script type="application\/ld\+json">([^<]+)<\/script>/i)?.[1];
    const metaDesc = r.data.match(/<meta name="description" content="([^"]+)"/i)?.[1];
    return `title=${title} date=${regDate} type=${type} metaDesc=${metaDesc?.slice(0,100)} jsonLd=${jsonLd?.slice(0,200)}`;
  });

  await probe('AU Details C2025L00001', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025L00001', { timeout: T, headers: h });
    const title = r.data.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim()
      ?? r.data.match(/<title>([^<|]+)/)?.[1]?.trim();
    return `status=${r.status} len=${r.data?.length} title=${title}`;
  });

  await probe('AU Details C2025L00010', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025L00010', { timeout: T, headers: h });
    const title = r.data.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim()
      ?? r.data.match(/<title>([^<|]+)/)?.[1]?.trim();
    return `status=${r.status} title=${title}`;
  });

  // Look for Angular transfer state in Search page
  await probe('AU Search page Angular state', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=act&dateregisteredfrom=2025-01-01&series=current&status=inforce', { timeout: T, headers: h });
    // Angular stores transfer state as ngsscr script or ng-state
    const ngState = r.data.match(/id="ng-state"[^>]*>([\s\S]{0,5000})/i)?.[1];
    const ngsscr = r.data.match(/<script id="serverApp-state"[^>]*type="application\/json"[^>]*>([\s\S]{0,5000})/i)?.[1];
    const scriptData = r.data.match(/<script[^>]*>(window\.__INITIAL|window\.APP|{&quot;)/i)?.[0];
    // Look for any JSON array of results
    const jsonArrayMatch = r.data.match(/\[\{"[a-zA-Z]+":/)?.[0];
    return `ngState=${ngState?.slice(0,200)} ngsscr=${ngsscr?.slice(0,200)} scriptData=${scriptData?.slice(0,100)} jsonMatch=${jsonArrayMatch?.slice(0,100)}`;
  });

  // Check the Details page for better date parsing
  await probe('AU Details page C2025A00001 full text', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00001', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,2000);
    return `text=${text}`;
  });

  // Also try Gazette Part II 2026 for Canada
  await probe('CA Gazette Part II 2026 index', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2026/index-eng.html', { timeout: T, headers: h });
    const issues = (r.data.match(/\/rp-pr\/p2\/2026\/([\d-]+)\/html\/index-eng\.html/g)||[]).slice(0,5).map(u=>u.match(/2026\/([\d-]+)\//)?.[1]);
    return `status=${r.status} issues=${JSON.stringify(issues)}`;
  });

  // Canada Gazette Part I 2026
  await probe('CA Gazette Part I 2026 index', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2026/index-eng.html', { timeout: T, headers: h });
    const issues = (r.data.match(/\/rp-pr\/p1\/2026\/([\d-]+)\/html\/index-eng\.html/g)||[]).slice(0,5).map(u=>u.match(/2026\/([\d-]+)\//)?.[1]);
    return `status=${r.status} issues=${JSON.stringify(issues)}`;
  });

  await probe('CA Gazette Part I 2026 OIC page sample', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2026/2026-01-17/html/order-decret-eng.html', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} isOIC=${r.data?.includes('ORDER')}`;
  });

  // UKSI total count approach - try CSV with just 1 row to get total header
  await probe('UKSI CSV start=1 results=1 total count', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=50', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g)||[]).length;
    const linkNext = r.data.match(/<link rel="next"[^>]+href="([^"]+)"/)?.[1];
    return `entries=${entries} nextLink=${linkNext?.slice(-80)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
