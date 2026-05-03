require('dotenv').config();
const axios = require('axios');
const T = 25000;
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function clean(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
}

(async () => {
  // HHS with Safari UA - find secretary name
  try {
    const hhs = await axios.get('https://www.hhs.gov/about/leadership/index.html', {
      timeout: T,
      headers: { 'User-Agent': SAFARI },
      maxRedirects: 5,
    });
    const c = clean(hhs.data);
    // Look for the Secretary heading section
    const secSection = c.match(/Immediate Office of the Secretary[\s\S]{0,1000}/i)?.[0] || '';
    console.log('HHS SecSection:', secSection.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,300));
    // Look for person names
    const h3s = (c.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    console.log('HHS h3s:', JSON.stringify(h3s));
    // Find Kennedy specific context
    const kennedyIdx = c.toLowerCase().indexOf('kennedy');
    if (kennedyIdx >= 0) console.log('HHS Kennedy ctx:', c.slice(Math.max(0,kennedyIdx-200), kennedyIdx+300).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    // Look for all person names (e.g. "Secretary Robert F. Kennedy" pattern)
    const personMatch = c.match(/Secretary[^<]{0,30}(?:Robert|Kennedy)[^<]{0,80}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    console.log('HHS person match:', personMatch.slice(0,100));
  } catch(e) {
    console.log('HHS FAIL:', e.response?.status, e.message.slice(0,60));
  }

  console.log('---');

  // Defense: try different approaches
  const defAttempts = [
    ['defense.gov/About/ Chrome no-ref', { url: 'https://www.defense.gov/About/', UA: CHROME, extraHeaders: {} }],
    ['defense.gov/About/ no-UA', { url: 'https://www.defense.gov/About/', UA: '', extraHeaders: {} }],
    ['defense.gov/About/ with referer', { url: 'https://www.defense.gov/About/', UA: CHROME, extraHeaders: { 'Referer': 'https://www.google.com', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' } }],
    ['secretary.defense.gov', { url: 'https://www.defense.gov/About/Biographies/Biography-View/Article/880376/lloyd-j-austin-iii/', UA: CHROME, extraHeaders: {} }],
  ];
  for (const [label, cfg] of defAttempts) {
    try {
      const r = await axios.get(cfg.url, {
        timeout: T,
        headers: { 'User-Agent': cfg.UA, ...cfg.extraHeaders },
        maxRedirects: 5,
      });
      const c = clean(r.data);
      const hegseth = c.match(/Hegseth|Secretary of Defense[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
      console.log(label + ' OK len=' + r.data.length + ' hegseth=' + hegseth.slice(0,60));
    } catch(e) {
      console.log(label + ' FAIL:', e.response?.status, e.message.slice(0,60));
    }
  }

  // Education: try ed.gov/about with more careful extraction
  try {
    const edu = await axios.get('https://www.ed.gov/about', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
    const c = clean(edu.data);
    // Look for Secretary name in page
    const mcmIdx = c.toLowerCase().indexOf('mcmahon');
    if (mcmIdx >= 0) {
      const ctx = c.slice(Math.max(0,mcmIdx-300), mcmIdx+300).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      console.log('Edu McMahon ctx:', ctx.slice(0,300));
    }
    // Also look for secretary of education page link
    const secLink = c.match(/secretary-of-education[^"]*">([^<]+)<\/a>/i)?.[1] || '';
    const secH2 = c.match(/Secretary of Education[^<]{0,200}/i)?.[0]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() || '';
    console.log('Edu secLink:', secLink, 'secH2:', secH2.slice(0,100));
    // Try to find a person name near "Secretary"
    const namePat = c.match(/Secretary[^<]{0,40}<[^>]+>([A-Z][a-z]+ [A-Z][a-z]+)<\/[^>]+>/i)?.[1] || 'not found';
    console.log('Edu namePat:', namePat);
  } catch(e) {
    console.log('Edu FAIL:', e.response?.status, e.message.slice(0,60));
  }

  // ed.gov/about/ed-overview secretary page
  try {
    const edu2 = await axios.get('https://www.ed.gov/about/ed-overview', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
    const c = clean(edu2.data);
    const mcmIdx = c.toLowerCase().indexOf('mcmahon');
    if (mcmIdx >= 0) {
      const ctx = c.slice(Math.max(0,mcmIdx-200), mcmIdx+300).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      console.log('Edu/overview McMahon ctx:', ctx.slice(0,250));
    }
  } catch(e) {
    console.log('Edu2 FAIL:', e.response?.status, e.message.slice(0,60));
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
