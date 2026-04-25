'use strict';

/**
 * Fetches recent activity for Mark Carney from official Canadian sources:
 *   - pm.gc.ca (Drupal JSON:API) — press releases, statements, readouts, speeches, advisories
 *   - openparliament.ca API      — parliamentary speeches, vote ballots, sponsored bills
 *
 * Writes to Firestore collection: member_recent_activity
 */

require('dotenv').config();
const axios = require('axios');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const CARNEY_NAME  = 'Mark Carney';
const CARNEY_SLUG  = 'mark-carney';
const JURISDICTION = 'CA';
const PM_START     = '2025-03-14';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const PM_NEWS_API    = 'https://pm.gc.ca/jsonapi/node/article';
const PM_BASE        = 'https://pm.gc.ca';
const OPENPARL_BASE  = 'https://api.openparliament.ca';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

function newsCategory(pathAlias) {
  if (/\/news-releases\/|\/releases\//.test(pathAlias)) return 'press_release';
  if (/\/statements\//.test(pathAlias))                 return 'statement';
  if (/\/readouts\//.test(pathAlias))                   return 'readout';
  if (/\/speeches\//.test(pathAlias))                   return 'speech';
  if (/\/media-advisories\//.test(pathAlias))           return 'media_advisory';
  if (/\/backgrounders\//.test(pathAlias))              return 'backgrounder';
  return 'news';
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

// ─── 1. pm.gc.ca — news, statements, readouts, speeches ──────────────────────

async function fetchPMNews() {
  console.log('[carney:activity] Fetching pm.gc.ca articles via JSON:API...');
  const docs = [];
  const ts   = new Date().toISOString();
  let   url  = `${PM_NEWS_API}?sort=-created&page%5Blimit%5D=50`;

  while (url) {
    const r = await axios.get(url, {
      timeout: 20000,
      headers: { ...BROWSER_HEADERS, Accept: 'application/vnd.api+json' },
    });
    const items   = r.data?.data || [];
    const nextUrl = r.data?.links?.next?.href || null;

    let reachedCutoff = false;
    for (const item of items) {
      const attrs    = item.attributes || {};
      const released = attrs.field_date_released || attrs.created || '';
      const dateStr  = released ? released.slice(0, 10) : '';

      // Stop once we reach articles before PM start date
      if (dateStr && dateStr < PM_START) { reachedCutoff = true; break; }

      const pathAlias = attrs.path?.alias || '';
      const title     = attrs.title || '';
      const summary   = stripHtml(attrs.body?.summary || attrs.body?.processed || '').slice(0, 500);
      const category  = newsCategory(pathAlias);
      const sourceUrl = pathAlias ? `${PM_BASE}${pathAlias}` : PM_BASE;

      if (!title) continue;

      docs.push({
        id:   `ca-carney-activity-pm-${item.id}`,
        data: {
          member_name:     CARNEY_NAME,
          politician_slug: CARNEY_SLUG,
          jurisdiction:    JURISDICTION,
          title,
          date:            dateStr,
          category,
          description:     summary,
          source_url:      sourceUrl,
          source_name:     'Office of the Prime Minister — pm.gc.ca',
          last_updated:    ts,
        },
      });
    }

    url = reachedCutoff ? null : nextUrl;
  }

  console.log(`[carney:activity] pm.gc.ca: ${docs.length} articles`);
  return docs;
}

// ─── 2. openparliament.ca — parliamentary speeches ───────────────────────────

async function fetchSpeeches() {
  console.log('[carney:activity] Fetching openparliament.ca speeches...');
  const docs = [];
  const ts   = new Date().toISOString();
  let   url  = `${OPENPARL_BASE}/speeches/?politician=${CARNEY_SLUG}&format=json&limit=50`;

  while (url) {
    const r       = await axios.get(url, { timeout: 20000, headers: BROWSER_HEADERS });
    const objects = r.data?.objects || [];
    const nextRel = r.data?.pagination?.next_url;

    for (const s of objects) {
      const dateStr = s.time ? s.time.slice(0, 10) : '';
      const text    = stripHtml(s.content?.en || '').slice(0, 500);
      const attrib  = s.attribution?.en || '';

      // Deduplicate same-day debate speeches by grouping on debate URL if available
      const debateId = s.url || s.politician_url || dateStr;

      docs.push({
        id:   `ca-carney-activity-speech-${sanitizeId(debateId + '-' + docs.length)}`,
        data: {
          member_name:     CARNEY_NAME,
          politician_slug: CARNEY_SLUG,
          jurisdiction:    JURISDICTION,
          title:           `Parliamentary speech — ${dateStr}`,
          date:            dateStr,
          category:        'parliamentary_speech',
          description:     text,
          attribution:     attrib,
          source_url:      `https://openparliament.ca/politicians/${CARNEY_SLUG}/`,
          source_name:     'openparliament.ca',
          last_updated:    ts,
        },
      });
    }

    url = nextRel ? `${OPENPARL_BASE}${nextRel}` : null;
  }

  console.log(`[carney:activity] speeches: ${docs.length}`);
  return docs;
}

// ─── 3. openparliament.ca — vote ballots ─────────────────────────────────────

async function fetchVotes() {
  console.log('[carney:activity] Fetching openparliament.ca votes...');
  const ts = new Date().toISOString();

  // Collect all ballot records first (paginated)
  const ballots = [];
  let url = `${OPENPARL_BASE}/votes/ballots/?politician=${CARNEY_SLUG}&format=json&limit=100`;
  while (url) {
    const r   = await axios.get(url, { timeout: 20000, headers: BROWSER_HEADERS });
    const obj = r.data?.objects || [];
    ballots.push(...obj);
    const next = r.data?.pagination?.next_url;
    url = next ? `${OPENPARL_BASE}${next}` : null;
  }
  console.log(`[carney:activity] ${ballots.length} vote ballots collected`);

  // Fetch vote details in batches of 20 concurrent
  const CONCUR = 20;
  const details = new Map();
  for (let i = 0; i < ballots.length; i += CONCUR) {
    await Promise.all(ballots.slice(i, i + CONCUR).map(async b => {
      if (details.has(b.vote_url)) return;
      try {
        const r = await axios.get(`${OPENPARL_BASE}${b.vote_url}?format=json`, { timeout: 10000, headers: BROWSER_HEADERS });
        details.set(b.vote_url, r.data);
      } catch { details.set(b.vote_url, null); }
    }));
  }

  const docs = ballots.map((b, idx) => {
    const detail   = details.get(b.vote_url) || {};
    const dateStr  = detail.date || '';
    const desc     = detail.description?.en || '';
    const result   = detail.result || '';
    const billUrl  = detail.bill_url;
    const voteNum  = detail.number || '';
    const session  = detail.session || '';

    return {
      id:   `ca-carney-activity-vote-${session}-${voteNum || idx}`,
      data: {
        member_name:     CARNEY_NAME,
        politician_slug: CARNEY_SLUG,
        jurisdiction:    JURISDICTION,
        title:           desc ? `Vote ${voteNum}: ${desc.slice(0, 100)}` : `Vote ${voteNum}`,
        date:            dateStr,
        category:        'vote',
        description:     desc,
        ballot:          b.ballot,        // Yes / No / Paired / Absent
        vote_result:     result,          // Passed / Failed
        vote_number:     voteNum,
        session,
        bill_url:        billUrl ? `https://openparliament.ca${billUrl}` : null,
        source_url:      `https://openparliament.ca${b.vote_url}`,
        source_name:     'openparliament.ca',
        last_updated:    ts,
      },
    };
  });

  console.log(`[carney:activity] votes: ${docs.length}`);
  return docs;
}

// ─── 4. openparliament.ca — sponsored bills ───────────────────────────────────

async function fetchBills() {
  console.log('[carney:activity] Fetching openparliament.ca sponsored bills...');
  const ts   = new Date().toISOString();
  const docs = [];
  let   url  = `${OPENPARL_BASE}/bills/?sponsor_politician=${CARNEY_SLUG}&format=json&limit=50`;

  while (url) {
    const r   = await axios.get(url, { timeout: 15000, headers: BROWSER_HEADERS });
    const obj = r.data?.objects || [];
    const next = r.data?.pagination?.next_url;

    for (const b of obj) {
      docs.push({
        id:   `ca-carney-activity-bill-${b.session}-${(b.number || '').replace(/\s+/g, '')}`,
        data: {
          member_name:     CARNEY_NAME,
          politician_slug: CARNEY_SLUG,
          jurisdiction:    JURISDICTION,
          title:           `${b.number}: ${b.name?.en || ''}`,
          date:            b.introduced || '',
          category:        'legislation',
          description:     b.name?.en || '',
          bill_number:     b.number || null,
          session:         b.session || null,
          source_url:      b.url ? `https://openparliament.ca${b.url}` : `https://openparliament.ca/politicians/${CARNEY_SLUG}/`,
          source_name:     'openparliament.ca',
          last_updated:    ts,
        },
      });
    }

    url = next ? `${OPENPARL_BASE}${next}` : null;
  }

  console.log(`[carney:activity] bills: ${docs.length}`);
  return docs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchCarneyActivity() {
  const db = getDb();
  const ts = new Date().toISOString();

  // pm.gc.ca and openparliament.ca are separate hosts — fetch in parallel.
  // Within openparliament, serialize to avoid 429 rate-limit.
  const openParlDocs = await (async () => {
    const s = await fetchSpeeches().catch(e => { console.error('[carney:activity] speeches failed:', e.message); return []; });
    const v = await fetchVotes().catch(e => { console.error('[carney:activity] votes failed:', e.message); return []; });
    const b = await fetchBills().catch(e => { console.error('[carney:activity] bills failed:', e.message); return []; });
    return [...s, ...v, ...b];
  })();
  const pmDocs = await fetchPMNews().catch(e => { console.error('[carney:activity] pm.gc.ca failed:', e.message); return []; });
  const [speechDocs, voteDocs, billDocs] = [
    openParlDocs.filter(d => d.data.category === 'parliamentary_speech'),
    openParlDocs.filter(d => d.data.category === 'vote'),
    openParlDocs.filter(d => d.data.category === 'legislation'),
  ];

  const allDocs = [...pmDocs, ...speechDocs, ...voteDocs, ...billDocs];
  console.log(`\n[carney:activity] Total docs: ${allDocs.length} (pm:${pmDocs.length} speeches:${speechDocs.length} votes:${voteDocs.length} bills:${billDocs.length})`);

  // Clear existing Carney activity docs then write fresh
  const existing = await db.collection('member_recent_activity')
    .where('politician_slug', '==', CARNEY_SLUG).get();
  if (!existing.empty) {
    for (let i = 0; i < existing.docs.length; i += 400) {
      const batch = db.batch();
      existing.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    console.log(`[carney:activity] Cleared ${existing.size} existing docs`);
  }

  const written = await batchSet(db, 'member_recent_activity', allDocs);
  console.log(`[carney:activity] ✓ member_recent_activity: ${written} documents written`);
  return written;
}

module.exports = { fetchCarneyActivity };

if (require.main === module) {
  fetchCarneyActivity()
    .then(n => { console.log(`Done — ${n} activity documents written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
