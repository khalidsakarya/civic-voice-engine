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
  console.log('=== TRUMP FR — direct URL ===');

  await probe('FR EO since 2025-01-20 count', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&conditions%5Bsigning_date%5D%5Bgte%5D=01%2F20%2F2025&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} sample: ${r.data?.results?.[0]?.title?.slice(0,60)}`;
  });

  await probe('FR Proclamations since 2025-01-20', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=proclamation&conditions%5Bsigning_date%5D%5Bgte%5D=01%2F20%2F2025&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} total_pages=${r.data?.total_pages}`;
  });

  await probe('FR memoranda check', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=presidential_memoranda&conditions%5Bsigning_date%5D%5Bgte%5D=01%2F20%2F2025&per_page=3&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${r.data?.results?.[0]?.title?.slice(0,60)}`;
  });

  console.log('\n=== CANADA OIC ===');

  await probe('CA OIC base redirect', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/', { timeout: T, headers: h, maxRedirects: 5 });
    const resultLinks = r.data.match(/href="([^"]*result[^"]*)"/gi);
    return `status=${r.status} len=${r.data?.length} url=${r.request?.res?.responseUrl}`;
  });

  await probe('CA OIC search 2025 via form POST', async () => {
    const r = await axios.post('https://orders-in-council.canada.ca/en/result.php',
      'lang=en&rec=100&order_year=2025&search=&action=ByYear',
      { timeout: T, headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA OIC en result by year GET', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/en/result.php?lang=en&rec=100&order_year=2025', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA Gazette Part II 2025 issues list', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/index-eng.html', { timeout: T, headers: h });
    const issues = r.data.match(/\/rp-pr\/p2\/2025\/[0-9-]+\/html\/index-eng\.html/g) || [];
    return `issues found: ${issues.length} first3: ${JSON.stringify(issues.slice(0,3))}`;
  });

  await probe('CA Gazette one issue - find OIC/regulations', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/index-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const sis = r.data.match(/href="([^"]*sor-[^"]+)"/gi)?.map(m=>m.match(/href="([^"]+)"/)?.[1]).slice(0,5) ?? [];
    const oics = r.data.match(/href="([^"]*si[0-9]+-[^"]+)"/gi)?.map(m=>m.match(/href="([^"]+)"/)?.[1]).slice(0,5) ?? [];
    return `text=${text.slice(0,300)} sis=${JSON.stringify(sis)} oics=${JSON.stringify(oics)}`;
  });

  await probe('CA Gazette April 9 2025 a specific OIC', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/si33-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return `len=${r.data?.length} text=${text.slice(0,400)}`;
  });

  console.log('\n=== STARMER UK legislation ===');

  await probe('legislation.gov.uk uksi total count since Starmer', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=1', { timeout: T, headers: h });
    const total = r.data.match(/<opensearch:totalResults>(\d+)<\/opensearch:totalResults>/)?.[1]
      ?? r.data.match(/totalResults[^>]*>(\d+)/)?.[1]
      ?? r.data.match(/(\d+)<\/opensearch:totalResults>/)?.[1];
    const startIdx = r.data.match(/startIndex[^>]*>(\d+)/)?.[1];
    const snip = r.data.slice(0, 600);
    return `total=${total} startIdx=${startIdx} snip=${snip}`;
  });

  await probe('legislation.gov.uk uksi page 2 pagination', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=51&results-count=50', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g)||[]).length;
    const titles = r.data.match(/<title>([^<]+)/g)?.slice(1,4).map(t=>t.replace('<title>',''));
    return `entries=${entries} titles=${JSON.stringify(titles)}`;
  });

  await probe('legislation.gov.uk ukpga SIs Starmer 2024', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/ukpga/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=5', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g)||[]).length;
    const titles = r.data.match(/<title>([^<]+)/g)?.slice(1,3).map(t=>t.replace('<title>',''));
    return `entries=${entries} titles=${JSON.stringify(titles)}`;
  });

  console.log('\n=== AUSTRALIA legislation.gov.au ===');

  await probe('AU main.js fetch API hints', async () => {
    const r = await axios.get('https://www.legislation.gov.au/main.33cbc5b7ed96b0b9.js', { timeout: T, headers: h });
    const apis = [];
    const re = /"(\/[A-Za-z]+Search[A-Za-z/]*|\/api\/[A-Za-z0-9/_-]+)"/g;
    let m;
    while ((m = re.exec(r.data)) !== null) apis.push(m[1]);
    const baseUrl = r.data.match(/"(https:\/\/[^"]{5,60}\/api[^"]{0,40})"/)?.[1];
    return `api_paths=${JSON.stringify([...new Set(apis)].slice(0,15))} baseUrl=${baseUrl}`;
  });

  await probe('AU legislation.gov.au /Browse/ByRegDate direct', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/ByRegDate/Acts/InForce/0/0/Principal', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} isHTML=${r.data?.includes('<!DOCTYPE')}`;
  });

  await probe('AU aph.gov.au bills 2025', async () => {
    const r = await axios.get('https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Bills_Search_Results?searchQuery=&Introduced=01%2F01%2F2025&Advanced=True&db=BILLS&dbSub=Current&r=5', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('AU aph bills JSON API', async () => {
    const r = await axios.get('https://www.aph.gov.au/api/Bills?dateIntroducedFrom=2025-01-01&pageIndex=1&pageSize=5', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  // Try the Federal Executive Council approach (OICs in AU)
  await probe('AU Federal Executive Council OIC', async () => {
    const r = await axios.get('https://www.pmc.gov.au/government/federal-executive-council', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('AU legislation.gov.au Recent registrations OData', async () => {
    const r = await axios.get('https://www.legislation.gov.au/SearchAPI/QuerySearch?q=&type=Instrument&dateFrom=2025-01-01&pageSize=5&format=json', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  // Try OData feed for AU
  await probe('AU legislation OData endpoint', async () => {
    const r = await axios.get('https://www.legislation.gov.au/odata/Legislations?$filter=RegisterDate ge datetime%272025-01-01T00:00:00%27&$top=5&$format=json', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
