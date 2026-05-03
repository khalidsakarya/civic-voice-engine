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
  // ── gov.uk Atom feed pagination ───────────────────────────────────────────

  // Check for <link> elements in the feed
  await probe('govuk PM .atom page=1 feed links', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom', { timeout: T, headers: h });
    // Find link elements
    const links = [...r.data.matchAll(/<link[^>]+rel="([^"]+)"[^>]+href="([^"]+)"/g)].map(m=>`${m[1]}=${m[2]}`);
    const links2 = [...r.data.matchAll(/href="([^"]+)"\s+rel="([^"]+)"/g)].map(m=>`${m[2]}=${m[1]}`);
    return `link_attrs:\n  ${[...links,...links2].join('\n  ')}`;
  });

  // Try different pagination approaches
  await probe('govuk PM .atom before param', async () => {
    // GOV.UK might use "before" parameter for cursor pagination
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?before=2026-04-01', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title>([^<]+)/g)].slice(1,4).map(m=>m[1]);
    return `entries=${entries} sample=${JSON.stringify(titles.slice(0,2))}`;
  });

  await probe('govuk PM .atom from= param', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?from=2026-01-01&to=2026-04-01', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    return `entries=${entries}`;
  });

  // Try the gov.uk feed with order/count params
  await probe('govuk PM news .atom with count', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street/news-and-communications.atom', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title>([^<]+)/g)].slice(1,4).map(m=>m[1]);
    return `entries=${entries} sample=${JSON.stringify(titles.slice(0,2))}`;
  });

  // Check what the GOV.UK search.json returns with proper pagination
  await probe('govuk search.json page 1 total', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_organisations=prime-ministers-office-10-downing-street&count=10&start=0', { timeout: T, headers: h });
    return `total=${r.data?.total} results=${r.data?.results?.length} sample=${r.data?.results?.slice(0,2).map(x=>x.title).join(' | ')}`;
  });

  await probe('govuk search.json page 2 (start=10)', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_organisations=prime-ministers-office-10-downing-street&count=10&start=10&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} results=${r.data?.results?.length} sample=${r.data?.results?.slice(0,2).map(x=>x.title).join(' | ')} first_date=${r.data?.results?.[0]?.public_timestamp?.slice?.(0,10)}`;
  });

  await probe('govuk search.json ordered by date', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_organisations=prime-ministers-office-10-downing-street&count=5&start=0&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} sample=${r.data?.results?.slice(0,3).map(x=>x.title+' '+x.public_timestamp?.slice(0,10)).join(' | ')}`;
  });

  // ── ALP: look for date in article more carefully ──────────────────────────

  await probe('ALP article date deep search', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/prime-minister-anthony-albanese-address-to-the-nation/', { timeout: T, headers: h });
    // All meta properties
    const allMeta = [...r.data.matchAll(/<meta[^>]+>/g)].map(m=>m[0]).filter(m => m.includes('time') || m.includes('date') || m.includes('publish') || m.includes('created') || m.includes('modified'));
    // Time tags
    const timeTags = [...r.data.matchAll(/<time[^>]*>([\s\S]*?)<\/time>/g)].map(m=>m[0]);
    // Date patterns in text
    const datePatterns = r.data.match(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g)?.slice(0,3) ?? [];
    // Published class
    const pubClass = r.data.match(/class="[^"]*(?:publish|date|posted|created)[^"]*"[^>]*>([\s\S]{1,50})/gi)?.slice(0,3) ?? [];
    return `meta=${JSON.stringify(allMeta).slice(0,200)} timeTags=${JSON.stringify(timeTags).slice(0,200)} dates=${JSON.stringify(datePatterns)} pubClass=${JSON.stringify(pubClass).slice(0,200)}`;
  });

  await probe('ALP article json-ld', async () => {
    const r = await axios.get('https://www.alp.org.au/news/all-news/ending-card-surcharges-to-help-with-the-cost-of-living/', { timeout: T, headers: h });
    const ldMatch = r.data.match(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/);
    if (ldMatch) {
      const d = JSON.parse(ldMatch[1]);
      return `type=${d['@type']} headline=${d.headline?.slice(0,60)} date=${d.datePublished || d.dateCreated}`;
    }
    const ogDate = r.data.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1];
    const allMeta = [...r.data.matchAll(/<meta name="([^"]*(?:date|time|publish)[^"]*)" content="([^"]+)"/gi)].map(m=>`${m[1]}=${m[2]}`);
    return `no_ld+json ogDate=${ogDate} meta_dates=${JSON.stringify(allMeta)}`;
  });

  // ── WH: check what URL patterns exist in sitemap ─────────────────────────

  await probe('WH sitemap URL patterns', async () => {
    const r = await axios.get('https://www.whitehouse.gov/post-sitemap.xml', { timeout: T, headers: h });
    const urls = [...r.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
    // Count by path type
    const counts = {};
    for (const u of urls) {
      const path = u.replace('https://www.whitehouse.gov/', '').split('/')[0];
      counts[path] = (counts[path] || 0) + 1;
    }
    return `patterns=${JSON.stringify(counts)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
