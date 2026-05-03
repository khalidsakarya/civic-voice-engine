require('dotenv').config();
const axios = require('axios');
const https = require('https');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': CHROME, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 30000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ data, status: res.statusCode, redirected: res.headers.location }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

(async () => {
  const urls = [
    'https://www.dol.gov/agencies/osec',
    'https://www.dol.gov/newsroom/releases/osec',
  ];

  for (const url of urls) {
    try {
      const { data, status, redirected } = await httpsGet(url);
      console.log(`\n${url}: status=${status} len=${data.length} redirect=${redirected}`);
      // Print first 500 chars
      console.log('First 500:', data.slice(0, 500).replace(/\s+/g, ' '));

      // Search for Chavez
      const idx = data.toLowerCase().indexOf('chavez');
      console.log('chavez idx:', idx);
      if (idx > 0) console.log('chavez ctx:', data.slice(Math.max(0, idx-50), idx+100).replace(/\s+/g,' '));

      const alts = (data.match(/alt="([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)"/g)||[]).slice(0,5);
      console.log('alts:', JSON.stringify(alts));

      // h1
      const h1 = (data.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim();
      console.log('h1:', h1);

    } catch (e) {
      console.log(`${url}: ERROR — ${e.message}`);
    }
  }

  // Also try axios on the newsroom press releases
  try {
    const res = await axios.get('https://www.dol.gov/newsroom/releases/osec', {
      timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5
    });
    const data = res.data;
    console.log(`\naxios dol newsroom: len=${data.length}`);
    const chavezIdx = data.toLowerCase().indexOf('chavez');
    console.log('chavez idx:', chavezIdx);
    if (chavezIdx > 0) console.log('ctx:', data.slice(Math.max(0, chavezIdx-50), chavezIdx+100).replace(/\s+/g,' '));
    // slug pattern like ed.gov
    const slugM = data.match(/secretary-of-labor-([a-z]+)-([a-z]+)-/i) || data.match(/sec-([a-z]+)-([a-z]+)-/i);
    console.log('slug match:', slugM?.[0]);
    console.log('first 500:', data.slice(0, 500).replace(/\s+/g,' '));
  } catch (e) {
    console.log('\ndol newsroom axios ERROR:', e.response?.status, e.message.slice(0,80));
  }

  console.log('\nDone');
})();
