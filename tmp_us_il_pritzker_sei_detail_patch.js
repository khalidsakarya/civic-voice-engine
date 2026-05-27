'use strict';
/**
 * tmp_us_il_pritzker_sei_detail_patch.js
 *
 * Adds SEI question-level detail to subnational_leader_transparency/US-IL:
 *   Q1  — Ownership interests / declared assets
 *   Q2  — Capital gains (assets sold in 2024) — structure only, dates TBD
 *   Debts, Gifts, Lobbyist relationships — all none declared
 *
 * Source: Illinois Secretary of State SEI, filed 2025-04-30
 *   https://apps.ilsos.gov/economicinterest/
 *   Illinois SEI lists entity names only — no dollar values per state law.
 *
 * Merge only — salary/blind_trust/income fields from prior patch untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL = 'https://apps.ilsos.gov/economicinterest/';
const SEI_NOTE   = 'Illinois SEI lists entity names only — no dollar values disclosed per state law.';

// ─── Q1: Declared assets / ownership interests ───────────────────────────────
// Part A — Publicly traded stocks (all 10 confirmed from 2025 SEI Q1)
const PUBLIC_STOCKS = [
  { entity: 'Apple Inc.' },
  { entity: 'Amazon.com Inc.' },
  { entity: 'Alphabet Inc.' },
  { entity: 'Berkshire Hathaway Inc.' },
  { entity: "McDonald's Corporation" },
  { entity: 'FedEx Corporation' },
  { entity: 'Meta Platforms Inc.' },
  { entity: 'The Walt Disney Company' },
  { entity: 'Kinder Morgan Inc.' },
  { entity: 'Procter & Gamble Co.' },
];

// Part B — Private equity / LLC holdings
// 300+ entities disclosed in the 2025 SEI Q1. Names on file with the Illinois
// Secretary of State; not individually enumerated here due to volume.
const PRIVATE_HOLDINGS = {
  count_approx: '300+',
  notes: '300+ private equity and LLC interests disclosed in Q1 of the 2025 SEI. Entity names are on file with the Illinois Secretary of State at apps.ilsos.gov/economicinterest/ (year 2025, name Pritzker). Illinois SEI lists names only — no valuations.',
};

const DECLARED_ASSETS = {
  period:          'As of filing date 2025-04-30',
  source_url:      SOURCE_URL,
  filing_year:     2025,
  fetched_at:      NOW,
  sei_question:    'Q1',
  notes:           SEI_NOTE,
  public_stocks:   PUBLIC_STOCKS,
  private_holdings: PRIVATE_HOLDINGS,
};

// ─── Q2: Capital gains — assets sold during calendar year 2024 ───────────────
// The 2025 SEI Q2 lists assets sold in 2024 with sale dates. Specific entries
// and dates to be added when Q2 row data is available.
const CAPITAL_GAINS_SALES = {
  period:       'Calendar year 2024',
  source_url:   SOURCE_URL,
  filing_year:  2025,
  fetched_at:   NOW,
  sei_question: 'Q2',
  notes:        'Q2 of the 2025 SEI lists assets sold during 2024 with sale dates. Specific entries not yet enumerated — to be updated with individual asset names and dates.',
  sales:        [],
};

// ─── Debts ────────────────────────────────────────────────────────────────────
const DEBTS = {
  period:       'As of filing date 2025-04-30',
  source_url:   SOURCE_URL,
  filing_year:  2025,
  fetched_at:   NOW,
  sei_question: 'Q3',
  debts:        [],
  notes:        'No debts declared.',
};

// ─── Gifts ────────────────────────────────────────────────────────────────────
const GIFTS = {
  period:       'Calendar year 2024',
  source_url:   SOURCE_URL,
  filing_year:  2025,
  fetched_at:   NOW,
  items:        [],
  notes:        'No gifts declared.',
};

// ─── Lobbyist relationships ───────────────────────────────────────────────────
const LOBBYIST_RELATIONSHIPS = {
  period:       'Calendar year 2024',
  source_url:   SOURCE_URL,
  filing_year:  2025,
  fetched_at:   NOW,
  relationships: [],
  notes:        'No lobbyist relationships declared.',
};

function print() {
  console.log('\n[US-IL Pritzker SEI Detail Patch]');
  console.log('Source: ILSOS SEI 2025 | Filed: 2025-04-30');

  console.log('\ndeclared_assets (Q1):');
  console.log('  public_stocks (' + PUBLIC_STOCKS.length + '):');
  for (const s of PUBLIC_STOCKS) console.log('    - ' + s.entity);
  console.log('  private_holdings: ' + PRIVATE_HOLDINGS.count_approx + ' entities (not individually enumerated)');

  console.log('\ncapital_gains_sales (Q2): structure filed — specific entries TBD');
  console.log('debts:                none declared');
  console.log('gifts:                none declared');
  console.log('lobbyist_relationships: none declared');
}

async function main() {
  console.log('\n[us-il-pritzker-detail] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-il-pritzker-detail] DRY RUN — no writes.');
    console.log('[us-il-pritzker-detail] To apply: node tmp_us_il_pritzker_sei_detail_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-IL').set(
    {
      declared_assets:        DECLARED_ASSETS,
      capital_gains_sales:    CAPITAL_GAINS_SALES,
      debts:                  DEBTS,
      gifts:                  GIFTS,
      lobbyist_relationships: LOBBYIST_RELATIONSHIPS,
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-il-pritzker-detail] ✅ subnational_leader_transparency/US-IL updated.');
  console.log('[us-il-pritzker-detail] Done.');
}

main().catch(e => { console.error('[us-il-pritzker-detail] Fatal:', e.message); process.exit(1); });
