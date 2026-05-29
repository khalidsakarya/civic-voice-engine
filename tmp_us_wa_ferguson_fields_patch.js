'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     218744,
  currency:   'USD',
  period:     'annual',
  notes:      '$204,205 Jan-Jun 2025, $218,744 Jul 2025-Jun 2026, $234,275 from Jul 2026. Per RCW 43.06.010.',
  source_url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=43.06.010',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  notes:      'PDC tracks lobbyist registrations but governor-specific meeting contacts not itemized at individual level.',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'EEB Form 10 filed annually. First Ferguson filing due April 15 2025 should exist but requires manual portal access at ethics.wa.gov.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  notes:      'WA EEB Form 10 does not require net worth totals. No aggregate figure published.',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-WA Ferguson Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:');
  console.log('  amount:  $' + SALARY.amount.toLocaleString());
  console.log('  notes:   ' + SALARY.notes);
  console.log('\nlobbying:');
  console.log('  status:  ' + LOBBYING.status);
  console.log('\nstock_holdings:');
  console.log('  status:  ' + STOCK_HOLDINGS.status);
  console.log('\nnet_worth:');
  console.log('  status:  ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_wa_ferguson_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-WA').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-WA updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
