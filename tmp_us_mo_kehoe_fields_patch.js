'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     137167,
  currency:   'USD',
  period:     'annual',
  notes:      'Statutory $137,167/yr per RSMo §26.010 plus §105.005 adjustments. Last confirmed figure.',
  source_url: 'https://revisor.mo.gov/main/OneSection.aspx?section=26.010',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'no_public_endpoint',
  notes:      'MO Personal Financial Disclosure under RSMo §105.485. MEC filings not accessible via public online portal.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-MO Kehoe Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_mo_kehoe_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-MO').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-MO updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
