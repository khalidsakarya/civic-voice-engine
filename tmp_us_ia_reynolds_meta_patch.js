'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:   'US-IA',
  leader_name:       'Kim Reynolds',
  title:             'Governor',
  party:             'Republican',
  took_office:       '2017-05-24',
  transparency_live: true,
  regulatory_body:   'Iowa Ethics and Campaign Disclosure Board',
  last_updated:      NOW,
};

function print() {
  console.log('\n[US-IA Reynolds Meta Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  for (const [k, v] of Object.entries(DOC))
    console.log('  ' + k + ': ' + v);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ia_reynolds_meta_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-IA').set(DOC, { merge: true });
  console.log('\n✅ subnational_leader_transparency/US-IA updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
