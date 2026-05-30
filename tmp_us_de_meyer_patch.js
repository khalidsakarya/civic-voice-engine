'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:   'US-DE',
  leader_name:       'Matt Meyer',
  title:             'Governor',
  party:             'Democratic',
  took_office:       '2025-01-21',
  transparency_live: true,
  regulatory_body:   'Delaware Public Integrity Commission',
  salary: {
    amount:     185096,
    currency:   'USD',
    period:     'annual',
    notes:      '$185,096/yr effective Jul 2025 per state legislature.',
    fetched_at: NOW,
  },
  lobbying: {
    status:     'not_publicly_trackable',
    fetched_at: NOW,
  },
  stock_holdings: {
    status:     'source_blocked',
    notes:      'DE Financial Disclosure under Del. Code Title 29. integrity.delaware.gov unreachable from automated access.',
    fetched_at: NOW,
  },
  net_worth: {
    status:     'not_disclosed',
    fetched_at: NOW,
  },
  last_updated: NOW,
};

function print() {
  console.log('\n[US-DE Meyer Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
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
    console.log('To apply: node tmp_us_de_meyer_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-DE').set(DOC, { merge: true });
  console.log('\n✅ subnational_leader_transparency/US-DE updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
