'use strict';
/**
 * localPdfParser.js
 *
 * Local regex-based parser for US House Periodic Transaction Reports (PTRs)
 * and Financial Disclosure Reports (FDRs). Zero Claude API calls.
 *
 * Exports:
 *   parsePdfText(text)        → [{ticker, company_name, transaction_type,
 *                                  amount_range, transaction_date, asset_type}]
 *   parseAllUnparsed()        → processes all Firestore docs without a successful parse
 *
 * PDF formats handled:
 *   PTR — "Periodic Transaction Report" (ptr-pdfs/)
 *     Each trade: COMPANY (TICKER)\n[CODE]\nTX_TYPE DATE1 DATE2 $AMOUNT
 *   FDR — "Financial Disclosure Report" (financial-pdfs/)
 *     Section B: COMPANY [CODE] DATE TX_TYPE $AMOUNT (inline row)
 */

require('dotenv').config();

const axios    = require('axios');
const pdfParse = require('pdf-parse');
const { getDb }        = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');

const COLLECTION    = 'member_stock_trades';
const CONCURRENCY   = 5;
const TIMEOUT_MS    = 30_000;
const SCHEDULER_TIER = 'bimonthly';

// ─── Asset type code lookup ───────────────────────────────────────────────────

const ASSET_CODE_MAP = {
  ST: 'Stock',
  MF: 'Mutual Fund',
  CS: 'Bond',
  BA: 'Bank Account',
  OT: 'Other',
  WU: 'Whole Life Insurance',
  OP: 'Stock Option',
  HN: 'Hedge Fund',
  AC: 'Annuity',
  DE: 'Debt',
  OL: 'Business Interest',
  RS: 'Retirement Savings',
  IJ: 'Investment Fund',
  RP: 'Real Property',
  FA: 'Farm/Agriculture',
};

function assetTypeFromCode(code) {
  return ASSET_CODE_MAP[code] || 'Other';
}

// Determine asset type from text hints when code is ambiguous
function inferAssetType(code, company) {
  if (code && ASSET_CODE_MAP[code]) return ASSET_CODE_MAP[code];
  if (!company) return 'Other';
  const c = company.toLowerCase();
  if (c.includes('bond') || c.includes('treasury') || c.includes('note') || c.includes('bill') || /\bdue\b/.test(c)) return 'Bond';
  if (c.includes('fund') || c.includes('etf')) return 'Mutual Fund';
  if (c.includes('option')) return 'Stock Option';
  return 'Other';
}

// ─── Field normalisers ────────────────────────────────────────────────────────

// Owner prefixes that appear at the start of company name from PDF column merge
const OWNER_PREFIX_RE = /^(?:SP|JT|DE|DC)\s*/;
// Lines that are clearly headers or annotation noise, not company names.
// Checked AFTER null-byte stripping so patterns are plain ASCII.
const NOISE_LINE_RE = /^(?:ID\s*Owner|Asset\s*Transaction|Type$|Date\s*Notification|Amount\s*Cap|Gains|F\s+[SI]|S\s+O\s*:|D\s*:|I\s+V\s+|Filing\s+ID|For\s+the\s+complete|\*\s+For|\$200\??$|Gains\s*>\s*\$)/i;

function cleanName(raw) {
  if (!raw) return null;
  let s = raw
    .replace(OWNER_PREFIX_RE, '')         // strip JT, SP, DE, DC owner prefix
    .replace(/\s*\[[A-Z]{2}\]\s*$/, '')   // strip trailing [CODE]
    .replace(/\s*\([A-Z][A-Z0-9]{0,5}\)\s*$/, '') // strip trailing (TICKER)
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[-–—]+$/, '')               // trailing dashes from line-wrap
    .trim();
  return s.length > 1 ? s : null;
}

