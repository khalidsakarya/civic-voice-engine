'use strict';

/**
 * Fetches Recent Bills, New Laws, and News & Announcements for a US state
 * and uploads them to Firestore under subnational_jurisdictions/{stateId}.
 *
 * Data sources:
 *   - Recent Bills  → OpenStates API (v3.openstates.org)
 *   - New Laws       → OpenStates API (bills with status = passed/signed)
 *   - News           → California official RSS feed (leginfo.legislature.ca.gov)
 *
 * Run:  node src/ingestion/stateDataFetcher.js --state US-CA
 */

require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const OPENSTATES_KEY = process.env.OPENSTATES_API_KEY;
const COLLECTION     = 'subnational_jurisdictions';

// Map subnationalId → OpenStates jurisdiction slug
const STATE_SLUGS = {
  'US-AL': 'al', 'US-AK': 'ak', 'US-AZ': 'az', 'US-AR': 'ar', 'US-CA': 'ca',
  'US-CO': 'co', 'US-CT': 'ct', 'US-DE': 'de', 'US-FL': 'fl', 'US-GA': 'ga',
  'US-HI': 'hi', 'US-ID': 'id', 'US-IL': 'il', 'US-IN': 'in', 'US-IA': 'ia',
  'US-KS': 'ks', 'US-KY': 'ky', 'US-LA': 'la', 'US-ME': 'me', 'US-MD': 'md',
  'US-MA': 'ma', 'US-MI': 'mi', 'US-MN': 'mn', 'US-MS': 'ms', 'US-MO': 'mo',
  'US-MT': 'mt', 'US-NE': 'ne', 'US-NV': 'nv', 'US-NH': 'nh', 'US-NJ': 'nj',
  'US-NM': 'nm', 'US-NY': 'ny', 'US-NC': 'nc', 'US-ND': 'nd', 'US-OH': 'oh',
  'US-OK': 'ok', 'US-OR': 'or', 'US-PA': 'pa', 'US-RI': 'ri', 'US-SC': 'sc',
  'US-SD': 'sd', 'US-TN': 'tn', 'US-TX': 'tx', 'US-UT': 'ut', 'US-VT': 'vt',
  'US-VA': 'va', 'US-WA': 'wa', 'US-WV': 'wv', 'US-WI': 'wi', 'US-WY': 'wy',
};

// State name → RSS/news feed URL (California Legislature news as default)
const STATE_NEWS_FEEDS = {
  'US-CA': 'https://leginfo.legislature.ca.gov/faces/billSearchClient.xhtml',
  // Add more state news RSS feeds here as we expand
};

// ─── OpenStates helpers ───────────────────────────────────────────────────────

async function openstatesGet(path, params = {}) {
  const url = `https://v3.openstates.org/${path}`;
  const res = await axios.get(url, {
    headers: { 'X-API-KEY': OPENSTATES_KEY },
    params,
    timeout: 30000,
  });
  return res.data;
}

// ─── Fetch recent bills (introduced/in progress) ──────────────────────────────

async function fetchRecentBills(stateId) {
  const jurisdiction = STATE_SLUGS[stateId];
  if (!jurisdiction) throw new Error(`No slug for ${stateId}`);

  console.log(`  [bills] Fetching recent bills for ${stateId}...`);
  const data = await openstatesGet('bills', {
    jurisdiction,
    sort: 'updated_desc',
    per_page: 20,
    include: ['abstracts', 'sponsorships'],
  });

  return (data.results || []).map(bill => ({
    billNumber: bill.identifier || '',
    title:      bill.title || '',
    summary:    (bill.abstracts && bill.abstracts[0]?.abstract) || bill.title || '',
    status:     bill.latest_action_description || bill.classification?.[0] || 'Introduced',
    category:   bill.subject?.[0] || bill.classification?.[0] || 'General',
    date:       bill.updated_at ? bill.updated_at.slice(0, 10) : (bill.first_action_date || ''),
    sponsor:    bill.sponsorships?.[0]?.name || '',
    url:        bill.openstates_url || `https://openstates.org/bills/${bill.id}/` || '',
    session:    bill.session || '',
  }));
}

