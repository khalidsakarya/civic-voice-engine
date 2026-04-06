require('dotenv').config();
const cron = require('node-cron');
const { runPipeline } = require('./pipeline');
const { processBill } = require('./processing/billProcessor');
const { fetchAllExpenses }        = require('./ingestion/expenseFetcher');
const { processExpenses }         = require('./processing/expenseProcessor');
const { detectWaste }             = require('./processing/wasteDetector');
const { fetchAllLeaderExpenses }    = require('./ingestion/leaderExpenseFetcher');
const { processLeaderExpenses }     = require('./processing/leaderExpenseProcessor');
const { buildLeaderboard }          = require('./processing/leaderLeaderboard');
const { detectLeaderAnomalies }     = require('./processing/leaderAnomalyDetector');
const { fetchAllBudgetAnalytics }   = require('./ingestion/budgetAnalyticsFetcher');
const { main: runTargetedFetch }    = require('./ingestion/targetedFetch');
const { fetchAllGovStats }          = require('./ingestion/govStatsFetcher');
const { fetchAllMemberData }        = require('./ingestion/memberDisclosureFetcher');
const { fetchAllMemberVotes }       = require('./ingestion/memberVotesFetcher');
const { fetchAllMemberAttendance }  = require('./ingestion/memberAttendanceFetcher');
const { fetchAllMemberBios }        = require('./ingestion/memberBioFetcher');
const { fetchAllMemberCommittees }  = require('./ingestion/memberCommitteesFetcher');
const { fetchAllMemberExpenses }    = require('./ingestion/memberExpensesFetcher');
const { fetchAllStockTrades }             = require('./ingestion/stockTradesFetcher');
const { fetchAllCorporateAffiliations }   = require('./ingestion/corporateAffiliationsFetcher');
const { processGovStats }           = require('./processing/govStatsProcessor');
const {
  uploadBills, uploadVotes, uploadMembers, uploadEfficiencyScores,
  uploadMonthlyEfficiencyScores, uploadBudgetSpending, uploadAuditFindings, uploadDepartmentPerformance,
  uploadFinancialDisclosures, uploadLobbyingActivity, uploadContracts, uploadCorporateAffiliations,
  uploadMemberDisclosures, uploadMemberLobbying, uploadMemberVotes, uploadMemberAttendance, uploadMemberBios, uploadMemberCommittees, uploadMemberExpenses, uploadMemberStockTrades, uploadMemberCorporateAffiliations,
  uploadFlaggedExpenses, uploadWasteReports, uploadLeaderExpenses, uploadLeaderboard,
  uploadExpenseAnomalies, uploadBudgetData, uploadAnalyticsData, uploadGovStats,
  uploadTargetedStats,
} = require('./firebase/uploader');
const { writeSchedulerStatus } = require('./firebase/statusWriter');
const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');
const BILL_DIR      = path.resolve(__dirname, '../output/bill');

// ─── Cron schedules (module-level so all cycles can reference them) ───────────

const DAILY_SCHEDULE            = process.env.CRON_DAILY            || '0 2 * * *';    // 02:00 every day
const WEEKLY_SCHEDULE           = process.env.CRON_WEEKLY           || '0 3 * * 0';    // 03:00 every Sunday
const MONTHLY_SCHEDULE          = process.env.CRON_MONTHLY          || '0 5 1 * *';    // 05:00 on the 1st
const BIMONTHLY_SCHEDULE        = process.env.CRON_BIMONTHLY        || '0 4 1,15 * *'; // 04:00 on 1st and 15th
const EXPENSE_SCHEDULE          = process.env.CRON_EXPENSE          || '0 1 * * 3';    // 01:00 every Wednesday
const LEADER_EXPENSE_SCHEDULE   = process.env.CRON_LEADER_EXPENSE   || '0 2 * * 4';    // 02:00 every Thursday
const BUDGET_ANALYTICS_SCHEDULE = process.env.CRON_BUDGET_ANALYTICS || '0 6 1 * *';    // 06:00 on the 1st
const GOV_STATS_SCHEDULE        = process.env.CRON_GOV_STATS        || '0 7 1 1,4,7,10 *'; // 07:00 on Jan/Apr/Jul/Oct 1st

