'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     193100,
  currency:   'USD',
  period:     'annual',
  notes:      'FY2026 rate per Utah Code §67-22-2, set by UT Elected Official Compensation Commission.',
  source_url: 'https://le.utah.gov/xcode/Title67/Chapter22/67-22-S2.html',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'UT financial disclosure under Utah Code §67-16-6. Disclosures portal requires manual navigation.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-UT Cox Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ut_cox_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-UT').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-UT updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
