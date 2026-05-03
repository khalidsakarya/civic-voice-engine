require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 20000;
const h = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== TRUMP — federalregister.gov ===');

  await probe('FR executive-orders API', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&per_page=5&order=newest&fields%5B%5D=title&fields%5B%5D=document_number&fields%5B%5D=signing_date&fields%5B%5D=publication_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract', { timeout: T, headers: h });
    const items = r.data?.results?.slice(0,3).map(d => `EO${d.executive_order_number}: ${d.title?.slice(0,60)} (${d.signing_date})`);
    return `count=${r.data?.count} total_pages=${r.data?.total_pages}\n  ${items?.join('\n  ')}`;
  });

  await probe('FR proclamations API', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=proclamation&per_page=3&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=proclamation_number', { timeout: T, headers: h });
    const items = r.data?.results?.slice(0,3).map(d => `Proc.${d.proclamation_number}: ${d.title?.slice(0,60)} (${d.signing_date})`);
    return `count=${r.data?.count}\n  ${items?.join('\n  ')}`;
  });

  await probe('FR presidential-actions (memoranda, notices)', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=presidential_memoranda&per_page=3&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date', { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${r.data?.results?.slice(0,2).map(d=>d.title?.slice(0,60)).join(' | ')}`;
  });

  await probe('FR available presidential doc types', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&per_page=1&fields%5B%5D=presidential_document_type', { timeout: T, headers: h });
    return `sample_type=${r.data?.results?.[0]?.presidential_document_type} count=${r.data?.count}`;
  });

  console.log('\n=== CARNEY — laws-lois.justice.gc.ca + pm.gc.ca ===');

  await probe('CA Orders in Council search JSON', async () => {
    const r = await axios.get('https://laws-lois.justice.gc.ca/eng/annualstatutes/', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA privy-council OIC JSON API', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=1&search=prime+minister&action=ByNumber', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA OIC search REST', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/api/oic?q=prime+minister&lang=en&limit=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('CA OIC main page', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*api[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} api_links=${JSON.stringify(links)}`;
  });

  await probe('CA OIC JSON result', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=1&search=&action=ByNumber&order_number=2025-&format=json', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('CA pm.gc.ca news (existing fetcher already works)', async () => {
    const r = await axios.get('https://pm.gc.ca/jsonapi/node/article?sort=-created&page%5Blimit%5D=3&filter%5Bfield_type%5D=order', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    return `count=${r.data?.data?.length} meta=${JSON.stringify(r.data?.meta)}`;
  });

  await probe('CA gazette legislation search', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/index-eng.html', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  console.log('\n=== STARMER — legislation.gov.uk + gov.uk ===');

  await probe('legislation.gov.uk SI search', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/search?type=uksi&made-date-start=2024-07-05&sort=made&start-index=1&results-count=5', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('legislation.gov.uk atom feed SI', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=5', { timeout: T, headers: h });
    const entries = (r.data?.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title>([^<]+)/g)].slice(1,4).map(m=>m[1]);
    return `entries=${entries} titles=${JSON.stringify(titles)}`;
  });

  await probe('legislation.gov.uk SI JSON feed', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/2024/data.feed?results-count=3', { timeout: T, headers: { ...h, Accept: 'application/atom+xml, application/xml' } });
    const entries = (r.data?.match(/<entry>/g) || []).length;
    return `entries=${entries} len=${r.data?.length}`;
  });

  await probe('legislation.gov.uk SI search JSON', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi?start-index=1&results-count=5&sort=made-desc&made-date-start=2024-07-05', { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} len=${r.data?.length} type=${r.headers['content-type']?.slice(0,40)}`;
  });

  // gov.uk for Starmer executive content
  await probe('govuk PM statutory instruments search', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_document_type=statutory_instrument&filter_organisations=prime-ministers-office-10-downing-street&count=3&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} results=${r.data?.results?.length} sample=${r.data?.results?.slice(0,2).map(x=>x.title).join(' | ')}`;
  });

  await probe('govuk legislation search', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?q=statutory+instrument&filter_organisations=cabinet-office&count=3&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} sample=${r.data?.results?.slice(0,2).map(x=>x.title).join(' | ')}`;
  });

  console.log('\n=== ALBANESE — legislation.gov.au + pm.gov.au ===');

  await probe('legislation.gov.au search', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/Results/1/0/0/0/0/1/0/0/0/0', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });

  await probe('legislation.gov.au API search', async () => {
    const r = await axios.get('https://www.legislation.gov.au/SearchAPI/QuerySearch?Title=&Phrase=&TextSearch=&DateFrom=2025-01-01&DateTo=&TypeNumber=1&limit=5&ResultType=XML', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('legislation.gov.au JSON API', async () => {
    const r = await axios.get('https://www.legislation.gov.au/api/search?type=1&dateFrom=2025-01-01&limit=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('legislation.gov.au feed', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Latest/2025?result=1', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });

  await probe('Federal Register of Legislation AU Acts', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?title=&num=&type=act&dateFrom=2025-01-01&series=current&status=inforce', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });

  await probe('AU legislation SPARQL/API', async () => {
    const r = await axios.get('https://www.legislation.gov.au/api/content/C2025A', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('AU legislation.gov.au RSS', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search/AdvancedSearch?type=act&status=all&dateregisteredfrom=2025-01-01&limit=5&format=rss', { timeout: T, headers: h });
    const items = (r.data?.match(/<item>/g)||[]).length;
    return `status=${r.status} len=${r.data?.length} items=${items}`;
  });

  // pm.gov.au is blocked, try alternative
  await probe('AU pm.gov.au blocked check', async () => {
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: h });
    return `noindex=${r.data?.includes('NOINDEX')} len=${r.data?.length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
