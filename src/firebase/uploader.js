const fs = require('fs');
const path = require('path');
const { getDb } = require('./client');

const OUTPUT_ROOT = path.resolve(__dirname, '../../output');
const BATCH_SIZE = 400; // Firestore max is 500 ops per batch

/**
 * Write an array of records to a Firestore collection in batches.
 * Each record must have an `id` field used as the document ID.
 * Falls back to auto-ID if missing.
 */
async function batchWrite(collectionName, records) {
  const db = getDb();
  let written = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const record of chunk) {
      const docId = sanitizeId(record.id || record.sourceId || `auto-${Date.now()}-${Math.random()}`);
      const ref = db.collection(collectionName).doc(docId);
      batch.set(ref, stripUndefined(record), { merge: true });
    }

    await batch.commit();
    written += chunk.length;
  }

  return written;
}

/**
 * Load the latest file per source prefix from a directory.
 */
function loadLatestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const latest = {};
  for (const file of files) {
    const key = file.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latest[key] = file;
  }
  return Object.values(latest).map(f => path.join(dir, f));
}

function withTimestamp(record) {
  return { ...record, last_updated: new Date().toISOString() };
}

/**
 * Upload all processed bills (with AI analysis) to the `bills` collection.
 */
async function uploadBills() {
  const processedDir = path.join(OUTPUT_ROOT, 'processed');
  const files = fs.readdirSync(processedDir)
    .filter(f => f.startsWith('bills_enriched') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) throw new Error('No processed bills found. Run npm run process:bills first.');

  const { bills } = JSON.parse(fs.readFileSync(path.join(processedDir, files[files.length - 1])));

  const docs = bills.map(bill => withTimestamp({
    ...bill,
    plainLanguageSummary:      bill.analysis?.plainLanguageSummary      ?? null,
    argumentsFor:              bill.analysis?.argumentsFor              ?? [],
    argumentsAgainst:          bill.analysis?.argumentsAgainst          ?? [],
    citizenImpactScore:        bill.analysis?.citizenImpactScore        ?? null,
    citizenImpactRationale:    bill.analysis?.citizenImpactRationale    ?? null,
    predictedOutcome:          bill.analysis?.predictedOutcome          ?? null,
    predictedOutcomeRationale: bill.analysis?.predictedOutcomeRationale ?? null,
    analysis: bill.analysis ?? null,
  }));

  const count = await batchWrite('bills', docs);
  console.log(`[firebase] ✓ bills: ${count} documents written`);
  return count;
}

/**
 * Upload legislators/members to the `members` collection.
 */
async function uploadMembers() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'legislator'));
  const allRecords = [];

  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }

  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ members: no records found, skipping');
    return 0;
  }

  const count = await batchWrite('members', allRecords);
  console.log(`[firebase] ✓ members: ${count} documents written`);
  return count;
}

/**
 * Upload votes to the `votes` collection.
 */
async function uploadVotes() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'vote'));
  const allRecords = [];

  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }

  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ votes: no records found, skipping');
    return 0;
  }

  const count = await batchWrite('votes', allRecords);
  console.log(`[firebase] ✓ votes: ${count} documents written`);
  return count;
}

/**
 * Upload efficiency scores to the `efficiency_scores` collection.
 */
async function uploadEfficiencyScores() {
  const reportPath = path.join(OUTPUT_ROOT, 'efficiency_report.json');
  if (!fs.existsSync(reportPath)) {
    console.log('[firebase] ⚠ efficiency_scores: no report found, skipping');
    return 0;
  }

  const report = JSON.parse(fs.readFileSync(reportPath));
  const db = getDb();
  const batch = db.batch();
  const now = new Date().toISOString();

  for (const score of report.detail) {
    const ref = db.collection('efficiency_scores').doc(score.code);
    batch.set(ref, { ...score, last_updated: now }, { merge: true });
  }

  const summaryRef = db.collection('efficiency_scores').doc('_summary');
  batch.set(summaryRef, {
    generatedAt: report.generatedAt,
    scores: report.summary,
    last_updated: now,
  }, { merge: true });

  await batch.commit();
  const count = report.detail.length + 1;
  console.log(`[firebase] ✓ efficiency_scores: ${count} documents written`);
  return count;
}

/**
 * Run all uploads (used for manual one-shot runs).
 */
async function uploadAll() {
  console.log('[firebase] Starting upload to Firestore...');
  const results = {
    bills:             await uploadBills(),
    members:           await uploadMembers(),
    votes:             await uploadVotes(),
    efficiency_scores: await uploadEfficiencyScores(),
  };
  const total = Object.values(results).reduce((a, b) => a + b, 0);
  console.log(`[firebase] Upload complete. ${total} total documents written.`);
  return results;
}

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

function stripUndefined(obj) {
  return JSON.parse(JSON.stringify(obj, (_, v) => (v === undefined ? null : v)));
}

module.exports = { uploadAll, uploadBills, uploadMembers, uploadVotes, uploadEfficiencyScores };
