'use strict';

/**
 * Fetches latest Canadian government announcements from pm.gc.ca (JSON:API),
 * enriches them with Claude Haiku (category, cost, affected groups, impact score),
 * and writes to Firestore collection: news_alerts
 */

require('dotenv').config();
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const COLLECTION      = 'news_alerts';
const COUNTRY         = 'CA';
const PM_NEWS_API     = 'https://pm.gc.ca/jsonapi/node/article';
const PM_BASE         = 'https://pm.gc.ca';
const PAGE_LIMIT      = 50;    // articles per fetch (one page — most recent first)
const CLAUDE_BATCH    = 10;    // articles per Claude call
const MIN_IMPACT      = 4;     // skip routine/ceremonial items (impact < 4)

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeId(id) {
  return `news-alert-ca-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200)}`;
}

function rawCategory(pathAlias) {
  if (/\/news-releases\/|\/releases\//.test(pathAlias)) return 'press_release';
  if (/\/statements\//.test(pathAlias))                 return 'statement';
  if (/\/readouts\//.test(pathAlias))                   return 'readout';
  if (/\/speeches\//.test(pathAlias))                   return 'speech';
  if (/\/media-advisories\//.test(pathAlias))           return 'media_advisory';
  if (/\/backgrounders\//.test(pathAlias))              return 'backgrounder';
  return 'news';
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchRawArticles() {
  const url = `${PM_NEWS_API}?sort=-created&page%5Blimit%5D=${PAGE_LIMIT}`;
  const r   = await axios.get(url, {
    timeout: 20000,
    headers: { ...BROWSER_HEADERS, Accept: 'application/vnd.api+json' },
  });

  const articles = [];
  for (const item of (r.data?.data || [])) {
    const attrs     = item.attributes || {};
    const pathAlias = attrs.path?.alias || '';
    const cat       = rawCategory(pathAlias);

    // Media advisories = scheduling notices; backgrounders = supplementary detail — skip both
    if (cat === 'media_advisory' || cat === 'backgrounder') continue;

    const released = attrs.field_date_released || attrs.created || '';
    const title    = attrs.title || '';
    if (!title) continue;

    articles.push({
      id:          item.id,
      title,
      date:        released ? released.slice(0, 10) : '',
      rawCategory: cat,
      body:        stripHtml(attrs.body?.summary || attrs.body?.processed || '').slice(0, 800),
      sourceUrl:   pathAlias ? `${PM_BASE}${pathAlias}` : PM_BASE,
    });
  }

  return articles;
}

// ─── Enrich (Claude Haiku) ────────────────────────────────────────────────────

async function enrichBatch(articles) {
  const input = articles.map((a, i) => ({
    index:   i,
    title:   a.title,
    date:    a.date,
    summary: a.body.slice(0, 400),
  }));

  const prompt = `You are a Canadian government news analyst. For each announcement extract structured data.

Announcements:
${JSON.stringify(input, null, 2)}

Return a JSON array (same order and length as input). Each element:
- index: same integer as input
- title: cleaned title (remove boilerplate prefixes like "Statement by the Prime Minister of Canada on" if they add no info)
- category: one of: defense, healthcare, economy, environment, infrastructure, immigration, foreign_affairs, housing, education, agriculture, energy, justice, social_services, trade, other
- estimated_cost_cad: dollar amount as a number if explicitly stated, else null
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

  console.log('[news-alerts] Fetching pm.gc.ca articles (JSON:API)...');
  const articles = await fetchRawArticles();
  console.log(`[news-alerts] ${articles.length} articles after pre-filter (media advisories and backgrounders removed)`);

  if (!articles.length) {
    console.log('[news-alerts] Nothing to process.');
    return 0;
  }

  // ── Enrich in batches ──────────────────────────────────────────────────────
  const enriched = [];
  const totalBatches = Math.ceil(articles.length / CLAUDE_BATCH);

  for (let i = 0; i < articles.length; i += CLAUDE_BATCH) {
    const batch     = articles.slice(i, i + CLAUDE_BATCH);
    const batchNum  = Math.floor(i / CLAUDE_BATCH) + 1;
    console.log(`[news-alerts] Claude batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

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

  console.log(`[news-alerts] ${enriched.length} articles pass impact threshold (>= ${MIN_IMPACT})`);
  if (!enriched.length) return 0;

  // ── Write to Firestore ─────────────────────────────────────────────────────
  const WRITE_BATCH = 400;
  let written = 0;

  for (let i = 0; i < enriched.length; i += WRITE_BATCH) {
    const chunk = enriched.slice(i, i + WRITE_BATCH);
    const batch = db.batch();

    for (const { article, extracted } of chunk) {
      const docId = sanitizeId(article.id);
      batch.set(db.collection(COLLECTION).doc(docId), {
        id:              docId,
        country:         COUNTRY,
        title:           extracted.title || article.title,
        date:            article.date,
        category:        extracted.category || 'other',
        cost_cad:        typeof extracted.estimated_cost_cad === 'number' ? extracted.estimated_cost_cad : null,
        affected_groups: Array.isArray(extracted.affected_groups) ? extracted.affected_groups : [],
        timeline:        extracted.timeline || null,
        summary:         extracted.plain_summary || '',
        source_url:      article.sourceUrl,
        impact_score:    extracted.impact_score || 0,
        raw_type:        article.rawCategory,
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
