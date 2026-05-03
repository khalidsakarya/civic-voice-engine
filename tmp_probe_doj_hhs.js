require('dotenv').config();
const axios = require('axios');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

(async () => {
  // DOJ: who is the current AG?
  const doj = await axios.get('https://www.justice.gov/ag', { timeout: 25000, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
  const dc = doj.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
  const blancheIdx = dc.toLowerCase().indexOf('blanche');
  const bondiIdx = dc.toLowerCase().indexOf('bondi');
  const toddIdx = dc.toLowerCase().indexOf('todd');
  const pamIdx = dc.toLowerCase().indexOf('pamela');
  console.log('DOJ: blanche=' + blancheIdx + ' bondi=' + bondiIdx + ' todd=' + toddIdx + ' pamela=' + pamIdx);

  const h1 = (dc.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim() || 'none';
  const h2s = (dc.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  const h3s = (dc.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,6).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  console.log('DOJ h1:', h1, '\nh2s:', JSON.stringify(h2s), '\nh3s:', JSON.stringify(h3s));

  // DOJ: find any person name links or featured profiles
  const personCtx = (dc.match(/(?:Attorney General|Acting) [A-Z][a-z]+ [A-Z][a-z]+/g)||[]).slice(0,5);
  console.log('DOJ person patterns:', JSON.stringify(personCtx));

  // HHS: check usa-card__heading structure
  const hhs = await axios.get('https://www.hhs.gov/about/leadership/index.html', { timeout: 25000, headers: { 'User-Agent': SAFARI }, maxRedirects: 5 });
  const hc = hhs.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
  const usaCardHds = (hc.match(/<h3[^>]*class="[^"]*usa-card__heading[^"]*"[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,10).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  console.log('\nHHS usa-card__heading h3s:', JSON.stringify(usaCardHds));

  // HHS: also find ALL h3 values
  const allH3s = (hc.match(/<h3[^>]*>([\s\S]{0,200}?)<\/h3>/gi)||[]).slice(0,15).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
  console.log('HHS all h3s:', JSON.stringify(allH3s));

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