// ─── Fetch new laws (passed/signed bills) ────────────────────────────────────

async function fetchNewLaws(stateId) {
  const jurisdiction = STATE_SLUGS[stateId];
  if (!jurisdiction) throw new Error(`No slug for ${stateId}`);

  console.log(`  [laws] Fetching new laws for ${stateId}...`);

  // Fetch bills with "passed" or "signed" in their action
  const data = await openstatesGet('bills', {
    jurisdiction,
    sort:          'updated_desc',
    per_page:      20,
    classification: 'bill',
    include:       ['abstracts', 'sponsorships', 'actions'],
  });

  // Filter to only bills that have been signed/enacted
  const enacted = (data.results || []).filter(bill => {
    const actions = bill.actions || [];
    return actions.some(a =>
      /signed|enacted|chaptered|effective|became law/i.test(a.description || '')
    );
  });

  // If we got few results, widen the search
  const list = enacted.length >= 5 ? enacted : (data.results || []).slice(0, 15);

  return list.map(bill => {
    const actions = bill.actions || [];
    const enactedAction = actions.find(a =>
      /signed|enacted|chaptered|effective|became law/i.test(a.description || '')
    );
    return {
      billNumber:  bill.identifier || '',
      title:       bill.title || '',
      summary:     (bill.abstracts && bill.abstracts[0]?.abstract) || bill.title || '',
      status:      enactedAction ? 'Signed into Law' : (bill.latest_action_description || 'Passed'),
      category:    bill.subject?.[0] || bill.classification?.[0] || 'General',
      dateEnacted: enactedAction?.date || bill.updated_at?.slice(0, 10) || '',
      signedBy:    `Governor of ${stateId.replace('US-', '')}`,
      impact:      '',
      url:         bill.openstates_url || `https://openstates.org/bills/${bill.id}/` || '',
      session:     bill.session || '',
    };
  });
}

// Official Governor press release RSS feeds — verified working
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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function parseRss(xml, source, maxItems = 10) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of blocks) {
    if (items.length >= maxItems) break;
    const getField = (tag) => {
      // CDATA version
      const cdataRe = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>');
      const cdataM  = block.match(cdataRe);
      if (cdataM) return cdataM[1].trim();
      // Plain version
      const plainRe = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>');
      const plainM  = block.match(plainRe);
      return plainM ? plainM[1].trim() : '';
    };
    // Category: grab first match
    const catM = block.match(/<category[^>]*>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/category>/);
    const cat  = catM ? catM[1].trim() : 'Announcement';

    const title   = getField('title');
    const link    = getField('link') || getField('guid');
    const desc    = getField('description').replace(/<[^>]+>/g, '').trim();
    const pubDate = getField('pubDate');

    if (!title) continue;
    items.push({
      title,
      summary:  desc.slice(0, 250) || title,
      date:     pubDate ? new Date(pubDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      category: cat,
      source,
      url: link || '',
    });
  }
  return items;
}

// ─── Fetch news & announcements ───────────────────────────────────────────────

