'use strict';
/**
 * tmp_us_tx_abbott_transparency_patch.js
 *
 * Replaces framework-only placeholder data in subnational_leader_transparency/US-TX
 * with confirmed facts only. Removes all previous "needs_manual_review" garbage.
 *
 * Sources (fetched 2026-05-25):
 *   Salary: gov.texas.gov (Governor's salary is set by Texas statute, §659.012)
 *   Stock holdings: Market Realist / finbold — Abbott confirmed no individual stock
 *                   trading since becoming Governor in January 2015
 *   PFS note: TEC states PFS filings are not available online; require Open Records
 *             Request (openrecords@ethics.state.tx.us, Gov. Code Ch. 572)
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

// ─── Confirmed salary ────────────────────────────────────────────────────────
const SALARY = {
  amount:     153750,
  currency:   'USD',
  period:     'Calendar year 2024',
  source_url: 'https://gov.texas.gov',
  notes:      'Set by Texas Government Code §659.012. Governor Abbott also receives lifetime monthly payments from a 1984 personal injury settlement (lump-sum component ended 2022); settlement income is not part of the gubernatorial salary.',
  fetched_at: NOW,
};

// ─── Stock holdings ──────────────────────────────────────────────────────────
const STOCK_HOLDINGS = {
  status:     'none_confirmed',
  shares:     [],
  notes:      'Governor Abbott voluntarily stopped trading individual stocks in 2015 upon taking office. He holds no blind trust. Assets are held in his own name. TEC Personal Financial Statement (the authoritative source) is not publicly available online — requires Open Records Request to openrecords@ethics.state.tx.us under Texas Gov. Code Ch. 572.',
  source_url: 'https://gov.texas.gov',
  fetched_at: NOW,
};

// ─── Fields to DELETE (previous garbage placeholders) ────────────────────────
// FieldValue.delete() removes the key entirely from the document on merge.
const FIELDS_TO_REMOVE = [
  'needs_manual_review',
  'financial_disclosure',
  'declared_assets',
  'conflict_of_interest_filings',
  'lobbying_records',
  'campaign_finance',
  'gifts_hospitality',
  'recent_official_activity',
];

function buildDeleteMap(fields) {
  const map = {};
  for (const f of fields) map[f] = FieldValue.delete();
  return map;
}

function print() {
  console.log('\n[US-TX Abbott Transparency Patch]');
  console.log('\nFields to REMOVE (delete from document):');
  for (const f of FIELDS_TO_REMOVE) console.log('  -', f);
  console.log('\nFields to SET:');
  console.log('  salary:');
  console.log(`    amount:   $${SALARY.amount.toLocaleString()}`);
  console.log(`    period:   ${SALARY.period}`);
  console.log(`    source:   ${SALARY.source_url}`);
  console.log('  stock_holdings:');
  console.log(`    status:   ${STOCK_HOLDINGS.status}`);
  console.log(`    notes:    ${STOCK_HOLDINGS.notes.substring(0, 80)}...`);
}

async function main() {
  console.log(`\n[us-tx-abbott] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-tx-abbott] DRY RUN — no writes.');
    console.log('[us-tx-abbott] To apply: node tmp_us_tx_abbott_transparency_patch.js --write');
    return;
  }

  const db = getDb();

  await db.collection('subnational_leader_transparency').doc('US-TX').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:        SALARY,
      stock_holdings: STOCK_HOLDINGS,
      last_updated:  NOW,
    },
    { merge: true }
  );

  console.log('\n[us-tx-abbott] ✅ subnational_leader_transparency/US-TX updated.');
  console.log('[us-tx-abbott] Done.');
}

main().catch(e => { console.error('[us-tx-abbott] Fatal:', e.message); process.exit(1); });
