'use strict';
/**
 * Fetches bills and laws for US states using:
 *   TIER 1 — Official government legislature APIs/RSS (where accessible)
 *   TIER 2 — LegiScan API (mirrors official legislature data, labeled clearly)
 *
 * All data is labeled with its source tier for full transparency.
 *
 * Run:  node src/ingestion/stateLegislatureFetcher.js
 *       node src/ingestion/stateLegislatureFetcher.js --state US-TX
 */
require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const LEGISCAN_KEY = process.env.LEGISCAN_API_KEY;
const COLLECTION   = 'subnational_jurisdictions';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, application/xml, text/xml, */*',
};

// ── TIER 1: Official government sources (verified working) ────────────────────
// Format: { url, type: 'api'|'rss', parser, label, sourceUrl }
const OFFICIAL_SOURCES = {
  'US-MA': {
    type:      'rss',
    url:       'https://malegislature.gov/Bills/Search?rss=true',
    label:     'Massachusetts Legislature',
    sourceUrl: 'https://malegislature.gov',
  },
  'US-CO': {
    type:      'rss',
    url:       'https://leg.colorado.gov/bill-search?rss=true',
    label:     'Colorado General Assembly',
    sourceUrl: 'https://leg.colorado.gov',
  },
  'US-MD': {
    type:      'rss',
    url:       'https://mgaleg.maryland.gov/mgawebsite/Members/Download/rss',
    label:     'Maryland General Assembly',
    sourceUrl: 'https://mgaleg.maryland.gov',
  },
  'US-OK': {
    type:      'rss',
    url:       'https://www.oklegislature.gov/rss/bills.aspx',
    label:     'Oklahoma Legislature',
    sourceUrl: 'https://www.oklegislature.gov',
  },
  // Add more as we verify them
};

// ── LegiScan state codes ──────────────────────────────────────────────────────
const LEGISCAN_STATES = {
  'US-AL':'AL','US-AK':'AK','US-AZ':'AZ','US-AR':'AR','US-CA':'CA',
  'US-CO':'CO','US-CT':'CT','US-DE':'DE','US-FL':'FL','US-GA':'GA',
  'US-HI':'HI','US-ID':'ID','US-IL':'IL','US-IN':'IN','US-IA':'IA',
  'US-KS':'KS','US-KY':'KY','US-LA':'LA','US-ME':'ME','US-MD':'MD',
  'US-MA':'MA','US-MI':'MI','US-MN':'MN','US-MS':'MS','US-MO':'MO',
  'US-MT':'MT','US-NE':'NE','US-NV':'NV','US-NH':'NH','US-NJ':'NJ',
  'US-NM':'NM','US-NY':'NY','US-NC':'NC','US-ND':'ND','US-OH':'OH',
  'US-OK':'OK','US-OR':'OR','US-PA':'PA','US-RI':'RI','US-SC':'SC',
  'US-SD':'SD','US-TN':'TN','US-TX':'TX','US-UT':'UT','US-VT':'VT',
  'US-VA':'VA','US-WA':'WA','US-WV':'WV','US-WI':'WI','US-WY':'WY',
};

// ── RSS parser ────────────────────────────────────────────────────────────────
function parseRssBills(xml, sourceLabel, sourceUrl, maxItems = 20) {
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
    const title = getField('title');
    const link  = getField('link') || getField('guid');
    const desc  = getField('description').replace(/<[^>]+>/g, '').trim();
    const pub   = getField('pubDate');
    if (!title) continue;
    // Try to extract bill number from title (e.g. "HB 123" or "SB 45")
    const billNumMatch = title.match(/^([HS][BJR]\s*\d+|[A-Z]{1,3}\s*\d+)/i);
    items.push({
      billNumber:  billNumMatch ? billNumMatch[0].trim() : '',
      title:       title.replace(/^[HS][BJR]\s*\d+\s*[-–]\s*/i, '').trim() || title,
      summary:     desc.slice(0, 300) || title,
      status:      'Introduced',
      category:    'General',
      date:        pub ? new Date(pub).toISOString().slice(0, 10) : '',
      sponsor:     '',
      url:         link || sourceUrl,
      dataSource:  sourceLabel,
      sourceTier:  'official',
    });
  }
  return items;
}

// ── TIER 1: Fetch from official government source ─────────────────────────────
async function fetchOfficial(stateId) {
  const src = OFFICIAL_SOURCES[stateId];
  if (!src) return null;

  try {
    const res = await axios.get(src.url, { timeout: 15000, headers: BROWSER_HEADERS });
    const bills = parseRssBills(res.data, src.label, src.sourceUrl);
    if (bills.length === 0) return null;
    console.log(`  ✅ [official] ${stateId} — ${bills.length} bills from ${src.label}`);
    return { bills, source: 'official', label: src.label };
  } catch (e) {
    console.warn(`  ⚠️  [official] ${stateId} failed (${e.message})`);
    return null;
  }
}

// ── TIER 2: Fetch from LegiScan ───────────────────────────────────────────────
async function legiscanGet(op, params = {}) {
  const res = await axios.get('https://api.legiscan.com/', {
    params: { op, key: LEGISCAN_KEY, ...params },
    timeout: 30000,
    headers: BROWSER_HEADERS,
  });
  if (res.data.status === 'ERROR') throw new Error(res.data.alert?.message || 'LegiScan error');
  return res.data;
}

