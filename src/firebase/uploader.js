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

// ─── Currency lookup ──────────────────────────────────────────────────────────

const CURRENCY_BY_JUR = { AU: 'AUD', CA: 'CAD', UK: 'GBP', US: 'USD' };

/**
 * Upload flagged expense records to the `flagged_expenses` collection.
 * Only isFlagged === true records from expenses_enriched.json are uploaded.
 * Doc schema matches the requested fields exactly.
 */
async function uploadFlaggedExpenses() {
  const enrichedPath = path.join(OUTPUT_ROOT, 'processed', 'expenses_enriched.json');
  if (!fs.existsSync(enrichedPath)) {
    console.log('[firebase] ⚠ flagged_expenses: expenses_enriched.json not found, skipping');
    return 0;
  }

  const { records } = JSON.parse(fs.readFileSync(enrichedPath));
  const flagged = records.filter(r => r.isFlagged);

  if (flagged.length === 0) {
    console.log('[firebase] ⚠ flagged_expenses: no flagged records found, skipping');
    return 0;
  }

  const docs = flagged.map(r => withTimestamp({
    id:                          r.id,
    country:                     r.jurisdiction,
    department:                  r.department    || null,
    amount:                      r.amount,
    currency:                    CURRENCY_BY_JUR[r.jurisdiction] || null,
    date:                        r.date          || null,
    category:                    r.category      || null,
    waste_score:                 r.wasteScore,
    severity:                    r.severity,
    plain_language_explanation:  r.flagReason    || null,
    source_url:                  r.sourceUrl     || null,
    // bonus context fields (useful for the app card display)
    title:                       r.title         || null,
    recipient:                   r.recipient     || null,
  }));

  const count = await batchWrite('flagged_expenses', docs);
  console.log(`[firebase] ✓ flagged_expenses: ${count} documents written`);
  return count;
}

/**
 * Upload waste analysis summaries to the `waste_reports` collection.
 * One document per country (doc ID = jurisdiction code: AU | CA | UK | US).
 * Doc schema: top10WastefulItems, departmentScores, totalFlaggedAmount,
 *             mostWastefulDepartment, comparedToPreviousPeriod, …
 */
async function uploadWasteReports() {
  const reportPath = path.join(OUTPUT_ROOT, 'processed', 'waste_report.json');
  if (!fs.existsSync(reportPath)) {
    console.log('[firebase] ⚠ waste_reports: waste_report.json not found, skipping');
    return 0;
  }

  const report = JSON.parse(fs.readFileSync(reportPath));
  const db  = getDb();
  const now = new Date().toISOString();

  const jurisdictions = ['AU', 'CA', 'UK', 'US'];
  const batch = db.batch();
  let count = 0;

  for (const jur of jurisdictions) {
    const top10       = report.top10ByCountry?.[jur]       || [];
    const deptScores  = (report.departmentScores  || []).filter(d => d.jurisdiction === jur);
    const spikes      = (report.spendSpikes       || []).filter(s => s.jurisdiction === jur);
    const clusters    = (report.contractorClusters || []).filter(c => c.jurisdictions?.includes(jur));
    const soleSrcs    = (report.soleSources       || []).filter(s => s.jurisdiction === jur);

    const totalFlaggedAmount = top10.reduce((sum, r) => sum + Math.abs(r.amount || 0), 0);

    // Most wasteful department for this country (highest score, already sorted desc)
    const topDept = deptScores[0] || null;

    // Period comparison derived from spend spikes
    const comparedToPreviousPeriod = spikes.length > 0
      ? spikes.map(s => ({
          department:      s.department,
          previousAmount:  s.previousAmount,
          currentAmount:   s.currentAmount,
          percentIncrease: s.percentIncrease,
          reason:          s.reason,
        }))
      : null;

    const doc = {
      country:                  jur,
      currency:                 CURRENCY_BY_JUR[jur] || null,
      generatedAt:              report.generatedAt,
      top10WastefulItems:       top10,
      departmentScores:         deptScores,
      totalFlaggedAmount,
      mostWastefulDepartment:   topDept ? {
        department:   topDept.department,
        wasteScore:   topDept.wasteScore,
        grade:        topDept.grade,
        totalSpend:   topDept.totalSpend,
        flaggedCount: topDept.flaggedCount,
      } : null,
      comparedToPreviousPeriod,
      contractorClusters:       clusters,
      soleSourceContractCount:  soleSrcs.length,
      last_updated:             now,
    };

    batch.set(db.collection('waste_reports').doc(jur), doc, { merge: true });
    count++;
  }

  await batch.commit();
  console.log(`[firebase] ✓ waste_reports: ${count} documents written`);
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
    flagged_expenses:           await uploadFlaggedExpenses(),
    waste_reports:              await uploadWasteReports(),
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
  uploadFlaggedExpenses,
  uploadWasteReports,
};
