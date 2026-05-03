require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA };

function clean(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
}

(async () => {
  // DHS: get 200 chars around Mullin
  const dhs = await axios.get('https://www.dhs.gov/leadership', { timeout: T, headers: h, maxRedirects: 5 });
  const dhsClean = clean(dhs.data);
  const mullinIdx = dhsClean.toLowerCase().indexOf('mullin');
  if (mullinIdx >= 0) {
    console.log('DHS Mullin context:', dhsClean.slice(Math.max(0,mullinIdx-200), mullinIdx+200).replace(/\s+/g,' '));
  }

  // Also look for Secretary specific section
  const secCornerIdx = dhsClean.toLowerCase().indexOf("secretary's corner");
  if (secCornerIdx >= 0) {
    console.log('DHS SecCorner context:', dhsClean.slice(secCornerIdx, secCornerIdx+500).replace(/\s+/g,' '));
  }

  // HHS: try with different agent (gov sites sometimes block curl UA not browser)
  const agentOpts = { timeout: T, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } };
  try {
    const hhs = await axios.get('https://www.hhs.gov/about/leadership/index.html', { ...agentOpts, maxRedirects: 5 });
    const c = clean(hhs.data);
    const rfk = c.match(/Kennedy|RFK|Secretary of Health[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    const h2s = (c.match(/<h2[^>]*>([\s\S]{0,200}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    console.log('HHS Safari UA:', rfk.slice(0,80), 'h2s:', JSON.stringify(h2s.slice(0,3)));
  } catch(e) {
    console.log('HHS Safari FAIL:', e.response?.status, e.message.slice(0,60));
  }

  // Defense: try with different agent + Googlebot (some .mil/.gov sites allow)
  const defAgents = [
    ['Defense curl', 'curl/7.88.1'],
    ['Defense googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ];
  for (const [label, agent] of defAgents) {
    try {
      const r = await axios.get('https://www.defense.gov/About/', { timeout: T, headers: { 'User-Agent': agent }, maxRedirects: 5 });
      console.log(label + ' OK len=' + r.data.length);
    } catch(e) {
      console.log(label + ' FAIL:', e.response?.status, e.message.slice(0,60));
    }
  }

  // Education: look for McMahon name specifically
  const edu = await axios.get('https://www.ed.gov', { timeout: T, headers: h, maxRedirects: 5 });
  const eduClean = clean(edu.data);
  const mcmahonIdx = eduClean.toLowerCase().indexOf('mcmahon');
  if (mcmahonIdx >= 0) {
    console.log('Edu McMahon context:', eduClean.slice(Math.max(0,mcmahonIdx-100), mcmahonIdx+200).replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
  }
  // Also look at ed.gov/about
  const eduAbout = await axios.get('https://www.ed.gov/about', { timeout: T, headers: h, maxRedirects: 5 });
  const eduAboutClean = clean(eduAbout.data);
  const mcmIdx2 = eduAboutClean.toLowerCase().indexOf('mcmahon');
  if (mcmIdx2 >= 0) {
    console.log('Edu/about McMahon ctx:', eduAboutClean.slice(Math.max(0,mcmIdx2-200), mcmIdx2+300).replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
  }

  // Treasury: extract first official's name properly
  const treas = await axios.get('https://home.treasury.gov/about/general-information/officials', { timeout: T, headers: h, maxRedirects: 5 });
  const treasClean = clean(treas.data);
  // Find all official links
  const officialLinks = (treasClean.match(/href="\/about\/general-information\/officials\/([a-z-]+)"[^>]*>([^<]+)<\/a>/g)||[]).slice(0,5).map(s=>{
    const m = s.match(/officials\/([a-z-]+)"[^>]*>([^<]+)<\/a>/);
    return m ? {slug: m[1], name: m[2].trim()} : null;
  }).filter(Boolean);
  console.log('Treasury officials:', JSON.stringify(officialLinks));
  // Check secretary title label
  const bessent = treasClean.match(/Scott Bessent[\s\S]{0,200}/i)?.[0]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,150) || 'not found';
  console.log('Treasury Bessent ctx:', bessent);

  // State: extract from alt tag
  const state = await axios.get('https://www.state.gov/secretary/', { timeout: T, headers: h, maxRedirects: 5 });
  const stateClean = clean(state.data);
  const stateAlts = (stateClean.match(/alt="([A-Z][a-z]+(?: [A-Z][a-z]+)+)"/g)||[]).slice(0,5).map(s=>s.replace(/alt="|"/g,''));
  console.log('State alts:', JSON.stringify(stateAlts));
  // Try the rubio bio page directly
  const rubioPage = await axios.get('https://www.state.gov/biographies/marco-rubio/', { timeout: T, headers: h, maxRedirects: 5 });
  const rubioClean = clean(rubioPage.data);
  const rubioH1 = rubioClean.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
  console.log('State Rubio bio h1:', rubioH1);

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
