require('dotenv').config();
const axios = require('axios');
const T = 25000;

// Full Chromium headers to bypass Cloudflare
const CHROME_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-AU,en-GB;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const h = { 'User-Agent': UA };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL: ${e.message?.slice(0, 120)}`); }
}

(async () => {
  // ── pm.gov.au with full Chrome headers ───────────────────────────────────

  await probe('pmau /media FULL Chrome headers', async () => {
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: CHROME_HEADERS });
    const isBot = r.data?.includes('NOINDEX, NOFOLLOW');
    const links = [...r.data.matchAll(/href="(\/media\/[^"?#]+)"/g)].map(m=>m[1]).slice(0,5);
    const len = r.data?.length;
    return `isBot=${isBot} len=${len} links=${links.length} snip=${r.data?.slice(0,200)}`;
  });

  // ── ALP news: understand pagination & article structure ───────────────────

  await probe('ALP /news/all-news/ pagination', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,15);
    const nextPage = r.data.match(/href="([^"]*(?:page|page_number)[^"]+)"/)?.[1];
    return `links=${links.length} next=${nextPage}\n  sample=${JSON.stringify(links.slice(0,5))}`;
  });

  await probe('ALP /news/all-news/?page=2', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/?page=2', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  // ALP article page structure
  await probe('ALP article page', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/prime-minister-anthony-albanese-address-to-the-nation/', { timeout: T, headers: h });
    // Title
    const titleMatch = r.data.match(/<h1[^>]*>([^<]+)/);
    // Date
    const dateMatch = r.data.match(/<time[^>]*datetime="([^"]+)"/) ||
                      r.data.match(/class="[^"]*date[^"]*"[^>]*>\s*([^<]+)/i);
    // OG
    const ogTitle = r.data.match(/<meta property="og:title" content="([^"]+)"/)?.[1];
    const ogDate = r.data.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1];
    const ogDesc = r.data.match(/<meta property="og:description" content="([^"]+)"/)?.[1];
    return `h1=${titleMatch?.[1]?.trim()?.slice(0,80)} date=${ogDate?.slice?.(0,10) || dateMatch?.[1]?.slice?.(0,20)} ogTitle=${ogTitle?.slice?.(0,80)} desc=${ogDesc?.slice?.(0,100)}`;
  });

  // ── ALP search/filter for PM specifically ────────────────────────────────

  await probe('ALP /news/all-news/?category=media-release', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/?category=media-release', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `links=${links.length}`;
  });

  await probe('ALP news search', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/?search=albanese', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  // ── ALP AJAX/API ──────────────────────────────────────────────────────────

  await probe('ALP fetch API', async () => {
    const r = await axios.get('https://www.alp.org.au/api/news?limit=5&offset=0', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).slice(0,200)}`;
  });

  await probe('ALP fetch news JSON', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news.json', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).slice(0,200)}`;
  });

  // ── Australian Open Parliament ────────────────────────────────────────────

  await probe('OpenAustralia with key in env', async () => {
    const key = process.env.OPENAUSTRALIA_API_KEY || '';
    if (!key) return 'no key in env';
    const r = await axios.get(`https://www.openaustralia.org.au/api/getMPs?key=${key}&search=albanese&output=json`, { timeout: T, headers: h });
    return `status=${r.status} data=${JSON.stringify(r.data).slice(0,200)}`;
  });

  // ── WH article detail: look at og:article:published_time vs article:published_time ──

  await probe('WH briefings-statements meta tags', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefings-statements/2026/04/presidential-message-on-arbor-day/', { timeout: T, headers: h });
    // Find all meta property tags
    const allMeta = [...r.data.matchAll(/<meta property="([^"]+)" content="([^"]+)"/g)].map(m=>`${m[1]}=${m[2]?.slice(0,60)}`).slice(0,15);
    const timeTag = r.data.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    return `meta:\n  ${allMeta.join('\n  ')}\n  time_tag=${timeTag}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
