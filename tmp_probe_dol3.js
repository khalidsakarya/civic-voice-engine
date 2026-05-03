require('dotenv').config();
const axios = require('axios');
const https = require('https');

const TARGET = 'https://www.dol.gov/agencies/osec';
const TARGETS = [
  'https://www.dol.gov/agencies/osec',
  'https://www.dol.gov/newsroom/releases/osec',
  'https://www.dol.gov/general/aboutdol/secretarybios',
];

const UAS = [
  ['Googlebot',    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['Bingbot',      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  ['Python',       'python-requests/2.31.0'],
  ['curl',         'curl/8.4.0'],
  ['Wget',         'Wget/1.21.4'],
  ['iOS Safari',   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'],
  ['Android',      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36'],
  ['Firefox',      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'],
  ['Edge',         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'],
  ['oldIE',        'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'],
  ['go-http',      'Go-http-client/1.1'],
];

const FULL_HEADERS = {
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':  'document',
  'Sec-Fetch-Mode':  'navigate',
  'Sec-Fetch-Site':  'none',
  'Cache-Control':   'max-age=0',
};

(async () => {
  // Test UAs against the osec page
  for (const [label, ua] of UAS) {
    try {
      const res = await axios.get(TARGET, {
        timeout: 12000,
        headers: { 'User-Agent': ua, ...FULL_HEADERS },
        maxRedirects: 5,
      });
      const len = res.data.length;
      const isChallenge = res.data.includes('Challenge Validation');
      const chavezIdx   = res.data.toLowerCase().indexOf('chavez');
      const sondIdx     = res.data.toLowerCase().indexOf('sonderling');
      console.log(`${label.padEnd(12)} len=${String(len).padStart(6)}  challenge=${isChallenge}  chavez=${chavezIdx}  sonderling=${sondIdx}`);
      if (!isChallenge && chavezIdx > 0) {
        console.log('  >>> FOUND CHAVEZ with UA:', ua);
        const ctx = res.data.slice(Math.max(0, chavezIdx - 100), chavezIdx + 200).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
        console.log('  ctx:', ctx);
      }
    } catch (e) {
      console.log(`${label.padEnd(12)} ERROR ${e.response?.status ?? e.code} — ${e.message.slice(0,60)}`);
    }
  }

  // Also try other DOL paths with Firefox UA (most likely to pass)
  console.log('\n── Other DOL paths with Firefox UA ─────────────────────────');
  const FFua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
  for (const url of TARGETS.slice(1)) {
    try {
      const res = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': FFua, ...FULL_HEADERS }, maxRedirects: 5 });
      const isChallenge = res.data.includes('Challenge Validation');
      const chavezIdx   = res.data.toLowerCase().indexOf('chavez');
      console.log(`${url}: len=${res.data.length} challenge=${isChallenge} chavez=${chavezIdx}`);
    } catch (e) {
      console.log(`${url}: ERROR ${e.response?.status ?? e.code}`);
    }
  }

  // Try WH bio text for Sonderling to confirm "Acting" keyword location
  console.log('\n── WH Sonderling bio text ─────────────────────────────────');
  try {
    const wh = await axios.get('https://www.whitehouse.gov/administration/cabinet/', {
      timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, maxRedirects: 5
    });
    const html = wh.data;
    // Find Sonderling section
    const sondIdx = html.toLowerCase().indexOf('sonderling');
    if (sondIdx > 0) {
      const section = html.slice(Math.max(0, sondIdx - 500), sondIdx + 1000);
      const text = section.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      console.log('Sonderling section text (first 600):', text.slice(0, 600));

      // Check for acting/designated keywords
      const actingMatch = text.match(/\b(?:Acting|designated[^.]{0,50}Acting|interim)\b/gi);
      console.log('Acting keywords found:', actingMatch);

      // What does the h3 title say?
      const h3Match = section.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (h3Match) console.log('h3 title:', h3Match[1].replace(/<[^>]+>/g,'').trim());
    } else {
      console.log('Sonderling not found in WH page');
    }
  } catch (e) {
    console.log('WH fetch ERROR:', e.message);
  }

  console.log('\nDone');
})();
