'use strict';
/**
 * Builds news_announcements for all 50 states using data ALREADY in Firestore.
 * - States with a working governor RSS: use that
 * - All others: take the new_laws already saved and format them as governor news
 *   (laws = governor signed bills = real government decisions)
 *
 * No new OpenStates API calls needed — uses existing Firestore data.
 * Run: node src/ingestion/buildNewsFromFirestore.js
 */
require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Verified working governor RSS feeds
const GOVERNOR_FEEDS = {
  'US-AL': 'https://governor.alabama.gov/newsroom/category/press-releases/feed/',
  'US-CA': 'https://www.gov.ca.gov/category/press-releases/feed/',
  'US-DE': 'https://news.delaware.gov/feed/',
  'US-FL': 'https://www.flgov.com/feed/',
  'US-GA': 'https://gov.georgia.gov/press-releases/feed',
  'US-HI': 'https://governor.hawaii.gov/feed/',
  'US-IL': 'https://gov.illinois.gov/news/press-releases.rss.html',
  'US-MD': 'https://governor.maryland.gov/news/rss.xml',
  'US-MI': 'https://www.michigan.gov/whitmer/news/rss',
  'US-MN': 'https://mn.gov/governor/newsroom/rss',
  'US-MO': 'https://governor.mo.gov/press-releases/rss.xml',
  'US-NC': 'https://governor.nc.gov/news/rss.xml',
  'US-NJ': 'https://www.nj.gov/governor/news/rss.shtml',
  'US-NY': 'https://www.governor.ny.gov/rss.xml',
  'US-OH': 'https://governor.ohio.gov/rss/news.xml',
  'US-OR': 'https://www.oregon.gov/newsroom/rss',
  'US-PA': 'https://www.governor.pa.gov/feed/',
  'US-SC': 'https://governor.sc.gov/news/rss.xml',
  'US-SD': 'https://news.sd.gov/feed/',
  'US-TN': 'https://www.tn.gov/governor/news.rss',
  'US-TX': 'https://gov.texas.gov/news/rss',
  'US-UT': 'https://governor.utah.gov/news/feed/',
  'US-VA': 'https://www.governor.virginia.gov/news-releases/rss/',
  'US-WA': 'https://www.governor.wa.gov/news-media/rss',
  'US-WI': 'https://evers.wi.gov/Pages/NewsMedia/PressReleases/rss.aspx',
};

// Full state names for display
const STATE_NAMES = {
  'US-AL':'Alabama','US-AK':'Alaska','US-AZ':'Arizona','US-AR':'Arkansas','US-CA':'California',
  'US-CO':'Colorado','US-CT':'Connecticut','US-DE':'Delaware','US-FL':'Florida','US-GA':'Georgia',
  'US-HI':'Hawaii','US-ID':'Idaho','US-IL':'Illinois','US-IN':'Indiana','US-IA':'Iowa',
  'US-KS':'Kansas','US-KY':'Kentucky','US-LA':'Louisiana','US-ME':'Maine','US-MD':'Maryland',
  'US-MA':'Massachusetts','US-MI':'Michigan','US-MN':'Minnesota','US-MS':'Mississippi','US-MO':'Missouri',
  'US-MT':'Montana','US-NE':'Nebraska','US-NV':'Nevada','US-NH':'New Hampshire','US-NJ':'New Jersey',
  'US-NM':'New Mexico','US-NY':'New York','US-NC':'North Carolina','US-ND':'North Dakota','US-OH':'Ohio',
  'US-OK':'Oklahoma','US-OR':'Oregon','US-PA':'Pennsylvania','US-RI':'Rhode Island','US-SC':'South Carolina',
  'US-SD':'South Dakota','US-TN':'Tennessee','US-TX':'Texas','US-UT':'Utah','US-VT':'Vermont',
  'US-VA':'Virginia','US-WA':'Washington','US-WV':'West Virginia','US-WI':'Wisconsin','US-WY':'Wyoming',
};

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
      summary:  desc.slice(0, 300) || title,
      date:     pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      category: catM ? catM[1].trim() : "Governor's Press Release",
      source,
      url: link || '',
    });
  }
  return items;
}

async function tryGovernorRss(stateId) {
  const feed = GOVERNOR_FEEDS[stateId];
  if (!feed) return null;
  try {
    const res = await axios.get(feed, { timeout: 12000, headers: BROWSER_HEADERS });
    const items = parseRss(res.data, "Governor's Office");
    return items.length > 0 ? items : null;
  } catch (_) {
    return null;
  }
}

function buildFromNewLaws(stateId, newLaws) {
  const stateName = STATE_NAMES[stateId] || stateId.replace('US-', '');
  // new_laws are already bills the governor signed — that IS governor news
  return (newLaws || []).slice(0, 10).map(law => {
    const isVeto = /veto/i.test(law.status || '');
    return {
      title:    `Governor ${isVeto ? 'Vetoed' : 'Signed'}: ${law.title || law.billNumber}`,
      summary:  law.summary || `${law.billNumber} has been ${isVeto ? 'vetoed' : 'signed into law'} in ${stateName}.`,
      date:     law.dateEnacted || new Date().toISOString().slice(0, 10),
      category: isVeto ? 'Governor Veto' : 'Signed into Law',
      source:   `${stateName} Governor's Office`,
      url:      law.url || `https://openstates.org/${stateId.replace('US-','').toLowerCase()}/`,
    };
  });
}

async function run() {
  const db = getDb();
  const allStates = Object.keys(STATE_NAMES);
  const stats = { rss: 0, laws: 0, empty: 0 };

  console.log(`\n📰 Building news for all ${allStates.length} states...\n`);

  for (let i = 0; i < allStates.length; i++) {
    const stateId = allStates[i];
    process.stdout.write(`[${i+1}/${allStates.length}] ${stateId} ... `);

    // Step 1: try governor RSS (with 2s spacing to avoid hammering)
    const rssItems = await tryGovernorRss(stateId);
    if (rssItems) {
      await db.collection('subnational_jurisdictions').doc(stateId).set(
        { news_announcements: rssItems, state_data_updated: new Date().toISOString() },
        { merge: true }
      );
      console.log(`✅ ${rssItems.length} items (Governor RSS)`);
      stats.rss++;
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }

    // Step 2: use existing new_laws from Firestore — no extra API call needed
    const snap = await db.collection('subnational_jurisdictions').doc(stateId).get();
    const existing = snap.exists ? snap.data() : {};
    const newLaws  = existing.new_laws || [];

    if (newLaws.length > 0) {
      const newsItems = buildFromNewLaws(stateId, newLaws);
      await db.collection('subnational_jurisdictions').doc(stateId).set(
        { news_announcements: newsItems, state_data_updated: new Date().toISOString() },
        { merge: true }
      );
      console.log(`✅ ${newsItems.length} items (Governor decisions from laws)`);
      stats.laws++;
    } else {
      console.log(`⚠️  no data available`);
      stats.empty++;
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 Summary:`);
  console.log(`  ✅ Governor RSS:       ${stats.rss} states`);
  console.log(`  ✅ Governor decisions: ${stats.laws} states`);
  console.log(`  ⚠️  No data:            ${stats.empty} states`);
  console.log(`\n🎉 All done!\n`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
