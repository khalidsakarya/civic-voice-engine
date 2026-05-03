require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA };

async function probe(label, url, fn) {
  try {
    const r = await axios.get(url, { timeout: T, headers: h, maxRedirects: 5 });
    const clean = r.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    const result = fn(clean, r.data);
    console.log(label + '\n  -> ' + result + '\n');
  } catch(e) {
    console.log(label + ' FAIL: ' + (e.response?.status ?? e.code) + ' ' + e.message.slice(0,80) + '\n');
  }
}

(async () => {
  // State - try different selectors on biographies page
  await probe('State /biographies/ raw', 'https://www.state.gov/biographies/', (clean) => {
    const links = (clean.match(/<a[^>]+href="\/biographies\/[^"]+">([^<]+)<\/a>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').trim());
    const allLinks = (clean.match(/<a[^>]+href="\/biographies\/[^"]+">/gi)||[]).length;
    const rubio = clean.match(/Rubio[^<]{0,100}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    return 'links=' + JSON.stringify(links) + ' allLinkCount=' + allLinks + ' rubio=' + rubio.slice(0,80);
  });

  // State: try /secretary/
  await probe('State /secretary/', 'https://www.state.gov/secretary/', (clean) => {
    const h1 = clean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || '';
    // Look for person name in meta or first paragraph
    const meta = clean.match(/<meta[^>]*(?:title|description)[^>]*content="([^"]{5,200})"/i)?.[1] || '';
    const rubio = clean.match(/Marco Rubio|Rubio/i)?.[0] || 'not found';
    return 'h1=' + h1 + ' meta=' + meta.slice(0,100) + ' rubio=' + rubio;
  });

  // Treasury: try secretary page
  await probe('Treasury /secretary', 'https://home.treasury.gov/about/general-information/officials/secretary-of-the-treasury', (clean) => {
    const h1 = clean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || '';
    const h2s = (clean.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    return 'h1=' + h1 + ' h2s=' + JSON.stringify(h2s);
  });

  // Treasury: try organizational structure with alternate path
  await probe('Treasury /officials', 'https://home.treasury.gov/about/general-information/officials', (clean) => {
    const h1 = clean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || '';
    const bessent = clean.match(/Bessent[^<]{0,100}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    return 'h1=' + h1 + ' bessent=' + bessent.slice(0,80);
  });

  // HHS: try alternate
  await probe('HHS /secretary', 'https://www.hhs.gov/about/leadership/secretary/index.html', (clean) => {
    const h1 = clean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || '';
    return 'h1=' + h1;
  });

  await probe('HHS /news/press', 'https://www.hhs.gov/news/press/index.html', (clean) => {
    return 'len=' + clean.length;
  });

  // Defense: try with no auth required pages
  await probe('Defense /OSD/', 'https://www.defense.gov/OSD/', (clean, raw) => {
    return 'status OK len=' + raw.length;
  });

  await probe('Defense news', 'https://www.defense.gov/News/Press-Releases/', (clean, raw) => {
    return 'len=' + raw.length;
  });

  // Ed.gov secretary page
  await probe('Education /secretary', 'https://www.ed.gov/about/ed-overview/secretary-of-education', (clean) => {
    const h1 = clean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || '';
    const h2s = (clean.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    return 'h1=' + h1 + ' h2s=' + JSON.stringify(h2s);
  });

  await probe('Education /leadership', 'https://www.ed.gov/leadership', (clean) => {
    return 'len=' + clean.length;
  });

  // DHS: More specific name extraction from leadership page
  await probe('DHS name detail', 'https://www.dhs.gov/leadership', (clean) => {
    // The match found mullin"> pattern - use that
    const namePattern = clean.match(/([a-z-]+)">([A-Z][a-z]+ [A-Z][a-z]+)<\/a>\s*<\/h\d/gi);
    const slugNames = (clean.match(/(?:slug|href)="\/[a-z-]*\/(mullin|noem|whitaker|hegseth|bessent|rubio|blanche|burgum|kennedy|mcmahon|wright|zeldin|loeffler|gabbard|rollins|duffy|turner|ratcliffe)[^"]*">([^<]+)<\/a>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').trim());
    return 'slugNames=' + JSON.stringify(slugNames);
  });

  // Energy: more precise name extraction
  await probe('Energy secretary name', 'https://www.energy.gov/our-leadership-offices', (clean) => {
    // chris wright appears in alt attribute of img
    const altName = clean.match(/alt="([^"]{5,60})"\s*class="megamenu-block__headshot"/i)?.[1] || '';
    // Also look in h2/h3
    const h2s = (clean.match(/<h2[^>]*>([\s\S]{0,100}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    return 'altName=' + altName + ' h2s=' + JSON.stringify(h2s);
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
