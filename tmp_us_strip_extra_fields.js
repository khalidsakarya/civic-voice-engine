'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE  = process.argv.includes('--write');
const SKIP_IDS    = new Set(['US-CA', 'US-AK', 'US-FL', 'US-GA', 'US-IL', 'US-MI', 'US-NC', 'US-NY', 'US-OH', 'US-PA', 'US-TX', 'US-VA']);
const KEEP_FIELDS = new Set([
  'jurisdiction_id', 'leader_name', 'title', 'party', 'took_office',
  'transparency_live', 'regulatory_body',
  'salary', 'lobbying', 'stock_holdings', 'net_worth',
]);

async function main() {
  const db   = getDb();
  const snap = await db.collection('subnational_leader_transparency').get();

  const targets = snap.docs.filter(doc =>
    doc.id.startsWith('US-') && !SKIP_IDS.has(doc.id)
  );

  console.log('\n[US Strip Extra Fields — ' + (WRITE_MODE ? '⚠  WRITE MODE (full replace, no merge)' : 'DRY RUN') + ']');
  console.log('\nDocuments to process (' + targets.length + '):');

  for (const doc of targets) {
    const data        = doc.data();
    const extraKeys   = Object.keys(data).filter(k => !KEEP_FIELDS.has(k));
    const stripped    = {};
    for (const key of KEEP_FIELDS) {
      if (key in data) stripped[key] = data[key];
    }

    if (extraKeys.length) {
      console.log('  ' + doc.id + ' — strip: [' + extraKeys.join(', ') + ']');
    } else {
      console.log('  ' + doc.id + ' — clean (no extra fields)');
    }

    if (WRITE_MODE) {
      await db.collection('subnational_leader_transparency').doc(doc.id).set(stripped);
    }
  }

  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_strip_extra_fields.js --write');
  } else {
    console.log('\n✅ Done. ' + targets.length + ' documents replaced.');
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
