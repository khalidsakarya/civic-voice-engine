'use strict';

/**
 * Fetches latest government announcements from all 4 countries, enriches
 * with Claude Haiku (category, cost, affected groups, impact score), and
 * writes to Firestore collection: news_alerts
 *
 * Sources:
 *   CA — pm.gc.ca (Drupal JSON:API) — press releases, statements, readouts, speeches
 *   US — whitehouse.gov (XML post-sitemap) — briefings, presidential actions, releases
 *   UK — gov.uk search JSON API — PM office announcements, speeches, press releases
 *   AU — alp.org.au/news/all-news/ (HTML scrape)
 *        NOTE: pm.gov.au returns Cloudflare bot-challenge for all automated requests;
 *        the ALP news page carries official government announcements from the PM.
 */

require('dotenv').config();
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLECTION   = 'news_alerts';
const CLAUDE_BATCH = 10;   // articles per Claude call
const MIN_IMPACT   = 4;    // drop routine/ceremonial items (impact < 4)
const PAGE_LIMIT   = 50;   // max articles per country per run

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Shared helpers ───────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Convert a URL slug to a human-readable title. */
function titleFromSlug(url) {
  const slug = url.split('/').filter(Boolean).pop() || '';
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function sanitizeDocId(country, rawId) {
  return `news-alert-${country.toLowerCase()}-${String(rawId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)}`;
}

// ─── CA — pm.gc.ca (Drupal JSON:API) ─────────────────────────────────────────

const PM_CA_API  = 'https://pm.gc.ca/jsonapi/node/article';
const PM_CA_BASE = 'https://pm.gc.ca';

function caRawType(pathAlias) {
  if (/\/news-releases\/|\/releases\//.test(pathAlias)) return 'press_release';
  if (/\/statements\//.test(pathAlias))                 return 'statement';
  if (/\/readouts\//.test(pathAlias))                   return 'readout';
  if (/\/speeches\//.test(pathAlias))                   return 'speech';
  if (/\/media-advisories\//.test(pathAlias))           return 'media_advisory';
  if (/\/backgrounders\//.test(pathAlias))              return 'backgrounder';
  return 'news';
}

async function fetchArticlesCA() {
  console.log('[news-alerts:CA] Fetching pm.gc.ca (JSON:API)...');
  const url = `${PM_CA_API}?sort=-created&page%5Blimit%5D=${PAGE_LIMIT}`;
  const r   = await axios.get(url, {
    timeout: 20000,
    headers: { ...BROWSER_HEADERS, Accept: 'application/vnd.api+json' },
  });

  const articles = [];
  for (const item of (r.data?.data || [])) {
    const attrs     = item.attributes || {};
    const pathAlias = attrs.path?.alias || '';
    const rawType   = caRawType(pathAlias);

    // Media advisories = scheduling notices; backgrounders = supplementary detail
    if (rawType === 'media_advisory' || rawType === 'backgrounder') continue;

    const released = attrs.field_date_released || attrs.created || '';
    const title    = attrs.title || '';
    if (!title) continue;

    articles.push({
      country:  'CA',
      id:       sanitizeDocId('CA', item.id),
      title,
      date:     released ? released.slice(0, 10) : '',
      rawType,
      body:     stripHtml(attrs.body?.summary || attrs.body?.processed || '').slice(0, 600),
      sourceUrl: pathAlias ? `${PM_CA_BASE}${pathAlias}` : PM_CA_BASE,
    });
  }

  console.log(`[news-alerts:CA] ${articles.length} articles after pre-filter`);
  return articles;
}

// ─── US — whitehouse.gov post-sitemap ────────────────────────────────────────

const WH_SITEMAP = 'https://www.whitehouse.gov/post-sitemap.xml';

function usRawType(url) {
  if (/\/presidential-actions\//.test(url)) return 'executive_action';
  if (/\/briefings-statements\//.test(url)) return 'statement';
  if (/\/fact-sheets\//.test(url))          return 'fact_sheet';
  if (/\/releases\//.test(url))             return 'press_release';
  return 'news';
}

/** Parse YYYY-MM-DD from a whitehouse.gov URL path (e.g. /briefings-statements/2025/05/15/...) */
function dateFromWhUrl(url) {
  const m = url.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

async function fetchArticlesUS() {
  console.log('[news-alerts:US] Fetching whitehouse.gov post-sitemap.xml...');
  const r = await axios.get(WH_SITEMAP, { timeout: 30000, headers: BROWSER_HEADERS });

  const entries = [...r.data.matchAll(/<url>([\s\S]+?)<\/url>/g)].map(e => ({
    loc:     e[1].match(/<loc>([^<]+)/)?.[1]  ?? '',
    lastmod: e[1].match(/<lastmod>([^<]+)/)?.[1]?.slice(0, 10) ?? '',
  }));

  // Keep only substantive article paths; drop index/taxonomy pages
  const filtered = entries.filter(e =>
    /\/(presidential-actions|briefings-statements|fact-sheets|releases)\/\d{4}\//.test(e.loc)
  );

  // Sort by date descending, take most recent PAGE_LIMIT
  const sorted = filtered
    .map(e => ({ ...e, date: e.lastmod || dateFromWhUrl(e.loc) }))
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
    .slice(0, PAGE_LIMIT);

  const articles = sorted.map(({ loc, date }) => ({
    country:  'US',
    id:       sanitizeDocId('US', loc.replace('https://www.whitehouse.gov', '')),
    title:    titleFromSlug(loc),
    date,
    rawType:  usRawType(loc),
    body:     '',
    sourceUrl: loc,
  }));

  console.log(`[news-alerts:US] ${articles.length} articles from sitemap`);
  return articles;
}

// ─── UK — gov.uk search JSON API ─────────────────────────────────────────────

const GOVUK_SEARCH = 'https://www.gov.uk/api/search.json';

function ukRawType(docType, link) {
  if (/speech/.test(docType)        || /\/speeches\//.test(link))       return 'speech';
  if (/press_release/.test(docType) || /\/press-releases\//.test(link)) return 'press_release';
  if (/statement/.test(docType))                                         return 'statement';
  return 'news';
}

async function fetchArticlesUK() {
  console.log('[news-alerts:UK] Fetching gov.uk search API (PM office)...');
  const r = await axios.get(GOVUK_SEARCH, {
    timeout: 20000,
    headers: BROWSER_HEADERS,
    params: {
      filter_organisations: 'prime-ministers-office-10-downing-street',
      count: PAGE_LIMIT,
      start: 0,
      order: '-public_timestamp',
    },
  });

  const articles = [];
  for (const item of (r.data?.results ?? [])) {
    const docType = item.document_type ?? '';
    const link    = item.link ?? '';
    const date    = (item.public_timestamp ?? '').slice(0, 10);

    // Keep only substantive content types
    const isSubstantive =
      /\/government\/(?:news|speeches|press-releases|statements)\//.test(link) ||
      /news|speech|statement|press_release/.test(docType);
    if (!isSubstantive) continue;

    const title = item.title || titleFromSlug(link);
    const body  = (item.description || '').slice(0, 600);

    articles.push({
      country:  'UK',
      id:       sanitizeDocId('UK', link),
      title,
      date,
      rawType:  ukRawType(docType, link),
      body,
      sourceUrl: link.startsWith('http') ? link : `https://www.gov.uk${link}`,
    });
  }

  console.log(`[news-alerts:UK] ${articles.length} articles after type filter`);
  return articles;
}

// ─── AU — alp.org.au HTML listing ────────────────────────────────────────────
// pm.gov.au returns a Cloudflare bot-challenge for all automated requests.
// The ALP news page carries official government announcements from the PM.

const ALP_URL  = 'https://www.alp.org.au/news/all-news/';
const ALP_BASE = 'https://www.alp.org.au';

const MONTH_MAP = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};

function parseALPDate(html) {
  const m = html.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return '';
  return `${m[3]}-${MONTH_MAP[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
}

async function fetchArticlesAU() {
  console.log('[news-alerts:AU] Fetching alp.org.au news listing...');
  const listR = await axios.get(ALP_URL, { timeout: 20000, headers: BROWSER_HEADERS });

  // Extract unique article paths from the listing page
  const paths = [...listR.data.matchAll(/href="(\/news\/all-news\/[^"?#]+)"/g)]
    .map(m => m[1])
    .filter((v, i, a) => a.indexOf(v) === i && v !== '/news/all-news/')
    .slice(0, PAGE_LIMIT);

  console.log(`[news-alerts:AU] ${paths.length} article links found — fetching details (5 concurrent)...`);

  const articles = [];
  const CONCUR = 5;

  for (let i = 0; i < paths.length; i += CONCUR) {
    await Promise.all(paths.slice(i, i + CONCUR).map(async (path) => {
      const url = `${ALP_BASE}${path}`;
      try {
        const r    = await axios.get(url, { timeout: 15000, headers: BROWSER_HEADERS });
        const html = r.data;

        const title = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1]
                   || html.match(/<h1[^>]*>([^<]+)/)?.[1]?.trim()
                   || titleFromSlug(path);

        const body = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1]
                  || '';

        const date = html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1]?.slice(0, 10)
                  || parseALPDate(html);

        articles.push({
          country:  'AU',
          id:       sanitizeDocId('AU', path),
          title,
          date,
          rawType:  'press_release',
          body:     body.slice(0, 600),
          sourceUrl: url,
        });
      } catch (e) {
        console.warn(`[news-alerts:AU] Failed ${url}: ${e.message}`);
      }
    }));
  }

  console.log(`[news-alerts:AU] ${articles.length} articles fetched`);
  return articles;
}

// ─── Claude Haiku enrichment ──────────────────────────────────────────────────

async function enrichBatch(articles) {
  const input = articles.map((a, i) => ({
    index:   i,
    country: a.country,
    title:   a.title,
    date:    a.date,
    summary: a.body.slice(0, 400),
  }));

  const prompt = `You are a government news analyst covering Canada, the US, the UK, and Australia. For each announcement extract structured data.

Announcements:
${JSON.stringify(input, null, 2)}

Return a JSON array (same order and length as input). Each element:
- index: same integer as input
- title: cleaned title (strip boilerplate prefixes like "Statement by the Prime Minister of Canada on", "FACT SHEET:", "Read-out of" if they add no content)
- category: one of: defense, healthcare, economy, environment, infrastructure, immigration, foreign_affairs, housing, education, agriculture, energy, justice, social_services, trade, other
- estimated_cost_local: dollar/pound amount as a number if explicitly stated, else null (use the country's local currency)
- affected_groups: array of up to 3 groups affected (e.g. ["seniors","veterans"]) — empty array if none clear
- timeline: short timeline phrase if mentioned (e.g. "by 2026","effective April 2025") else null
- plain_summary: exactly 3 plain-English sentences — what was announced, who it affects, why it matters
- impact_score: integer 1–10 (1=ceremonial/scheduling, 10=major national policy with large confirmed funding)

Respond with ONLY a valid JSON array. No markdown, no explanation.`;

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages:   [{ role: 'user', content: prompt }],
  });

  const text      = message.content[0].text.trim();
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Claude did not return a JSON array');
  return JSON.parse(jsonMatch[0]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchNewsAlerts() {
  const db = getDb();
  const ts = new Date().toISOString();

  // Fetch all 4 countries in parallel — separate hosts, no rate-limit conflicts
  console.log('[news-alerts] Fetching all 4 countries in parallel...');
  const [caArticles, usArticles, ukArticles, auArticles] = await Promise.allSettled([
    fetchArticlesCA(),
    fetchArticlesUS(),
    fetchArticlesUK(),
    fetchArticlesAU(),
  ]).then(results => results.map((r, i) => {
    const label = ['CA', 'US', 'UK', 'AU'][i];
    if (r.status === 'rejected') {
      console.error(`[news-alerts:${label}] fetch failed: ${r.reason?.message}`);
      return [];
    }
    return r.value;
  }));

  const allArticles = [...caArticles, ...usArticles, ...ukArticles, ...auArticles];
  console.log(`\n[news-alerts] Total fetched: ${allArticles.length} (CA:${caArticles.length} US:${usArticles.length} UK:${ukArticles.length} AU:${auArticles.length})`);

  if (!allArticles.length) {
    console.log('[news-alerts] Nothing to process.');
    return 0;
  }

  // ── Enrich in batches via Claude Haiku ────────────────────────────────────
  const enriched = [];
  const totalBatches = Math.ceil(allArticles.length / CLAUDE_BATCH);

  for (let i = 0; i < allArticles.length; i += CLAUDE_BATCH) {
    const batch    = allArticles.slice(i, i + CLAUDE_BATCH);
    const batchNum = Math.floor(i / CLAUDE_BATCH) + 1;
    const countries = [...new Set(batch.map(a => a.country))].join('+');
    console.log(`[news-alerts] Claude batch ${batchNum}/${totalBatches} (${batch.length} items, ${countries})...`);

    try {
      const results = await enrichBatch(batch);
      for (const extracted of results) {
        const article = batch[extracted.index];
        if (!article) continue;
        if ((extracted.impact_score || 0) < MIN_IMPACT) continue; // drop routine/ceremonial
        enriched.push({ article, extracted });
      }
    } catch (e) {
      console.error(`[news-alerts] Batch ${batchNum} failed: ${e.message}`);
    }
  }

  // Count how many passed per country
  const countsByCountry = { CA: 0, US: 0, UK: 0, AU: 0 };
  for (const { article } of enriched) countsByCountry[article.country] = (countsByCountry[article.country] || 0) + 1;
  console.log(`\n[news-alerts] ${enriched.length} articles pass impact threshold (>= ${MIN_IMPACT}) — CA:${countsByCountry.CA} US:${countsByCountry.US} UK:${countsByCountry.UK} AU:${countsByCountry.AU}`);

  if (!enriched.length) return 0;

  // ── Write to Firestore ─────────────────────────────────────────────────────
  const WRITE_BATCH = 400;
  let written = 0;

  for (let i = 0; i < enriched.length; i += WRITE_BATCH) {
    const chunk = enriched.slice(i, i + WRITE_BATCH);
    const batch = db.batch();

    for (const { article, extracted } of chunk) {
      batch.set(db.collection(COLLECTION).doc(article.id), {
        id:              article.id,
        country:         article.country,
        title:           extracted.title || article.title,
        date:            article.date,
        category:        extracted.category || 'other',
        cost_local:      typeof extracted.estimated_cost_local === 'number' ? extracted.estimated_cost_local : null,
        affected_groups: Array.isArray(extracted.affected_groups) ? extracted.affected_groups : [],
        timeline:        extracted.timeline || null,
        summary:         extracted.plain_summary || '',
        source_url:      article.sourceUrl,
        impact_score:    extracted.impact_score || 0,
        raw_type:        article.rawType,
        created_at:      ts,
      }, { merge: false });
    }

    await batch.commit();
    written += chunk.length;
  }

  console.log(`[news-alerts] ✓ ${COLLECTION}: ${written} documents written`);
  return written;
}

module.exports = { fetchNewsAlerts };

if (require.main === module) {
  fetchNewsAlerts()
    .then(n => { console.log(`Done — ${n} news alerts written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
