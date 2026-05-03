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
  console.log('=== AUSTRALIA api.prod.legislation.gov.au ===');

  await probe('AU API root', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  await probe('AU API search acts 2025', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/search?type=act&dateFrom=2025-01-01&limit=10', { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU API legislation search', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/legislation?type=1&startDate=2025-01-01&limit=5", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU API content acts 2025 search', async () => {
    // The angular app queries content() - try the search endpoint used by the app
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/content('/search-results')?type=1&dateFrom=2025-01-01&limit=5", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  // The ngState shows content('/config-public/menus/mega-menu.json') pattern
  // Try to find a search or browse endpoint in the API
  await probe('AU API browse path', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/content('%2Fsearch-results%2Facts')?status=inforce&dateFrom=2025-01-01", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU API OData style', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Legislation?%24filter=type+eq+1+and+startDate+ge+datetime'2025-01-01T00:00:00'&%24top=5", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  // Try direct search endpoint
  await probe('AU API v1 search endpoint', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/search?searchText=&type=1&dateFrom=2025-01-01&pageSize=5", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  // The app uses content('path') - try to find a list endpoint
  await probe('AU API acts list', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/acts?year=2025&limit=5", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  // Try fetching a specific item to understand the content() pattern
  await probe('AU API content C2025A00001', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/content('C2025A00001')", { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  console.log('\n=== AU title from Details page ===');

  await probe('AU Details page title extraction', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00001', { timeout: T, headers: h });
    // Title is in <title> tag
    const title = r.data.match(/<title>([^<]+)/)?.[1]?.replace(' - Federal Register of Legislation','').trim();
    // Look for dates in meta or body
    const dateMatch = r.data.match(/(?:Registered:|Royal Assent|Commencement)[^0-9]*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i)?.[1];
    // look for structured data
    const tableData = r.data.match(/<td[^>]*>\s*([\d\/]+)\s*<\/td>/g)?.map(m=>m.replace(/<[^>]+>/g,'').trim()).slice(0,10);
    return `title=${title} date=${dateMatch} tableDates=${JSON.stringify(tableData?.slice(0,5))}`;
  });

  await probe('AU Details page C2025A00010 title', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025A00010', { timeout: T, headers: h });
    const title = r.data.match(/<title>([^<]+)/)?.[1]?.replace(' - Federal Register of Legislation','').trim();
    return `title=${title} len=${r.data?.length}`;
  });

  await probe('AU Details page C2025L00005', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Details/C2025L00005', { timeout: T, headers: h });
    const title = r.data.match(/<title>([^<]+)/)?.[1]?.replace(' - Federal Register of Legislation','').trim();
    return `title=${title} status=${r.status} len=${r.data?.length}`;
  });

  console.log('\n=== CANADA Part I 2026 OIC check ===');

  // Find which Part I 2026 issues have OIC pages
  const issues2026 = ['2026-04-25','2026-04-18','2026-04-11','2026-04-04','2026-03-28','2026-03-21','2026-03-14','2026-03-07','2026-02-28','2026-02-21'];
  for (const date of issues2026.slice(0,6)) {
    await probe(`CA Part I ${date} OIC`, async () => {
      const r = await axios.get(`https://www.gazette.gc.ca/rp-pr/p1/2026/${date}/html/order-decret-eng.html`, { timeout: T, headers: h });
      return `status=${r.status} len=${r.data?.length} hasOIC=${r.data?.includes('ORDERS IN COUNCIL')}`;
    });
  }

  // UK pagination with page= param
  await probe('UK UKSI page=2', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&results-count=50&page=2', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g)||[]).length;
    const firstTitle = r.data.match(/<title>([^<]+)/g)?.[1]?.replace('<title>','');
    const nextLink = r.data.match(/<link rel="next"[^>]+href="([^"]+)"/)?.[1];
    return `entries=${entries} first=${firstTitle?.slice(0,50)} next_page_in_url=${nextLink?.match(/page=(\d+)/)?.[1]}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
