'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:   'US-HI',
  leader_name:       'Josh Green',
  title:             'Governor',
  party:             'Democratic',
  took_office:       '2022-12-05',
  transparency_live: true,
  regulatory_body:   'Hawaii State Ethics Commission',
  salary: {
    amount:     217908,
    currency:   'USD',
    period:     'annual',
    notes:      '$217,908/yr effective Jul 1 2025.',
    fetched_at: NOW,
  },
  lobbying: {
    status:     'not_publicly_trackable',
    fetched_at: NOW,
  },
  stock_holdings: {
    status:     'official_bulk_register_pdf',
    notes:      'HI Ethics Commission filings. PDFs require manual navigation.',
    fetched_at: NOW,
  },
  net_worth: {
    status:     'not_disclosed',
    fetched_at: NOW,
  },
  last_updated: NOW,
};

function print() {
  console.log('\n[US-HI Green Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('  jurisdiction_id:   ' + DOC.jurisdiction_id);
  console.log('  leader_name:       ' + DOC.leader_name);
  console.log('  party:             ' + DOC.party);
  console.log('  took_office:       ' + DOC.took_office);
  console.log('  regulatory_body:   ' + DOC.regulatory_body);
  console.log('  salary:            $' + DOC.salary.amount.toLocaleString() + ' — ' + DOC.salary.notes);
  console.log('  lobbying:          ' + DOC.lobbying.status);
  console.log('  stock_holdings:    ' + DOC.stock_holdings.status + ' — ' + DOC.stock_holdings.notes);
  console.log('  net_worth:         ' + DOC.net_worth.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_hi_green_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-HI').set(DOC, { merge: true });
  console.log('\n✅ subnational_leader_transparency/US-HI updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
