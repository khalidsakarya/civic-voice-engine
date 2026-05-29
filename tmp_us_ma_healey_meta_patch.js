'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:  'US-MA',
  leader_name:      'Maura Healey',
  title:            'Governor',
  party:            'Democratic',
  took_office:      '2023-01-05',
  transparency_live: true,
  regulatory_body:  'Massachusetts State Ethics Commission',
  last_updated:     NOW,
};

function print() {
  console.log('\n[US-MA Healey Meta Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  for (const [k, v] of Object.entries(DOC))
    console.log('  ' + k + ': ' + v);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ma_healey_meta_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-MA').set(DOC, { merge: true });
  console.log('\n✅ subnational_leader_transparency/US-MA updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
