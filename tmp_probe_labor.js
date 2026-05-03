require('dotenv').config();
const axios = require('axios');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;

(async () => {
  // 1. Check WH cabinet for Labor
  const wh = await axios.get('https://www.whitehouse.gov/administration/cabinet/', {
    timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5
  });
  const whc = wh.data;
  const laborIdx = whc.toLowerCase().indexOf('labor');
  console.log('WH cabinet labor idx:', laborIdx);
  if (laborIdx > 0) {
    // Get 300 chars around it
    const ctx = whc.slice(Math.max(0, laborIdx - 200), laborIdx + 300).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('WH labor context:', ctx);
  }

  // Find all "Secretary of Labor" contexts
  const labRe = /Secretary of Labor[^<]{0,200}/gi;
  let m;
  const labMatches = [];
  while ((m = labRe.exec(whc))) labMatches.push(m[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  console.log('WH Labor Secretary entries:', JSON.stringify(labMatches));

  // 2. Try blog.dol.gov (often unblocked)
  try {
    const blog = await axios.get('https://blog.dol.gov/', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
    const bc = blog.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    const chavezIdx = bc.toLowerCase().indexOf('chavez');
    console.log('\nblog.dol.gov len:', blog.data.length, 'chavez:', chavezIdx);
    if (chavezIdx > 0) {
      console.log('chavez ctx:', bc.slice(Math.max(0,chavezIdx-80), chavezIdx+120).replace(/\s+/g,' '));
    }
    // slug pattern
    const slugM = bc.match(/secretary[^"]*?-([a-z]+)-([a-z-]+)-[0-9]/i);
    console.log('blog slug:', slugM?.[0]?.slice(0,80));
    // All hrefs with "chavez" or "lori"
    const chavezLinks = (bc.match(/href="[^"]*chavez[^"]*"/gi)||[]).slice(0,5);
    console.log('chavez links:', chavezLinks);
    const h1s = (bc.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/gi)||[]).slice(0,3).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    console.log('blog h1s:', JSON.stringify(h1s));
  } catch (e) {
    console.log('\nblog.dol.gov ERROR:', e.response?.status ?? e.code, e.message.slice(0,60));
  }

  // 3. Try WH individual page for Chavez-DeRemer
  try {
    const whi = await axios.get('https://www.whitehouse.gov/administration/lori-chavez-deremerr/', {
      timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5
    });
    console.log('\nWH Chavez-DeRemer individual page: status', whi.status, 'len', whi.data.length);
    const h1 = (whi.data.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim();
    console.log('h1:', h1);
  } catch (e) {
    try {
      const whi2 = await axios.get('https://www.whitehouse.gov/administration/lori-chavez-deremer/', {
        timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5
      });
      console.log('\nWH Chavez-DeRemer (no double-r): status', whi2.status);
      const h1 = (whi2.data.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)||[])[1]?.replace(/<[^>]+>/g,'').trim();
      console.log('h1:', h1);
    } catch (e2) {
      console.log('\nWH Chavez-DeRemer page ERROR:', e2.response?.status ?? e2.code, e2.message.slice(0,60));
    }
  }

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
