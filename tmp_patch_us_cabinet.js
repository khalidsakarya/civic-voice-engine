'use strict';
require('dotenv').config();

const { getDb } = require('./src/firebase/client');
const { writeAuditLog } = require('./src/firebase/auditLog');

const COLLECTION = 'department_heads';
const _ts = new Date().toISOString();

(async () => {
  const db = getDb();

  // ── Read current US state ─────────────────────────────────────────────────
  const snap = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const docs = new Map();
  snap.forEach(doc => docs.set(doc.id, doc.data()));

  console.log(`\nCurrent US cabinet (${docs.size} records):`);
  [...docs.entries()].sort().forEach(([id, d]) => console.log(`  ${id.padEnd(42)} ${d.name} — ${d.title}`));

  // ── Define changes ────────────────────────────────────────────────────────

  const toDelete = ['us-lori-chavez-deremer'];

  const toUpdate = {
    'us-keith-e-sonderling': {
      title:          'Acting Secretary of Labor',
      department:     'Department of Labor',
      date_appointed: '2026-04-20',
      last_updated:   _ts,
      source:         'whitehouse_gov',
      source_url:     'https://www.whitehouse.gov/administration/cabinet/',
    },
  };

  // ── Confirm expected docs already present / absent ───────────────────────
  const checks = {
    'us-todd-blanche':   { expect: true,  label: 'Todd Blanche — Acting AG' },
    'us-markwayne-mullin': { expect: true, label: 'Markwayne Mullin — DHS Secretary' },
    'us-kristi-noem':    { expect: false, label: 'Kristi Noem (should be gone)' },
    'us-pam-bondi':      { expect: false, label: 'Pam Bondi (should be gone)' },
  };

  console.log('\n── Verification checks ──────────────────────────────────────');
  for (const [id, { expect, label }] of Object.entries(checks)) {
    const present = docs.has(id);
    const ok = present === expect;
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${present ? 'PRESENT' : 'ABSENT'} (expected ${expect ? 'present' : 'absent'})`);
  }

  // ── Apply batch changes ───────────────────────────────────────────────────
  console.log('\n── Applying changes ─────────────────────────────────────────');

  const batch = db.batch();

  for (const id of toDelete) {
    if (docs.has(id)) {
      const d = docs.get(id);
      console.log(`  DELETE  ${id} (${d.name})`);
      batch.delete(db.collection(COLLECTION).doc(id));
    } else {
      console.log(`  SKIP    ${id} — already absent`);
    }
  }

  for (const [id, fields] of Object.entries(toUpdate)) {
    if (docs.has(id)) {
      const d = docs.get(id);
      console.log(`  UPDATE  ${id} (${d.name})`);
      console.log(`          title: "${d.title}" → "${fields.title}"`);
      console.log(`          date_appointed: "${d.date_appointed}" → "${fields.date_appointed}"`);
      batch.update(db.collection(COLLECTION).doc(id), fields);
    } else {
      console.log(`  MISSING ${id} — not found, cannot update`);
    }
  }

  await batch.commit();
  console.log('\nBatch committed.');

  // ── Audit log ─────────────────────────────────────────────────────────────
  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'US',
    data_pull_timestamp: _ts,
    source_endpoint:     'manual-cabinet-patch',
    record_count:        toDelete.length + Object.keys(toUpdate).length,
    import_status:       'updated',
    scheduler_tier:      'manual',
    changes: [
      'deleted: us-lori-chavez-deremer (resigned 2026-04-20)',
      'updated: us-keith-e-sonderling → Acting Secretary of Labor (designated 2026-04-20)',
    ],
  });

  // ── Final state ───────────────────────────────────────────────────────────
  const finalSnap = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const finalDocs = [];
  finalSnap.forEach(doc => finalDocs.push({ id: doc.id, ...doc.data() }));
  finalDocs.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\n── Final US cabinet (${finalDocs.length} records) ─────────────────────`);
  finalDocs.forEach(d => console.log(`  ${d.id.padEnd(42)} ${d.name} — ${d.title}`));

  process.exit(0);
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
