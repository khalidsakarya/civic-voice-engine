'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:              135360,
  amount_from_jul2026: 168000,
  currency:            'USD',
  period:              'annual',
  notes:               '$135,360/yr current per N.D.C.C. §54-06-01. Rising to $168,000 effective Jul 1 2026 per state legislation.',
  source_url:          'https://www.legis.nd.gov/cencode/t54c06.pdf',
  fetched_at:          NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'ND Financial Disclosure under N.D.C.C. §16.1-09-02. Portal JS-rendered, manual access required.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-ND Armstrong Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' current / $' + SALARY.amount_from_jul2026.toLocaleString() + ' from Jul 2026 — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_nd_armstrong_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-ND').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-ND updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
