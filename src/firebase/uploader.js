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
 * Upload government efficiency scores (monthly recalc) to `efficiency_scores_monthly`.
 */
async function uploadMonthlyEfficiencyScores() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'efficiency_score'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ efficiency_scores_monthly: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('efficiency_scores_monthly', allRecords);
  console.log(`[firebase] ✓ efficiency_scores_monthly: ${count} documents written`);
  return count;
}

/**
 * Upload budget and spending data to the `budget_spending` collection.
 */
async function uploadBudgetSpending() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'budget'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ budget_spending: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('budget_spending', allRecords);
  console.log(`[firebase] ✓ budget_spending: ${count} documents written`);
  return count;
}

/**
 * Upload audit findings to the `audit_findings` collection.
 */
async function uploadAuditFindings() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'audit'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ audit_findings: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('audit_findings', allRecords);
  console.log(`[firebase] ✓ audit_findings: ${count} documents written`);
  return count;
}

/**
 * Upload department performance metrics to `department_performance`.
 */
async function uploadDepartmentPerformance() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'department_performance'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ department_performance: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('department_performance', allRecords);
  console.log(`[firebase] ✓ department_performance: ${count} documents written`);
  return count;
}

/**
 * Upload financial disclosures to the `financial_disclosures` collection.
 */
async function uploadFinancialDisclosures() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'financial_disclosure'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ financial_disclosures: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('financial_disclosures', allRecords);
  console.log(`[firebase] ✓ financial_disclosures: ${count} documents written`);
  return count;
}

/**
 * Upload lobbying activity to the `lobbying_activity` collection.
 */
async function uploadLobbyingActivity() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'lobbying'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ lobbying_activity: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('lobbying_activity', allRecords);
  console.log(`[firebase] ✓ lobbying_activity: ${count} documents written`);
  return count;
}

/**
 * Upload government contracts to the `contracts` collection.
 */
async function uploadContracts() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'contract'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ contracts: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('contracts', allRecords);
  console.log(`[firebase] ✓ contracts: ${count} documents written`);
  return count;
}

/**
 * Upload corporate affiliations to the `corporate_affiliations` collection.
 */
async function uploadCorporateAffiliations() {
  const files = loadLatestFiles(path.join(OUTPUT_ROOT, 'corporate_affiliation'));
  const allRecords = [];
  for (const file of files) {
    const { records } = JSON.parse(fs.readFileSync(file));
    allRecords.push(...records.map(withTimestamp));
  }
  if (allRecords.length === 0) {
    console.log('[firebase] ⚠ corporate_affiliations: no records found, skipping');
    return 0;
  }
  const count = await batchWrite('corporate_affiliations', allRecords);
  console.log(`[firebase] ✓ corporate_affiliations: ${count} documents written`);
  return count;
}

/**
 * Run all uploads (used for manual one-shot runs).
 */
async function uploadAll() {
  console.log('[firebase] Starting upload to Firestore...');
  const results = {
    bills:                      await uploadBills(),
    members:                    await uploadMembers(),
    votes:                      await uploadVotes(),
    efficiency_scores:          await uploadEfficiencyScores(),
    efficiency_scores_monthly:  await uploadMonthlyEfficiencyScores(),
    budget_spending:            await uploadBudgetSpending(),
    audit_findings:             await uploadAuditFindings(),
    department_performance:     await uploadDepartmentPerformance(),
    financial_disclosures:      await uploadFinancialDisclosures(),
    lobbying_activity:          await uploadLobbyingActivity(),
    contracts:                  await uploadContracts(),
    corporate_affiliations:     await uploadCorporateAffiliations(),
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

module.exports = {
  uploadAll,
  uploadBills,
  uploadMembers,
  uploadVotes,
  uploadEfficiencyScores,
  uploadMonthlyEfficiencyScores,
  uploadBudgetSpending,
  uploadAuditFindings,
  uploadDepartmentPerformance,
  uploadFinancialDisclosures,
  uploadLobbyingActivity,
  uploadContracts,
  uploadCorporateAffiliations,
};
