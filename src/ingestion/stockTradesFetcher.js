/**
 * Member Stock Trades Fetcher — Civic Voice Engine
 *
 * Fetches real STOCK Act periodic transaction reports (PTRs) filed by US
 * members of Congress via the official public disclosure search endpoints.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * US House  disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult
 *   POST endpoint from the House Clerk's FinancialDisclosure system. Returns an
 *   HTML table of PTR filings filtered by year and report type.
 *   Params: LastName (blank = all), FilingYear, State, District, ReportType=P
 *   Row columns: Name (link to PDF), Office (state+district), Filing Year, Filing type
 *   PDF base: https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{id}.pdf
 *
 *   NOTE: efts.house.gov/EFTS-Public/query is NXDOMAIN as of 2026-05-02 — the old
 *   Elasticsearch-based EFTS was decommissioned.
 *
 * US Senate  efts.senate.gov/ETRS/query — DEAD as of 2026-05-02 (NXDOMAIN)
 *   ethics.senate.gov blocks programmatic access (Akamai WAF 403).
 *   efd.senate.gov requires filer authentication.
 *   Senate PTRs are currently not fetchable programmatically; skipped gracefully.
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

// ─── US House — PTR filings via ViewMemberSearchResult ────────────────────────
//
//  POST https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult
//    LastName=       — blank = all members
//    FilingYear=     — 4-digit year
//    State=          — blank = all states
//    District=       — blank = all districts
//    ReportType=P    — P = Periodic Transaction Report (PTR)
//
//  Returns an HTML page with a <tbody> table. Each row has four cells:
//    [0] Name — <a href="public_disc/ptr-pdfs/{year}/{id}.pdf">LastName, Title. First M.</a>
//    [1] Office — state+district code (e.g. "AL04")
//    [2] Filing Year
//    [3] Filing type (e.g. "PTR Original", "PTR Amendment")
//
//  We query all years from the lookback window and de-duplicate by filing_id.

const HOUSE_SEARCH_URL = 'https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult';
const HOUSE_DOC_BASE   = 'https://disclosures-clerk.house.gov';

function parseHouseSearchHtml(html, year) {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];

  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const records = [];

  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

    const linkMatch = row.match(/href="([^"]+\.pdf)"/i);
    if (!cells[0] || !linkMatch) continue;

    const pdfPath  = linkMatch[1];
    const idMatch  = pdfPath.match(/(\d+)\.pdf$/);
    const filingId = idMatch ? idMatch[1] : null;

    // Name format: "LastName, Hon.. FirstName M." — split on first comma
    const rawName   = cells[0].trim();
    const commaIdx  = rawName.indexOf(',');
    const lastName  = commaIdx > -1 ? rawName.slice(0, commaIdx).trim() : rawName;
    const firstPart = commaIdx > -1 ? rawName.slice(commaIdx + 1).replace(/Hon\.\.?\s*/i, '').trim() : '';
    const firstName = firstPart.replace(/\s+[A-Z]\.$/, '').trim() || null;

    records.push({
      id:           `us-house-ptr-${filingId}`,
      filing_id:    filingId,
      member_name:  rawName || null,
      first_name:   firstName,
      last_name:    safeStr(lastName) || null,
      office:       safeStr(cells[1]) || null,
      state_district: safeStr(cells[1]) || null,
      filing_type:  safeStr(cells[3]) || 'PTR',
      filing_year:  safeNum(cells[2] || year),
      filing_date:  null,
      document_url: pdfPath ? `${HOUSE_DOC_BASE}/${pdfPath}` : null,
      jurisdiction: 'US',
      chamber:      'House',
      report_type:  'PTR',
      source_url:   HOUSE_SEARCH_URL,
    });
  }

  return records;
}

async function fetchUSHouseTrades() {
  const _ts = new Date().toISOString();
  try {
    const currentYear = new Date().getFullYear();
    const startYear   = currentYear - Math.ceil(LOOKBACK_MONTHS / 12);
    const years       = [];
    for (let y = startYear; y <= currentYear; y++) years.push(y);

    console.log(`[stock-trades:US-House] Querying PTR filings for years: ${years.join(', ')}…`);

    const allRecords = [];
    const seenIds    = new Set();

    for (const year of years) {
      const resp = await axios.post(HOUSE_SEARCH_URL, new URLSearchParams({
        LastName:    '',
        FilingYear:  String(year),
        State:       '',
        District:    '',
        ReportType:  'P',
      }).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept':       'text/html',
          'Origin':       'https://disclosures-clerk.house.gov',
          'Referer':      'https://disclosures-clerk.house.gov/FinancialDisclosure',
        },
        timeout: TIMEOUT_MS,
      });

      const rows = parseHouseSearchHtml(resp.data, year);
      console.log(`[stock-trades:US-House] Year ${year}: ${rows.length} PTR rows`);

      for (const r of rows) {
        if (r.filing_id && seenIds.has(r.filing_id)) continue;
        if (r.filing_id) seenIds.add(r.filing_id);
        allRecords.push(r);
      }
    }

    console.log(`[stock-trades:US-House] Total PTR filings fetched: ${allRecords.length}`);

    const result = saveRecords('us_house_ptr', allRecords, {
      years,
      sourceUrl: HOUSE_SEARCH_URL,
    });
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: _ts, source_endpoint: HOUSE_SEARCH_URL, record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: _ts, source_endpoint: HOUSE_SEARCH_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── US Senate PTR filings — UNAVAILABLE ──────────────────────────────────────
//
//  efts.senate.gov/ETRS/query is NXDOMAIN as of 2026-05-02.
//  ethics.senate.gov (the public search UI) blocks all programmatic access via
//  Akamai WAF (403). efd.senate.gov requires filer authentication.
//  No public bulk-download alternative has been identified.
//
//  This function logs the skip to the audit log and returns 0 records until a
//  working Senate PTR source is identified.

const SENATE_ETRS_BASE = 'https://efts.senate.gov/ETRS/query'; // dead — kept for audit log reference

async function fetchUSSenatorTrades() {
  const _ts = new Date().toISOString();
  const reason = 'efts.senate.gov is NXDOMAIN (decommissioned); ethics.senate.gov blocks programmatic access via Akamai WAF — no public Senate PTR API available';
  console.warn('[stock-trades:US-Senate] ⚠ Skipped: ' + reason);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-Senate', data_pull_timestamp: _ts, source_endpoint: SENATE_ETRS_BASE, record_count: 0, import_status: 'skipped', error_message: reason, scheduler_tier: SCHEDULER_TIER });
  return { count: 0, skipped: true, reason };
}

// ─── Main export ───────────────────────────────────────────────────────────────

async function fetchAllStockTrades() {
  console.log('\n[stock-trades] Starting stock trades fetch…');
  const results = {};

  // House PTRs
  try {
    results.usHouse = await fetchUSHouseTrades();
  } catch (err) {
    console.warn(`[stock-trades:US-House] ⚠ Skipped: ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US-House', data_pull_timestamp: new Date().toISOString(), source_endpoint: HOUSE_SEARCH_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.usHouse = { count: 0, skipped: true, reason: err.message };
  }

  // Senate PTRs — skipped until a working public source is identified
  results.usSenate = await fetchUSSenatorTrades();

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
