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
 * Upload expense anomalies to the `expense_anomalies` collection.
 * One document per anomaly. Also writes per-country summary docs.
 */
async function uploadExpenseAnomalies() {
  const anomaliesPath = path.join(OUTPUT_ROOT, 'processed', 'expense_anomalies.json');
  if (!fs.existsSync(anomaliesPath)) {
    console.log('[firebase] ⚠ expense_anomalies: expense_anomalies.json not found, skipping');
    return 0;
  }

  const { anomalies, summary, generatedAt } = JSON.parse(fs.readFileSync(anomaliesPath));
  if (!anomalies || anomalies.length === 0) {
    console.log('[firebase] ⚠ expense_anomalies: no anomalies found, skipping');
    return 0;
  }

  // Upload individual anomaly documents
  const docs = anomalies.map(a => withTimestamp({
    id:           a.id,
    leaderId:     a.leaderId     || null,
    person:       a.person       || null,
    role:         a.role         || null,
    department:   a.department   || null,
    jurisdiction: a.jurisdiction,
    currency:     a.currency     || null,
    anomalyType:  a.anomalyType,
    headline:     a.headline,
    description:  a.description  || null,
    scandalScore: a.scandalScore ?? null,
    severity:     a.severity     || null,
    evidence:     a.evidence     || null,
    detectedAt:   a.detectedAt   || null,
  }));

  let count = await batchWrite('expense_anomalies', docs);

  // Write per-country summary docs
  const db  = getDb();
  const now = new Date().toISOString();
  const summaryBatch = db.batch();
  const jurisdictions = [...new Set(anomalies.map(a => a.jurisdiction))];

  for (const jur of jurisdictions) {
    const jurAnomalies = anomalies.filter(a => a.jurisdiction === jur);
    const topAnomalies = [...jurAnomalies]
      .sort((a, b) => (b.scandalScore ?? 0) - (a.scandalScore ?? 0))
      .slice(0, 10)
      .map(a => ({
        id:          a.id,
        person:      a.person,
        anomalyType: a.anomalyType,
        headline:    a.headline,
        scandalScore: a.scandalScore,
        severity:    a.severity,
      }));

    const ref = db.collection('expense_anomalies').doc(`_summary_${jur}`);
    summaryBatch.set(ref, {
      country:          jur,
      generatedAt,
      totalAnomalies:   jurAnomalies.length,
      topScandals:      topAnomalies,
      byType:           summary?.byType ?? {},
      bySeverity:       summary?.bySeverity ?? {},
      last_updated:     now,
    }, { merge: true });
    count++;
  }

  await summaryBatch.commit();
  console.log(`[firebase] ✓ expense_anomalies: ${count} documents written (${docs.length} anomalies + ${jurisdictions.length} summaries)`);
  return count;
}

/**
 * Upload the expense leaderboard to the `expense_leaderboard` collection.
 * One document per country (doc ID = jurisdiction: AU | CA | UK | US)
 * plus one global top-10 document (doc ID = _global).
 */
async function uploadLeaderboard() {
  const leaderboardPath = path.join(OUTPUT_ROOT, 'processed', 'expense_leaderboard.json');
  if (!fs.existsSync(leaderboardPath)) {
    console.log('[firebase] ⚠ expense_leaderboard: expense_leaderboard.json not found, skipping');
    return 0;
  }

  const leaderboard = JSON.parse(fs.readFileSync(leaderboardPath));
  const db  = getDb();
  const now = new Date().toISOString();
  const batch = db.batch();
  let count = 0;

  // One doc per country
  for (const section of leaderboard.countries || []) {
    const ref = db.collection('expense_leaderboard').doc(section.country);
    batch.set(ref, { ...section, last_updated: now }, { merge: true });
    count++;
  }

  // Global top-10 summary doc
  if ((leaderboard.globalTop10 || []).length > 0) {
    const ref = db.collection('expense_leaderboard').doc('_global');
    batch.set(ref, {
      generatedAt:  leaderboard.generatedAt,
      sourceDataAt: leaderboard.sourceDataAt,
      globalTop10:  leaderboard.globalTop10,
      last_updated: now,
    }, { merge: true });
    count++;
  }

  await batch.commit();
  console.log(`[firebase] ✓ expense_leaderboard: ${count} documents written`);
  return count;
}

