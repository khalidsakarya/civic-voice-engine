'use strict';
require('dotenv').config();

const axios     = require('axios');
const pdfParse  = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');

const COLLECTION_NAME  = 'member_stock_trades';
const CONCURRENCY      = 2;   // keep well under 10K output tokens/min rate limit
const TIMEOUT_PDF_MS   = 30_000;
const SCHEDULER_TIER   = 'bimonthly';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a financial disclosure parser for US House of Representatives Periodic Transaction Reports (PTRs).

Extract every stock/asset transaction from the provided PDF text and return a JSON array.

Each element must have exactly these fields:
- ticker: stock ticker symbol (string or null if not present)
- company_name: full company or fund name (string or null)
- transaction_type: "buy", "sell", or "exchange" (lowercase; null if unclear)
- amount_range: the dollar amount range as printed (e.g. "$1,001 - $15,000"; null if missing)
- transaction_date: ISO date string YYYY-MM-DD (null if not parseable)
- asset_type: e.g. "Stock", "ETF", "Mutual Fund", "Bond", "Option", "Cryptocurrency", "Other" (null if unknown)

Rules:
- Return ONLY a raw JSON array — no markdown, no explanation, no wrapper object.
- If there are no transactions, return an empty array: []
- Do not invent data; use null for missing fields.
- If a row spans multiple lines, merge it into one object.
- Ignore header rows, page numbers, filer info, and certification text.`;

// ─── Retry helper for rate-limit 429s ─────────────────────────────────────────

async function withRetry(fn, maxAttempts = 4) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || (err.message && err.message.includes('429'));
      if (is429 && attempt < maxAttempts) {
        const delay = Math.min(2000 * 2 ** (attempt - 1), 60_000);
        console.warn(`[pdf-parser] Rate limit hit — retry ${attempt}/${maxAttempts} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// ─── Parse one PDF buffer through Claude ──────────────────────────────────────

async function parsePdfWithClaude(pdfText, memberName) {
  const userContent = `PTR filing for: ${memberName || 'Unknown Member'}\n\n--- PDF TEXT ---\n${pdfText.slice(0, 12_000)}`;

  const msg = await withRetry(() => client.messages.create({
    model:      'claude-haiku-4-5',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userContent }],
  }));

  const raw = msg.content[0]?.text?.trim() || '[]';

  // Strip accidental markdown fences
  const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn(`[pdf-parser] JSON parse error for ${memberName}: ${clean.slice(0, 120)}`);
    return [];
  }
}

// ─── Process one Firestore document ───────────────────────────────────────────

async function processDocument(db, doc) {
  const data       = doc.data();
  const docId      = doc.id;
  const memberName = data.member_name || data.last_name || docId;
  const url        = data.document_url;

  if (!url) {
    console.log(`[pdf-parser] ${docId}: no document_url — skipping`);
    return { docId, status: 'skipped', reason: 'no document_url' };
  }

  // Skip if already successfully parsed (has trades) or confirmed empty (no parse_error)
  if (Array.isArray(data.parsed_trades) && data.parsed_trades.length > 0) {
    console.log(`[pdf-parser] ${docId}: already parsed (${data.parsed_trades.length} trades) — skipping`);
    return { docId, status: 'skipped', reason: 'already_parsed' };
  }
  if (Array.isArray(data.parsed_trades) && data.parse_error === null && data.parse_attempted_at) {
    console.log(`[pdf-parser] ${docId}: confirmed empty PDF — skipping`);
    return { docId, status: 'skipped', reason: 'confirmed_empty' };
  }

  let pdfText;
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_PDF_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CivicVoiceEngine/1.0)',
        'Referer':    'https://disclosures-clerk.house.gov/',
      },
    });
    const parsed = await pdfParse(Buffer.from(resp.data));
    pdfText = parsed.text || '';
  } catch (err) {
    console.warn(`[pdf-parser] ${docId}: PDF fetch/parse failed — ${err.message}`);
    await db.collection(COLLECTION_NAME).doc(docId).update({
      parsed_trades:      [],
      parse_error:        err.message,
      parse_attempted_at: new Date().toISOString(),
    });
    return { docId, status: 'error', reason: err.message };
  }

  if (!pdfText.trim()) {
    console.log(`[pdf-parser] ${docId}: empty PDF text — skipping`);
    await db.collection(COLLECTION_NAME).doc(docId).update({
      parsed_trades:      [],
      parse_error:        'empty PDF text',
      parse_attempted_at: new Date().toISOString(),
    });
    return { docId, status: 'empty' };
  }

  let trades;
  try {
    trades = await parsePdfWithClaude(pdfText, memberName);
  } catch (err) {
    console.warn(`[pdf-parser] ${docId}: Claude call failed — ${err.message}`);
    await db.collection(COLLECTION_NAME).doc(docId).update({
      parsed_trades:      [],
      parse_error:        `Claude error: ${err.message}`,
      parse_attempted_at: new Date().toISOString(),
    });
    return { docId, status: 'error', reason: err.message };
  }

  await db.collection(COLLECTION_NAME).doc(docId).update({
    parsed_trades:      trades,
    parse_error:        null,
    parse_attempted_at: new Date().toISOString(),
  });

  console.log(`[pdf-parser] ${docId} (${memberName}): ${trades.length} trades parsed`);
  return { docId, status: 'ok', tradeCount: trades.length };
}

// ─── Concurrency pool ─────────────────────────────────────────────────────────

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function parseAllStockTrades() {
  const _ts = new Date().toISOString();
  console.log('\n[pdf-parser] Loading member_stock_trades from Firestore…');

  const db      = getDb();
  const snap    = await db.collection(COLLECTION_NAME).get();
  const docs    = snap.docs;

  console.log(`[pdf-parser] ${docs.length} documents found`);

  const tasks = docs.map(doc => () => processDocument(db, doc));

  const results = await runWithConcurrency(tasks, CONCURRENCY);

  const ok      = results.filter(r => r.status === 'ok');
  const skipped = results.filter(r => r.status === 'skipped');
  const errors  = results.filter(r => r.status === 'error');
  const empty   = results.filter(r => r.status === 'empty');
  const totalTrades = ok.reduce((s, r) => s + (r.tradeCount || 0), 0);

  console.log(`\n[pdf-parser] Done.`);
  console.log(`  Parsed:  ${ok.length} docs (${totalTrades} total trades)`);
  console.log(`  Skipped: ${skipped.length}`);
  console.log(`  Empty:   ${empty.length}`);
  console.log(`  Errors:  ${errors.length}`);

  await writeAuditLog({
    collection_name:      COLLECTION_NAME,
    jurisdiction:         'US-House',
    data_pull_timestamp:  _ts,
    source_endpoint:      'pdf-parser/claude-haiku-4-5',
    record_count:         ok.length,
    import_status:        errors.length === 0 ? 'success' : 'partial',
    error_message:        errors.length ? `${errors.length} parse errors` : null,
    scheduler_tier:       SCHEDULER_TIER,
  });

  return { parsed: ok.length, skipped: skipped.length, errors: errors.length, totalTrades };
}

module.exports = { parseAllStockTrades };

if (require.main === module) {
  parseAllStockTrades()
    .then(r => {
      console.log('[pdf-parser] Complete:', r);
      process.exit(0);
    })
    .catch(err => {
      console.error('[pdf-parser] Fatal:', err.message);
      process.exit(1);
    });
}
