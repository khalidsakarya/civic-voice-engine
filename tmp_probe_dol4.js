require('dotenv').config();
const axios = require('axios');

const FULL_HEADERS = {
  'User-Agent':      'python-requests/2.31.0',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
};
const T = 20000;

(async () => {
  // 1. DOL /agencies/osec — parse the secretary's name
  {
    const res = await axios.get('https://www.dol.gov/agencies/osec', { timeout: T, headers: FULL_HEADERS, maxRedirects: 5 });
    const c = res.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    const sondIdx = c.toLowerCase().indexOf('sonderling');
    console.log('DOL /osec len:', res.data.length);
    console.log('sonderling idx:', sondIdx);
    if (sondIdx > 0) {
      const ctx = c.slice(Math.max(0, sondIdx - 200), sondIdx + 400).replace(/\s+/g, ' ');
      console.log('sonderling ctx:', ctx);
    }
    // h1/h2/h3
    const h1 = (c.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim();
    const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const h3s = (c.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    console.log('h1:', h1);
    console.log('h2s:', JSON.stringify(h2s));
    console.log('h3s:', JSON.stringify(h3s));
    // alt names
    const alts = (c.match(/alt="([A-Z][a-z]+(?:\s[A-Z][a-z.]+)+)"/g)||[]).slice(0,5);
    console.log('alts:', JSON.stringify(alts));
    // "Acting" mentions
    const actMatches = (c.match(/Acting Secretary[^<]{0,100}/gi)||[]).slice(0,5).map(s=>s.replace(/\s+/g,' '));
    console.log('Acting Secretary mentions:', JSON.stringify(actMatches));
    // Any person name near "Secretary of Labor"
    const secCtxs = (c.match(/Secretary of Labor[^<]{0,200}/gi)||[]).slice(0,5).map(s=>s.replace(/\s+/g,' ').trim());
    console.log('Secretary of Labor contexts:', JSON.stringify(secCtxs));
  }

  // 2. DOL newsroom - look for who is featured as current secretary
  {
    const res = await axios.get('https://www.dol.gov/newsroom/releases/osec', { timeout: T, headers: FULL_HEADERS, maxRedirects: 5 });
    const c = res.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    const chavezIdx = c.toLowerCase().indexOf('chavez');
    const sondIdx   = c.toLowerCase().indexOf('sonderling');
    console.log('\nDOL newsroom len:', res.data.length, 'chavez:', chavezIdx, 'sonderling:', sondIdx);
    if (sondIdx > 0) {
      const ctx = c.slice(Math.max(0, sondIdx - 100), sondIdx + 200).replace(/\s+/g,' ');
      console.log('sonderling ctx:', ctx);
    }
    // First few article hrefs/titles
    const articles = (c.match(/<a[^>]+href="\/newsroom\/releases\/osec\/[^"]*"[^>]*>([\s\S]{0,100}?)<\/a>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
    console.log('articles:', JSON.stringify(articles));
    // First h2/h3
    const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,4).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const h3s = (c.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    console.log('newsroom h2s:', JSON.stringify(h2s));
    console.log('newsroom h3s:', JSON.stringify(h3s));
  }

  // 3. WH Sonderling - scan full bio section for Acting mention
  {
    const res = await axios.get('https://www.whitehouse.gov/administration/cabinet/', {
      timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, maxRedirects: 5
    });
    const html = res.data;
    const sondIdx = html.toLowerCase().indexOf('sonderling');
    if (sondIdx > 0) {
      // Get up to 3000 chars of the section
      const section = html.slice(Math.max(0, sondIdx - 100), sondIdx + 3000);
      const text = section.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      console.log('\nWH Sonderling full section text (2000 chars):', text.slice(0, 2000));
      const actingMatch = text.match(/\b(?:Acting|designated[^.]{0,80}Acting|interim)\b/gi);
      console.log('Acting keywords in full section:', actingMatch);
    }
  }

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