/**
 * Upload enriched leader expense profiles to the `leader_expenses` collection.
 * One document per leader, keyed by leader id.
 * Doc schema: person, role, jurisdiction, currency, totalExpenses, tripCount,
 *             averageTripCost, mostExpensiveTrip, peerAverage, peerRank,
 *             wasteScore, severity, isFlagged, plainLanguageSummary, flagReason,
 *             trips (capped to 20 to stay within Firestore doc limits)
 */
async function uploadLeaderExpenses() {
  const enrichedPath = path.join(OUTPUT_ROOT, 'processed', 'leader_expenses_enriched.json');
  if (!fs.existsSync(enrichedPath)) {
    console.log('[firebase] ⚠ leader_expenses: leader_expenses_enriched.json not found, skipping');
    return 0;
  }

  const { leaders } = JSON.parse(fs.readFileSync(enrichedPath));
  if (!leaders || leaders.length === 0) {
    console.log('[firebase] ⚠ leader_expenses: no leader records found, skipping');
    return 0;
  }

  const docs = leaders.map(l => withTimestamp({
    id:                   l.id,
    person:               l.person               || null,
    role:                 l.role                 || null,
    jurisdiction:         l.jurisdiction,
    currency:             l.currency             || null,
    department:           l.department           || null,
    party:                l.party                || null,
    roleTier:             l.roleTier             || null,
    hasAmounts:           l.hasAmounts           ?? false,
    totalExpenses:        l.totalExpenses        ?? null,
    tripCount:            l.tripCount            ?? 0,
    averageTripCost:      l.averageTripCost      ?? null,
    mostExpensiveTrip:    l.mostExpensiveTrip    ?? null,
    transportation:       l.transportation       ?? null,
    accommodation:        l.accommodation        ?? null,
    mealsEntertainment:   l.mealsEntertainment   ?? null,
    otherExpenses:        l.otherExpenses        ?? null,
    peerAverage:          l.peerAverage          ?? null,
    peerRank:             l.peerRank             ?? null,
    peerGroupSize:        l.peerGroupSize        ?? null,
    peerComparison:       l.peerComparison       ?? null,
    wasteScore:           l.wasteScore           ?? null,
    severity:             l.severity             ?? null,
    isFlagged:            l.isFlagged            ?? false,
    plainLanguageSummary: l.plainLanguageSummary ?? null,
    flagReason:           l.flagReason           ?? null,
    dataNote:             l.dataNote             ?? null,
    sourceUrl:            l.sourceUrl            ?? null,
    processedAt:          l.processedAt          ?? null,
    // Cap trips array to 20 entries to stay within Firestore 1MB doc limit
    trips: (l.trips || []).slice(0, 20),
  }));

  const count = await batchWrite('leader_expenses', docs);
  console.log(`[firebase] ✓ leader_expenses: ${count} documents written`);
  return count;
}

/**
 * Upload federal budget distribution, department spending, and "Where the Money
 * Goes" stats to the `budget_data` collection.
 * One document per jurisdiction (doc ID = CA | US | UK | AU).
 * Reads from output/budget_analytics/budget_{JUR}_{ts}.json files.
 */
async function uploadBudgetData() {
  const dir = path.join(OUTPUT_ROOT, 'budget_analytics');
  if (!fs.existsSync(dir)) {
    console.log('[firebase] ⚠ budget_data: output/budget_analytics/ not found, skipping');
    return 0;
  }

  const files = loadLatestFiles(dir).filter(f => path.basename(f).startsWith('budget_'));
  if (files.length === 0) {
    console.log('[firebase] ⚠ budget_data: no budget files found, skipping');
    return 0;
  }

  const db    = getDb();
  const batch = db.batch();
  const now   = new Date().toISOString();
  let count   = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(file));
    const jur  = data.jurisdiction;
    if (!jur) continue;

    const ref = db.collection('budget_data').doc(jur);
    batch.set(ref, stripUndefined({ ...data, last_updated: now }), { merge: true });
    count++;
  }

  await batch.commit();
  console.log(`[firebase] ✓ budget_data: ${count} documents written`);
  return count;
}

