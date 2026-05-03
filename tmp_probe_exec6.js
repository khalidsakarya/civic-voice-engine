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
  console.log('=== FR EO - test different per_page values ===');

  // Try very small per_page to confirm FR works at all
  await probe('FR EO per_page=5 ISO date', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=5&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} OK`;
  });

  await probe('FR EO per_page=20 ISO date', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=20&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages}`;
  });

  await probe('FR Proclamations per_page=20', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=proclamation&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=20&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=html_url&fields%5B%5D=abstract';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages}`;
  });

  await probe('FR Memoranda per_page=20', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=presidential_memoranda&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=20&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=html_url&fields%5B%5D=abstract';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} sample=${r.data?.results?.[0]?.title?.slice(0,60)}`;
  });

  console.log('\n=== CANADA Gazette Part I (OICs) ===');

  await probe('CA Gazette Part I 2025 index', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/index-eng.html', { timeout: T, headers: h });
    const issues = (r.data.match(/\/rp-pr\/p1\/2025\/([0-9-]+)\/html\/index-eng\.html/g)||[]).slice(0,10);
    return `issues=${JSON.stringify(issues.slice(0,5))} count=${issues.length}`;
  });

  await probe('CA Gazette Part I issue index', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-04-12/html/index-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400);
    const oicLinks = (r.data.match(/href="(order-[^"]+\.html)"/g)||[]).map(m=>m.match(/href="([^"]+)"/)?.[1]).slice(0,5);
    return `oic_links=${JSON.stringify(oicLinks)} text=${text}`;
  });

  await probe('CA Gazette Part I order-decret page', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-04-12/html/order-decret-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,1000);
    const h2s = r.data.match(/<h2[^>]*>([^<]+)<\/h2>/gi)?.map(m=>m.replace(/<[^>]+>/g,'')).slice(0,5);
    const items = r.data.match(/P\.C\.\s*\d{4}-\d+[^<]*<[^>]*>([^<]+)/gi)?.slice(0,5).map(m=>m.replace(/<[^>]+>/g,'').trim());
    return `len=${r.data?.length} h2s=${JSON.stringify(h2s)} items=${JSON.stringify(items)} text=${text}`;
  });

  await probe('CA Gazette March 2025 OIC page', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p1/2025/2025-03-15/html/order-decret-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,800);
    const h2s = r.data.match(/<h2[^>]*>([^<]+)<\/h2>/gi)?.map(m=>m.replace(/<[^>]+>/g,'')).slice(0,5);
    return `len=${r.data?.length} h2s=${JSON.stringify(h2s)} text=${text}`;
  });

  console.log('\n=== AUSTRALIA legislation.gov.au - parse Search HTML ===');

  await probe('AU Search Legislative Instruments HTML parse', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=legislative_instrument&dateregisteredfrom=2025-01-01', { timeout: T, headers: h });
    // The Angular-rendered HTML should have pre-rendered content from SSR
    // Look for <app-root> content
    const appRoot = r.data.match(/<app-root[^>]*>([\s\S]{0,20000})<\/app-root>/i)?.[1];
    const rowData = appRoot?.match(/C202[56][A-Z]\d+/g)?.slice(0,10);
    const titleMatches = appRoot?.match(/<td[^>]*>([^<]{20,100})<\/td>/g)?.slice(0,10).map(m=>m.replace(/<[^>]+>/g,''));
    return `appRoot_len=${appRoot?.length} row_data=${JSON.stringify(rowData)} titles=${JSON.stringify(titleMatches?.slice(0,5))}`;
  });

  await probe('AU legislation.gov.au Acts 2025 page', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=act&dateregisteredfrom=2025-01-01&series=current&status=inforce', { timeout: T, headers: h });
    const appRoot = r.data.match(/<app-root[^>]*>([\s\S]{0,30000})<\/app-root>/i)?.[1] ?? r.data;
    const actCodes = appRoot?.match(/C202[56][A-Z]\d+/g)?.slice(0,10) ?? [];
    const anchors = appRoot?.match(/<a [^>]*href="[^"]*C202[56][^"]*"[^>]*>([^<]+)<\/a>/gi)?.slice(0,5) ?? [];
    return `act_codes=${JSON.stringify(actCodes)} anchors=${JSON.stringify(anchors)}`;
  });

  await probe('AU aph.gov.au Bills server-rendered content', async () => {
    const r = await axios.get('https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Bills_Search_Results?searchQuery=&Introduced=01%2F01%2F2025&Advanced=True', { timeout: T, headers: { 'User-Agent': UA } });
    // Look for rendered bill data
    const billLinks = r.data.match(/href="\/Parliamentary_Business\/Bills_Legislation\/Bills_all[^"]+">([^<]+)</gi)?.slice(0,5);
    const h3s = r.data.match(/<h3[^>]*>([^<]{10,100})<\/h3>/gi)?.map(m=>m.replace(/<[^>]+>/g,'')).slice(0,5);
    const tableRows = r.data.match(/<tr[^>]*>[\s\S]{0,500}<\/tr>/gi)?.slice(0,3).map(m=>m.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,100));
    return `bill_links=${JSON.stringify(billLinks)} h3s=${JSON.stringify(h3s)} rows=${JSON.stringify(tableRows?.slice(0,3))}`;
  });

  // Try data.gov.au for legislation datasets
  await probe('AU data.gov.au legislation datasets', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=legislation+register+2025&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
