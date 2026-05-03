'use strict';
require('dotenv').config();

const { getDb }             = require('./src/firebase/client');
const { fetchUSDeptHeads }  = require('./src/ingestion/departmentHeadsFetcher');
const { uploadDepartmentHeads } = require('./src/firebase/uploader');

const COLLECTION = 'department_heads';

// Names to remove (stale + duplicate)
const REMOVE_NAMES = new Set(['Keith Sonderling', 'Kristi Noem', 'Pam Bondi']);

(async () => {
  const db = getDb();

  // ── 1. Read all US records ────────────────────────────────────────────────
  const snap = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const docs = [];
  snap.forEach(doc => docs.push({ id: doc.id, ...doc.data() }));
  docs.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\nCurrent US cabinet in Firestore (${docs.length} records):`);
  docs.forEach(d => console.log(`  ${d.id.padEnd(40)} ${d.name} — ${d.title}`));

  // ── 2. Delete stale / duplicate docs ─────────────────────────────────────
  const toDelete = docs.filter(d => REMOVE_NAMES.has(d.name));
  if (toDelete.length === 0) {
    console.log('\nNo stale docs found with those names — may already have correct docIds. Checking...');
    // Also check if duplicates exist for Secretary of Labor
    const laborDocs = docs.filter(d => d.title && d.title.includes('Secretary of Labor'));
    if (laborDocs.length > 1) {
      console.log('  Found duplicate Labor Secretaries:');
      laborDocs.forEach(d => console.log(`    ${d.id}: ${d.name}`));
    }
  } else {
    const batch = db.batch();
    for (const d of toDelete) {
      console.log(`\nDeleting: ${d.id} (${d.name} — ${d.title})`);
      batch.delete(db.collection(COLLECTION).doc(d.id));
    }
    await batch.commit();
    console.log(`\nDeleted ${toDelete.length} stale/duplicate document(s).`);
  }

  // Also delete any extra Labor Secretary docs beyond the first
  const snap2 = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const afterDelete = [];
  snap2.forEach(doc => afterDelete.push({ id: doc.id, ...doc.data() }));

  const laborDocs = afterDelete.filter(d => d.title && d.title.includes('Secretary of Labor'));
  if (laborDocs.length > 1) {
    console.log(`\nStill ${laborDocs.length} Labor Secretary docs — deleting extras, keeping Lori Chavez-DeRemer:`);
    const keep = laborDocs.find(d => d.name === 'Lori Chavez-DeRemer') || laborDocs[0];
    const extras = laborDocs.filter(d => d.id !== keep.id);
    const batch2 = db.batch();
    for (const d of extras) {
      console.log(`  Deleting extra: ${d.id} (${d.name})`);
      batch2.delete(db.collection(COLLECTION).doc(d.id));
    }
    await batch2.commit();
    console.log(`  Kept: ${keep.id} (${keep.name})`);
  }

  // ── 3. Fetch fresh US cabinet data from dept sites + whitehouse.gov ───────
  console.log('\n──────────────────────────────────────────────────');
  console.log('Fetching fresh US cabinet data from department sites...');
  await fetchUSDeptHeads();

  // ── 4. Upload to Firestore (US fresh + latest CA/UK/AU from output/) ─────
  console.log('\nUploading fresh US cabinet data to Firestore...');
  const count = await uploadDepartmentHeads();
  console.log(`Uploaded ${count} total dept-heads documents.`);

  // ── 5. Verify final US state ──────────────────────────────────────────────
  const finalSnap = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const finalDocs = [];
  finalSnap.forEach(doc => finalDocs.push({ id: doc.id, ...doc.data() }));
  finalDocs.sort((a, b) => a.id.localeCompare(b.id));

  console.log(`\nFinal US cabinet in Firestore (${finalDocs.length} records):`);
  finalDocs.forEach(d => console.log(`  ${d.id.padEnd(40)} ${d.name} — ${d.title}`));

  process.exit(0);
})().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