/**
 * Upload GDP, unemployment, inflation, crime trends, and sector spending stats
 * to the `analytics_data` collection.
 * One document per jurisdiction (doc ID = CA | US | UK | AU).
 * Reads from the latest output/budget_analytics/analytics_{ts}.json file.
 */
async function uploadAnalyticsData() {
  const dir = path.join(OUTPUT_ROOT, 'budget_analytics');
  if (!fs.existsSync(dir)) {
    console.log('[firebase] ⚠ analytics_data: output/budget_analytics/ not found, skipping');
    return 0;
  }

  const files = loadLatestFiles(dir).filter(f => path.basename(f).startsWith('analytics_'));
  if (files.length === 0) {
    console.log('[firebase] ⚠ analytics_data: no analytics files found, skipping');
    return 0;
  }

  // loadLatestFiles returns the latest file per prefix; there is only one prefix here
  const { jurisdictions } = JSON.parse(fs.readFileSync(files[0]));
  if (!jurisdictions || Object.keys(jurisdictions).length === 0) {
    console.log('[firebase] ⚠ analytics_data: no jurisdiction records found, skipping');
    return 0;
  }

  const db    = getDb();
  const batch = db.batch();
  const now   = new Date().toISOString();
  let count   = 0;

  for (const [jur, data] of Object.entries(jurisdictions)) {
    const ref = db.collection('analytics_data').doc(jur);
    batch.set(ref, stripUndefined({ ...data, last_updated: now }), { merge: true });
    count++;
  }

  await batch.commit();
  console.log(`[firebase] ✓ analytics_data: ${count} documents written`);
  return count;
}

/**
 * Upload social statistics to the `social_stats` collection.
 *
 * Each stat becomes one flat Firestore document keyed by
 * {JUR}_{YYYY}_{Q}_{statName}, e.g. US_2026_Q1_homicideRate.
 *
 * Schema: country, quarter, year, statName, value, unit, date,
 *         sourceUrl, updateFrequency, last_updated.
 *
 * Reads from output/socialstats/socialstats_{JUR}_{ts}.json (one per country).
 */

// Source URL lookup for legacy metrics that store source as a string.
const SOCIAL_STAT_SOURCE_URLS = {
  unemployment: {
    US: 'https://api.bls.gov/publicAPI/v1/timeseries/data/LNS14000000?latest=true',
    CA: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410028703',
    UK: 'https://api.worldbank.org/v2/country/GB/indicator/SL.UEM.TOTL.ZS?format=json',
    AU: 'https://api.data.abs.gov.au/data/LF/1.3.1599.20.M/',
  },
  inflation: {
    default: 'https://api.worldbank.org/v2/country/indicator/FP.CPI.TOTL.ZG?format=json',
  },
  housePrices: {
    US: 'https://api.census.gov/data',
    CA: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810020501',
    UK: 'https://data.gov.uk',
    AU: 'https://data.gov.au',
  },
  rent: {
    US: 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUSR0000SEHA?latest=true',
    CA: 'https://open.canada.ca',
    UK: 'https://data.gov.uk',
    AU: 'https://data.gov.au',
  },
  immigration: {
    default: 'https://api.worldbank.org/v2/country/indicator/SM.POP.TOTL.ZS?format=json',
  },
  homelessness: {
    US: 'https://www.huduser.gov/portal/datasets/ahar.html',
    CA: 'https://www.canada.ca/en/employment-social-development/programs/homelessness.html',
    UK: 'https://www.gov.uk/government/statistics/statutory-homelessness-in-england',
    AU: 'https://www.aihw.gov.au/reports/homelessness-services/specialist-homelessness-services-annual-report',
  },
};

/**
 * Flatten one country's socialstats document into an array of flat stat records
 * matching the { country, statName, value, unit, date, sourceUrl, updateFrequency } schema.
 */
