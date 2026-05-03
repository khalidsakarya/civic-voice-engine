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
  // ── WH: post sitemaps ─────────────────────────────────────────────────────

  await probe('WH post-sitemap.xml', async () => {
    const r = await axios.get('https://www.whitehouse.gov/post-sitemap.xml', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)].map(e => {
      const loc = e[1].match(/<loc>([^<]+)/)?.[1];
      const mod = e[1].match(/<lastmod>([^<]+)/)?.[1];
      return `${mod?.slice(0,10)} ${loc?.slice(25,90)}`;
    });
    return `\n  count=${entries.length}\n  ` + entries.slice(0,5).join('\n  ');
  });

  await probe('WH post-sitemap2.xml', async () => {
    const r = await axios.get('https://www.whitehouse.gov/post-sitemap2.xml', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)];
    return `count=${entries.length}`;
  });

  // Try to get more sitemap URLs
  await probe('WH wp-sitemap.xml all entries', async () => {
    const r = await axios.get('https://www.whitehouse.gov/wp-sitemap.xml', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
    return `all: ${JSON.stringify(links)}`;
  });

  // Try WP REST with Accept header
  await probe('WH wp-json posts Accept json', async () => {
    const r = await axios.get('https://www.whitehouse.gov/wp-json/wp/v2/posts?per_page=3&_fields=id,title,date,link,excerpt,categories', { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} count=${r.data?.length}`;
  });

  // Look for JSON data in briefing room HTML more carefully
  await probe('WH briefing-room JSON in scripts', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room/', { timeout: T, headers: h });
    // Find all script contents for JSON with post data
    const scripts = [...r.data.matchAll(/<script[^>]*>([\s\S]+?)<\/script>/g)];
    const interesting = scripts.filter(s => s[1].includes('"releases') || s[1].includes('"posts') || s[1].includes('"articles'));
    const whLinks = [...r.data.matchAll(/href="(https?:\/\/www\.whitehouse\.gov\/[^"?#]+)"/g)].map(m=>m[1]).filter(l => /\/\d{4}\//.test(l)).filter((v,i,a)=>a.indexOf(v)===i).slice(0,10);
    return `interesting_scripts=${interesting.length} dated_links=${whLinks.length} sample=${JSON.stringify(whLinks.slice(0,3))}`;
  });

  // ── pm.gov.au: look for alternative data access ───────────────────────────

  // Try with Referer + extra headers (anti-bot workaround)
  await probe('pmau media with Referer', async () => {
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: { ...h, Referer: 'https://www.pm.gov.au/', 'Accept-Language': 'en-AU,en;q=0.9' } });
    const hasRobots = r.data.includes('NOINDEX, NOFOLLOW');
    const len = r.data?.length;
    const links = [...r.data.matchAll(/href="(\/media\/[^"?#]+)"/g)].map(m=>m[1]).slice(0,5);
    return `noindex=${hasRobots} len=${len} links=${links.length}`;
  });

  // Try the Drupal node export / REST API
  await probe('pmau node/1?_format=json', async () => {
    const r = await axios.get('https://www.pm.gov.au/node/1?_format=json', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Try pm.gov.au news rss with different path
  await probe('pmau /rss', async () => {
    const r = await axios.get('https://www.pm.gov.au/rss', { timeout: T, headers: h });
    const isXml = r.data?.includes('<?xml') || r.data?.includes('<rss');
    return `status=${r.status} isXml=${isXml} len=${r.data?.length} content=${r.data?.slice(0,100)}`;
  });

  // Try pm.gov.au media releases list page with different approach
  await probe('pmau /media/media-releases', async () => {
    const r = await axios.get('https://www.pm.gov.au/media/media-releases', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });

  // Try pm.gov.au direct search API (Drupal search)
  await probe('pmau /search?query=&_format=json', async () => {
    const r = await axios.get('https://www.pm.gov.au/search?query=&_format=json', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} type=${typeof r.data}`;
  });

  // ── gov.uk: atom feed pagination ─────────────────────────────────────────

  await probe('govuk PM .atom page=2', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?page=2', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    const titles = [...r.data.matchAll(/<title>([^<]+)/g)].map(m=>m[1]).slice(1,4); // skip feed title
    return `entries=${entries} sample=${JSON.stringify(titles.slice(0,2))}`;
  });

  await probe('govuk PM .atom all news page=1', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom?page=1', { timeout: T, headers: h });
    const entries = (r.data.match(/<entry>/g) || []).length;
    return `entries=${entries}`;
  });

  // Check Content API for a sample article
  await probe('govuk Content API sample article', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/news/readout-of-the-first-meeting-of-the-civil-society-council-22-april-2026', { timeout: T, headers: h });
    const doc_type = r.data?.document_type;
    const title = r.data?.title;
    const date = r.data?.public_updated_at?.slice(0,10);
    const body = r.data?.details?.body?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,200);
    return `doc_type=${doc_type} date=${date} title=${title?.slice(0,60)}\n  body: ${body}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
