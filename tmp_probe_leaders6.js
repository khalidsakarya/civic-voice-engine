require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL: ${e.message?.slice(0, 120)}`); }
}

(async () => {
  // ── Wayback CDX for pm.gov.au media releases ──────────────────────────────

  await probe('Wayback CDX pm.gov.au/media/*', async () => {
    const r = await axios.get('https://web.archive.org/cdx/search/cdx?url=pm.gov.au/media/*&output=json&limit=20&from=20250101&to=20260501&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=original', { timeout: T, headers: h });
    const rows = r.data?.slice(1,6) ?? [];
    return `total_approx=${r.data?.length-1} sample:\n  ${rows.map(r=>r.join(' ')).join('\n  ')}`;
  });

  // Narrow to just recent media releases (not the index page)
  await probe('Wayback CDX pm.gov.au/media/recent', async () => {
    const r = await axios.get('https://web.archive.org/cdx/search/cdx?url=pm.gov.au/media/*&output=json&limit=50&from=20250601&to=20260501&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=original&matchType=prefix', { timeout: T, headers: h });
    const rows = r.data ?? [];
    const count = rows.length - 1; // minus header row
    const sample = rows.slice(1, 6).map(r => `${r[0].slice(0,8)} ${r[1].replace('https://www.pm.gov.au','').slice(0,80)}`);
    return `count=${count}\n  ${sample.join('\n  ')}`;
  });

  // Try fetching one cached pm.gov.au page from Wayback
  await probe('Wayback cached pm.gov.au/media', async () => {
    const r = await axios.get('https://web.archive.org/web/20260101120000*/pm.gov.au/media', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/\d{14}/g)].slice(0,5).map(m=>m[0]);
    return `len=${r.data?.length} timestamps=${JSON.stringify(entries.slice(0,3))}`;
  });

  // ── ALP website - look for script data ───────────────────────────────────

  await probe('ALP media page script data', async () => {
    const r = await axios.get('https://www.alp.org.au/media/', { timeout: T, headers: h });
    // Check for JSON data in scripts
    const ldMatch = r.data.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
    const nextMatch = r.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    const nuxtMatch = r.data.match(/window\.__nuxt__[^;]+;/);
    if (nextMatch) {
      const d = JSON.parse(nextMatch[1]);
      return `NEXT_DATA pageProps=${JSON.stringify(Object.keys(d?.props?.pageProps||{})).slice(0,200)}`;
    }
    if (nuxtMatch) return `nuxt found len=${nuxtMatch[0].length}`;
    if (ldMatch) return `ld+json: ${ldMatch[1].slice(0,200)}`;
    // Look for article/press-release links in a different way
    const relLinks = [...r.data.matchAll(/href="([^"]*(?:media|press|release|news|article)[^"?#]*)"/gi)].map(m=>m[1]).filter(u => !u.startsWith('http') || u.includes('alp.org.au')).slice(0,5);
    return `no_embedded_data rel_links=${JSON.stringify(relLinks)} page_len=${r.data?.length}`;
  });

  // ALP API/GraphQL
  await probe('ALP graphql', async () => {
    const r = await axios.post('https://www.alp.org.au/api/graphql', 
      { query: '{ posts(first: 3) { nodes { title date slug } } }' },
      { timeout: T, headers: { ...h, 'Content-Type': 'application/json' } }
    );
    return `status=${r.status} data=${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('ALP wp-json posts', async () => {
    const r = await axios.get('https://www.alp.org.au/wp-json/wp/v2/posts?per_page=3', { timeout: T, headers: h });
    return `status=${r.status} count=${Array.isArray(r.data) ? r.data.length : 'N/A'} sample=${r.data?.[0]?.title?.rendered?.slice(0,60)}`;
  });

  // ── Alternative: Australian Senate Hansard ────────────────────────────────

  await probe('Hansard API albanese speeches', async () => {
    const r = await axios.get('https://hansard.aph.gov.au/Search/SearchResults?page=1&query=albanese&house=Representatives&startDate=2025-01-01&endDate=2026-01-01&count=5', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // ── WH: quickly check how og:title looks across different post types ──────

  await probe('WH presidential-action og:title sample', async () => {
    const r = await axios.get('https://www.whitehouse.gov/presidential-actions/2025/01/designation-of-acting-leaders/', { timeout: T, headers: h });
    const og = {};
    [...r.data.matchAll(/<meta property="og:([^"]+)" content="([^"]+)"/g)].forEach(m => og[m[1]] = m[2]?.slice(0,80));
    const timeDate = r.data.match(/<time[^>]*datetime="([^"]+)"/)?.[1]?.slice(0,10);
    const catClass = r.data.match(/class="[^"]*label[^"]*"[^>]*>([^<]+)/)?.[1]?.trim();
    return `title=${og.title} date=${og.article_published_time?.slice?.(0,10) || timeDate} cat=${catClass}`;
  });

  await probe('WH briefings-statements og:title sample', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefings-statements/2026/04/presidential-message-on-arbor-day/', { timeout: T, headers: h });
    const og = {};
    [...r.data.matchAll(/<meta property="og:([^"]+)" content="([^"]+)"/g)].forEach(m => og[m[1]] = m[2]?.slice(0,80));
    return `title=${og.title} pubtime=${og['article:published_time']?.slice?.(0,10)} desc=${og.description?.slice(0,100)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