async function fetchLegiScan(stateId) {
  if (!LEGISCAN_KEY) throw new Error('LEGISCAN_API_KEY not set in .env');

  const stateCode = LEGISCAN_STATES[stateId];
  if (!stateCode) throw new Error(`No LegiScan code for ${stateId}`);

  // Get current session
  const sessions = await legiscanGet('getSessionList', { state: stateCode });
  const sessionList = sessions.sessions || [];
  // Find most recent regular session
  const currentSession = sessionList.find(s => s.special === 0) || sessionList[0];
  if (!currentSession) throw new Error(`No session found for ${stateCode}`);

  // Get master bill list for session
  const masterList = await legiscanGet('getMasterList', { session_id: currentSession.session_id });
  const allBills = Object.values(masterList.masterlist || {}).filter(b => b.bill_id);

  // Sort by last_action_date descending
  allBills.sort((a, b) => (b.last_action_date || '').localeCompare(a.last_action_date || ''));

  const stateAbbr = stateId.replace('US-', '');

  // Recent bills = latest 20 introduced/active
  const recent_bills = allBills.slice(0, 20).map(b => ({
    billNumber:  b.bill_number || '',
    title:       b.title || '',
    summary:     b.title || '',
    status:      b.last_action || 'Introduced',
    category:    b.type_id === 1 ? 'Bill' : b.type_id === 2 ? 'Resolution' : 'Legislation',
    date:        b.last_action_date || '',
    sponsor:     '',
    url:         b.url || `https://legiscan.com/${stateCode}/bill/${b.bill_number}/${currentSession.year_start}`,
    dataSource:  'LegiScan (official legislature data)',
    sourceTier:  'legiscan',
  }));

  // New laws = bills with "signed" or "enacted" in last action
  const signedBills = allBills.filter(b =>
    /signed|enacted|chaptered|became law|approved/i.test(b.last_action || '')
  ).slice(0, 15);

  const new_laws = signedBills.map(b => ({
    billNumber:  b.bill_number || '',
    title:       b.title || '',
    summary:     b.title || '',
    status:      'Signed into Law',
    category:    b.type_id === 1 ? 'Bill' : 'Legislation',
    dateEnacted: b.last_action_date || '',
    signedBy:    `Governor of ${stateAbbr}`,
    impact:      '',
    url:         b.url || `https://legiscan.com/${stateCode}/bill/${b.bill_number}/${currentSession.year_start}`,
    dataSource:  'LegiScan (official legislature data)',
    sourceTier:  'legiscan',
  }));

  console.log(`  ✅ [legiscan] ${stateId} — ${recent_bills.length} bills, ${new_laws.length} laws`);
  return { recent_bills, new_laws, source: 'legiscan' };
}

// ── Main per-state fetch ──────────────────────────────────────────────────────
async function fetchState(stateId) {
  // Try Tier 1 first
  const official = await fetchOfficial(stateId);
  if (official) {
    return {
      recent_bills: official.bills,
      new_laws:     official.bills.filter(b => /signed|enacted/i.test(b.status)),
      sourceLabel:  official.label,
      sourceTier:   'official',
    };
  }

  // Fall back to LegiScan (Tier 2)
  return fetchLegiScan(stateId);
}

// ── Upload ────────────────────────────────────────────────────────────────────
async function uploadState(stateId, recent_bills, new_laws) {
  const db = getDb();
  await db.collection(COLLECTION).doc(stateId).set(
    { recent_bills, new_laws, state_data_updated: new Date().toISOString() },
    { merge: true }
  );
}

// ── Run all or single state ───────────────────────────────────────────────────
async function run() {
  if (!LEGISCAN_KEY) {
    console.error('\n❌ LEGISCAN_API_KEY is not set in .env');
    console.error('   Sign up free at: https://legiscan.com/legiscan');
    console.error('   Then add to .env:  LEGISCAN_API_KEY=your_key_here\n');
    process.exit(1);
  }

  const stateArg = process.argv.find(a => a.startsWith('--state='))?.split('=')[1]
    || (process.argv.indexOf('--state') !== -1 ? process.argv[process.argv.indexOf('--state') + 1] : null);

  const statesToRun = stateArg ? [stateArg] : Object.keys(LEGISCAN_STATES);
  const DELAY_MS    = 2000; // LegiScan allows ~10 req/s on free tier
  const results     = { official: [], legiscan: [], failed: [] };

  console.log(`\n🏛️  Fetching legislature data for ${statesToRun.length} state(s)...\n`);

  for (let i = 0; i < statesToRun.length; i++) {
    const stateId = statesToRun[i];
    process.stdout.write(`[${i+1}/${statesToRun.length}] ${stateId} ... `);
    try {
      const data = await fetchState(stateId);
      await uploadState(stateId, data.recent_bills, data.new_laws);
      console.log(`✅  ${data.recent_bills.length} bills, ${data.new_laws.length} laws (${data.sourceTier})`);
      results[data.sourceTier === 'official' ? 'official' : 'legiscan'].push(stateId);
    } catch (e) {
      console.log(`❌  ${e.message}`);
      results.failed.push(stateId);
    }
    if (i < statesToRun.length - 1) await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n📊 Summary:`);
  console.log(`  🏛️  Official .gov source: ${results.official.length} states  → ${results.official.join(', ') || 'none'}`);
  console.log(`  📋 LegiScan (fallback):  ${results.legiscan.length} states`);
  console.log(`  ❌ Failed:               ${results.failed.length} states  → ${results.failed.join(', ') || 'none'}`);
}

run().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
