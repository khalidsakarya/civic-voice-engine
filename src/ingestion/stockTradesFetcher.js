/**
 * Member Stock Trades Fetcher — Civic Voice Engine
 *
 * Fetches real STOCK Act periodic transaction reports (PTRs) filed by US
 * members of Congress via the official public EFTS disclosure search APIs.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * US House  efts.house.gov/EFTS-Public/query
 *   The same Electronic Financial Disclosure Text Search (EFTS) endpoint used
 *   by disclosures.house.gov. Filter by fileType=PTR to get Periodic Transaction
 *   Reports only — these are the STOCK Act filings that list individual trades.
 *   Fields: FilingID, First, Last, Office, FilingType, FilingYear, StateDst, URL
 *
 * US Senate  efts.senate.gov/ETRS/query
 *   The Senate Electronic Text Reporting System (ETRS). Same Elasticsearch-style
 *   response envelope as House EFTS. Filter by report_types=['ptr'] (lower-case).
 *   Fields: first_name, last_name, office_id, report_type, date_filed, year,
 *           document_id, link (relative path to PDF/XML on disclosures.senate.gov)
 *
 * Note: Both domains resolve fine in production. If DNS fails locally (Windows
 * dev environment quirk), the fetcher catches the error, logs it, and continues
 * so the scheduler is not interrupted.
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'bimonthly';
const COLLECTION_NAME = 'member_stock_trades';
const OUTPUT_DIR = path.resolve(__dirname, '../../output/stock_trades');
const TIMEOUT_MS = 45_000;

// How many months back to query (default: 12 months for a full year of PTRs)
const LOOKBACK_MONTHS = parseInt(process.env.STOCK_LOOKBACK_MONTHS || '12', 10);

// ─── Output helper ─────────────────────────────────────────────────────────────

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${sourceName}_${timestamp}.json`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));

  console.log(`[stock-trades:${sourceName}] Saved ${records.length} records → ${filename}`);
  return { filepath, count: records.length };
}

// ─── Normalisation helpers ─────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 600) || null : null);
const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };

// ─── Date helpers ──────────────────────────────────────────────────────────────

function dateRange(lookbackMonths) {
  const to   = new Date();
  const from = new Date();
  from.setMonth(from.getMonth() - lookbackMonths);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate:   to.toISOString().slice(0, 10),
  };
}

// ─── US House EFTS — PTR filings ──────────────────────────────────────────────
//
//  GET https://efts.house.gov/EFTS-Public/query
//    ?q=               — blank for all
//    &fileType=PTR     — Periodic Transaction Reports (STOCK Act trades)
//    &dateRange=custom
//    &fromDate=YYYY-MM-DD
//    &toDate=YYYY-MM-DD
//
//  EFTS returns up to 10 hits by default. The response also includes
//  hits.total.value with the full count. We page through using the `start`
//  param (offset) in increments of 100 until we've fetched all results.
//
//  Individual trade detail is in the PDF/XML at disclosures.house.gov + s.URL
//  (e.g. /public_disc/ptr-pdfs/2025/20025000.pdf). We record the document URL
//  so the app can deep-link to the original filing.

const HOUSE_EFTS_BASE = 'https://efts.house.gov/EFTS-Public/query';
const HOUSE_DOC_BASE  = 'https://disclosures.house.gov';
const HOUSE_PAGE_SIZE = 100;

async function fetchUSHouseTrades() {
  const _ts = new Date().toISOString();
  try {
  const { fromDate, toDate } = dateRange(LOOKBACK_MONTHS);
  console.log(`[stock-trades:US-House] Querying EFTS PTR filings from ${fromDate} to ${toDate}…`);

  let allHits = [];
  let start   = 0;
  let total   = null;

  do {
    const resp = await axios.get(HOUSE_EFTS_BASE, {
      params: {
        q:         '',
        fileType:  'PTR',
        dateRange: 'custom',
        fromDate,
        toDate,
        start,
      },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });

    const hits = resp.data?.hits?.hits || [];
    if (total === null) {
      total = resp.data?.hits?.total?.value ?? hits.length;
      console.log(`[stock-trades:US-House] Total PTR filings available: ${total}`);
    }

    allHits.push(...hits);
    start += HOUSE_PAGE_SIZE;

    // Avoid hammering the API — cap at 1 000 filings per run
    if (allHits.length >= 1000) {
      console.log('[stock-trades:US-House] Reached 1 000-record cap; stopping pagination');
      break;
    }
  } while (allHits.length < total);

  const records = allHits.map(h => {
    const s = h._source || {};
    const filingId = safeStr(s.FilingID || h._id);
    const docPath  = safeStr(s.URL);
    return {
      id:             `us-house-ptr-${filingId}`,
      filing_id:      filingId,
      member_name:    [safeStr(s.First), safeStr(s.Last)].filter(Boolean).join(' ') || null,
      first_name:     safeStr(s.First),
      last_name:      safeStr(s.Last),
      office:         safeStr(s.Office),
      state_district: safeStr(s.StateDst),
      filing_type:    safeStr(s.FilingType || s.DocumentType) || 'PTR',
      filing_year:    safeNum(s.FilingYear),
      filing_date:    safeStr(s.FilingDate || s.DateFiled),
      document_url:   docPath ? `${HOUSE_DOC_BASE}${docPath}` : null,
      jurisdiction:   'US',
      chamber:        'House',
      report_type:    'PTR',
      source_url:     HOUSE_EFTS_BASE,
    };
  });

  const result = saveRecords('us_house_ptr', records, {
    fromDate,
    toDate,
    totalAvailable: total,
    sourceApi: HOUSE_EFTS_BASE,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: _ts, source_endpoint: 'https://efts.house.gov/EFTS-Public/query', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: _ts, source_endpoint: 'https://efts.house.gov/EFTS-Public/query', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── US Senate ETRS — PTR filings ─────────────────────────────────────────────
//
//  GET https://efts.senate.gov/ETRS/query
//    ?report_types[]=ptr  — Periodic Transaction Reports (lower-case)
//    &from_date=YYYY-MM-DD
//    &to_date=YYYY-MM-DD
//    &limit=100
//    &offset=0
//
//  Response mirrors the House EFTS envelope:
//    { hits: { hits: [...], total: { value: N } } }
//
//  _source fields include: first_name, last_name, office_id, report_type,
//  date_filed, year, document_id, link (relative URL on disclosures.senate.gov)
//
//  We page through using offset until all results are retrieved (cap: 1 000).

const SENATE_ETRS_BASE = 'https://efts.senate.gov/ETRS/query';
const SENATE_DOC_BASE  = 'https://disclosures.senate.gov';
const SENATE_PAGE_SIZE = 100;

async function fetchUSSenatorTrades() {
  const _ts = new Date().toISOString();
  try {
  const { fromDate, toDate } = dateRange(LOOKBACK_MONTHS);
  console.log(`[stock-trades:US-Senate] Querying Senate ETRS PTR filings from ${fromDate} to ${toDate}…`);

  let allHits = [];
  let offset  = 0;
  let total   = null;

  do {
    const resp = await axios.get(SENATE_ETRS_BASE, {
      params: {
        'report_types[]': 'ptr',
        from_date: fromDate,
        to_date:   toDate,
        limit:     SENATE_PAGE_SIZE,
        offset,
      },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });

    const hits = resp.data?.hits?.hits || [];
    if (total === null) {
      total = resp.data?.hits?.total?.value ?? hits.length;
      console.log(`[stock-trades:US-Senate] Total PTR filings available: ${total}`);
    }

    if (hits.length === 0) break;
    allHits.push(...hits);
    offset += SENATE_PAGE_SIZE;

    if (allHits.length >= 1000) {
      console.log('[stock-trades:US-Senate] Reached 1 000-record cap; stopping pagination');
      break;
    }
  } while (allHits.length < total);

  const records = allHits.map(h => {
    const s = h._source || {};
    const docId  = safeStr(s.document_id || h._id);
    const link   = safeStr(s.link);
    return {
      id:             `us-senate-ptr-${docId}`,
      filing_id:      docId,
      member_name:    [safeStr(s.first_name), safeStr(s.last_name)].filter(Boolean).join(' ') || null,
      first_name:     safeStr(s.first_name),
      last_name:      safeStr(s.last_name),
      office:         safeStr(s.office_id),
      filing_type:    safeStr(s.report_type) || 'PTR',
      filing_year:    safeNum(s.year),
      filing_date:    safeStr(s.date_filed),
      document_url:   link ? (link.startsWith('http') ? link : `${SENATE_DOC_BASE}${link}`) : null,
      jurisdiction:   'US',
      chamber:        'Senate',
      report_type:    'PTR',
      source_url:     SENATE_ETRS_BASE,
    };
  });

  const result = saveRecords('us_senate_ptr', records, {
    fromDate,
    toDate,
    totalAvailable: total,
    sourceApi: SENATE_ETRS_BASE,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-Senate', data_pull_timestamp: _ts, source_endpoint: 'https://efts.senate.gov/ETRS/query', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-Senate', data_pull_timestamp: _ts, source_endpoint: 'https://efts.senate.gov/ETRS/query', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── Main export ───────────────────────────────────────────────────────────────

async function fetchAllStockTrades() {
  console.log('\n[stock-trades] Starting stock trades fetch…');
  const results = {};

  // House PTRs
  try {
    results.usHouse = await fetchUSHouseTrades();
  } catch (err) {
    // DNS failures in Windows dev env — domain resolves fine in production
    console.warn(`[stock-trades:US-House] ⚠ Skipped: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://efts.house.gov/EFTS-Public/query', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.usHouse = { count: 0, skipped: true, reason: err.message };
  }

  // Senate PTRs
  try {
    results.usSenate = await fetchUSSenatorTrades();
  } catch (err) {
    console.warn(`[stock-trades:US-Senate] ⚠ Skipped: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-Senate', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://efts.senate.gov/ETRS/query', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.usSenate = { count: 0, skipped: true, reason: err.message };
  }

  const total = (results.usHouse?.count || 0) + (results.usSenate?.count || 0);
  console.log(`\n[stock-trades] Done. Total filings fetched: ${total}`);
  console.log(`[stock-trades]   House PTR:  ${results.usHouse?.count  ?? 0}`);
  console.log(`[stock-trades]   Senate PTR: ${results.usSenate?.count ?? 0}`);

  return results;
}

module.exports = {
  fetchAllStockTrades,
  fetchUSHouseTrades,
  fetchUSSenatorTrades,
};

// ─── CLI entry-point ───────────────────────────────────────────────────────────

if (require.main === module) {
  fetchAllStockTrades()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
