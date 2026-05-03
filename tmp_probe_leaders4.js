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
  // ── WH sitemap: understand date distribution + structure ──────────────────

  await probe('WH post-sitemap.xml date range', async () => {
    const r = await axios.get('https://www.whitehouse.gov/post-sitemap.xml', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)].map(e => {
      const loc = e[1].match(/<loc>([^<]+)/)?.[1] ?? '';
      const mod = e[1].match(/<lastmod>([^<]+)/)?.[1] ?? '';
      return { loc, mod };
    });
    // Date range
    const dates = entries.map(e => e.mod.slice(0,10)).filter(Boolean).sort();
    const recent = entries.filter(e => e.mod >= '2025-01-20').length;
    const sample = entries.filter(e => e.mod >= '2025-01-20').slice(0, 5).map(e => `${e.mod.slice(0,10)} ${e.loc.replace('https://www.whitehouse.gov','').slice(0,70)}`);
    return `total=${entries.length} since2025=${recent} min=${dates[0]} max=${dates[dates.length-1]}\n  sample:\n  ${sample.join('\n  ')}`;
  });

  // Try fetching one WH article to understand its HTML structure
  await probe('WH article HTML parse', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefings-statements/2026/04/president-donald-j-trump-and-first-lady-melania-trump-to-welcome-his-majesty-king-charles-the-iii-of-the-united-kingdom-of-great-britain-and-northern-ireland-and-her-majesty-queen-camilla-for-a-state/', { timeout: T, headers: h });
    // Title
    const titleMatch = r.data.match(/<h1[^>]*class="[^"]*(?:post-title|entry-title|article-title|page-title)[^"]*"[^>]*>([^<]+)/i) ||
                       r.data.match(/<h1[^>]*>([^<]+)/);
    const dateMatch = r.data.match(/<time[^>]*datetime="([^"]+)"/) ||
                      r.data.match(/<span[^>]*class="[^"]*date[^"]*"[^>]*>([^<]+)/i) ||
                      r.data.match(/class="date[^"]*"[^>]*>([^<]+)/i);
    const catMatch = r.data.match(/class="[^"]*category[^"]*"[^>]*>\s*<a[^>]+>([^<]+)/i) ||
                     r.data.match(/"category":\s*"([^"]+)"/);
    const bodySnip = r.data.replace(/<style[\s\S]+?<\/style>/g,'').replace(/<script[\s\S]+?<\/script>/g,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').match(/(?:Mr\. Trump|President Trump|The White House)[^.]{50,200}/i)?.[0] ?? '';
    return `title=${titleMatch?.[1]?.trim()?.slice(0,80)} date=${dateMatch?.[1]?.slice(0,20)} cat=${catMatch?.[1]} body_snip=${bodySnip.slice(0,100)}`;
  });

  // Check if WH uses JSON-LD for article metadata
  await probe('WH article JSON-LD', async () => {
    const r = await axios.get('https://www.whitehouse.gov/presidential-actions/2025/01/designation-of-acting-leaders/', { timeout: T, headers: h });
    const ldMatch = r.data.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
    if (ldMatch) {
      const d = JSON.parse(ldMatch[1]);
      return `type=${d['@type']} headline=${d.headline?.slice(0,60)} date=${d.datePublished} author=${d.author?.name}`;
    }
    // Also check og: meta tags
    const og = {};
    [...r.data.matchAll(/<meta property="og:([^"]+)" content="([^"]+)"/g)].forEach(m => og[m[1]] = m[2]);
    return `no_ld+json og=${JSON.stringify(og).slice(0,200)}`;
  });

  // ── pm.gov.au alternatives ────────────────────────────────────────────────

  // Try pm.gov.au sitemap
  await probe('pmau sitemap.xml', async () => {
    const r = await axios.get('https://www.pm.gov.au/sitemap.xml', { timeout: T, headers: h });
    const isBot = r.data?.includes('NOINDEX');
    return `status=${r.status} len=${r.data?.length} isBot=${isBot} snip=${r.data?.slice(0,100)}`;
  });

  // Try with different UA - no bot marker
  await probe('pmau /media Accept-Language', async () => {
    const headers2 = { 
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    };
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: headers2 });
    const isBot = r.data?.includes('NOINDEX');
    return `status=${r.status} len=${r.data?.length} isBot=${isBot}`;
  });

  // Try individual release page
  await probe('pmau individual release', async () => {
    const r = await axios.get('https://www.pm.gov.au/media/albanese-hosts-asean-leaders-special-summit-melbourne', { timeout: T, headers: h });
    const isBot = r.data?.includes('NOINDEX');
    return `status=${r.status} len=${r.data?.length} isBot=${isBot}`;
  });

  // Try ALP (Australian Labor Party) news
  await probe('ALP news', async () => {
    const r = await axios.get('https://www.alp.org.au/news/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="(\/news\/[^"?#]+)"/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
    return `status=${r.status} len=${r.data?.length} links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  // APH (Australian Parliament House) - Albanese speeches
  await probe('APH debates/speeches for albanese', async () => {
    const r = await axios.get('https://www.aph.gov.au/api/parliamentmember/memberlist', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).length}`;
  });

  // Try pm.gov.au search JSON API  
  await probe('pmau /api/search', async () => {
    const r = await axios.get('https://www.pm.gov.au/api/search?text=&content_type=media_releases&sort=date_desc&page=0', { timeout: T, headers: h });
    const isBot = r.data?.includes('NOINDEX');
    return `status=${r.status} len=${r.data?.length} isBot=${isBot} type=${typeof r.data}`;
  });

  // ── gov.uk: more pagination ───────────────────────────────────────────────

  await probe('govuk PM .atom page=3', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?page=3', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    return `entries=${entries}`;
  });

  await probe('govuk PM .atom page=10', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?page=10', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title>([^<]+)/g)].slice(1,4).map(m=>m[1]);
    return `entries=${entries} sample=${JSON.stringify(titles.slice(0,2))}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
