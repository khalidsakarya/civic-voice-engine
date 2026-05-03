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
  console.log('=== FR EO - confirm working params ===');

  await probe('FR EO ISO date + per_page=50', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} first=${r.data?.results?.[0]?.signing_date} last=${r.data?.results?.at(-1)?.signing_date}`;
  });

  await probe('FR Proclamations ISO date + per_page=50', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=proclamation&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages}`;
  });

  await probe('FR Memoranda ISO date', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=presidential_memoranda&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} sample=${r.data?.results?.[0]?.title?.slice(0,60)}`;
  });

  console.log('\n=== CANADA open.canada.ca OIC datasets ===');

  await probe('open.canada.ca OIC dataset 1', async () => {
    const r = await axios.get('https://open.canada.ca/data/en/api/3/action/package_show?id=d63a5c6d-fd93-4442-ac28-561f4dac90c6', { timeout: T, headers: h });
    const res = r.data?.result;
    const resources = res?.resources ?? [];
    return `title=${res?.title} resources=${resources.length} formats=${resources.slice(0,3).map(x=>x.format+'|'+x.url?.slice(-50)).join('; ')}`;
  });

  await probe('open.canada.ca OIC dataset 2', async () => {
    const r = await axios.get('https://open.canada.ca/data/en/api/3/action/package_show?id=c3910028-7c49-4659-99da-3ed00ca2cb53', { timeout: T, headers: h });
    const res = r.data?.result;
    const resources = res?.resources ?? [];
    return `title=${res?.title} resources=${resources.length} formats=${resources.slice(0,3).map(x=>x.format+'|'+x.url?.slice(-50)).join('; ')}`;
  });

  // Try accessing the actual OIC JSON data
  await probe('open.canada.ca OIC JSON resource download', async () => {
    const r = await axios.get('https://open.canada.ca/data/en/api/3/action/package_show?id=d63a5c6d-fd93-4442-ac28-561f4dac90c6', { timeout: T, headers: h });
    const jsonRes = r.data?.result?.resources?.find(r => r.format?.toLowerCase().includes('json') || r.url?.endsWith('.json'));
    const csvRes = r.data?.result?.resources?.find(r => r.format?.toLowerCase().includes('csv') || r.url?.endsWith('.csv'));
    return `json_url=${jsonRes?.url?.slice(-60)} csv_url=${csvRes?.url?.slice(-60)}`;
  });

  // Try Gazette Part II issue listing for Carney era (March 2025 onwards)
  await probe('CA Gazette Part II 2025 recent issues', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/index-eng.html', { timeout: T, headers: h });
    // Get all bi-weekly issue HTML index URLs
    const issues = (r.data.match(/\/rp-pr\/p2\/2025\/([0-9-]+)\/html\/index-eng\.html/g)||[])
      .filter(u => u.match(/2025-(0[3-9]|1[0-2])/)) // March-December 2025
      .slice(0, 10);
    return `issues in Carney era 2025: ${JSON.stringify(issues)}`;
  });

  // Get the SOR list from a March 2025 gazette issue
  await probe('CA Gazette March 26 2025 issue SORs', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-03-26/html/index-eng.html', { timeout: T, headers: h });
    const sorLinks = (r.data.match(/href="(sor-[^"]+\.html)"/g)||[]).map(m=>m.match(/href="([^"]+)"/)?.[1]);
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(200, 800);
    return `sor_count=${sorLinks.length} links=${JSON.stringify(sorLinks.slice(0,5))} text=${text}`;
  });

  // Fetch one SOR page to understand the structure (title, date, description)
  await probe('CA Gazette SOR page title and date parse', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-03-26/html/sor-dors64-eng.html', { timeout: T, headers: h });
    const title = r.data.match(/<title>([^<|]+)/)?.[1]?.trim();
    const h2 = r.data.match(/<h2[^>]*>([^<]+)<\/h2>/i)?.[1]?.trim();
    const dateInText = r.data.match(/Registered:?\s*(\w+ \d+, \d{4})|P\.C\.\s*(\d{4}-\d+)|Registration\s*(\d{4}-\d{2}-\d{2})/i);
    const regDate = r.data.match(/Registration\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? r.data.match(/Registered:?\s*([A-Za-z]+ \d+, \d{4})/i)?.[1];
    const desc = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(800,1200);
    return `title=${title} h2=${h2} regDate=${regDate} desc=${desc}`;
  });

  console.log('\n=== UK legislation.gov.uk - total count ===');

  await probe('UKSI openSearch namespace fix', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=1', { timeout: T, headers: h });
    // Try all variations of the namespace
    const total1 = r.data.match(/openSearch:totalResults[^>]*>(\d+)/)?.[1];
    const total2 = r.data.match(/totalResults[^>]*>(\d+)/)?.[1];
    const total3 = r.data.match(/:totalResults>(\d+)/)?.[1];
    const total4 = r.data.match(/<[^:>]+:totalResults>(\d+)/)?.[1];
    const snip = r.data.slice(400, 800);
    return `t1=${total1} t2=${total2} t3=${total3} t4=${total4} snip=${snip}`;
  });

  console.log('\n=== AUSTRALIA - parse legislation.gov.au /Search HTML ===');

  await probe('AU legislation.gov.au /Search HTML content', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=legislative_instrument&dateregisteredfrom=2025-01-01', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    // Look for any structured data
    const jsonLd = r.data.match(/<script type="application\/ld\+json">([^<]+)<\/script>/i)?.[1];
    const instrumentTitles = (r.data.match(/C202[0-9][A-Z]\d+/g)||[]).slice(0,5);
    return `len=${r.data?.length} jsonLd=${jsonLd?.slice(0,200)} instruments=${JSON.stringify(instrumentTitles)} text=${text.slice(0,300)}`;
  });

  // Try aph.gov.au for legislative instruments
  await probe('AU aph.gov.au legislativeInstruments JSON', async () => {
    const r = await axios.get('https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Legislative_Instruments?db=Current&r=5', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Try the legislation.gov.au API endpoint with different path
  await probe('AU FRLI search endpoint', async () => {
    const r = await axios.get('https://www.legislation.gov.au/api/Searches?searchText=&type=11&dateFrom=2025-01-01&pageSize=5', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('AU FRLI content API', async () => {
    const r = await axios.get('https://www.legislation.gov.au/api/content/LI%20list?type=11&dateFrom=2025-01-01&limit=5', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  // Try FRLI sitemap to find actual XML feeds
  await probe('AU FRLI /content/... endpoint probe', async () => {
    const r = await axios.get('https://www.legislation.gov.au/content/C2025L00001', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} len=${r.data?.length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