function flattenSocialStatDocs(doc, now) {
  const { country, quarter, year } = doc;
  const qKey = `${country}_${year}_${quarter}`;
  const docs = [];

  function push(statName, value, unit, date, sourceUrl, updateFrequency, extra = {}) {
    docs.push(stripUndefined({
      id:              `${qKey}_${statName}`,
      country,
      quarter,
      year,
      statName,
      value:           value ?? null,
      unit:            unit  ?? null,
      date:            date  != null ? String(date) : null,
      sourceUrl:       sourceUrl ?? null,
      updateFrequency: updateFrequency ?? null,
      ...extra,
      last_updated: now,
    }));
  }

  function srcUrl(statName, jur) {
    const map = SOCIAL_STAT_SOURCE_URLS[statName] || {};
    return map[jur] || map.default || null;
  }

  // ── Legacy metrics (richer nested shape — extract primary value) ────────────

  push(
    'unemployment',
    doc.unemployment?.rate,
    '% of labour force',
    doc.unemployment?.year ?? doc.unemployment?.period,
    srcUrl('unemployment', country),
    country === 'UK' ? 'Annual (World Bank)' : 'Monthly'
  );

  push(
    'inflation',
    doc.inflation?.annualPct,
    '% annual change in CPI',
    doc.inflation?.dataYear,
    srcUrl('inflation', country),
    'Annual'
  );

  // House prices: median home value (US) or housing price index (CA) or null (UK/AU)
  const hpValue = doc.housePrices?.medianHomeValueUSD ?? doc.housePrices?.newHousingPriceIndex ?? null;
  const hpUnit  = doc.housePrices?.medianHomeValueUSD  ? 'USD (median owner-occupied home value)'
                : doc.housePrices?.newHousingPriceIndex ? 'New Housing Price Index (2016=100)' : null;
  push(
    'housePrices',
    hpValue,
    hpUnit,
    doc.housePrices?.dataYear ?? doc.housePrices?.period ?? null,
    srcUrl('housePrices', country),
    country === 'CA' ? 'Monthly' : 'Annual'
  );

  // Rent: median gross rent (US Census) or CPI rent index (BLS)
  const rentValue = doc.rent?.medianGrossRentUSD ?? doc.rent?.cpiRentIndex ?? null;
  const rentUnit  = doc.rent?.medianGrossRentUSD ? 'USD/month (median gross rent)'
                  : doc.rent?.cpiRentIndex       ? 'CPI index (1982-84=100)' : null;
  push(
    'rent',
    rentValue,
    rentUnit,
    doc.rent?.dataYear ?? doc.rent?.period ?? null,
    srcUrl('rent', country),
    country === 'US' ? 'Annual (ACS) / Monthly (BLS)' : 'Annual'
  );

  push(
    'immigration',
    doc.immigration?.migrantStockPctOfPopulation,
    '% of population that are international migrants',
    doc.immigration?.migrantStockYear,
    srcUrl('immigration', country),
    'Every 5 years (UN/World Bank estimates)'
  );

  // Homelessness: value is usually null (published as reports, not open APIs)
  push(
    'homelessness',
    null,
    'point-in-time homeless count (not available via open API)',
    null,
    srcUrl('homelessness', country),
    'Annual'
  );

  // ── New metrics — already in { value, unit, date, sourceUrl, updateFrequency } shape ──
  const NEW_STAT_KEYS = [
    'crimeRate', 'drugOverdoses', 'homicideRate', 'roadFatalities',
    'lifeExpectancy', 'obesityRate', 'povertyRate', 'graduationRates', 'studentDebt',
  ];

  for (const key of NEW_STAT_KEYS) {
    const s = doc[key];
    if (!s) continue;

    if (key === 'graduationRates') {
      // Two values: high-school-level and bachelor's-level graduation rates
      push(
        'graduationRates_highSchool',
        s.highSchoolOrEquivalentPct ?? s.value ?? null,
        '% of population 25+ with at least upper-secondary / high-school education',
        s.date,
        s.sourceUrl,
        s.updateFrequency,
        { govtEdSpendPctGDP: s.govtEdSpendPctGDP ?? null }
      );
      push(
        'graduationRates_tertiary',
        s.bachelorsDegreeOrHigherPct ?? null,
        '% of population 25+ with at least a Bachelor\'s degree',
        s.date,
        s.sourceUrl,
        s.updateFrequency
      );
    } else {
      push(key, s.value, s.unit, s.date, s.sourceUrl, s.updateFrequency);
    }
  }

  return docs;
}

