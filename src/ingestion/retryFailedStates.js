'use strict';
/**
 * Retries only the states that got 0 bills due to rate limiting (429).
 * Uses a 15-second delay between each to stay under OpenStates free tier limits.
 */
require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const OPENSTATES_KEY = process.env.OPENSTATES_API_KEY;

const STATE_SLUGS = {
  'US-AL':'al','US-AK':'ak','US-AZ':'az','US-AR':'ar','US-CA':'ca',
  'US-CO':'co','US-CT':'ct','US-DE':'de','US-FL':'fl','US-GA':'ga',
  'US-HI':'hi','US-ID':'id','US-IL':'il','US-IN':'in','US-IA':'ia',
  'US-KS':'ks','US-KY':'ky','US-LA':'la','US-ME':'me','US-MD':'md',
  'US-MA':'ma','US-MI':'mi','US-MN':'mn','US-MS':'ms','US-MO':'mo',
  'US-MT':'mt','US-NE':'ne','US-NV':'nv','US-NH':'nh','US-NJ':'nj',
  'US-NM':'nm','US-NY':'ny','US-NC':'nc','US-ND':'nd','US-OH':'oh',
  'US-OK':'ok','US-OR':'or','US-PA':'pa','US-RI':'ri','US-SC':'sc',
  'US-SD':'sd','US-TN':'tn','US-TX':'tx','US-UT':'ut','US-VT':'vt',
  'US-VA':'va','US-WA':'wa','US-WV':'wv','US-WI':'wi','US-WY':'wy',
};

const GOVERNOR_FEEDS = {
  'US-CA':'https://www.gov.ca.gov/category/press-releases/feed/',
  'US-NY':'https://www.governor.ny.gov/rss.xml',
  'US-FL':'https://www.flgov.com/feed/',
  'US-IL':'https://gov.illinois.gov/news/press-releases.rss.html',
  'US-PA':'https://www.governor.pa.gov/feed/',
  'US-OH':'https://governor.ohio.gov/rss/news.xml',
  'US-GA':'https://gov.georgia.gov/press-releases/feed',
  'US-NC':'https://governor.nc.gov/news/rss.xml',
  'US-MI':'https://www.michigan.gov/whitmer/news/rss',
  'US-WA':'https://www.governor.wa.gov/news-media/rss',
  'US-AZ':'https://azgovernor.gov/governor/news/rss',
  'US-MN':'https://mn.gov/governor/newsroom/rss',
  'US-OR':'https://www.oregon.gov/newsroom/rss',
  'US-MA':'https://www.mass.gov/news/rss',
  'US-NJ':'https://www.nj.gov/governor/news/rss.shtml',
  'US-VA':'https://www.governor.virginia.gov/news-releases/rss/',
  'US-TN':'https://www.tn.gov/governor/news.rss',
  'US-SC':'https://governor.sc.gov/news/rss.xml',
  'US-MD':'https://governor.maryland.gov/news/rss.xml',
  'US-MO':'https://governor.mo.gov/press-releases/rss.xml',
  'US-WI':'https://evers.wi.gov/Pages/NewsMedia/PressReleases/rss.aspx',
  'US-TX':'https://gov.texas.gov/news/rss',
};

const BROWSER_HEADERS = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language':'en-US,en;q=0.9',
};

async function openstatesGet(path, params = {}) {
  const res = await axios.get(`https://v3.openstates.org/${path}`, {
    headers: { 'X-API-KEY': OPENSTATES_KEY },
    params,
    timeout: 45000,
  });
  return res.data;
}

