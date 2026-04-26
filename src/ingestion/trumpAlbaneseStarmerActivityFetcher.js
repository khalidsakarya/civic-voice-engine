'use strict';

/**
 * Fetches recent activity for Donald Trump, Anthony Albanese, and Keir Starmer
 * from official government sources:
 *
 *   Trump:    whitehouse.gov XML sitemap (post-sitemap.xml)
 *             — presidential actions, briefings-statements, fact-sheets, releases
 *
 *   Albanese: alp.org.au/news/all-news/ HTML scrape
 *             — pm.gov.au is Cloudflare-blocked; ALP site carries PM announcements
 *
 *   Starmer:  gov.uk search JSON API (/api/search.json) paginated by date
 *             — filtered to prime-ministers-office-10-downing-street org
 *
 * Writes to Firestore collection: member_recent_activity
 */

require('dotenv').config();
const axios = require('axios');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const TRUMP_NAME    = 'Donald Trump';
const TRUMP_SLUG    = 'donald-trump';
const TRUMP_JUR     = 'US';
const TRUMP_START   = '2025-01-20';

const ALBANESE_NAME = 'Anthony Albanese';
const ALBANESE_SLUG = 'anthony-albanese';
const ALBANESE_JUR  = 'AU';

const STARMER_NAME  = 'Keir Starmer';
const STARMER_SLUG  = 'keir-starmer';
const STARMER_JUR   = 'UK';
const STARMER_START = '2024-07-05';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

// Convert URL slug to readable title
function titleFromSlug(url) {
  const slug = url.split('/').filter(Boolean).pop() || '';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

async function batchSet(db, collection, docs) {
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of chunk) {
      batch.set(db.collection(collection).doc(sanitizeId(id)), data, { merge: false });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// ─── 1. Trump — whitehouse.gov post sitemap ───────────────────────────────────

const WH_SITEMAP = 'https://www.whitehouse.gov/post-sitemap.xml';

function whCategory(url) {
  if (/\/presidential-actions\//.test(url)) return 'executive_action';
  if (/\/briefings-statements\//.test(url)) return 'statement';
  if (/\/fact-sheets\//.test(url))          return 'fact_sheet';
  if (/\/releases\//.test(url))             return 'press_release';
  return 'news';
}

async function fetchTrumpActivity() {
  console.log('[trump:activity] Fetching whitehouse.gov post sitemap...');
  const ts = new Date().toISOString();

  const r = await axios.get(WH_SITEMAP, { timeout: 30000, headers: BROWSER_HEADERS });

  const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)].map(e => ({
    loc:     e[1].match(/<loc>([^<]+)/)?.[1]  ?? '',
    lastmod: e[1].match(/<lastmod>([^<]+)/)?.[1]?.slice(0, 10) ?? '',
  }));

  // Only keep dated article paths; exclude index pages and taxonomy
  const articles = entries.filter(e =>
    /\/(presidential-actions|briefings-statements|fact-sheets|releases)\/\d{4}\//.test(e.loc)
  );

  console.log(`[trump:activity] ${articles.length} article URLs from sitemap`);

  const docs = articles.map(({ loc, lastmod }) => ({
    id:   `us-trump-activity-${sanitizeId(loc.replace('https://www.whitehouse.gov', ''))}`,
    data: {
      member_name:     TRUMP_NAME,
      politician_slug: TRUMP_SLUG,
      jurisdiction:    TRUMP_JUR,
      title:           titleFromSlug(loc),
      date:            lastmod,
      category:        whCategory(loc),
      description:     '',
      source_url:      loc,
      source_name:     'The White House — whitehouse.gov',
      last_updated:    ts,
    },
  }));

  console.log(`[trump:activity] ✓ ${docs.length} docs`);
  return docs;
}

// ─── 2. Albanese — alp.org.au HTML scrape ────────────────────────────────────
// pm.gov.au returns a Cloudflare bot-challenge for all automated requests.
// The ALP news page carries official government announcements from the PM.

const ALP_NEWS_URL = 'https://www.alp.org.au/news/all-news/';
const ALP_BASE     = 'https://www.alp.org.au';

const MONTH_MAP = {
  january:   '01', february: '02', march:     '03', april:    '04',
  may:       '05', june:     '06', july:      '07', august:   '08',
  september: '09', october:  '10', november:  '11', december: '12',
};

function parseTextDate(html) {
  const m = html.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return '';
  const mm = MONTH_MAP[m[2].toLowerCase()] || '';
  return `${m[3]}-${mm}-${m[1].padStart(2, '0')}`;
}

async function fetchAlbaneseActivity() {
  console.log('[albanese:activity] Fetching alp.org.au news listing...');
  const ts = new Date().toISOString();
  const docs = [];

  const listR = await axios.get(ALP_NEWS_URL, { timeout: 20000, headers: BROWSER_HEADERS });
  const paths = [...listR.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)]
    .map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i && v !== '/news/all-news/');

  console.log(`[albanese:activity] ${paths.length} article links found`);

  const CONCUR = 5;
  for (let i = 0; i < paths.length; i += CONCUR) {
    await Promise.all(paths.slice(i, i + CONCUR).map(async path => {
      const url = `${ALP_BASE}${path}`;
      try {
        const r   = await axios.get(url, { timeout: 15000, headers: BROWSER_HEADERS });
        const html = r.data;

        const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]
                   || html.match(/<h1[^>]*>([^<]+)/)?.[1]?.trim()
                   || titleFromSlug(path);

        const desc  = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1]
                   || '';

        const date  = html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1]?.slice(0, 10)
                   || parseTextDate(html);

        docs.push({
          id:   `au-albanese-activity-${sanitizeId(path)}`,
          data: {
            member_name:     ALBANESE_NAME,
            politician_slug: ALBANESE_SLUG,
            jurisdiction:    ALBANESE_JUR,
            title,
            date,
            category:        'press_release',
            description:     desc,
            source_url:      url,
            source_name:     'Australian Labor Party — alp.org.au',
            last_updated:    ts,
          },
        });
      } catch (e) {
        console.warn(`[albanese:activity] Failed ${url}: ${e.message}`);
      }
    }));
  }

  console.log(`[albanese:activity] ✓ ${docs.length} docs`);
  return docs;
}

