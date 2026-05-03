require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 20000;
const h = { 'User-Agent': UA };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL: ${e.message?.slice(0, 120)}`); }
}

(async () => {
  // ── Trump / whitehouse.gov ────────────────────────────────────────────────

  await probe('WH RSS /feed/', async () => {
    const r = await axios.get('https://www.whitehouse.gov/feed/', { timeout: T, headers: h });
    const items = (r.data.match(/<item>/g) || []).length;
    const title = r.data.match(/<title><!\[CDATA\[([^\]]+)/)?.[1] ?? r.data.match(/<title>([^<]+)/)?.[1];
    return `items=${items} first_title=${title?.slice(0,60)} len=${r.data?.length}`;
  });

  await probe('WH briefing-room/feed/', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room/feed/', { timeout: T, headers: h });
    const items = (r.data.match(/<item>/g) || []).length;
    return `items=${items} len=${r.data?.length} status=${r.status}`;
  });

  await probe('WH wp-json/wp/v2/posts with UA', async () => {
    const r = await axios.get('https://www.whitehouse.gov/wp-json/wp/v2/posts?per_page=3', { timeout: T, headers: h });
    return `status=${r.status} count=${r.data?.length}`;
  });

  await probe('WH briefing-room HTML', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room/statements-releases/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/briefing-room\/statements-releases\/\d{4}\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    const linkLen = links.length;
    return `links=${linkLen} sample=${JSON.stringify(links.slice(0,2))} pageLen=${r.data?.length}`;
  });

  await probe('WH presidential-actions HTML', async () => {
    const r = await axios.get('https://www.whitehouse.gov/presidential-actions/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/presidential-actions\/\d{4}\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,2))} pageLen=${r.data?.length}`;
  });

  // ── Albanese / pm.gov.au ──────────────────────────────────────────────────

  await probe('pmau /media/rss.xml', async () => {
    const r = await axios.get('https://www.pm.gov.au/media/rss.xml', { timeout: T, headers: h });
    const items = (r.data.match(/<item>/g) || []).length;
    return `items=${items} len=${r.data?.length} status=${r.status}`;
  });

  await probe('pmau /feed/', async () => {
    const r = await axios.get('https://www.pm.gov.au/feed/', { timeout: T, headers: h });
    const items = (r.data.match(/<item>/g) || []).length;
    return `items=${items} len=${r.data?.length} status=${r.status}`;
  });

  await probe('pmau jsonapi node/media_release', async () => {
    const r = await axios.get('https://www.pm.gov.au/jsonapi/node/media_release?page%5Blimit%5D=3&sort=-created', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    return `count=${r.data?.data?.length} total=${r.data?.meta?.count} keys=${Object.keys(r.data?.data?.[0]?.attributes||{}).slice(0,5).join(',')}`;
  });

  await probe('pmau jsonapi node/speech', async () => {
    const r = await axios.get('https://www.pm.gov.au/jsonapi/node/speech?page%5Blimit%5D=3&sort=-created', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    return `count=${r.data?.data?.length} total=${r.data?.meta?.count}`;
  });

  await probe('pmau jsonapi', async () => {
    const r = await axios.get('https://www.pm.gov.au/jsonapi', { timeout: T, headers: { ...h, Accept: 'application/vnd.api+json' } });
    const links = Object.keys(r.data?.links||{}).slice(0,10);
    return `links=${JSON.stringify(links)}`;
  });

  await probe('pmau /media HTML', async () => {
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/media\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    const titles = [...r.data.matchAll(/<h3[^>]*>[\s\S]*?<a[^>]+>([^<]+)/g)].map(m=>m[1].trim()).slice(0,3);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,2))} titles=${JSON.stringify(titles.slice(0,2))}`;
  });

  // ── Starmer / gov.uk ──────────────────────────────────────────────────────

  await probe('govuk PM office .atom', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title type="text">([^<]+)/g)].map(m=>m[1]).slice(0,3);
    return `entries=${entries} titles=${JSON.stringify(titles.slice(0,2))} len=${r.data?.length}`;
  });

  await probe('govuk search.json no brackets', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_organisations=prime-ministers-office-10-downing-street&count=3', { timeout: T, headers: h });
    return `total=${r.data?.total} results=${r.data?.results?.length} sample=${r.data?.results?.[0]?.title?.slice(0,60)}`;
  });

  await probe('govuk news HTML links', async () => {
    const r = await axios.get('https://www.gov.uk/search/news-and-communications?organisations%5B%5D=prime-ministers-office-10-downing-street', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/government\/(?:news|speeches|press-releases)[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,2))} len=${r.data?.length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