async function uploadSocialStats() {
  const dir = path.join(OUTPUT_ROOT, 'socialstats');
  if (!fs.existsSync(dir)) {
    console.log('[firebase] ⚠ social_stats: output/socialstats/ not found, skipping');
    return 0;
  }

  const files = loadLatestFiles(dir).filter(f => path.basename(f).startsWith('socialstats_'));
  if (files.length === 0) {
    console.log('[firebase] ⚠ social_stats: no socialstats files found. Run npm run ingest:social-stats first.');
    return 0;
  }

  const now  = new Date().toISOString();
  const docs = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file));
      docs.push(...flattenSocialStatDocs(raw, now));
    } catch (err) {
      console.warn(`[firebase] ⚠ social_stats: could not parse ${path.basename(file)}: ${err.message}`);
    }
  }

  if (docs.length === 0) {
    console.log('[firebase] ⚠ social_stats: no stat records to upload');
    return 0;
  }

  const count = await batchWrite('social_stats', docs);
  console.log(`[firebase] ✓ social_stats: ${count} documents written (${files.length} countries × ~${Math.round(count / files.length)} stats each)`);
  return count;
}

/**
 * Upload AI-enriched quarterly government statistics to `government_stats`.
 * One document per jurisdiction per quarter (doc ID = {JUR}_{YYYY}_{Q}).
 *
 * Prefers output/processed/gov_stats_enriched.json (post-Claude AI analysis).
 * Falls back to raw output/govstats/govstats_{JUR}_{ts}.json files if enriched
 * file is absent.
 *
 * Firestore fields: country, quarter, year, revenue, spending, deficit,
 * nationalDebt, unemployment, foreignAid, grants, departmentTrends,
 * fiscalHealthScore, fiscalHealthRating, plainLanguageSummary,
 * keyInsights, alerts, processedAt, last_updated.
 */
async function uploadGovStats() {
  const enrichedPath = path.join(OUTPUT_ROOT, 'processed', 'gov_stats_enriched.json');
  const rawDir       = path.join(OUTPUT_ROOT, 'govstats');

  const db    = getDb();
  const batch = db.batch();
  const now   = new Date().toISOString();
  let count   = 0;

  if (fs.existsSync(enrichedPath)) {
    // ── Preferred: AI-enriched file ───────────────────────────────────────
    const { countries } = JSON.parse(fs.readFileSync(enrichedPath));
    if (!countries || countries.length === 0) {
      console.log('[firebase] ⚠ government_stats: enriched file has no countries, skipping');
      return 0;
    }
    for (const doc of countries) {
      const docId = sanitizeId(doc.id || `${doc.country}_${doc.year}_${doc.quarter}`);
      if (!docId) continue;
      const ref = db.collection('government_stats').doc(docId);
      batch.set(ref, stripUndefined({ ...doc, last_updated: now }), { merge: true });
      count++;
    }
  } else if (fs.existsSync(rawDir)) {
    // ── Fallback: raw govstats files ──────────────────────────────────────
    console.log('[firebase] ⚠ government_stats: enriched file not found, falling back to raw govstats');
    const files = loadLatestFiles(rawDir).filter(f => path.basename(f).startsWith('govstats_'));
    if (files.length === 0) {
      console.log('[firebase] ⚠ government_stats: no govstats files found, skipping');
      return 0;
    }
    for (const file of files) {
      const data  = JSON.parse(fs.readFileSync(file));
      const docId = sanitizeId(data.id || `${data.country}_${data.year}_${data.quarter}`);
      if (!docId) continue;
      const ref = db.collection('government_stats').doc(docId);
      batch.set(ref, stripUndefined({ ...data, last_updated: now }), { merge: true });
      count++;
    }
  } else {
    console.log('[firebase] ⚠ government_stats: output/govstats/ not found, skipping');
    return 0;
  }

  await batch.commit();
  console.log(`[firebase] ✓ government_stats: ${count} documents written`);
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
    leader_expenses:            await uploadLeaderExpenses(),
    expense_leaderboard:        await uploadLeaderboard(),
    expense_anomalies:          await uploadExpenseAnomalies(),
    budget_data:                await uploadBudgetData(),
    analytics_data:             await uploadAnalyticsData(),
    government_stats:           await uploadGovStats(),
    social_stats:               await uploadSocialStats(),
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
  uploadLeaderExpenses,
  uploadLeaderboard,
  uploadExpenseAnomalies,
  uploadBudgetData,
  uploadAnalyticsData,
  uploadGovStats,
  uploadSocialStats,
};
