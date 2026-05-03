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
  // ── whitehouse.gov: look for embedded JSON in HTML ─────────────────────────

  await probe('WH briefing-room __NEXT_DATA__', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room/statements-releases/', { timeout: T, headers: h });
    const match = r.data.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (!match) return 'no __NEXT_DATA__';
    const d = JSON.parse(match[1]);
    // Navigate to find posts
    const keys = Object.keys(d?.props?.pageProps ?? d?.props ?? {});
    return `has_NEXT_DATA keys=${JSON.stringify(keys).slice(0,200)}`;
  });

  await probe('WH briefing-room window.__data__', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room/statements-releases/', { timeout: T, headers: h });
    // Look for Apollo/GraphQL state or similar
    const apolloMatch = r.data.match(/window\.__APOLLO_STATE__\s*=\s*(\{.+?\});/);
    const dataMatch = r.data.match(/window\.__(?:data|state|INITIAL_STATE|APP_STATE)__\s*=\s*(\{.+?\})/);
    const graphqlMatch = r.data.match(/"type":"posts"[^}]{0,200}/);
    if (apolloMatch) return `apollo state len=${apolloMatch[1].length}`;
    if (dataMatch) return `data state found len=${dataMatch[1].length}`;
    if (graphqlMatch) return `graphql post found: ${graphqlMatch[0].slice(0,120)}`;
    // Check for JSON script tags
    const jsonScripts = [...r.data.matchAll(/<script type="application\/json"[^>]*>([^<]+)<\/script>/g)].map(m => m[1].slice(0,100));
    return `no state, json_scripts=${jsonScripts.length} first=${jsonScripts[0]?.slice(0,100)}`;
  });

  // Sitemap
  await probe('WH wp-sitemap.xml', async () => {
    const r = await axios.get('https://www.whitehouse.gov/wp-sitemap.xml', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  await probe('WH sitemap.xml', async () => {
    const r = await axios.get('https://www.whitehouse.gov/sitemap.xml', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).slice(0,5);
    return `links=${links.length} sample=${JSON.stringify(links.slice(0,3))}`;
  });

  // Try with different path (no trailing slash)
  await probe('WH briefing-room no-slash', async () => {
    const r = await axios.get('https://www.whitehouse.gov/briefing-room', { timeout: T, headers: h });
    // Check for article links in different format
    const links1 = [...r.data.matchAll(/href="(https:\/\/www\.whitehouse\.gov\/[^"?#]+)"/g)].map(m=>m[1]).filter(l => l.includes('/2026/') || l.includes('/2025/')).slice(0,5);
    const links2 = [...r.data.matchAll(/"url":"(\/[^"?#]*(news|release|action|brief)[^"?#]*)"/g)].map(m=>m[1]).slice(0,5);
    return `abs_links=${links1.length} json_links=${links2.length} sample1=${JSON.stringify(links1.slice(0,2))} sample2=${JSON.stringify(links2.slice(0,2))}`;
  });

  // ── pm.gov.au: look for embedded data ────────────────────────────────────

  await probe('pmau /media __NEXT_DATA__', async () => {
    const r = await axios.get('https://www.pm.gov.au/media', { timeout: T, headers: h });
    const match = r.data.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (match) {
      const d = JSON.parse(match[1]);
      const keys = Object.keys(d?.props?.pageProps ?? {});
      return `has_NEXT_DATA pageProps_keys=${JSON.stringify(keys).slice(0,200)}`;
    }
    // Check for Drupal JSON embedded state
    const drupalMatch = r.data.match(/drupalSettings\s*=\s*(\{.+?\});/s);
    if (drupalMatch) return `has drupalSettings len=${drupalMatch[1].length}`;
    // Check for application/ld+json
    const ldMatch = r.data.match(/<script type="application\/ld\+json">([^<]+)/);
    if (ldMatch) return `ld+json: ${ldMatch[1].slice(0,150)}`;
    return `no embedded data. Checking page content... ${r.data.slice(0,200)}`;
  });

  await probe('pmau jsonapi /api/node', async () => {
    const r = await axios.get('https://www.pm.gov.au/jsonapi?_format=json', { timeout: T, headers: { ...h, Accept: 'application/json' } });
    return `status=${r.status} len=${JSON.stringify(r.data).length} type=${typeof r.data}`;
  });

  await probe('pmau /api/content/media', async () => {
    const r = await axios.get('https://www.pm.gov.au/api/content/media-release?_format=json&page=0', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).length}`;
  });

  await probe('pmau views/media_releases json', async () => {
    const r = await axios.get('https://www.pm.gov.au/views/media_releases?_format=json', { timeout: T, headers: h });
    return `status=${r.status} len=${JSON.stringify(r.data).length} type=${typeof r.data}`;
  });

  // ── gov.uk Atom feed: get full content ───────────────────────────────────

  await probe('govuk PM .atom full parse', async () => {
    const r = await axios.get('https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom', { timeout: T, headers: h });
    const entries = [...r.data.matchAll(/<entry>([\s\S]+?)<\/entry>/g)].map(e => {
      const title = e[1].match(/<title>([^<]+)/)?.[1] || e[1].match(/<title type="[^"]*">([^<]+)/)?.[1];
      const link = e[1].match(/<link[^>]+href="([^"]+)"/)?.[1];
      const updated = e[1].match(/<updated>([^<]+)/)?.[1]?.slice(0,10);
      return `${updated} | ${title?.slice(0,60)} | ${link?.slice(-50)}`;
    });
    return `\n  ` + entries.join('\n  ');
  });

  // Try gov.uk search.json with correct filter for PM news specifically
  await probe('govuk search.json PM news filter', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?filter_organisations=prime-ministers-office-10-downing-street&filter_content_purpose_supergroup=news_and_communications&count=5&order=updated-newest', { timeout: T, headers: h });
    return `total=${r.data?.total} results=${r.data?.results?.length} sample=${r.data?.results?.slice(0,2).map(x=>x.title).join(' | ')}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