function parseRss(xml, source, maxItems = 10) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of blocks) {
    if (items.length >= maxItems) break;
    const getField = (tag) => {
      const cdataM = block.match(new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>'));
      if (cdataM) return cdataM[1].trim();
      const plainM = block.match(new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>'));
      return plainM ? plainM[1].trim() : '';
    };
    const catM  = block.match(/<category[^>]*>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/category>/);
    const title = getField('title');
    const link  = getField('link') || getField('guid');
    const desc  = getField('description').replace(/<[^>]+>/g, '').trim();
    const pub   = getField('pubDate');
    if (!title) continue;
    items.push({
      title,
      summary:  desc.slice(0, 250) || title,
      date:     pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      category: catM ? catM[1].trim() : 'Announcement',
      source,
      url: link || '',
    });
  }
  return items;
}

async function fetchOneState(stateId) {
  const jurisdiction = STATE_SLUGS[stateId];
  const stateAbbr    = stateId.replace('US-', '');

  let recent_bills = [];
  try {
    const data = await openstatesGet('bills', {
      jurisdiction, sort: 'updated_desc', per_page: 20,
      include: ['abstracts', 'sponsorships'],
    });
    recent_bills = (data.results || []).map(b => ({
      billNumber: b.identifier || '',
      title:      b.title || '',
      summary:    (b.abstracts && b.abstracts[0]?.abstract) || b.title || '',
      status:     b.latest_action_description || b.classification?.[0] || 'Introduced',
      category:   (b.subject?.[0] || b.classification?.[0] || 'General').replace(/([a-z])([A-Z])/g, '$1 $2'),
      date:       b.updated_at ? b.updated_at.slice(0, 10) : (b.first_action_date || ''),
      sponsor:    b.sponsorships?.[0]?.name || '',
      url:        b.openstates_url || '',
      session:    b.session || '',
    }));
  } catch (e) {
    throw new Error(`bills: ${e.message}`);
  }

  let new_laws = [];
  try {
    const data = await openstatesGet('bills', {
      jurisdiction, sort: 'updated_desc', per_page: 20,
      classification: 'bill', include: ['abstracts', 'sponsorships', 'actions'],
    });
    const enacted = (data.results || []).filter(b =>
      (b.actions || []).some(a => /signed|enacted|chaptered|effective|became law/i.test(a.description || ''))
    );
    const list = enacted.length >= 3 ? enacted : (data.results || []).slice(0, 15);
    new_laws = list.map(b => {
      const enactedAction = (b.actions || []).find(a =>
        /signed|enacted|chaptered|effective|became law/i.test(a.description || '')
      );
      return {
        billNumber:  b.identifier || '',
        title:       b.title || '',
        summary:     (b.abstracts && b.abstracts[0]?.abstract) || b.title || '',
        status:      enactedAction ? 'Signed into Law' : (b.latest_action_description || 'Passed'),
        category:    (b.subject?.[0] || b.classification?.[0] || 'General').replace(/([a-z])([A-Z])/g, '$1 $2'),
        dateEnacted: enactedAction?.date || b.updated_at?.slice(0, 10) || '',
        signedBy:    `Governor of ${stateAbbr}`,
        impact:      '',
        url:         b.openstates_url || '',
        session:     b.session || '',
      };
    });
  } catch (e) {
    console.warn(`    laws: ${e.message}`);
  }

  let news_announcements = [];
  const govFeed = GOVERNOR_FEEDS[stateId];
  if (govFeed) {
    try {
      const res = await axios.get(govFeed, { timeout: 15000, headers: BROWSER_HEADERS });
      const items = parseRss(res.data, "Governor's Office");
      if (items.length > 0) news_announcements = items;
    } catch (_) {}
  }
  if (news_announcements.length === 0 && recent_bills.length > 0) {
    news_announcements = recent_bills.slice(0, 10).map(b => ({
      title:    `${b.billNumber}: ${b.title}`,
      summary:  `Latest action: ${b.status}`,
      date:     b.date || '',
      category: 'Legislature Update',
      source:   'OpenStates',
      url:      b.url || `https://openstates.org/${stateAbbr.toLowerCase()}/`,
    }));
  }

  const db = getDb();
  await db.collection('subnational_jurisdictions').doc(stateId).set(
    { recent_bills, new_laws, news_announcements, state_data_updated: new Date().toISOString() },
    { merge: true }
  );

  return { stateId, bills: recent_bills.length, laws: new_laws.length, news: news_announcements.length };
}

async function run() {
  // States that got 0 bills due to 429 rate limiting
  const RETRY_STATES = [
    'US-CT','US-DE','US-ME','US-MD','US-MA','US-MI','US-MN','US-MS','US-MO',
    'US-MT','US-NE','US-NV','US-NH','US-NJ','US-OK','US-OR','US-PA','US-RI',
    'US-SC','US-SD','US-TN','US-TX','US-WY',
  ];
  const DELAY_MS = 15000; // 15 seconds between each state
  const results = { ok: [], failed: [] };

  console.log(`\n🔄 Retrying ${RETRY_STATES.length} states with ${DELAY_MS/1000}s delay...\n`);

  for (let i = 0; i < RETRY_STATES.length; i++) {
    const stateId = RETRY_STATES[i];
    process.stdout.write(`[${i+1}/${RETRY_STATES.length}] ${stateId} ... `);
    try {
      const r = await fetchOneState(stateId);
      console.log(`✅  ${r.bills} bills, ${r.laws} laws, ${r.news} news`);
      results.ok.push(stateId);
    } catch (e) {
      console.log(`❌  ${e.message}`);
      results.failed.push(stateId);
    }
    if (i < RETRY_STATES.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`\n🎉 Done! ${results.ok.length} succeeded, ${results.failed.length} failed`);
  if (results.failed.length > 0) console.log(`Still failed: ${results.failed.join(', ')}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
