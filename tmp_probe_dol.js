require('dotenv').config();
const axios = require('axios');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;

(async () => {
  const urls = [
    'https://www.dol.gov/agencies/osec',
    'https://www.dol.gov/general/aboutdol/secretarybios',
    'https://www.dol.gov/',
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
      const c = res.data.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

      // Search for "Chavez" or "Lori" or "Secretary of Labor"
      const chavezIdx = c.toLowerCase().indexOf('chavez');
      const loriIdx   = c.toLowerCase().indexOf('lori');
      const sondIdx   = c.toLowerCase().indexOf('sonderling');
      console.log(`\n${url}: chavez=${chavezIdx} lori=${loriIdx} sonderling=${sondIdx}`);

      // h1/h2/h3
      const h1 = (c.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim();
      const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
      const h3s = (c.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
      console.log(`  h1: ${h1}`);
      console.log(`  h2s: ${JSON.stringify(h2s)}`);
      console.log(`  h3s: ${JSON.stringify(h3s)}`);

      // Look for Secretary patterns
      const secCtx = c.match(/Secretary of Labor[^<]{0,200}/gi)?.slice(0,3).map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
      if (secCtx) console.log(`  sec ctx: ${JSON.stringify(secCtx)}`);

      // Look for alt="..." with a name pattern
      const alts = (c.match(/alt="([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)"/g)||[]).slice(0,5);
      console.log(`  alts: ${JSON.stringify(alts)}`);

    } catch (e) {
      console.log(`  ${url}: ERROR ${e.response?.status ?? e.code} — ${e.message.slice(0,60)}`);
    }
  }
  console.log('\nDone');
})();
