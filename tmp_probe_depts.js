require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA };

async function probe(label, url, fn) {
  try {
    const r = await axios.get(url, { timeout: T, headers: h, maxRedirects: 5 });
    const clean = r.data.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'');
    const result = fn(clean, r.data);
    console.log(label + '\n  -> ' + result + '\n');
  } catch(e) {
    console.log(label + ' FAIL: ' + (e.response?.status ?? e.code) + ' ' + e.message.slice(0,60) + '\n');
  }
}

(async () => {
  // DHS - dhs.gov/leadership
  await probe('DHS', 'https://www.dhs.gov/leadership', (clean) => {
    const h4s = (clean.match(/<h4[^>]*>([\s\S]{0,200}?)<\/h4>/gi)||[]).slice(0,10).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const fieldTitles = (clean.match(/field--name-field-member-title[^>]*>[\s\S]{0,500}/gi)||[]).slice(0,3).map(s=>s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,100));
    const nameMatch = clean.match(/(?:Noem|Mullin|Whitaker|Acting Secretary|Secretary of Homeland)[^<]{0,80}/i);
    return 'h4s=' + JSON.stringify(h4s.slice(0,5)) + '\n  fieldTitles=' + JSON.stringify(fieldTitles) + '\n  nameMatch=' + (nameMatch?.[0]||'none').replace(/<[^>]+>/g,'').trim().slice(0,80);
  });

  // State - biographies list
  await probe('State biographies', 'https://www.state.gov/biographies/', (clean) => {
    const re = /href="\/biographies\/([a-z-]+)\/">([^<]{5,60})<\/a>/gi;
    const links = [];
    let m;
    while ((m = re.exec(clean)) && links.length < 8) links.push(m[2].trim());
    return 'first_bio_links=' + JSON.stringify(links);
  });

  // DOJ attorney-general page
  await probe('DOJ /ag', 'https://www.justice.gov/ag', (clean) => {
    const h4s = (clean.match(/<h4[^>]*>([\s\S]{0,150}?)<\/h4>/gi)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const personName = clean.match(/(?:Attorney General|AG[^A-Z]) ([A-Z][a-z]+ [A-Z][a-z]+)/)?.[1] || '';
    const agLinks = (clean.match(/\/ag\/[a-z-]+"[^>]*>([^<]{5,60})<\/a>/g)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,''));
    return 'h4s=' + JSON.stringify(h4s) + '\n  personName=' + personName + '\n  agLinks=' + JSON.stringify(agLinks);
  });

  // Energy leadership
  await probe('Energy', 'https://www.energy.gov/our-leadership-offices', (clean) => {
    const h3s = (clean.match(/<h3[^>]*>([\s\S]{0,150}?)<\/h3>/gi)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const namePattern = clean.match(/(?:Chris Wright|Secretary of Energy[^<]{0,50})[^<]{0,100}/i)?.[0]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim() || 'not found';
    return 'h3s=' + JSON.stringify(h3s.slice(0,5)) + '\n  name=' + namePattern.slice(0,100);
  });

  // EPA administrator
  await probe('EPA', 'https://www.epa.gov/aboutepa/epa-administrator', (clean) => {
    const h2s = (clean.match(/<h2[^>]*>([\s\S]{0,150}?)<\/h2>/gi)||[]).slice(0,5).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    return 'h2s=' + JSON.stringify(h2s);
  });

  // HHS alternate
  await probe('HHS /about/index', 'https://www.hhs.gov/about/index.html', (clean) => {
    const hs = (clean.match(/<h[23][^>]*>([\s\S]{0,150}?)<\/h[23]>/gi)||[]).slice(0,8).map(s=>s.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim());
    const rfk = clean.match(/Kennedy|HHS Secretary|Secretary of Health[^<]{0,60}/i)?.[0]?.replace(/<[^>]+>/g,'').trim() || 'not found';
    return 'hs=' + JSON.stringify(hs.slice(0,4)) + '\n  rfk=' + rfk.slice(0,100);
  });

  // Defense alternate (no auth)
  const defUrls = [
    'https://www.defense.gov/About/',
    'https://www.pentagon.mil/Leaders/',
    'https://www.defense.gov/News/',
  ];
  for (const u of defUrls) {
    await probe('Defense ' + u.split('/').slice(-2)[0], u, (clean, raw) => {
      return 'len=' + raw.length + ' status=OK';
    });
  }

  console.log('Done');
})().catch(e => console.error('Fatal:', e.message));
