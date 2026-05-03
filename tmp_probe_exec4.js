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
  console.log('=== TRUMP FR — date filter formats ===');

  // Try no date filter, just paginate (count=1537 total, we need all from 2025+)
  await probe('FR EO no date filter page 1', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&per_page=50&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date&fields%5B%5D=executive_order_number&fields%5B%5D=html_url&fields%5B%5D=abstract&fields%5B%5D=presidential_document_type';
    const r = await axios.get(url, { timeout: T, headers: h });
    const first = r.data?.results?.[0];
    const last = r.data?.results?.[r.data?.results?.length - 1];
    return `count=${r.data?.count} total_pages=${r.data?.total_pages} first_date=${first?.signing_date} last_date=${last?.signing_date}`;
  });

  // Try date filter with different format (no slash encoding)
  await probe('FR EO date filter 2025 ISO style', async () => {
    const url = 'https://www.federalregister.gov/api/v1/documents.json?conditions%5Btype%5D%5B%5D=PRESDOCU&conditions%5Bpresidential_document_type%5D%5B%5D=executive_order&conditions%5Bsigning_date%5D%5Bgte%5D=2025-01-20&per_page=3&order=newest&fields%5B%5D=title&fields%5B%5D=signing_date';
    const r = await axios.get(url, { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${r.data?.results?.[0]?.signing_date}`;
  });

  // Try date as query param with qs-style different encoding
  await probe('FR EO date filter page param', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json', {
      timeout: T, headers: h,
      params: {
        'conditions[type][]': 'PRESDOCU',
        'conditions[presidential_document_type][]': 'executive_order',
        'conditions[signing_date][gte]': '01/20/2025',
        'per_page': 3, 'order': 'newest',
        'fields[]': 'title',
      },
      paramsSerializer: (p) => {
        const qs = require('querystring');
        // Manual serialization that preserves brackets
        const parts = [];
        for (const [k, v] of Object.entries(p)) {
          if (Array.isArray(v)) v.forEach(vi => parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(vi)}`));
          else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        }
        return parts.join('&');
      }
    });
    return `count=${r.data?.count} sample=${r.data?.results?.[0]?.signing_date}`;
  });

  console.log('\n=== CANADA OIC — what the site now looks like ===');

  await probe('CA OIC main page text', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 600);
    const allLinks = r.data.match(/href="([^"]+)"/gi)?.map(m=>m.match(/href="([^"]+)"/)?.[1]).filter(l=>l.includes('result') || l.includes('search') || l.includes('oic')).slice(0,10);
    return `text=${text} links=${JSON.stringify(allLinks)}`;
  });

  // Try the new OIC search URLs (site may have been migrated)
  await probe('CA OIC search result all 2025', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=100', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA OIC search via privy council direct', async () => {
    const r = await axios.get('https://pco-bcp.gc.ca/oic/OICMain.nsf/index_eng.htm', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Try open.canada.ca for OIC dataset
  await probe('CA open.canada.ca OIC dataset', async () => {
    const r = await axios.get('https://open.canada.ca/data/en/api/3/action/package_search?q=orders+in+council&rows=3', { timeout: T, headers: h });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).join('|')}`;
  });

  // Gazette: get a specific issue with Carney-era SORs
  await probe('CA Gazette 2025-04-09 issue index full text', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/index-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 1000);
    const sorLinks = (r.data.match(/href="(sor-[^"]+\.html)"/g)||[]).map(m=>m.match(/href="([^"]+)"/)?.[1]);
    const siLinks = (r.data.match(/href="(si[0-9]+-[^"]+\.html)"/g)||[]).map(m=>m.match(/href="([^"]+)"/)?.[1]);
    return `sor_links=${JSON.stringify(sorLinks.slice(0,5))} si_links=${JSON.stringify(siLinks.slice(0,5))} text=${text}`;
  });

  await probe('CA Gazette SOR page structure', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/sor-dors113-eng.html', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 800);
    return `len=${r.data?.length} text=${text}`;
  });

  // Canada: try pm.gc.ca JSONAPI node listing to find OIC content type name
  await probe('pm.gc.ca JSONAPI links list all types', async () => {
    const r = await axios.get('https://pm.gc.ca/jsonapi', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    const links = Object.keys(r.data?.links ?? {});
    const nodeTypes = links.filter(l => l.startsWith('node--'));
    return `all node types: ${JSON.stringify(nodeTypes)}`;
  });

  console.log('\n=== AUSTRALIA — APH bills page and alternatives ===');

  await probe('AU APH bills search page parse', async () => {
    const r = await axios.get('https://www.aph.gov.au/Parliamentary_Business/Bills_Legislation/Bills_Search_Results?searchQuery=&Introduced=01%2F01%2F2025&Advanced=True&db=BILLS&dbSub=Current&r=5', { timeout: T, headers: { 'User-Agent': UA } });
    const bills = r.data.match(/<a[^>]+href="[^"]*Bills_all[^"]*"[^>]*>([^<]+)<\/a>/gi)?.slice(0,5) ?? [];
    const text = r.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0,500);
    return `bills=${JSON.stringify(bills)} text=${text}`;
  });

  // Try legislation.gov.au with specific series filter
  await probe('AU legislation.gov.au XML sitemap', async () => {
    const r = await axios.get('https://www.legislation.gov.au/sitemap.xml', { timeout: T, headers: h });
    const sitemaps = r.data.match(/<loc>([^<]+)<\/loc>/g)?.map(m=>m.replace('<loc>','').replace('</loc>',''));
    return `sitemaps=${JSON.stringify(sitemaps?.slice(0,5))}`;
  });

  await probe('AU legislation.gov.au XML sitemap sub', async () => {
    const r = await axios.get('https://www.legislation.gov.au/sitemap-acts-current.xml', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice(0,300)}`;
  });

  // Try AU legislation with Accept: application/rss+xml
  await probe('AU legislation RSS', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/ByRegDate/Acts/InForce/0/0/Principal', { timeout: T, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, */*' } });
    return `status=${r.status} len=${r.data?.length} type=${r.headers['content-type']?.slice(0,40)}`;
  });

  // Try the aph.gov.au Gazettes for royal assent instruments
  await probe('AU aph.gov.au Gazettes 2025', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Browse/Results/1/0/0/0/0/1/2025', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('AU legislation.gov.au /Search with JSON accept', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=legislative_instrument&dateregisteredfrom=2025-01-01', {
      timeout: T,
      headers: { 'User-Agent': UA, Accept: 'application/json' }
    });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} len=${r.data?.length ?? JSON.stringify(r.data).length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
