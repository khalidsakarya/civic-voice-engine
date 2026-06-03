'use strict';
/**
 * Refreshes governor press release news for the 12 US states that have
 * verified working official RSS/API feeds from their .gov websites.
 *
 * Sources are 100% official government — no third parties.
 *
 * Run:         node src/ingestion/refreshGovernorNews.js
 * Single state: node src/ingestion/refreshGovernorNews.js --state US-TX
 * Schedule:    add to cron or npm scripts for daily refresh
 */
require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'application/rss+xml, application/xml, application/json, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ── Verified official .gov governor feeds ─────────────────────────────────────
const GOVERNOR_FEEDS = {
  'US-AL': {
    type:   'rss',
    url:    'https://governor.alabama.gov/newsroom/category/press-releases/feed/',
    label:  "Alabama Governor's Office",
    site:   'governor.alabama.gov',
  },
  'US-AK': {
    type:   'rss',
    url:    'https://gov.alaska.gov/category/press-releases/feed/',
    label:  "Alaska Governor's Office",
    site:   'gov.alaska.gov',
  },
  'US-CA': {
    type:   'rss',
    url:    'https://www.gov.ca.gov/category/press-releases/feed/',
    label:  "California Governor's Office",
    site:   'gov.ca.gov',
  },
  'US-DE': {
    type:   'rss',
    url:    'https://news.delaware.gov/feed/',
    label:  "Delaware Governor's Office",
    site:   'news.delaware.gov',
  },
  'US-GA': {
    type:   'rss',
    url:    'https://gov.georgia.gov/rss.xml',
    label:  "Georgia Governor's Office",
    site:   'gov.georgia.gov',
  },
  'US-HI': {
    type:   'rss',
    url:    'https://governor.hawaii.gov/feed/',
    label:  "Hawaii Governor's Office",
    site:   'governor.hawaii.gov',
  },
  'US-MS': {
    type:   'rss',
    url:    'https://governorreeves.ms.gov/feed/',
    label:  "Mississippi Governor's Office",
    site:   'governorreeves.ms.gov',
  },
  'US-NC': {
    type:   'rss',
    url:    'https://governor.nc.gov/news/feed/',
    label:  "North Carolina Governor's Office",
    site:   'governor.nc.gov',
  },
  'US-ND': {
    type:   'rss',
    url:    'https://www.governor.nd.gov/rss.xml',
    label:  "North Dakota Governor's Office",
    site:   'governor.nd.gov',
  },
  'US-NM': {
    type:   'wp',
    url:    'https://www.governor.state.nm.us/wp-json/wp/v2/posts?per_page=10&orderby=date&order=desc',
    label:  "New Mexico Governor's Office",
    site:   'governor.state.nm.us',
  },
  // US-TX: gov.texas.gov actively blocks all automated access (TLS drops + 403).
  // Texas data remains in Firestore from last manual run. Re-check periodically.
  // 'US-TX': { type: 'rss', url: 'https://gov.texas.gov/news/rss', ... },
  'US-UT': {
    type:   'rss',
    url:    'https://governor.utah.gov/news/feed/',
    label:  "Utah Governor's Office",
    site:   'governor.utah.gov',
  },
};

// ── RSS parser ────────────────────────────────────────────────────────────────
function parseRss(xml, label, maxItems = 10) {
  const items  = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const block of blocks) {
    if (items.length >= maxItems) break;

    const getField = (tag) => {
      const cdataRe = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>');
      const cdataM  = block.match(cdataRe);
      if (cdataM) return cdataM[1].trim();
      const plainRe = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>');
      const plainM  = block.match(plainRe);
      return plainM ? plainM[1].trim() : '';
    };

    const catM = block.match(/<category[^>]*>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/category>/);
    const title = getField('title');
    if (!title) continue;

    const pub = getField('pubDate');
    const desc = getField('description').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

    items.push({
      title:    title.replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#8217;/g, "'"),
      summary:  desc.slice(0, 300) || title,
      date:     pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      category: catM ? catM[1].trim() : "Governor's Statement",
      source:   label,
      url:      getField('link') || getField('guid') || '',
    });
  }
  return items;
}

// ── WordPress REST API parser ─────────────────────────────────────────────────
function parseWordPress(posts, label) {
  return posts.slice(0, 10).map(post => ({
    title:    (post.title?.rendered || '')
                .replace(/<[^>]+>/g, '')
                .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
                .replace(/&amp;/g, '&')
                .trim(),
    summary:  (post.excerpt?.rendered || '')
                .replace(/<[^>]+>/g, '')
                .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
                .trim()
                .slice(0, 300),
    date:     post.date ? post.date.slice(0, 10) : '',
    category: "Governor's Statement",
    source:   label,
    url:      post.link || '',
  }));
}

// ── Fetch one state ───────────────────────────────────────────────────────────
async function fetchState(stateId) {
  const cfg = GOVERNOR_FEEDS[stateId];
  if (!cfg) throw new Error(`No feed configured for ${stateId}`);

  const res = await axios.get(cfg.url, { timeout: 15000, headers: HEADERS });

  const items = cfg.type === 'wp'
    ? parseWordPress(res.data, cfg.label)
    : parseRss(res.data, cfg.label);

  if (items.length === 0) throw new Error('No items parsed from feed');

  return items;
}

// ── Upload to Firestore ───────────────────────────────────────────────────────
async function upload(stateId, items) {
  const db = getDb();
  await db.collection('subnational_jurisdictions').doc(stateId).set(
    {
      news_announcements:   items,
      news_source:          GOVERNOR_FEEDS[stateId].label,
      news_source_site:     GOVERNOR_FEEDS[stateId].site,
      news_source_type:     'official_rss',
      news_last_updated:    new Date().toISOString(),
      state_data_updated:   new Date().toISOString(),
    },
    { merge: true }
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  // Single state mode
  const stateArg = process.argv.find(a => a.startsWith('--state='))?.split('=')[1]
    || (process.argv.indexOf('--state') !== -1
        ? process.argv[process.argv.indexOf('--state') + 1]
        : null);

  const statesToRun = stateArg
    ? [stateArg]
    : Object.keys(GOVERNOR_FEEDS);

  const results = { ok: [], failed: [] };

  console.log(`\n📰 Refreshing official governor news for ${statesToRun.length} state(s)...\n`);

  for (let i = 0; i < statesToRun.length; i++) {
    const stateId = statesToRun[i];
    const cfg     = GOVERNOR_FEEDS[stateId];
    if (!cfg) { console.log(`⚠️  ${stateId} — no feed configured`); continue; }

    process.stdout.write(`[${i + 1}/${statesToRun.length}] ${stateId} (${cfg.site}) ... `);
    try {
      const items = await fetchState(stateId);
      await upload(stateId, items);
      console.log(`✅  ${items.length} items`);
      console.log(`    Latest: "${items[0].title.slice(0, 70)}"`);
      results.ok.push(stateId);
    } catch (e) {
      console.log(`❌  ${e.message}`);
      results.failed.push(stateId);
    }

    // Small pause between requests
    if (i < statesToRun.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n📊 Results:`);
  console.log(`  ✅ Success: ${results.ok.length}  → ${results.ok.join(', ')}`);
  if (results.failed.length > 0)
    console.log(`  ❌ Failed:  ${results.failed.length}  → ${results.failed.join(', ')}`);
  console.log(`\n🏛️  All data sourced directly from official .gov governor websites.\n`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
