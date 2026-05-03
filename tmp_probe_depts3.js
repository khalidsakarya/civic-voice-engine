require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA };

function clean(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
}

async function probe(label, url, fn) {
  try {
    const r = await axios.get(url, { timeout: T, headers: h, maxRedirects: 5 });
    const c = clean(r.data);
    const result = fn(c, r.data);
    console.log(label + '\n  -> ' + result + '\n');
  } catch(e) {
    console.log(label + ' FAIL: ' + (e.response?.status ?? e.code) + ' ' + e.message.slice(0,80) + '\n');
  }
}

(async () => {
  // State /secretary/ - extract Rubio's name
  await probe('State /secretary/ detail', 'https://www.state.gov/secretary/', (c) => {
    // Look for href containing rubio
    const rubioLink = c.match(/href="[^"]*rubio[^"]*">([^<]{5,60})<\/a>/i)?.[1] || '';
    // First strong or h2 after "Secretary"
    const secName = c.match(/Secretary of State[^<]{0,200}<strong>([^<]+)<\/strong>/i)?.[1] ||
      c.match(/<strong>([A-Z][a-z]+ [A-Z][a-z]+)<\/strong>\s*<\/div>\s*(?:Secretary|The Secretary)/i)?.[1] || '';
    // Look for og:title or similar meta
    const ogTitle = c.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || '';
    // Alt text of image on the page
    const altText = (c.match(/alt="([A-Z][a-z]+ [A-Z][a-z]+)"/g)||[]).slice(0,5).map(s=>s.replace(/alt="|"/g,''));
    return 'rubioLink=' + rubioLink + ' secName=' + secName + ' og:title=' + ogTitle + ' alts=' + JSON.stringify(altText);
  });

  // Treasury officials
  await probe('Treasury /officials detail', 'https://home.treasury.gov/about/general-information/officials', (c) => {
    // The page has links like /about/general-information/officials/scott-bessent
    const officialLinks = (c.match(/\/officials\/([a-z-]+)">([^<]{5,60})<\/a>/g)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').trim());
    const bessent = c.match(/Scott Bessent[^<]{0,80}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    return 'officialLinks=' + JSON.stringify(officialLinks) + ' bessent=' + bessent.slice(0,80);
  });

  // HHS - try different URLs
  const hhsUrls = [
    'https://www.hhs.gov/about',
    'https://www.hhs.gov/secretary',
    'https://www.hhs.gov',
  ];
  for (const u of hhsUrls) {
    await probe('HHS ' + u.replace('https://www.hhs.gov',''), u, (c) => {
      const rfk = c.match(/Kennedy|Robert F\.|RFK|Secretary of Health[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
      const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
      return 'rfk=' + rfk.slice(0,80) + ' h2s=' + JSON.stringify(h2s.slice(0,3));
    });
  }

  // Defense - try different approaches
  const defUrls = [
    'https://www.defense.gov/',
    'https://secretary.defense.gov/',
    'https://www.defense.gov/Portals/1/Documents/',
  ];
  for (const u of defUrls) {
    await probe('Defense ' + u.slice(8,40), u, (c, raw) => {
      const hegseth = (raw||'').match(/Hegseth|Secretary of Defense[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
      return 'len=' + raw.length + ' hegseth=' + hegseth.slice(0,60);
    });
  }

  // Education - ed.gov
  const eduUrls = [
    'https://www.ed.gov',
    'https://www.ed.gov/about',
    'https://www.ed.gov/about/ed-overview',
  ];
  for (const u of eduUrls) {
    await probe('Edu ' + u.slice(20), u, (c) => {
      const mcmahon = c.match(/McMahon|Secretary of Education[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
      const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
      return 'mcmahon=' + mcmahon.slice(0,60) + ' h2s=' + JSON.stringify(h2s.slice(0,3));
    });
  }

  // DHS: more careful extraction of Secretary name
  await probe('DHS secretary name', 'https://www.dhs.gov/leadership', (c) => {
    // The pattern that worked: mullin">Markwayne Mullin
    const secretaryMatch = c.match(/(?:Secretary's Corner|Secretary of Homeland)[^<]{0,200}/gi);
    // Look for person page links
    const personLinks = (c.match(/\/person\/[a-z-]+">([^<]{5,60})<\/a>/g)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').trim());
    // The name appears right after the /people/markwayne-mullin or similar anchor
    const nameAfterPeople = (c.match(/\/(?:people|person)\/[a-z-]+[^>]*>([^<]{5,60})<\/a>/g)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').trim());
    return 'personLinks=' + JSON.stringify(personLinks) + ' peopleLinks=' + JSON.stringify(nameAfterPeople);
  });

  // DOJ /about page - is Todd Blanche there?
  await probe('DOJ /about', 'https://www.justice.gov/about', (c) => {
    const agMention = c.match(/(?:Attorney General|Acting Attorney General|AG)[^<]{0,100}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || '';
    const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const personLinks = (c.match(/\/ag\/[a-z-]+[^>]*>([^<]{5,60})<\/a>/g)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').trim());
    return 'agMention=' + agMention.slice(0,100) + ' h2s=' + JSON.stringify(h2s.slice(0,3)) + ' links=' + JSON.stringify(personLinks);
  });

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