function parseDate(s) {
  if (!s) return null;
  s = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // already ISO
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function parseTxType(c) {
  if (!c) return null;
  switch (c.trim().charAt(0).toUpperCase()) {
    case 'S': return 'sell';
    case 'P': return 'buy';
    case 'E': return 'exchange';
    default:  return null;
  }
}

function cleanAmount(raw) {
  if (!raw) return null;
  // Join multi-line split: "$15,001 -\n$50,000" → "$15,001 - $50,000"
  return raw.replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── Core parse functions ─────────────────────────────────────────────────────

/**
 * PTR Format — Periodic Transaction Report
 *
 * Block structure (one trade):
 *   [optional continuation of prev company name]
 *   [optional owner: SP/JT/DE/DC] COMPANY NAME (TICKER) [CODE]   — or split across two lines
 *   TX_TYPE [(partial)] DATE1 DATE2   $AMT_LO - \n? $AMT_HI
 *
 * Strategy: anchor on the TX line which starts with [SPE] immediately followed
 * by an optional annotation and then MM/DD/YYYY date. This is highly distinctive.
 * Then look back 5 lines for the [CODE] and company context.
 */
function parsePtrBlocks(text) {
  const trades = [];

  // TX line anchor: line starting with S/P/E followed by an optional note and two dates.
  // Capture: (1) tx type char  (2) transaction date  (3) notification date
  //          (4) amount (possibly crossing next line for split variant)
  // Notification date is captured solely to use in the dedup key; it is not output.
  const TX_RE = /^([SPE])(?:\s*\([^)]*\))?\s*(\d{1,2}\/\d{1,2}\/\d{4})(\d{1,2}\/\d{1,2}\/\d{4})\s*(\$[\d,]+\s*-\s*\$[\d,]+)/mg;
  // Variant for split amount across two lines
  const TX_SPLIT_RE = /^([SPE])(?:\s*\([^)]*\))?\s*(\d{1,2}\/\d{1,2}\/\d{4})(\d{1,2}\/\d{1,2}\/\d{4})\s*(\$[\d,]+\s*-)\s*\n\s*(\$[\d,]+)/mg;

  // Run split variant first so it wins over the non-split (both patterns may match start)
  const splitMatches = new Set();

  let m;
  // Pass 1: split amounts
  while ((m = TX_SPLIT_RE.exec(text)) !== null) {
    const amount   = cleanAmount(`${m[4]} ${m[5]}`);
    const notifDate = m[3];  // notification date — used in dedup key only
    const info     = lookBackForAsset(text, m.index);
    if (!info) continue;

    splitMatches.add(m.index);
    trades.push({
      ticker:           info.ticker,
      company_name:     info.company,
      transaction_type: parseTxType(m[1]),
      amount_range:     amount,
      transaction_date: parseDate(m[2]),
      asset_type:       inferAssetType(info.code, info.company),
      _notif:           notifDate,  // stripped before output
    });
  }

  // Pass 2: inline amounts
  while ((m = TX_RE.exec(text)) !== null) {
    if (splitMatches.has(m.index)) continue; // already captured by split pass
    const notifDate = m[3];
    const info = lookBackForAsset(text, m.index);
    if (!info) continue;

    trades.push({
      ticker:           info.ticker,
      company_name:     info.company,
      transaction_type: parseTxType(m[1]),
      amount_range:     cleanAmount(m[4]),
      transaction_date: parseDate(m[2]),
      asset_type:       inferAssetType(info.code, info.company),
      _notif:           notifDate,
    });
  }

  return trades;
}

/**
 * Look back from a TX anchor position to find the asset block above it.
 * Returns { ticker, company, code } or null if lines look like pure headers.
 */
function lookBackForAsset(text, txPos) {
  // Take the preceding 350 chars, split into lines
  const before = text.slice(Math.max(0, txPos - 350), txPos);
  const lines  = before.split('\n').map(l => l.trim()).filter(Boolean);

  // Walk backwards to find the last [CODE] and (TICKER) before it
  let code   = null;
  let ticker = null;
  let codeLineIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];

    // Find [CODE] pattern
    if (!code) {
      const cm = line.match(/\[([A-Z]{2})\]/);
      if (cm) {
        code       = cm[1];
        codeLineIdx = i;
      }
    }

    // Find (TICKER) — must be a 1-5 uppercase letter code (not fund manager names)
    if (!ticker && code) {
      const tm = line.match(/\(([A-Z][A-Z0-9]{0,4})\)/g);
      if (tm) {
        // Take the last one on the line (some lines have multiple parens)
        const last = tm[tm.length - 1].match(/\(([A-Z][A-Z0-9]{0,4})\)/);
        if (last) ticker = last[1];
      }
    }

    if (code && ticker) break;
    // Don't look further back than 5 lines from [CODE]
    if (code && codeLineIdx - i > 4) break;
  }

  if (!code) return null;

  // Build company name from lines around the [CODE] line
  // Lines from (codeLineIdx-2) to codeLineIdx inclusive, filtered for noise
  const startIdx  = Math.max(0, codeLineIdx - 2);
  const nameLines = lines.slice(startIdx, codeLineIdx + 1)
    .filter(l => !NOISE_LINE_RE.test(l))
    .map(l => l
      .replace(/\[[A-Z]{2}\]/g, '')              // strip [CODE]
      .replace(/\([A-Z][A-Z0-9]{0,4}\)\s*$/, '') // strip (TICKER)
      .replace(OWNER_PREFIX_RE, '')               // strip owner prefix
      .trim()
    )
    .filter(l => l.length > 1);

  const company = cleanName(nameLines.join(' ')) || null;

  return { ticker: ticker || null, company, code };
}