async function fetchNewsAnnouncements(stateId) {
  console.log(`  [news] Fetching news for ${stateId}...`);
  const stateAbbr = stateId.replace('US-', '');

  // 1. Try official governor press releases RSS
  const govFeed = GOVERNOR_FEEDS[stateId];
  if (govFeed) {
    try {
      const res = await axios.get(govFeed, { timeout: 15000, headers: BROWSER_HEADERS });
      const items = parseRss(res.data, "Governor's Office");
      if (items.length > 0) {
        console.log(`  [news] Got ${items.length} items from Governor RSS`);
        return items;
      }
    } catch (e) {
      console.warn(`  [news] Governor RSS failed (${e.message})`);
    }
  }

  // 2. Fallback: fetch ONLY governor actions (signed, vetoed, executive orders)
  //    These are real decisions — not random bill committee referrals
  try {
    console.log(`  [news] Fetching governor decisions from OpenStates for ${stateId}...`);
    const jurisdiction = STATE_SLUGS[stateId];
    const data = await openstatesGet('bills', {
      jurisdiction,
      sort:     'updated_desc',
      per_page: 50,
      include:  ['actions', 'abstracts'],
    });

    const GOV_ACTION_RE = /signed|vetoed|veto|enacted|approved by governor|executive order|chaptered|governor action|approved and signed|became law without/i;

    const govDecisions = [];
    for (const bill of (data.results || [])) {
      const govAction = (bill.actions || []).find(a => GOV_ACTION_RE.test(a.description || ''));
      if (!govAction) continue;
      const isVeto = /veto/i.test(govAction.description);
      govDecisions.push({
        title:    `Governor ${isVeto ? 'VETOED' : 'Signed'}: ${bill.title}`,
        summary:  (bill.abstracts && bill.abstracts[0]?.abstract)
                    || `${govAction.description}. ${bill.title}`,
        date:     govAction.date || bill.updated_at?.slice(0, 10) || '',
        category: isVeto ? 'Governor Veto' : 'Signed into Law',
        source:   `${stateAbbr} Legislature`,
        url:      bill.openstates_url || `https://openstates.org/${stateAbbr.toLowerCase()}/`,
      });
      if (govDecisions.length >= 10) break;
    }
    if (govDecisions.length > 0) {
      console.log(`  [news] Found ${govDecisions.length} governor decisions`);
      return govDecisions;
    }
  } catch (e) {
    console.warn(`  [news] Governor decisions fallback failed (${e.message})`);
  }

  // 3. Last resort placeholder
  return [{
    title:    `${stateAbbr} Governor's Office`,
    summary:  'Visit the official governor website for the latest news and announcements.',
    date:     new Date().toISOString().slice(0, 10),
    category: 'Official',
    source:   `Governor of ${stateAbbr}`,
    url:      `https://www.google.com/search?q=${stateAbbr}+governor+press+releases`,
  }];
}

// ─── Upload to Firestore ───────────────────────────────────────────────────────

async function uploadToFirestore(stateId, recent_bills, new_laws, news_announcements) {
  const db  = getDb();
  const ref = db.collection(COLLECTION).doc(stateId);
  await ref.set(
    { recent_bills, new_laws, news_announcements, state_data_updated: new Date().toISOString() },
    { merge: true }
  );
  console.log(`  [upload] Saved to Firestore: ${COLLECTION}/${stateId}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run(stateId = 'US-CA') {
  if (!OPENSTATES_KEY) {
    console.error('ERROR: OPENSTATES_API_KEY is not set in .env');
    process.exit(1);
  }

  console.log(`\n🏛️  Fetching state data for ${stateId}...\n`);

  try {
    const [recent_bills, new_laws, news_announcements] = await Promise.all([
      fetchRecentBills(stateId),
      fetchNewLaws(stateId),
      fetchNewsAnnouncements(stateId),
    ]);

    console.log(`\n✅ Results:`);
    console.log(`   Recent Bills:       ${recent_bills.length}`);
    console.log(`   New Laws:           ${new_laws.length}`);
    console.log(`   News & Announce:    ${news_announcements.length}`);

    await uploadToFirestore(stateId, recent_bills, new_laws, news_announcements);
    console.log(`\n🎉 Done! Data is now live in Firestore for ${stateId}\n`);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    if (err.response) {
      console.error(`   HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    process.exit(1);
  }
}

// Parse --state flag
const stateArg = process.argv.find(a => a.startsWith('--state='))?.split('=')[1]
  || (process.argv.indexOf('--state') !== -1 ? process.argv[process.argv.indexOf('--state') + 1] : null)
  || 'US-CA';

run(stateArg);
