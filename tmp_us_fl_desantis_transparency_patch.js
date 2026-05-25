'use strict';
/**
 * tmp_us_fl_desantis_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-FL
 * with confirmed facts extracted from Governor DeSantis's 2024 Form 6 Full and Public
 * Disclosure of Financial Interests (EFDMS Filing ID 1042280, filed July 1, 2025).
 *
 * Source:
 *   Florida EFDMS Filing 1042280
 *   https://disclosure.floridaethics.gov/api/Report/RenderPdf/1042280/False
 *   Filer: Hon Ronald Dion DeSantis (PID 275100)
 *   Submitted: 2025-07-01 | Form year: 2024 | 4 pages, digitally typed
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL  = 'https://disclosure.floridaethics.gov/api/Report/RenderPdf/1042280/False';
const FILING_ID   = 1042280;
const PERIOD_EOY  = 'As of December 31, 2024';
const PERIOD_YEAR = 'Calendar year 2024';

// ─── Salary ──────────────────────────────────────────────────────────────────
const SALARY = {
  amount:     141400.20,
  currency:   'USD',
  period:     PERIOD_YEAR,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  notes:      'State of Florida gubernatorial salary per 2024 Form 6, primary income source. Governor DeSantis also received $625,500 from HarperCollins Publishers LLC (book royalties) — see income field.',
  fetched_at: NOW,
};

// ─── Declared assets (Form 6 Part I — Assets over $1,000) ───────────────────
const DECLARED_ASSETS = {
  period:     PERIOD_EOY,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  status:     'filed',
  assets: [
    {
      description: 'Savings Account (IBKR / Interactive Brokers)',
      value:       1312874.00,
      currency:    'USD',
    },
    {
      description: 'Checking and Savings Bank Accounts (USAA)',
      value:       573108.93,
      currency:    'USD',
    },
    {
      description: 'FRS — Retirement Date Fund 2045',
      value:       116859.08,
      currency:    'USD',
    },
    {
      description: 'Thrift Savings Plan',
      value:       99803.40,
      currency:    'USD',
    },
  ],
  notes: 'Household goods and personal effects: N/A. No real estate disclosed — governor resides at the Florida Governor\'s Mansion. No stock holdings or business interests disclosed.',
};

// ─── Liabilities (Form 6 Part II — Liabilities over $1,000) ─────────────────
const LIABILITIES = {
  period:     PERIOD_EOY,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  liabilities: [
    {
      creditor: 'Mohela/Navient',
      address:  '633 Spirit Drive, Chesterfield, MO 63005-1243',
      amount:   15095.09,
      currency: 'USD',
      notes:    'Student loan',
    },
  ],
  joint_and_several: [],
};

// ─── Income (Form 6 Part III — Sources over $1,000) ──────────────────────────
const INCOME = {
  period:     PERIOD_YEAR,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  primary_sources: [
    {
      name:     'State of Florida',
      address:  'The Capitol, Tallahassee, FL 32399',
      amount:   141400.20,
      currency: 'USD',
    },
    {
      name:     'HarperCollins Publishers LLC',
      address:  '195 Broadway, New York, NY 10007',
      amount:   625500.00,
      currency: 'USD',
      notes:    'Book royalties',
    },
  ],
  secondary_sources:  [],
  business_interests: [],
};

// ─── Net worth declared ───────────────────────────────────────────────────────
const NET_WORTH_DECLARED = {
  amount:     2087550.32,
  currency:   'USD',
  as_of_date: '2024-12-31',
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
};

// ─── Fields to DELETE (all previous framework-only placeholders) ──────────────
const FIELDS_TO_REMOVE = [
  'lobbying_records',
  'stock_holdings',
  'recent_official_activity',
  'sections_available',
  'data_completeness_note',
  'contact_info',
  'transparency_live',
  'financial_disclosure',
  'sections_unavailable',
  'regulatory_body',
  'sources_confirmed',
  'regulatory_act',
  'gifts_hospitality',
  'campaign_finance',
  'sources_inaccessible',
  'field_sources',
  'transparency_fetched_at',
];

function buildDeleteMap(fields) {
  const map = {};
  for (const f of fields) map[f] = FieldValue.delete();
  return map;
}

function print() {
  console.log('\n[US-FL DeSantis Transparency Patch]');

  console.log('\nFields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  amount:  $' + SALARY.amount.toLocaleString());
  console.log('  period:  ' + SALARY.period);

  console.log('\ndeclared_assets (' + DECLARED_ASSETS.assets.length + ' items):');
  for (const a of DECLARED_ASSETS.assets)
    console.log('  - ' + a.description + ': $' + a.value.toLocaleString());

  console.log('\nliabilities (' + LIABILITIES.liabilities.length + ' items):');
  for (const l of LIABILITIES.liabilities)
    console.log('  - ' + l.creditor + ': $' + l.amount.toLocaleString());

  console.log('\nincome (' + INCOME.primary_sources.length + ' primary sources):');
  for (const s of INCOME.primary_sources)
    console.log('  - ' + s.name + ': $' + s.amount.toLocaleString());

  console.log('\nnet_worth_declared: $' + NET_WORTH_DECLARED.amount.toLocaleString() + ' as of ' + NET_WORTH_DECLARED.as_of_date);
  console.log('source_url:', SOURCE_URL);
  console.log('status: filed | filing_year: 2024');
}

async function main() {
  console.log('\n[us-fl-desantis] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-fl-desantis] DRY RUN — no writes.');
    console.log('[us-fl-desantis] To apply: node tmp_us_fl_desantis_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-FL').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:              SALARY,
      declared_assets:     DECLARED_ASSETS,
      liabilities:         LIABILITIES,
      income:              INCOME,
      net_worth_declared:  NET_WORTH_DECLARED,
      source_url:          SOURCE_URL,
      status:              'filed',
      filing_year:         2024,
      last_updated:        NOW,
    },
    { merge: true }
  );

  console.log('\n[us-fl-desantis] ✅ subnational_leader_transparency/US-FL updated.');
  console.log('[us-fl-desantis] Done.');
}

main().catch(e => { console.error('[us-fl-desantis] Fatal:', e.message); process.exit(1); });
