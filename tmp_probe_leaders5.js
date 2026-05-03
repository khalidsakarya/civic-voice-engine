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
  // ── Albanese alternatives ─────────────────────────────────────────────────

  // openaustralia.org.au API (like openparliament.ca)
  await probe('OpenAustralia speeches API', async () => {
    const r = await axios.get('https://www.openaustralia.org.au/api/getDebates?type=representatives&person_id=10877&num=5&output=js', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).slice(0,200)}`;
  });

  // Try searching for Albanese's person ID
  await probe('OpenAustralia getMPs albanese', async () => {
    const r = await axios.get('https://www.openaustralia.org.au/api/getMPs?search=albanese&output=json', { timeout: T, headers: h });
    return `status=${r.status} data=${JSON.stringify(r.data).slice(0,300)}`;
  });

  // openaustralia without api key
  await probe('OpenAustralia getMPs no auth', async () => {
    const r = await axios.get('https://www.openaustralia.org.au/api/getMPs?search=albanese', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice?.(0,200)}`;
  });

  // Parliament of Australia API - Albanese as member for Grayndler
  await probe('APH member search albanese', async () => {
    const r = await axios.get('https://www.aph.gov.au/api/parliamentmember/query?lastName=albanese&pageSize=3', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).slice(0,200)}`;
  });

  // APH Members search
  await probe('APH senators-and-members', async () => {
    const r = await axios.get('https://www.aph.gov.au/senators-and-members/senators', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Hansard/parlinfo search for PM
  await probe('APH parlinfo PM speech', async () => {
    const r = await axios.get('https://parlinfo.aph.gov.au/parlInfo/search/display/display.w3p;adv=yes;orderBy=date3,seq;query=Content%3APM%20Chamber%3A%22Representatives%22;rec=0;resCount=Default', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Try pm.gov.au with a real CDN/archive approach  
  await probe('Wayback Machine pm.gov.au/media recent', async () => {
    const r = await axios.get('https://web.archive.org/web/2026*/https://www.pm.gov.au/media', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // ALP party website  
  await probe('ALP newsroom', async () => {
    const r = await axios.get('https://www.alp.org.au/newsroom/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/newsroom\/[^"?#]+)"/g)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} links=${links.length}`;
  });

  await probe('ALP media releases', async () => {
    const r = await axios.get('https://www.alp.org.au/media/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/media\/[^"?#]+)"/g)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  // Government of Australia data/feeds
  await probe('Australia gov RSS feed search', async () => {
    const r = await axios.get('https://www.australia.gov.au/rss/prime-minister-media-releases', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice?.(0,200)}`;
  });

  // Try pm.gov.au/sitemap_index.xml (maybe different bot rules)
  await probe('pmau /sitemap_index.xml', async () => {
    const r = await axios.get('https://www.pm.gov.au/sitemap_index.xml', { timeout: T, headers: h });
    const isBot = r.data?.includes('NOINDEX');
    return `status=${r.status} len=${r.data?.length} isBot=${isBot} snip=${r.data?.slice?.(0,100)}`;
  });

  // ── WH: check a few articles for og:title ────────────────────────────────

  await probe('WH post-sitemap sample 5 recent', async () => {
    const r = await axios.get('https://www.whitehouse.gov/post-sitemap.xml', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)].map(e => {
      const loc = e[1].match(/<loc>([^<]+)/)?.[1] ?? '';
      const mod = e[1].match(/<lastmod>([^<]+)/)?.[1]?.slice(0,10) ?? '';
      return { loc, mod };
    }).filter(e => e.loc.match(/\/(briefings-statements|releases|presidential-actions|articles)\//))
    .slice(0, 5);
    return `\n  ${entries.map(e => `${e.mod} ${e.loc.replace('https://www.whitehouse.gov','').slice(0,70)}`).join('\n  ')}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
