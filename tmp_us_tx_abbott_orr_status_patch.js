'use strict';
/**
 * tmp_us_tx_abbott_orr_status_patch.js
 *
 * Adds ORR-status fields to subnational_leader_transparency/US-TX.
 * Merge only — salary and stock_holdings written in previous patch are untouched.
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const ORR_NOTE = 'Texas Ethics Commission does not publish PFS online. Request via openrecords@ethics.state.tx.us under Texas Government Code Chapter 572.';
const ORR_STATUS = 'requires_open_records_request';

const DECLARED_ASSETS = {
  status:     ORR_STATUS,
  notes:      ORR_NOTE,
  fetched_at: NOW,
};

const FINANCIAL_DISCLOSURE = {
  status:     ORR_STATUS,
  notes:      ORR_NOTE,
  fetched_at: NOW,
};

const SECTIONS_UNAVAILABLE = [
  { section: 'assets',            reason: ORR_STATUS, notes: ORR_NOTE },
  { section: 'gifts',             reason: ORR_STATUS, notes: ORR_NOTE },
  { section: 'lobbying_disclosures', reason: ORR_STATUS, notes: ORR_NOTE },
  { section: 'campaign_finance',  reason: ORR_STATUS, notes: ORR_NOTE },
];

const DATA_COMPLETENESS_NOTE =
  'Partial. Salary and stock_holdings status confirmed from public sources. ' +
  'All other financial disclosure sections (assets, real property, gifts, lobbying, ' +
  'campaign finance) require an Open Records Request to the Texas Ethics Commission ' +
  '(openrecords@ethics.state.tx.us, Gov. Code Ch. 572). TEC does not publish ' +
  'Personal Financial Statements online.';

function print() {
  console.log('\n[US-TX Abbott ORR Status Patch]');
  console.log('\ndeclared_assets.status:     ', DECLARED_ASSETS.status);
  console.log('financial_disclosure.status:', FINANCIAL_DISCLOSURE.status);
  console.log('\nsections_unavailable:');
  for (const s of SECTIONS_UNAVAILABLE) console.log(`  - ${s.section}: ${s.reason}`);
  console.log('\ndata_completeness_note:', DATA_COMPLETENESS_NOTE.substring(0, 80) + '...');
}

async function main() {
  console.log(`\n[us-tx-orr] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-tx-orr] DRY RUN — no writes.');
    console.log('[us-tx-orr] To apply: node tmp_us_tx_abbott_orr_status_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-TX').set(
    {
      declared_assets:       DECLARED_ASSETS,
      financial_disclosure:  FINANCIAL_DISCLOSURE,
      sections_unavailable:  SECTIONS_UNAVAILABLE,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      last_updated:          NOW,
    },
    { merge: true }
  );

  console.log('\n[us-tx-orr] ✅ subnational_leader_transparency/US-TX updated.');
  console.log('[us-tx-orr] Done.');
}

main().catch(e => { console.error('[us-tx-orr] Fatal:', e.message); process.exit(1); });
