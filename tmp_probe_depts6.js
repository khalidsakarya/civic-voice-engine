require('dotenv').config();
const axios = require('axios');
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;

(async () => {
  // Education: find the "Meet the Secretary" link href on ed.gov/about/news
  const edu = await axios.get('https://www.ed.gov/about/news', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
  const c = edu.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
  // Find all anchor tags containing "secretary" in href or text near "Meet the Secretary"
  const secLinks = (c.match(/<a[^>]+href="[^"]*secretary[^"]*"[^>]*>[^<]*<\/a>/gi)||[]).slice(0,10).map(s=>s.replace(/<[^>]+>/g,'|').trim());
  console.log('Ed sec links:', JSON.stringify(secLinks));
  // Find full href
  const meetLink = c.match(/href="([^"]*secretary[^"]*)"[^>]*>(?:[^<]*Meet|[^<]*Secretary)[^<]*<\/a>/i);
  console.log('Meet link href:', meetLink?.[1]);
  // Also: find all hrefs with "secretary"
  const allSecHrefs = (c.match(/href="([^"]*secretary[^"]*)"/gi)||[]).slice(0,10).map(s=>s.replace(/href="|"/g,''));
  console.log('All sec hrefs:', JSON.stringify(allSecHrefs));

  // DOJ: better name extraction from /ag page
  const doj = await axios.get('https://www.justice.gov/ag', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
  const dojC = doj.data.replace(/<script[\s\S]*?<\/script>/gi,'');
  // The probe found personName=Todd Blanche via /Attorney General ([A-Z][a-z]+ [A-Z][a-z]+)/
  // Let's verify
  const agMatch = dojC.match(/Attorney General\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/);
  const actingMatch = dojC.match(/Acting Attorney General\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
  const blancheCtx = dojC.match(/Blanche[^<]{0,300}/i)?.[0]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('DOJ agMatch:', agMatch?.[1], 'actingMatch:', actingMatch?.[1]);
  console.log('DOJ blanche ctx:', blancheCtx?.slice(0,150));

  // Treasury: test the officials page parser more carefully
  const treas = await axios.get('https://home.treasury.gov/about/general-information/officials', { timeout: T, headers: { 'User-Agent': CHROME }, maxRedirects: 5 });
  const treasC = treas.data.replace(/<script[\s\S]*?<\/script>/gi,'');
  const re = /\/officials\/([a-z-]+)"[^>]*>([^<]+)<\/a>/gi;
  const results = [];
  let m;
  while ((m = re.exec(treasC)) && results.length < 10) {
    results.push({ slug: m[1], name: m[2].trim() });
  }
  console.log('Treasury officials links:', JSON.stringify(results));

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