/**
 * FDR Section B — Financial Disclosure Report inline format
 *
 * Each row: ASSET_NAME [CODE] [OWNER?] DATE TX_TYPE $AMT - $AMT
 * The whole row may appear on one line or wrap the amount.
 *
 * Only run when PTR pass returns nothing (FDR docs don't have the double-date pattern).
 */
function parseFdrSection(text) {
  const trades = [];

  // Pattern: text before [CODE], then optional owner (SP/JT), then date, tx type, amount
  const FDR_RE = /([^\n\[]{3,100})\[([A-Z]{2})\]\s*(?:SP|JT|DE|DC)?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*([SPE])\s*(\$[\d,]+\s*-\s*\$[\d,]+)/g;
  const FDR_SPLIT_RE = /([^\n\[]{3,100})\[([A-Z]{2})\]\s*(?:SP|JT|DE|DC)?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*([SPE])\s*(\$[\d,]+\s*-)\s*\n\s*(\$[\d,]+)/g;

  let m;

  const splitPos = new Set();

  while ((m = FDR_SPLIT_RE.exec(text)) !== null) {
    splitPos.add(m.index);
    const rawName = m[1];
    const code    = m[2];
    const tickerM = rawName.match(/\(([A-Z][A-Z0-9]{0,4})\)\s*$/);
    trades.push({
      ticker:           tickerM ? tickerM[1] : null,
      company_name:     cleanName(rawName),
      transaction_type: parseTxType(m[4]),
      amount_range:     cleanAmount(`${m[5]} ${m[6]}`),
      transaction_date: parseDate(m[3]),
      asset_type:       inferAssetType(code, rawName),
    });
  }

  while ((m = FDR_RE.exec(text)) !== null) {
    if (splitPos.has(m.index)) continue;
    const rawName = m[1];
    const code    = m[2];
    const tickerM = rawName.match(/\(([A-Z][A-Z0-9]{0,4})\)\s*$/);
    trades.push({
      ticker:           tickerM ? tickerM[1] : null,
      company_name:     cleanName(rawName),
      transaction_type: parseTxType(m[4]),
      amount_range:     cleanAmount(m[5]),
      transaction_date: parseDate(m[3]),
      asset_type:       inferAssetType(code, rawName),
    });
  }

  return trades.filter(t => t.transaction_type && t.transaction_date);
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Deduplicate using ticker + date + notification-date + amount as the key.
 * Two trades with the same stock/date/amount can be legitimately distinct if
 * they have different notification dates (filed separately). Using only
 * transaction date would incorrectly collapse those rows.
 * Strips the internal _notif helper field before returning.
 */
function dedup(trades) {
  const seen = new Set();
  return trades
    .filter(t => {
      const key = `${t.ticker}|${t.transaction_type}|${t.transaction_date}|${t._notif || ''}|${t.amount_range}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ _notif, ...rest }) => rest); // strip internal helper field
}

// ─── Text normalisation ───────────────────────────────────────────────────────

/**
 * Strip null bytes and normalise whitespace before any regex work.
 * PTR PDFs from disclosures-clerk.house.gov embed null bytes ( ) between
 * characters in obfuscated/redacted label text (e.g. "F\0I\0L\0I\0N\0G\0").
 * Those bytes contaminate company name lookbacks if not removed first.
 */
function normalisePdfText(raw) {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/ /g, '')  // remove null bytes embedded in redacted label text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/ \n/g, '\n');
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse raw PDF text into structured trade records.
 * Tries PTR format first; falls back to FDR inline format.
 * Returns [] if no trades are found — never throws.
 */
function parsePdfText(text) {
  if (!text || !text.trim()) return [];
  const norm = normalisePdfText(text);

  // Try PTR format (has double-date pattern)
  const ptrTrades = parsePtrBlocks(norm);
  if (ptrTrades.length > 0) {
    return dedup(ptrTrades.filter(t => t.transaction_type && t.transaction_date && t.amount_range));
  }

  // Fall back to FDR Section B inline format
  const fdrTrades = parseFdrSection(norm);
  return dedup(fdrTrades.filter(t => t.transaction_type && t.transaction_date && t.amount_range));
}

// ─── Firestore runner ─────────────────────────────────────────────────────────

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function processDocument(db, doc) {
  const data       = doc.data();
  const docId      = doc.id;
  const memberName = data.member_name || data.last_name || docId;
  const url        = data.document_url;

  if (!url) {
    return { docId, status: 'skipped', reason: 'no document_url' };
  }

  // Already successfully parsed with trades → skip
  if (Array.isArray(data.parsed_trades) && data.parsed_trades.length > 0) {
    return { docId, status: 'skipped', reason: 'already_parsed' };
  }
  // Confirmed empty by a previous local-parse run → skip
  if (Array.isArray(data.parsed_trades) && data.parse_error === null && data.parsed_by === 'local') {
    return { docId, status: 'skipped', reason: 'confirmed_empty' };
  }

  let pdfText;
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_MS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CivicVoiceEngine/1.0)',
        'Referer':    'https://disclosures-clerk.house.gov/',
      },
    });
    const parsed = await pdfParse(Buffer.from(resp.data));
    pdfText = parsed.text || '';
  } catch (err) {
    console.warn(`[local-parser] ${docId}: PDF fetch/parse failed — ${err.message}`);
    await db.collection(COLLECTION).doc(docId).update({
      parsed_trades:      [],
      parse_error:        err.message,
      parse_attempted_at: new Date().toISOString(),
      parsed_by:          'local',
    });
    return { docId, status: 'error', reason: err.message };
  }

  if (!pdfText.trim()) {
    await db.collection(COLLECTION).doc(docId).update({
      parsed_trades:      [],
      parse_error:        'empty PDF text',
      parse_attempted_at: new Date().toISOString(),
      parsed_by:          'local',
    });
    return { docId, status: 'empty' };
  }

  const trades = parsePdfText(pdfText);

  await db.collection(COLLECTION).doc(docId).update({
    parsed_trades:      trades,
    parse_error:        null,
    parse_attempted_at: new Date().toISOString(),
    parsed_by:          'local',
  });

  if (trades.length > 0) {
    console.log(`[local-parser] ${docId} (${memberName}): ${trades.length} trades`);
  }
  return { docId, status: 'ok', tradeCount: trades.length };
}

async function runWithConcurrency(tasks, limit) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Process all Firestore member_stock_trades docs that:
 *   (a) have never been attempted (parse_attempted_at not set), OR
 *   (b) previously failed with a Claude API error
 *
 * Skips docs with confirmed trades or confirmed-empty from a prior local run.
 */
async function parseAllUnparsed() {
  const ts = new Date().toISOString();
  console.log('\n[local-parser] Starting — processing unparsed + Claude-errored docs…');

  const db   = getDb();
  const snap = await db.collection(COLLECTION).get();

  const targets = snap.docs.filter(doc => {
    const d = doc.data();
    // Already has trades → skip
    if (Array.isArray(d.parsed_trades) && d.parsed_trades.length > 0) return false;
    // Confirmed empty by a prior local run → skip
    if (d.parsed_by === 'local' && d.parse_error === null) return false;
    // Never attempted → include
    if (!d.parse_attempted_at) return true;
    // Previously failed with Claude API error → include (retry locally)
    if (d.parse_error && d.parse_error.includes('Claude')) return true;
    return false;
  });

  console.log(`[local-parser] ${snap.size} total docs — ${targets.length} to process`);

  const tasks = targets.map(doc => () => processDocument(db, doc));
  const results = await runWithConcurrency(tasks, CONCURRENCY);

  const ok      = results.filter(r => r.status === 'ok');
  const withTrades = ok.filter(r => r.tradeCount > 0);
  const empty   = [...results.filter(r => r.status === 'empty'), ...ok.filter(r => r.tradeCount === 0)];
  const errors  = results.filter(r => r.status === 'error');
  const skipped = results.filter(r => r.status === 'skipped');
  const totalTrades = ok.reduce((s, r) => s + (r.tradeCount || 0), 0);

  console.log('\n[local-parser] Done.');
  console.log(`  With trades:   ${withTrades.length} docs (${totalTrades} trades)`);
  console.log(`  Empty PDF:     ${empty.length} docs`);
  console.log(`  Errors:        ${errors.length} docs`);
  console.log(`  Skipped:       ${skipped.length} docs`);

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'US-House',
    data_pull_timestamp: ts,
    source_endpoint:     'local-pdf-parser/regex',
    record_count:        ok.length,
    import_status:       errors.length === 0 ? 'success' : 'partial',
    error_message:       errors.length ? `${errors.length} fetch errors` : null,
    scheduler_tier:      SCHEDULER_TIER,
  });

  return { processed: ok.length, withTrades: withTrades.length, empty: empty.length, errors: errors.length, totalTrades };
}

module.exports = { parsePdfText, parseAllUnparsed };

if (require.main === module) {
  parseAllUnparsed()
    .then(r => { console.log('[local-parser] Complete:', r); process.exit(0); })
    .catch(e => { console.error('[local-parser] Fatal:', e.message); process.exit(1); });
}