// ─── Source lists ─────────────────────────────────────────────────────────────

const allSources       = require('../config/sources.json');
const dailySources     = allSources.filter(s => s.type === 'bill' || s.type === 'vote');
const weeklySources    = allSources.filter(s => s.type === 'legislator');
const monthlySources   = allSources.filter(s =>
  ['efficiency_score', 'budget', 'audit', 'department_performance'].includes(s.type)
);
const biMonthlySources = allSources.filter(s =>
  ['financial_disclosure', 'lobbying', 'contract', 'corporate_affiliation'].includes(s.type)
);

// ─── Tier definitions ────────────────────────────────────────────────────────
//
//  DAILY      (02:00 every day)           — bills + votes
//    1. Ingest all bill and vote sources
//    2. Process bills with Claude AI
//    3. Score government efficiency
//    4. Upload bills, votes, efficiency_scores to Firestore
//
//  WEEKLY     (03:00 every Sunday)        — member profiles
//    1. Ingest all legislator sources
//    2. Upload members to Firestore
//
//  MONTHLY    (05:00 on the 1st)          — efficiency scores, budget & spending,
//                                           audit findings, department performance
//    1. Ingest efficiency_score, budget, audit, department_performance sources
//    2. Recalculate efficiency scores
//    3. Upload all four collections to Firestore
//
//  BIMONTHLY  (04:00 on 1st and 15th)    — financial disclosures, lobbying,
//                                           government contracts, corporate affiliations
//    1. Ingest financial_disclosure, lobbying, contract, corporate_affiliation sources
//    2. Upload all four collections to Firestore
//
//  BUDGET_ANALYTICS  (06:00 on the 1st)  — federal budget distribution & spending,
//                                           department spending vs budgets,
//                                           GDP/unemployment/inflation/crime analytics,
//                                           "Where the Money Goes" overview stats,
//                                           government efficiency recalculation
//    1. Fetch budget + analytics data (CA / US / UK / AU)
//    2. Recalculate government efficiency scores
//    3. Upload budget_data + analytics_data to Firestore
//
//  GOV_STATS QUARTERLY (07:00 Jan/Apr/Jul/Oct 1st) — important government stats
//                                           Revenue sources breakdown
//                                           Total spending by department
//                                           Deficit and surplus figures
//                                           National debt total
//                                           Unemployment rate
//                                           Foreign aid given (ODA)
//                                           Foreign loans note
//                                           Grants by department
//                                           Department spending trends
//    1. Fetch gov stats (World Bank + BLS + USAspending + open.canada.ca CKAN)
//    2. Upload government_stats to Firestore
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Daily cycle ─────────────────────────────────────────────────────────────

