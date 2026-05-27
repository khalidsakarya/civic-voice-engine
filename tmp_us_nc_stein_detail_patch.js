'use strict';
/**
 * tmp_us_nc_stein_detail_patch.js
 *
 * Adds net_worth_estimate, box_history, and data_completeness_note
 * to subnational_leader_transparency/US-NC for Governor Josh Stein.
 *
 * Merge only. All other fields untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL_SEC = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001372612&type=4&dateb=&owner=include&count=40';
const SOURCE_URL_BOX = 'https://www.box.com/events/cards/resource/58866?resource_id=JoshStein-58866';

// ─── Net worth estimate ───────────────────────────────────────────────────────
const NET_WORTH_ESTIMATE = {
  amount_approx:  6000000,
  currency:       'USD',
  basis:          'Primarily Box Inc. (BOX) shareholding (~193,586 shares). Estimate from Urbansplatter (May 2025) citing SEC insider-trade data.',
  source_url:     'https://www.urbansplatter.com/2025/05/josh-stein-net-worth/',
  fetched_at:     NOW,
  notes:          'Not from NC SEI (form does not require asset values). Derived from estimated market value of Box Inc. shares at time of last confirmed holding. No other major assets identified in public records.',
};

// ─── Box Inc. trade history ───────────────────────────────────────────────────
const BOX_HISTORY = {
  ticker:     'BOX',
  company:    'Box, Inc.',
  source_url: SOURCE_URL_SEC,
  fetched_at: NOW,
  shares_held_as_of_june_2019: 193586,
  transactions: [
    {
      date:        '2019-06-17',
      type:        'Sale',
      shares:      20000,
      proceeds:    363800,
      currency:    'USD',
      notes:       'Most recent SEC Form 4 transaction on record. Open-market sale.',
    },
  ],
  subsequent_transactions: 'None filed with SEC 2019–2024.',
  director_departure:      'Listed as "(Outgoing)" in Box FY2025 proxy materials (annual meeting June 27, 2025). Not listed as director in Box 2026 proxy cycle.',
  director_departure_url:  SOURCE_URL_BOX,
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. NC SEI portal (ethicssei.nc.gov) returns HTTP 403 to automated access; ' +
  'DocID 157385 (identified via Google as likely Stein\'s SEI) also returns 403. ' +
  'NC General Statutes Chapter 138A does not require dollar values for most SEI items — ' +
  'only investment company names (>$10,000/company), NC real estate (>$10,000 including ' +
  'primary residence), income source names, and business ownership interests are disclosed. ' +
  'Box Inc. (BOX) directorship tenure ending confirmed: listed as "(Outgoing)" in Box ' +
  'FY2025 proxy materials; absent from Box 2026 proxy cycle (8 named directors, Stein ' +
  'not among them). Last SEC Form 4 trade: sold 20,000 shares June 17, 2019 for ~$363,800; ' +
  'no subsequent trades filed 2019–2024. Real estate (likely Raleigh area primary ' +
  'residence), gifts, creditors, and any income beyond state salary and Box director ' +
  'compensation are unverifiable without direct SEI access. Net worth estimated ~$6M ' +
  'primarily from Box Inc. holdings (Urbansplatter May 2025, citing SEC data).';

function print() {
  console.log('\n[US-NC Stein Detail Patch]');
  console.log('Adds net_worth_estimate, box_history, data_completeness_note\n');

  console.log('net_worth_estimate:');
  console.log('  ~$' + (NET_WORTH_ESTIMATE.amount_approx / 1e6).toFixed(0) + 'M — ' + NET_WORTH_ESTIMATE.basis);

  console.log('\nbox_history:');
  console.log('  shares_held_as_of_june_2019: ' + BOX_HISTORY.shares_held_as_of_june_2019.toLocaleString());
  for (const t of BOX_HISTORY.transactions)
    console.log('  ' + t.date + ': ' + t.type + ' ' + t.shares.toLocaleString() +
      ' shares for $' + t.proceeds.toLocaleString());
  console.log('  subsequent_transactions: ' + BOX_HISTORY.subsequent_transactions);
  console.log('  director_departure: ' + BOX_HISTORY.director_departure);

  console.log('\ndata_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 120) + '...');
}

async function main() {
  console.log('\n[us-nc-stein-detail] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-nc-stein-detail] DRY RUN — no writes.');
    console.log('[us-nc-stein-detail] To apply: node tmp_us_nc_stein_detail_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-NC').set(
    {
      net_worth_estimate:     NET_WORTH_ESTIMATE,
      box_history:            BOX_HISTORY,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-nc-stein-detail] ✅ subnational_leader_transparency/US-NC updated.');
  console.log('[us-nc-stein-detail] Done.');
}

main().catch(e => { console.error('[us-nc-stein-detail] Fatal:', e.message); process.exit(1); });