// ─── 3. Starmer — gov.uk search API ──────────────────────────────────────────

const GOVUK_SEARCH = 'https://www.gov.uk/api/search.json';

// URL path → activity category
function govukCategory(docType, link) {
  if (/speech/.test(docType)        || /\/speeches\//.test(link))       return 'speech';
  if (/press_release/.test(docType) || /\/press-releases\//.test(link)) return 'press_release';
  if (/statement/.test(docType))                                         return 'statement';
  if (/publication/.test(docType)   || /\/publications\//.test(link))   return 'publication';
  return 'news';
}

async function fetchStarmerActivity() {
  console.log('[starmer:activity] Fetching gov.uk search results (PM office)...');
  const ts   = new Date().toISOString();
  const docs = [];
  let start = 0;
  const COUNT = 20;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const r = await axios.get(GOVUK_SEARCH, {
      timeout: 20000,
      headers: BROWSER_HEADERS,
      params: {
        filter_organisations: 'prime-ministers-office-10-downing-street',
        count: COUNT,
        start,
        order: '-public_timestamp',
      },
    });

    const results = r.data?.results ?? [];
    if (results.length === 0) break;

    let hitCutoff = false;
    for (const item of results) {
      const date = (item.public_timestamp ?? '').slice(0, 10);
      if (date && date < STARMER_START) { hitCutoff = true; break; }

      // Skip non-news document types (appointments, guidance, etc.)
      const docType = item.document_type ?? '';
      const link    = item.link ?? '';
      if (/\/government\/(?:news|speeches|press-releases|statements)\//.test(link) === false
        && !/news|speech|statement|press_release/.test(docType)) continue;

      const title = item.title || titleFromSlug(link);
      const desc  = (item.description || '').slice(0, 500);

      docs.push({
        id:   `uk-starmer-activity-${sanitizeId(link)}`,
        data: {
          member_name:     STARMER_NAME,
          politician_slug: STARMER_SLUG,
          jurisdiction:    STARMER_JUR,
          title,
          date,
          category:        govukCategory(docType, link),
          description:     desc,
          source_url:      link.startsWith('http') ? link : `https://www.gov.uk${link}`,
          source_name:     "Prime Minister's Office — gov.uk",
          last_updated:    ts,
        },
      });
    }

    if (hitCutoff || results.length < COUNT) break;
    start += COUNT;

    await new Promise(res => setTimeout(res, 60));
  }

  console.log(`[starmer:activity] ✓ ${docs.length} docs`);
  return docs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchLeaderActivity() {
  const db = getDb();

  // Fetch all three in parallel (separate hosts, no rate-limit conflicts)
  const [trumpDocs, albaneseDocs, starmerDocs] = await Promise.allSettled([
    fetchTrumpActivity(),
    fetchAlbaneseActivity(),
    fetchStarmerActivity(),
  ]).then(results => results.map((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[leaders:activity] source ${i} failed:`, r.reason?.message);
      return [];
    }
    return r.value;
  }));

  const allDocs = [...trumpDocs, ...albaneseDocs, ...starmerDocs];
  console.log(`\n[leaders:activity] Total: ${allDocs.length} (trump:${trumpDocs.length} albanese:${albaneseDocs.length} starmer:${starmerDocs.length})`);

  // Clear existing docs for each politician then write fresh
  for (const slug of [TRUMP_SLUG, ALBANESE_SLUG, STARMER_SLUG]) {
    const existing = await db.collection('member_recent_activity')
      .where('politician_slug', '==', slug).get();
    if (!existing.empty) {
      for (let i = 0; i < existing.docs.length; i += 400) {
        const batch = db.batch();
        existing.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      console.log(`[leaders:activity] Cleared ${existing.size} existing ${slug} docs`);
    }
  }

  const written = await batchSet(db, 'member_recent_activity', allDocs);
  console.log(`[leaders:activity] ✓ member_recent_activity: ${written} documents written`);
  return written;
}

module.exports = { fetchLeaderActivity };

if (require.main === module) {
  fetchLeaderActivity()
    .then(n => { console.log(`Done — ${n} activity documents written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
