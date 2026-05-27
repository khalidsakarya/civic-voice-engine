'use strict';
/**
 * tmp_us_mi_whitmer_assets_patch.js
 *
 * Adds declared_assets, real_estate, business_interests, gifts, and data_note
 * to subnational_leader_transparency/US-MI for Governor Gretchen Whitmer.
 *
 * declared_assets: named Vanguard fund values confirmed from 2024 PFD (CY 2023,
 *   filed April 15 2024). Whitmer voluntarily disclosed exact dollar amounts;
 *   form only requires ranges. ~11 additional unnamed accounts (deferred-comp,
 *   401(k), ETF/index/mutual funds) bring CY 2024 total to ~$2.5M.
 *
 * Sources:
 *   Bridge Michigan April 15 2024 — 2024 PFD (CY 2023) details
 *   Bridge Michigan June 2025     — 2025 PFD (CY 2024) Cascade Township addition
 *   Detroit News June 13 2025     — Cascade Township property confirmed
 *
 * Merge only. All other fields from prior patch untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL_2024 = 'https://bridgemi.com/michigan-government/whitmer-worth-23-million-new-michigan-disclosure-filings-lack-details/';
const SOURCE_URL_2025 = 'https://bridgemi.com/michigan-government/tech-flaws-weak-rules-mar-michigan-system-shine-light-lawmaker-conflicts/';

// ─── Declared assets ─────────────────────────────────────────────────────────
// Named fund values confirmed from 2024 PFD (CY 2023). Whitmer voluntarily
// provided exact dollar amounts — Michigan PFD form only requires value ranges.
// ~11 additional accounts (7 deferred-comp/401(k) + 4 ETF/index/mutual funds)
// are disclosed on the form but not individually named in public reporting.
// CY 2024 total (2025 PFD, filed June 2025): ~$2.5M.
const DECLARED_ASSETS = {
  period:           'Calendar year 2023 (named values); CY 2024 total approximate',
  source_url:       SOURCE_URL_2024,
  filing_year:      2024,
  fetched_at:       NOW,
  total_named:      1659402,
  total_approx_cy2023: 2300000,
  total_approx_cy2024: 2500000,
  currency:         'USD',
  notes:            'Named fund values from 2024 PFD (CY 2023). Whitmer voluntarily disclosed exact dollar amounts; form requires ranges only. ~11 additional unnamed accounts (7 deferred-comp/401(k), 4 ETF/index/mutual funds) also disclosed on form. CY 2024 total ~$2.5M per 2025 PFD (filed June 13 2025).',
  named_funds: [
    {
      name:        'Vanguard Total Stock Market Index Fund Admiral Shares',
      ticker:      'VTSAX',
      value:       1003294,
      filing_year: 2024,
    },
    {
      name:        'Vanguard Intermediate-Term Tax-Exempt Fund Admiral Shares',
      ticker:      'VWIUX',
      value:       382135,
      filing_year: 2024,
    },
    {
      name:        'Vanguard 500 Index Fund Admiral Shares',
      ticker:      'VFIAX',
      value:       273973,
      filing_year: 2024,
    },
  ],
  unnamed_accounts: {
    count_approx: '~11',
    types:        ['Deferred compensation', '401(k)', 'ETF/index/mutual funds'],
    notes:        'Disclosed on Michigan PFD form but not individually named in public reporting.',
  },
};

// ─── Real estate ─────────────────────────────────────────────────────────────
const REAL_ESTATE = {
  fetched_at: NOW,
  notes:      'Cottage confirmed in 2024 PFD (CY 2023). Cascade Township parcel confirmed in 2025 PFD (CY 2024, filed June 13 2025). Cascade parcel held via unnamed LLC formed for this purchase.',
  properties: [
    {
      description: 'Cottage, Elk Rapids, Michigan',
      value:       418200,
      currency:    'USD',
      ownership:   'Full ownership',
      filing_year: 2024,
      source_url:  SOURCE_URL_2024,
    },
    {
      description: 'Lakefront parcel (~3 acres), Cascade Township, Kent County, Michigan',
      value:       399000,
      currency:    'USD',
      ownership:   'Held through unnamed LLC formed for this purchase',
      filing_year: 2025,
      source_url:  SOURCE_URL_2025,
    },
  ],
};

// ─── Business interests ───────────────────────────────────────────────────────
const BUSINESS_INTERESTS = {
  fetched_at: NOW,
  notes:      'Michigan PFD requires entity name; income/value amounts not required for LLC holdings. Book income from True Gretch (and teen edition) not separately itemized — flows through Super Deluxe LLC. Contrasts with SOS Benson who disclosed $65,000 directly from Penguin Random House.',
  entities: [
    {
      name:        'Super Deluxe LLC',
      description: 'Manages governor\'s personal affairs and book earnings ("True Gretch"; revised teen edition). Created November 2023 by attorney Christopher Trebilcock.',
      filing_year: 2024,
      source_url:  'https://www.detroitnews.com/story/news/politics/2024/04/15/gretchen-whitmer-millionaire-family-office-company-super-deluxe-personal-financial-disclosure-bills/73334696007/',
    },
    {
      name:        'Unnamed LLC (Cascade Township property)',
      description: 'Formed to acquire ~3-acre lakefront parcel in Cascade Township, Kent County for $399,000.',
      filing_year: 2025,
      source_url:  SOURCE_URL_2025,
    },
  ],
};

// ─── Gifts ────────────────────────────────────────────────────────────────────
// From 2024 PFD (CY 2023). Michigan PFD threshold: gifts >$50 aggregate per source.
const GIFTS = {
  period:      'Calendar year 2023',
  source_url:  SOURCE_URL_2024,
  filing_year: 2024,
  fetched_at:  NOW,
  notes:       'From 2024 PFD (CY 2023 first filing). Michigan PFD threshold: >$50 aggregate per source per calendar year. CY 2024 gifts not available — 2025 PFD content inaccessible (michigan.gov 403).',
  items: [
    {
      source:      'Blue Cross Blue Shield of Michigan',
      amount:      127,
      currency:    'USD',
      description: 'Food and beverages',
    },
    {
      source:      'Battle Creek Unlimited Inc.',
      amount_note: 'Less than $76',
      currency:    'USD',
      description: 'Meal during Make it in Michigan Airport tour',
    },
  ],
};

// ─── Data note ────────────────────────────────────────────────────────────────
const DATA_NOTE =
  'Bridge Michigan (April 2024) noted that Whitmer voluntarily disclosed exact dollar ' +
  'amounts for her investment holdings instead of just the value ranges required by the ' +
  'Michigan PFD form. This makes her filing more transparent than the statutory minimum. ' +
  'By contrast, she declined to disclose her $159,300 governor salary on the form ' +
  '(not legally required) and did not itemize book income separately (routed through ' +
  'Super Deluxe LLC). Secretary of State Benson disclosed $65,000 from Penguin Random ' +
  'House directly on her form.';

function print() {
  console.log('\n[US-MI Whitmer Assets Patch]');
  console.log('Adds declared_assets, real_estate, business_interests, gifts, data_note\n');

  console.log('declared_assets (' + DECLARED_ASSETS.named_funds.length + ' named funds):');
  for (const f of DECLARED_ASSETS.named_funds)
    console.log('  ' + f.ticker + ': $' + f.value.toLocaleString());
  console.log('  Named total:   $' + DECLARED_ASSETS.total_named.toLocaleString());
  console.log('  CY 2023 total: ~$' + (DECLARED_ASSETS.total_approx_cy2023 / 1e6).toFixed(1) + 'M');
  console.log('  CY 2024 total: ~$' + (DECLARED_ASSETS.total_approx_cy2024 / 1e6).toFixed(1) + 'M');
  console.log('  + ~11 unnamed accounts (deferred-comp / 401k / ETF)');

  console.log('\nreal_estate (' + REAL_ESTATE.properties.length + ' properties):');
  for (const p of REAL_ESTATE.properties)
    console.log('  - ' + p.description + ': $' + p.value.toLocaleString() + ' (FY' + p.filing_year + ')');

  console.log('\nbusiness_interests (' + BUSINESS_INTERESTS.entities.length + ' entities):');
  for (const e of BUSINESS_INTERESTS.entities)
    console.log('  - ' + e.name + ' (FY' + e.filing_year + ')');

  console.log('\ngifts (' + GIFTS.items.length + ' items, CY 2023):');
  for (const g of GIFTS.items)
    console.log('  - ' + g.source + ': ' + (g.amount ? '$' + g.amount : g.amount_note));

  console.log('\ndata_note: ' + DATA_NOTE.substring(0, 100) + '...');
}

async function main() {
  console.log('\n[us-mi-whitmer-assets] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-mi-whitmer-assets] DRY RUN — no writes.');
    console.log('[us-mi-whitmer-assets] To apply: node tmp_us_mi_whitmer_assets_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-MI').set(
    {
      declared_assets:    DECLARED_ASSETS,
      real_estate:        REAL_ESTATE,
      business_interests: BUSINESS_INTERESTS,
      gifts:              GIFTS,
      data_note:          DATA_NOTE,
      last_updated:       NOW,
    },
    { merge: true }
  );

  console.log('\n[us-mi-whitmer-assets] ✅ subnational_leader_transparency/US-MI updated.');
  console.log('[us-mi-whitmer-assets] Done.');
}

main().catch(e => { console.error('[us-mi-whitmer-assets] Fatal:', e.message); process.exit(1); });
