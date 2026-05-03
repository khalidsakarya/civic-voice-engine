require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== TRUMP — FR API detail ===');

  // Full field set for EO
  await probe('FR EO full fields sample', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json', {
      timeout: T, headers: h,
      params: {
        'conditions[type][]': 'PRESDOCU',
        'conditions[presidential_document_type][]': 'executive_order',
        'conditions[correction]': '0',
        'per_page': 3,
        'order': 'newest',
        'fields[]': ['title','document_number','signing_date','publication_date','executive_order_number','html_url','abstract','type','presidential_document_type'],
      },
    });
    return `count=${r.data?.count} sample=\n  ${r.data?.results?.map(d=>JSON.stringify(d)).join('\n  ')}`;
  });

  // Memoranda - find correct type
  await probe('FR memoranda correct params', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json', {
      timeout: T, headers: h,
      params: {
        'conditions[type][]': 'PRESDOCU',
        'conditions[presidential_document_type][]': 'memoranda',
        'per_page': 3, 'order': 'newest',
        'fields[]': ['title','signing_date','presidential_document_type'],
      },
    });
    return `count=${r.data?.count} sample=${r.data?.results?.map(d=>d.title?.slice(0,60)).join(' | ')}`;
  });

  // All presidential doc types since Jan 20 2025
  await probe('FR all pres-docs since 2025-01-20', async () => {
    const r = await axios.get('https://www.federalregister.gov/api/v1/documents.json', {
      timeout: T, headers: h,
      params: {
        'conditions[type][]': 'PRESDOCU',
        'conditions[signing_date][gte]': '01/20/2025',
        'per_page': 3, 'order': 'newest',
        'fields[]': ['title','signing_date','presidential_document_type','executive_order_number'],
      },
    });
    return `count=${r.data?.count} types=${[...new Set(r.data?.results?.map(d=>d.presidential_document_type))].join(',')}`;
  });

  console.log('\n=== CANADA — Orders in Council ===');

  // OIC website HTML structure
  await probe('CA OIC main page links', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/', { timeout: T, headers: h });
    const forms = [...r.data.matchAll(/<form[^>]*action="([^"]+)"/gi)].map(m=>m[1]);
    const scripts = [...r.data.matchAll(/<script[^>]*src="([^"]+)"/gi)].map(m=>m[1]).filter(s=>!s.includes('google'));
    return `forms=${JSON.stringify(forms)} scripts=${JSON.stringify(scripts.slice(0,5))}`;
  });

  await probe('CA OIC search page form', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=1', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,400)}`;
  });

  await probe('CA OIC by date 2025', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=100&order_year=2025', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  await probe('CA OIC result parse', async () => {
    const r = await axios.get('https://orders-in-council.canada.ca/result.php?lang=en&rec=100&order_year=2025', { timeout: T, headers: h });
    // Find OIC links and titles
    const rows = [...r.data.matchAll(/href="([^"]*detail\.php[^"]*)"[^>]*>([^<]+)/gi)].slice(0,5).map(m=>`${m[1].slice(-40)} | ${m[2].trim()}`);
    return `rows: ${rows.join('\n  ')}`;
  });

  // Canada Gazette Part II for Statutory Orders / Regulations
  await probe('CA Gazette Part II 2025 index', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/index-eng.html', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*\d{4}-\d{2}-\d{2}[^"]*)"/g)].map(m=>m[1]).slice(0,5);
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500);
    return `links=${JSON.stringify(links)} text=${text}`;
  });

  // pm.gc.ca JSON:API for Orders in Council (different content type)
  await probe('pm.gc.ca JSONAPI all content types', async () => {
    const r = await axios.get('https://pm.gc.ca/jsonapi', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    const links = Object.keys(r.data?.links ?? {}).slice(0,20);
    return `links=${JSON.stringify(links)}`;
  });

  await probe('pm.gc.ca JSONAPI node types', async () => {
    const r = await axios.get('https://pm.gc.ca/jsonapi/node/order_in_council?sort=-created&page%5Blimit%5D=3', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    return `count=${r.data?.data?.length} total=${r.data?.meta?.count}`;
  });

  await probe('pm.gc.ca JSONAPI executive_order', async () => {
    const r = await axios.get('https://pm.gc.ca/jsonapi/node/executive_order?sort=-created&page%5Blimit%5D=3', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    return `count=${r.data?.data?.length} total=${r.data?.meta?.count}`;
  });

  // GC Regulation Site for OIC
  await probe('CA Gazette OIC search', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/si33-eng.html', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  console.log('\n=== STARMER — legislation.gov.uk Atom feed ===');

  await probe('legislation.gov.uk SI Atom full structure', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=5', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<entry>([\s\S]+?)<\/entry>/g)].map(e => {
      const title   = e[1].match(/<title>([^<]+)/)?.[1];
      const link    = e[1].match(/<link[^>]+href="([^"]+)"/)?.[1];
      const updated = e[1].match(/<updated>([^<]+)/)?.[1]?.slice(0,10);
      const id      = e[1].match(/<id>([^<]+)/)?.[1];
      return `${updated} | ${title?.slice(0,60)} | ${link?.slice(-50)}`;
    });
    return `entries=${entries.length}\n  ${entries.join('\n  ')}`;
  });

  await probe('legislation.gov.uk SI total count', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/uksi/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=10', { timeout: T, headers: h });
    const totalMatch = r.data.match(/opensearch:totalResults[^>]*>(\d+)/);
    const startIdx = r.data.match(/opensearch:startIndex[^>]*>(\d+)/)?.[1];
    const perPage = r.data.match(/opensearch:itemsPerPage[^>]*>(\d+)/)?.[1];
    return `total=${totalMatch?.[1]} start=${startIdx} per_page=${perPage}`;
  });

  // legislation.gov.uk Orders in Council specifically
  await probe('legislation.gov.uk OIC feed', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/ukoic/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=5', { timeout: T, headers: h });
    const entries = (r.data?.match(/<entry>/g)||[]).length;
    return `entries=${entries} len=${r.data?.length} snip=${r.data?.slice(0,500)}`;
  });

  await probe('legislation.gov.uk Royal Proclamations', async () => {
    const r = await axios.get('https://www.legislation.gov.uk/ukpga/data.feed?made-date-start=2024-07-05&sort=made-desc&start-index=1&results-count=5', { timeout: T, headers: h });
    const entries = (r.data?.match(/<entry>/g)||[]).length;
    return `entries=${entries} len=${r.data?.length}`;
  });

  console.log('\n=== ALBANESE — legislation.gov.au ===');

  // The legislation.gov.au is a React SPA but the search page renders data
  await probe('AU legislation latest 2025 HTML parse', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Latest/2025?result=1', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*C2025[^"]*)"[^>]*>([^<]+)/gi)].map(m=>`${m[1].slice(-30)}: ${m[2].trim()}`).slice(0,5);
    const scriptData = r.data.match(/window\.__(?:INITIAL|APP|NEXT)[\w_]*__\s*=\s*(\{.+?\})/)?.[1];
    return `links=${JSON.stringify(links)} scriptData=${scriptData?.slice(0,100)}`;
  });

  await probe('AU legislation Acts 2025 HTML parse', async () => {
    const r = await axios.get('https://www.legislation.gov.au/Search?type=act&dateregisteredfrom=2025-01-01&series=current&status=inforce', { timeout: T, headers: h });
    // Try to parse out act names and dates
    const rows = [...r.data.matchAll(/C\d{4}[A-Z]\d+[\s\S]{0,500}/g)].slice(0,3).map(m=>m[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,120));
    return `rows:\n  ${rows.join('\n  ')}`;
  });

  await probe('AU legislation search direct API endpoint', async () => {
    // legislation.gov.au is Angular/React, try their actual JSON API
    const r = await axios.get('https://www.legislation.gov.au/api/v1/legislation?type=act&startDate=2025-01-01&limit=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('AU legislation API endpoint discovery', async () => {
    // Look for API base URL in the SPA HTML
    const r = await axios.get('https://www.legislation.gov.au/', { timeout: T, headers: h });
    const apiUrls = [...r.data.matchAll(/['"]([^'"]*\/api\/[^'"]{3,80})['"]/g)].map(m=>m[1]).filter(u=>!u.includes('google')).slice(0,10);
    const mainScript = [...r.data.matchAll(/src="([^"]*main[^"]*\.js[^"]*)"/gi)].map(m=>m[1]).slice(0,3);
    return `api_urls=${JSON.stringify(apiUrls)} main_scripts=${JSON.stringify(mainScript)}`;
  });

  await probe('AU Federal Register search query', async () => {
    // Try legislation search with query parameter
    const r = await axios.get('https://www.legislation.gov.au/Browse/Results/1/0/0/0/0/0/0/2025/0/0', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
    const items = [...text.matchAll(/([A-Z][^.]+Act\s+\d{4})/g)].map(m=>m[1]).slice(0,5);
    return `len=${r.data?.length} acts=${JSON.stringify(items)}`;
  });

  await probe('AU legislation.gov.au sitemap', async () => {
    const r = await axios.get('https://www.legislation.gov.au/sitemap.xml', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice(0,200)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
