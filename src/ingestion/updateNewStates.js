'use strict';
require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
};

const NEW_FEEDS = {
  'US-AK': { type: 'rss', url: 'https://gov.alaska.gov/category/press-releases/feed/',   source: "Governor's Office" },
  'US-GA': { type: 'rss', url: 'https://gov.georgia.gov/rss.xml',                         source: "Governor's Office" },
  'US-MS': { type: 'rss', url: 'https://governorreeves.ms.gov/feed/',                     source: "Governor's Office" },
  'US-NC': { type: 'rss', url: 'https://governor.nc.gov/news/feed/',                      source: "Governor's Office" },
  'US-ND': { type: 'rss', url: 'https://www.governor.nd.gov/rss.xml',                     source: "Governor's Office" },
};

function parseRss(xml, source) {
  const items = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of blocks.slice(0, 10)) {
    const getField = (tag) => {
      const cdataRe = new RegExp('<' + tag + '[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>');
      const cdataM  = block.match(cdataRe);
      if (cdataM) return cdataM[1].trim();
      const plainRe = new RegExp('<' + tag + '[^>]*>([^<]*)<\\/' + tag + '>');
      const plainM  = block.match(plainRe);
      return plainM ? plainM[1].trim() : '';
    };
    const catM  = block.match(/<category[^>]*>(?:<!\[CDATA\[)?([^\]<]+?)(?:\]\]>)?<\/category>/);
    const title = getField('title');
    if (!title) continue;
    const pub = getField('pubDate');
    items.push({
      title,
      summary:  getField('description').replace(/<[^>]+>/g, '').slice(0, 250) || title,
      date:     pub ? new Date(pub).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      category: catM ? catM[1].trim() : "Governor's Press Release",
      source,
      url:      getField('link') || getField('guid') || '',
    });
  }
  return items;
}

async function run() {
  const db = getDb();
  for (const [stateId, cfg] of Object.entries(NEW_FEEDS)) {
    try {
      const r     = await axios.get(cfg.url, { timeout: 12000, headers: HEADERS });
      const items = parseRss(r.data, cfg.source);
      if (items.length === 0) { console.log('⚠️ ', stateId, '- no items parsed'); continue; }
      await db.collection('subnational_jurisdictions').doc(stateId).set(
        { news_announcements: items, state_data_updated: new Date().toISOString() },
        { merge: true }
      );
      console.log('✅', stateId, '-', items.length, 'items -', items[0].title.slice(0, 70));
    } catch (e) {
      console.log('❌', stateId, '-', e.message);
    }
  }
  console.log('\nDone!');
}

run().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
