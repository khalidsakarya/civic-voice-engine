'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     190424,
  currency:   'USD',
  period:     'annual',
  notes:      'Tied to OPM federal locality pay per W. Va. Code §6-7-2a. $190,424 effective 2025, adjusts annually with federal pay scale.',
  source_url: 'https://code.wvlegislature.gov/6-7-2A/',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'WV Financial Disclosure under W. Va. Code §6B-2-6. Portal JS-rendered, manual access required.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-WV Morrisey Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_wv_morrisey_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-WV').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-WV updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
