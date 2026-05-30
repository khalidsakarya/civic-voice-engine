'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:   'US-KY',
  leader_name:       'Andy Beshear',
  title:             'Governor',
  party:             'Democratic',
  took_office:       '2019-12-10',
  transparency_live: true,
  regulatory_body:   'Kentucky Executive Branch Ethics Commission',
  last_updated:      NOW,
};

function print() {
  console.log('\n[US-KY Beshear Meta Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  for (const [k, v] of Object.entries(DOC))
    console.log('  ' + k + ': ' + v);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ky_beshear_meta_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-KY').set(DOC, { merge: true });
  console.log('\n✅ subnational_leader_transparency/US-KY updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