async function runDailyCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:daily] Cycle started at ${startedAt.toISOString()}`);
  console.log(`[scheduler:daily] Sources: ${dailySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  let aiCallsMade = 0, recordsSkipped = 0;
  let billCount = 0, voteCount = 0, scoreCount = 0;

  try {
    console.log('\n[scheduler:daily] Step 1/4 — Ingesting bills & votes...');
    await runPipeline(dailySources);

    console.log('\n[scheduler:daily] Step 2/4 — Processing bills with Claude AI...');
    ({ succeeded: aiCallsMade, failed: recordsSkipped } = await processBillsFromOutput());

    console.log('\n[scheduler:daily] Step 3/4 — Scoring government efficiency...');
    delete require.cache[require.resolve('./scoreEfficiency')];
    require('./scoreEfficiency');

    console.log('\n[scheduler:daily] Step 4/4 — Uploading to Firebase...');
    billCount  = await uploadBills();
    voteCount  = await uploadVotes();
    scoreCount = await uploadEfficiencyScores();

    console.log(`\n[scheduler:daily] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:daily]   bills: ${billCount}  votes: ${voteCount}  efficiency_scores: ${scoreCount}`);

    await writeSchedulerStatus('daily', {
      startedAt,
      status:         'success',
      collections:    ['bills', 'votes', 'efficiency_scores'],
      recordsUpdated: billCount + voteCount + scoreCount,
      recordsSkipped,
      aiCallsMade,
      cronSchedule:   DAILY_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:daily] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('daily', {
      startedAt,
      status:         'error',
      collections:    ['bills', 'votes', 'efficiency_scores'],
      recordsUpdated: billCount + voteCount + scoreCount,
      recordsSkipped,
      aiCallsMade,
      cronSchedule:   DAILY_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Weekly cycle ─────────────────────────────────────────────────────────────

async function runWeeklyCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:weekly] Cycle started at ${startedAt.toISOString()}`);
  console.log(`[scheduler:weekly] Sources: ${weeklySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  let memberCount = 0, memberVotesCount = 0, memberAttendanceCount = 0, memberBiosCount = 0, memberCommitteesCount = 0;

  try {
    console.log('\n[scheduler:weekly] Step 1/10 — Ingesting member profiles...');
    await runPipeline(weeklySources);

    console.log('\n[scheduler:weekly] Step 2/10 — Uploading members to Firebase...');
    memberCount = await uploadMembers();

    console.log('\n[scheduler:weekly] Step 3/10 — Fetching member voting records (CA / US / UK)...');
    await fetchAllMemberVotes();

    console.log('\n[scheduler:weekly] Step 4/10 — Uploading member votes to Firebase...');
    memberVotesCount = await uploadMemberVotes();

    console.log('\n[scheduler:weekly] Step 5/10 — Fetching member attendance (CA / US / UK)...');
    await fetchAllMemberAttendance();

    console.log('\n[scheduler:weekly] Step 6/10 — Uploading member attendance to Firebase...');
    memberAttendanceCount = await uploadMemberAttendance();

    console.log('\n[scheduler:weekly] Step 7/10 — Fetching member biographies (CA / US / UK / AU)...');
    await fetchAllMemberBios();

    console.log('\n[scheduler:weekly] Step 8/10 — Uploading member bios to Firebase...');
    memberBiosCount = await uploadMemberBios();

    console.log('\n[scheduler:weekly] Step 9/10 — Fetching member committee assignments (CA / US / UK / AU)...');
    await fetchAllMemberCommittees();

    console.log('\n[scheduler:weekly] Step 10/10 — Uploading member committees to Firebase...');
    memberCommitteesCount = await uploadMemberCommittees();

    console.log(`\n[scheduler:weekly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:weekly]   members: ${memberCount}  votes: ${memberVotesCount}  attendance: ${memberAttendanceCount}  bios: ${memberBiosCount}  committees: ${memberCommitteesCount}`);

    await writeSchedulerStatus('weekly', {
      startedAt,
      status:         'success',
      collections:    ['members', 'member_votes', 'member_attendance', 'member_bios', 'member_committees'],
      recordsUpdated: memberCount + memberVotesCount + memberAttendanceCount + memberBiosCount + memberCommitteesCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   WEEKLY_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:weekly] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('weekly', {
      startedAt,
      status:         'error',
      collections:    ['members', 'member_votes', 'member_attendance', 'member_bios', 'member_committees'],
      recordsUpdated: memberCount + memberVotesCount + memberAttendanceCount + memberBiosCount + memberCommitteesCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   WEEKLY_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Monthly cycle (1st of each month) ───────────────────────────────────────

async function runMonthlyCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:monthly] Cycle started at ${startedAt.toISOString()}`);
  console.log(`[scheduler:monthly] Sources: ${monthlySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  let efficiencyCount = 0, budgetCount = 0, auditCount = 0, performanceCount = 0, targetedCount = 0;

  try {
    console.log('\n[scheduler:monthly] Step 1/5 — Ingesting budget, audit & performance data...');
    await runPipeline(monthlySources);

    console.log('\n[scheduler:monthly] Step 2/5 — Recalculating efficiency scores...');
    delete require.cache[require.resolve('./scoreEfficiency')];
    require('./scoreEfficiency');

    console.log('\n[scheduler:monthly] Step 3/5 — Uploading efficiency/budget/audit to Firebase...');
    efficiencyCount  = await uploadMonthlyEfficiencyScores();
    budgetCount      = await uploadBudgetSpending();
    auditCount       = await uploadAuditFindings();
    performanceCount = await uploadDepartmentPerformance();

    console.log('\n[scheduler:monthly] Step 4/5 — Fetching live targeted stats (CA / US / UK / AU)...');
    await runTargetedFetch();

    console.log('\n[scheduler:monthly] Step 5/5 — Uploading targeted stats to social_stats...');
    targetedCount = await uploadTargetedStats();

    const total = efficiencyCount + budgetCount + auditCount + performanceCount + targetedCount;
    console.log(`\n[scheduler:monthly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:monthly]   efficiency_scores_monthly: ${efficiencyCount}  budget_spending: ${budgetCount}  audit_findings: ${auditCount}  department_performance: ${performanceCount}  social_stats (targeted): ${targetedCount}`);

    await writeSchedulerStatus('monthly', {
      startedAt,
      status:         'success',
      collections:    ['efficiency_scores_monthly', 'budget_spending', 'audit_findings', 'department_performance', 'social_stats'],
      recordsUpdated: total,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   MONTHLY_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:monthly] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('monthly', {
      startedAt,
      status:         'error',
      collections:    ['efficiency_scores_monthly', 'budget_spending', 'audit_findings', 'department_performance', 'social_stats'],
      recordsUpdated: efficiencyCount + budgetCount + auditCount + performanceCount + targetedCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   MONTHLY_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Bimonthly cycle (1st and 15th) ──────────────────────────────────────────

async function runBiMonthlyCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:bimonthly] Cycle started at ${startedAt.toISOString()}`);
  console.log(`[scheduler:bimonthly] Sources: ${biMonthlySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  let disclosureCount = 0, lobbyingCount = 0, contractCount = 0, corporateCount = 0;
  let memberDisclosureCount = 0, memberLobbyingCount = 0, memberExpensesCount = 0;
  let memberStockTradesCount = 0, memberCorporateAffiliationsCount = 0;

  try {
    console.log('\n[scheduler:bimonthly] Step 1/9 — Ingesting financial & lobbying data...');
    await runPipeline(biMonthlySources);

    console.log('\n[scheduler:bimonthly] Step 2/9 — Fetching member disclosures & lobbying (US/UK/AU/CA)...');
    await fetchAllMemberData();

    console.log('\n[scheduler:bimonthly] Step 3/9 — Uploading disclosures & lobbying to Firebase...');
    disclosureCount       = await uploadFinancialDisclosures();
    lobbyingCount         = await uploadLobbyingActivity();
    contractCount         = await uploadContracts();
    corporateCount        = await uploadCorporateAffiliations();
    memberDisclosureCount = await uploadMemberDisclosures();
    memberLobbyingCount   = await uploadMemberLobbying();

    console.log('\n[scheduler:bimonthly] Step 4/9 — Fetching member expense reports (CA/US/UK/AU)...');
    await fetchAllMemberExpenses();

    console.log('\n[scheduler:bimonthly] Step 5/9 — Uploading member expenses to Firebase...');
    memberExpensesCount = await uploadMemberExpenses();

    console.log('\n[scheduler:bimonthly] Step 6/9 — Fetching STOCK Act trade disclosures (US House & Senate)...');
    await fetchAllStockTrades();

    console.log('\n[scheduler:bimonthly] Step 7/9 — Uploading member stock trades to Firebase...');
    memberStockTradesCount = await uploadMemberStockTrades();

    console.log('\n[scheduler:bimonthly] Step 8/9 — Fetching corporate affiliations (CA/US/UK/AU)...');
    await fetchAllCorporateAffiliations();

    console.log('\n[scheduler:bimonthly] Step 9/9 — Uploading member corporate affiliations to Firebase...');
    memberCorporateAffiliationsCount = await uploadMemberCorporateAffiliations();

    const total = disclosureCount + lobbyingCount + contractCount + corporateCount +
      memberDisclosureCount + memberLobbyingCount + memberExpensesCount +
      memberStockTradesCount + memberCorporateAffiliationsCount;
    console.log(`\n[scheduler:bimonthly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:bimonthly]   financial_disclosures: ${disclosureCount}  lobbying_activity: ${lobbyingCount}  contracts: ${contractCount}  corporate_affiliations: ${corporateCount}`);
    console.log(`[scheduler:bimonthly]   member_disclosures: ${memberDisclosureCount}  member_lobbying: ${memberLobbyingCount}  member_expenses: ${memberExpensesCount}`);
    console.log(`[scheduler:bimonthly]   member_stock_trades: ${memberStockTradesCount}  member_corporate_affiliations: ${memberCorporateAffiliationsCount}`);

    await writeSchedulerStatus('bimonthly', {
      startedAt,
      status:         'success',
      collections:    ['financial_disclosures', 'lobbying_activity', 'contracts', 'corporate_affiliations', 'member_disclosures', 'member_lobbying', 'member_expenses', 'member_stock_trades', 'member_corporate_affiliations'],
      recordsUpdated: total,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   BIMONTHLY_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:bimonthly] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('bimonthly', {
      startedAt,
      status:         'error',
      collections:    ['financial_disclosures', 'lobbying_activity', 'contracts', 'corporate_affiliations', 'member_disclosures', 'member_lobbying', 'member_expenses', 'member_stock_trades', 'member_corporate_affiliations'],
      recordsUpdated: disclosureCount + lobbyingCount + contractCount + corporateCount +
        memberDisclosureCount + memberLobbyingCount + memberExpensesCount +
        memberStockTradesCount + memberCorporateAffiliationsCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   BIMONTHLY_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Expense cycle (every Wednesday) ─────────────────────────────────────────
//
//  EXPENSE_WEEKLY  (01:00 every Wednesday)  — government expense & waste
//    1. Fetch raw expense data from CA / US / UK / AU open-data APIs
//    2. Run Claude AI waste analysis  → expenses_enriched.json
//    3. Run pattern detector          → waste_report.json
//    4. Upload flagged_expenses + waste_reports to Firestore

async function runExpenseCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:expense] Cycle started at ${startedAt.toISOString()}`);
  console.log('='.repeat(60));

  let expenseCount = 0, wasteCount = 0, aiCalls = 0;

  try {
    console.log('\n[scheduler:expense] Step 1/4 — Fetching expense data (CA / US / UK / AU)...');
    await fetchAllExpenses();

    console.log('\n[scheduler:expense] Step 2/4 — Processing with Claude AI waste analysis...');
    const expenseResult = await processExpenses();
    aiCalls = expenseResult.apiCallsMade || 0;

    console.log('\n[scheduler:expense] Step 3/4 — Running waste pattern analysis...');
    await detectWaste();

    console.log('\n[scheduler:expense] Step 4/4 — Uploading to Firebase...');
    expenseCount = await uploadFlaggedExpenses();
    wasteCount   = await uploadWasteReports();

    console.log(`\n[scheduler:expense] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:expense]   flagged_expenses: ${expenseCount}  waste_reports: ${wasteCount}`);

    await writeSchedulerStatus('expense_weekly', {
      startedAt,
      status:         'success',
      collections:    ['flagged_expenses', 'waste_reports'],
      recordsUpdated: expenseCount + wasteCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCalls,
      cronSchedule:   EXPENSE_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:expense] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('expense_weekly', {
      startedAt,
      status:         'error',
      collections:    ['flagged_expenses', 'waste_reports'],
      recordsUpdated: expenseCount + wasteCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCalls,
      cronSchedule:   EXPENSE_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Leader expense cycle (every Thursday) ────────────────────────────────────
//
//  LEADER_EXPENSE_WEEKLY  (02:00 every Thursday)  — minister/secretary expenses
//    1. Fetch leader expense data from CA / US / UK / AU open-data APIs
//    2. Run Claude AI analysis (waste score, peer comparison, summaries)
//    3. Run anomaly detection (second AI pass — 6 pattern types, scandal scores)
//    4. Build expense leaderboard with trend arrows (vs previous run)
//    5. Upload leader_expenses + expense_anomalies + expense_leaderboard to Firestore

async function runLeaderExpenseCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:leader-expense] Cycle started at ${startedAt.toISOString()}`);
  console.log('='.repeat(60));

  let leaderCount = 0, anomalyCount = 0, leaderboardCount = 0, aiCalls = 0;

  try {
    console.log('\n[scheduler:leader-expense] Step 1/6 — Fetching leader expenses (CA / US / UK / AU)...');
    await fetchAllLeaderExpenses();

    console.log('\n[scheduler:leader-expense] Step 2/6 — Processing with Claude AI (waste scores + summaries)...');
    const leaderResult = await processLeaderExpenses();
    aiCalls += leaderResult.apiCallsMade || 0;

    console.log('\n[scheduler:leader-expense] Step 3/6 — Running anomaly detection (6 pattern types)...');
    const anomalyResult = await detectLeaderAnomalies();
    aiCalls += anomalyResult.apiCallsMade || 0;

    console.log('\n[scheduler:leader-expense] Step 4/6 — Building expense leaderboard with trend arrows...');
    buildLeaderboard();

    console.log('\n[scheduler:leader-expense] Step 5/6 — Uploading leader_expenses + anomalies to Firebase...');
    leaderCount  = await uploadLeaderExpenses();
    anomalyCount = await uploadExpenseAnomalies();

    console.log('\n[scheduler:leader-expense] Step 6/6 — Uploading expense_leaderboard to Firebase...');
    leaderboardCount = await uploadLeaderboard();

    console.log(`\n[scheduler:leader-expense] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:leader-expense]   leader_expenses: ${leaderCount}  expense_anomalies: ${anomalyCount}  expense_leaderboard: ${leaderboardCount}`);

    await writeSchedulerStatus('leader_expense_weekly', {
      startedAt,
      status:         'success',
      collections:    ['leader_expenses', 'expense_anomalies', 'expense_leaderboard'],
      recordsUpdated: leaderCount + anomalyCount + leaderboardCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCalls,
      cronSchedule:   LEADER_EXPENSE_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:leader-expense] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('leader_expense_weekly', {
      startedAt,
      status:         'error',
      collections:    ['leader_expenses', 'expense_anomalies', 'expense_leaderboard'],
      recordsUpdated: leaderCount + anomalyCount + leaderboardCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCalls,
      cronSchedule:   LEADER_EXPENSE_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Budget & analytics cycle (1st of each month) ────────────────────────────
//
//  BUDGET_ANALYTICS  (06:00 on the 1st)  — federal budget distribution & spending,
//    GDP, unemployment, inflation, crime trends, efficiency recalculation
//    1. Fetch budget data from CA / US / UK / AU open-data APIs + World Bank
//    2. Recalculate government efficiency scores
//    3. Upload budget_data + analytics_data to Firestore

async function runBudgetAnalyticsCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:budget-analytics] Cycle started at ${startedAt.toISOString()}`);
  console.log('='.repeat(60));

  let budgetCount = 0, analyticsCount = 0;

  try {
    console.log('\n[scheduler:budget-analytics] Step 1/3 — Fetching budget & analytics data (CA / US / UK / AU)...');
    await fetchAllBudgetAnalytics();

    console.log('\n[scheduler:budget-analytics] Step 2/3 — Recalculating government efficiency scores...');
    delete require.cache[require.resolve('./scoreEfficiency')];
    require('./scoreEfficiency');

    console.log('\n[scheduler:budget-analytics] Step 3/3 — Uploading to Firebase...');
    budgetCount    = await uploadBudgetData();
    analyticsCount = await uploadAnalyticsData();

    console.log(`\n[scheduler:budget-analytics] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:budget-analytics]   budget_data: ${budgetCount}  analytics_data: ${analyticsCount}`);

    await writeSchedulerStatus('budget_analytics', {
      startedAt,
      status:         'success',
      collections:    ['budget_data', 'analytics_data'],
      recordsUpdated: budgetCount + analyticsCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   BUDGET_ANALYTICS_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:budget-analytics] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('budget_analytics', {
      startedAt,
      status:         'error',
      collections:    ['budget_data', 'analytics_data'],
      recordsUpdated: budgetCount + analyticsCount,
      recordsSkipped: 0,
      aiCallsMade:    0,
      cronSchedule:   BUDGET_ANALYTICS_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Government stats cycle (quarterly: Jan/Apr/Jul/Oct 1st) ─────────────────
//
//  GOV_STATS_QUARTERLY  (07:00 on 1st of Jan, Apr, Jul, Oct)
//    1. Fetch all gov stats from World Bank + BLS + USAspending + CKAN sources
//    2. Upload government_stats collection to Firestore

async function runGovStatsCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:gov-stats] Cycle started at ${startedAt.toISOString()}`);
  console.log('='.repeat(60));

  let govStatsCount  = 0;
  let aiCallsMadeGov = 0;

  try {
    console.log('\n[scheduler:gov-stats] Step 1/3 — Fetching quarterly government stats (CA / US / UK / AU)...');
    await fetchAllGovStats();

    console.log('\n[scheduler:gov-stats] Step 2/3 — Processing through Claude AI...');
    const processResult = await processGovStats();
    aiCallsMadeGov = processResult.apiCallsMade || 0;

    console.log('\n[scheduler:gov-stats] Step 3/3 — Uploading to Firebase...');
    govStatsCount = await uploadGovStats();

    console.log(`\n[scheduler:gov-stats] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:gov-stats]   government_stats: ${govStatsCount}  AI calls: ${aiCallsMadeGov}`);

    await writeSchedulerStatus('gov_stats_quarterly', {
      startedAt,
      status:         'success',
      collections:    ['government_stats'],
      recordsUpdated: govStatsCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCallsMadeGov,
      cronSchedule:   GOV_STATS_SCHEDULE,
    });
  } catch (err) {
    console.error(`[scheduler:gov-stats] ✗ Failed: ${err.message}`);
    console.error(err.stack);
    await writeSchedulerStatus('gov_stats_quarterly', {
      startedAt,
      status:         'error',
      collections:    ['government_stats'],
      recordsUpdated: govStatsCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCallsMadeGov,
      cronSchedule:   GOV_STATS_SCHEDULE,
      errorMessage:   err.message,
    }).catch(() => {});
  }
}

// ─── Bill processing helper ───────────────────────────────────────────────────
// Returns { total, succeeded, failed } so the daily cycle can track AI stats.

async function processBillsFromOutput() {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  const files = fs.readdirSync(BILL_DIR).filter(f => f.endsWith('.json')).sort();
  const latest = {};
  for (const file of files) {
    const key = file.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latest[key] = file;
  }

  const allBills = [];
  for (const file of Object.values(latest)) {
    const raw = JSON.parse(fs.readFileSync(path.join(BILL_DIR, file)));
    allBills.push(...raw.records);
  }

  console.log(`[scheduler:daily] Processing ${allBills.length} bills...`);
  const results = [];
  let succeeded = 0, failed = 0;

  for (const bill of allBills) {
    try {
      results.push(await processBill(bill));
      succeeded++;
    } catch (err) {
      console.error(`  ✗ ${bill.title?.slice(0, 50)}: ${err.message}`);
      results.push({ ...bill, analysis: null, processedAt: new Date().toISOString(), error: err.message });
      failed++;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(PROCESSED_DIR, `bills_enriched_${timestamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalBills:  results.length,
    bills:       results,
  }, null, 2));

  console.log(`[scheduler:daily] ${succeeded} bills processed (${failed} failed) → ${outFile}`);
  return { total: allBills.length, succeeded, failed };
}

// ─── Start ────────────────────────────────────────────────────────────────────

const RUN_NOW                   = process.argv.includes('--now');
const RUN_DAILY_NOW             = process.argv.includes('--daily');
const RUN_WEEKLY_NOW            = process.argv.includes('--weekly');
const RUN_MONTHLY_NOW           = process.argv.includes('--monthly');
const RUN_BIMONTHLY_NOW         = process.argv.includes('--bimonthly');
const RUN_EXPENSE_NOW           = process.argv.includes('--expenses');
const RUN_LEADER_EXPENSE_NOW    = process.argv.includes('--leader-expenses');
const RUN_BUDGET_ANALYTICS_NOW  = process.argv.includes('--budget-analytics');
const RUN_GOV_STATS_NOW         = process.argv.includes('--gov-stats');
const RUN_TARGETED_STATS_NOW    = process.argv.includes('--targeted-stats');

if (RUN_NOW) {
  runDailyCycle()
    .then(() => runWeeklyCycle())
    .then(() => runMonthlyCycle())
    .then(() => runBiMonthlyCycle())
    .then(() => runExpenseCycle())
    .then(() => runLeaderExpenseCycle())
    .then(() => runBudgetAnalyticsCycle())
    .then(() => runGovStatsCycle())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else if (RUN_DAILY_NOW) {
  runDailyCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_WEEKLY_NOW) {
  runWeeklyCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_MONTHLY_NOW) {
  runMonthlyCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_BIMONTHLY_NOW) {
  runBiMonthlyCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_EXPENSE_NOW) {
  runExpenseCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_LEADER_EXPENSE_NOW) {
  runLeaderExpenseCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_BUDGET_ANALYTICS_NOW) {
  runBudgetAnalyticsCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_GOV_STATS_NOW) {
  runGovStatsCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_TARGETED_STATS_NOW) {
  runTargetedFetch()
    .then(() => uploadTargetedStats())
    .then(n => { console.log(`[scheduler:targeted-stats] ✓ ${n} docs written to social_stats`); process.exit(0); })
    .catch(err => { console.error('[scheduler:targeted-stats] ✗', err.message); process.exit(1); });
} else {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         CIVIC VOICE ENGINE — SCHEDULER STARTED       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Daily            (bills + votes)                            → ${DAILY_SCHEDULE}`);
  console.log(`  Weekly           (member profiles)                          → ${WEEKLY_SCHEDULE}`);
  console.log(`  Monthly          (efficiency, budget, audits, performance,   → ${MONTHLY_SCHEDULE}`);
  console.log(`                    + targeted live stats → social_stats)`);
  console.log(`  Bimonthly        (disclosures, lobbying, contracts,           → ${BIMONTHLY_SCHEDULE}`);
  console.log(`                    + member_disclosures, member_lobbying)`);
  console.log(`  Expense/Waste    (dept expenses + waste analysis)            → ${EXPENSE_SCHEDULE}`);
  console.log(`  Leader Expenses  (minister/secretary expenses + leaderboard) → ${LEADER_EXPENSE_SCHEDULE}`);
  console.log(`  Budget/Analytics (federal budgets, GDP, unemployment, crime) → ${BUDGET_ANALYTICS_SCHEDULE}`);
  console.log(`  Gov Stats        (revenue, debt, deficit, ODA, grants)        → ${GOV_STATS_SCHEDULE}`);
  console.log('\n  Flags: --now (all), --daily, --weekly, --monthly, --bimonthly, --expenses, --leader-expenses, --budget-analytics, --gov-stats, --targeted-stats\n');

  cron.schedule(DAILY_SCHEDULE,            () => runDailyCycle());
  cron.schedule(WEEKLY_SCHEDULE,           () => runWeeklyCycle());
  cron.schedule(MONTHLY_SCHEDULE,          () => runMonthlyCycle());
  cron.schedule(BIMONTHLY_SCHEDULE,        () => runBiMonthlyCycle());
  cron.schedule(EXPENSE_SCHEDULE,          () => runExpenseCycle());
  cron.schedule(LEADER_EXPENSE_SCHEDULE,   () => runLeaderExpenseCycle());
  cron.schedule(BUDGET_ANALYTICS_SCHEDULE, () => runBudgetAnalyticsCycle());
  cron.schedule(GOV_STATS_SCHEDULE,        () => runGovStatsCycle());

  // Run all tiers on startup
  console.log('[scheduler] Running initial cycles on startup...');
  runDailyCycle()
    .then(() => runWeeklyCycle())
    .then(() => runMonthlyCycle())
    .then(() => runBiMonthlyCycle())
    .then(() => runExpenseCycle())
    .then(() => runLeaderExpenseCycle())
    .then(() => runBudgetAnalyticsCycle())
    .then(() => runGovStatsCycle());
}
