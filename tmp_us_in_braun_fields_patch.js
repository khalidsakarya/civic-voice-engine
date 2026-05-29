'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount:     221024,
  currency:   'USD',
  period:     'annual',
  notes:      'Statutory $221,024/yr per Ind. Code §4-2-1-4. Raised 65% from prior $133,684.',
  source_url: 'https://iga.in.gov/laws/2024/ic/titles/4#4-2-1-4',
  fetched_at: NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'IN Statement of Economic Interests under Ind. Code §4-2-6-8. Portal requires manual access.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-IN Braun Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:         $' + SALARY.amount.toLocaleString() + ' — ' + SALARY.notes);
  console.log('lobbying:       ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status + ' — ' + STOCK_HOLDINGS.notes);
  console.log('net_worth:      ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_in_braun_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-IN').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-IN updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
