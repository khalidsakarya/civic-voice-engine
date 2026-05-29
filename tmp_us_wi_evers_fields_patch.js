'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     165568,
  currency:   'USD',
  period:     'annual',
  notes:      'Statutory $165,568/yr per Wis. Stat. §20.923.',
  source_url: 'https://docs.legis.wisconsin.gov/statutes/statutes/20/IX/923',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'blind_trust',
  notes:      'Assets placed in blind trust Jan 2019. WI SEI filed under Wis. Stat. §19.44. Blind trust assets not individually disclosed.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-WI Evers Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_wi_evers_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-WI').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-WI updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
