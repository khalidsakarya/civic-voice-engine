require('dotenv').config();
const cron = require('node-cron');
const { runPipeline } = require('./pipeline');
const { processBill } = require('./processing/billProcessor');
const { fetchAllExpenses }        = require('./ingestion/expenseFetcher');
const { processExpenses }         = require('./processing/expenseProcessor');
const { detectWaste }             = require('./processing/wasteDetector');
const { fetchAllLeaderExpenses }  = require('./ingestion/leaderExpenseFetcher');
const { processLeaderExpenses }   = require('./processing/leaderExpenseProcessor');
const { buildLeaderboard }        = require('./processing/leaderLeaderboard');
const {
  uploadBills, uploadVotes, uploadMembers, uploadEfficiencyScores,
  uploadMonthlyEfficiencyScores, uploadBudgetSpending, uploadAuditFindings, uploadDepartmentPerformance,
  uploadFinancialDisclosures, uploadLobbyingActivity, uploadContracts, uploadCorporateAffiliations,
  uploadFlaggedExpenses, uploadWasteReports, uploadLeaderExpenses, uploadLeaderboard,
} = require('./firebase/uploader');
const { writeSchedulerStatus } = require('./firebase/statusWriter');
const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');
const BILL_DIR      = path.resolve(__dirname, '../output/bill');

// ─── Cron schedules (module-level so all cycles can reference them) ───────────

const DAILY_SCHEDULE     = process.env.CRON_DAILY     || '0 2 * * *';    // 02:00 every day
const WEEKLY_SCHEDULE    = process.env.CRON_WEEKLY    || '0 3 * * 0';    // 03:00 every Sunday
const MONTHLY_SCHEDULE   = process.env.CRON_MONTHLY   || '0 5 1 * *';    // 05:00 on the 1st
const BIMONTHLY_SCHEDULE = process.env.CRON_BIMONTHLY || '0 4 1,15 * *'; // 04:00 on 1st and 15th
const EXPENSE_SCHEDULE        = process.env.CRON_EXPENSE        || '0 1 * * 3';    // 01:00 every Wednesday
const LEADER_EXPENSE_SCHEDULE = process.env.CRON_LEADER_EXPENSE || '0 2 * * 4';    // 02:00 every Thursday

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

  let memberCount = 0;

  try {
    console.log('\n[scheduler:weekly] Step 1/2 — Ingesting member profiles...');
    await runPipeline(weeklySources);

    console.log('\n[scheduler:weekly] Step 2/2 — Uploading members to Firebase...');
    memberCount = await uploadMembers();

    console.log(`\n[scheduler:weekly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:weekly]   members: ${memberCount}`);

    await writeSchedulerStatus('weekly', {
      startedAt,
      status:         'success',
      collections:    ['members'],
      recordsUpdated: memberCount,
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
      collections:    ['members'],
      recordsUpdated: memberCount,
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

  let efficiencyCount = 0, budgetCount = 0, auditCount = 0, performanceCount = 0;

  try {
    console.log('\n[scheduler:monthly] Step 1/3 — Ingesting budget, audit & performance data...');
    await runPipeline(monthlySources);

    console.log('\n[scheduler:monthly] Step 2/3 — Recalculating efficiency scores...');
    delete require.cache[require.resolve('./scoreEfficiency')];
    require('./scoreEfficiency');

    console.log('\n[scheduler:monthly] Step 3/3 — Uploading to Firebase...');
    efficiencyCount  = await uploadMonthlyEfficiencyScores();
    budgetCount      = await uploadBudgetSpending();
    auditCount       = await uploadAuditFindings();
    performanceCount = await uploadDepartmentPerformance();

    console.log(`\n[scheduler:monthly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:monthly]   efficiency_scores_monthly: ${efficiencyCount}  budget_spending: ${budgetCount}  audit_findings: ${auditCount}  department_performance: ${performanceCount}`);

    await writeSchedulerStatus('monthly', {
      startedAt,
      status:         'success',
      collections:    ['efficiency_scores_monthly', 'budget_spending', 'audit_findings', 'department_performance'],
      recordsUpdated: efficiencyCount + budgetCount + auditCount + performanceCount,
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
      collections:    ['efficiency_scores_monthly', 'budget_spending', 'audit_findings', 'department_performance'],
      recordsUpdated: efficiencyCount + budgetCount + auditCount + performanceCount,
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

  try {
    console.log('\n[scheduler:bimonthly] Step 1/2 — Ingesting financial & lobbying data...');
    await runPipeline(biMonthlySources);

    console.log('\n[scheduler:bimonthly] Step 2/2 — Uploading to Firebase...');
    disclosureCount = await uploadFinancialDisclosures();
    lobbyingCount   = await uploadLobbyingActivity();
    contractCount   = await uploadContracts();
    corporateCount  = await uploadCorporateAffiliations();

    console.log(`\n[scheduler:bimonthly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:bimonthly]   financial_disclosures: ${disclosureCount}  lobbying_activity: ${lobbyingCount}  contracts: ${contractCount}  corporate_affiliations: ${corporateCount}`);

    await writeSchedulerStatus('bimonthly', {
      startedAt,
      status:         'success',
      collections:    ['financial_disclosures', 'lobbying_activity', 'contracts', 'corporate_affiliations'],
      recordsUpdated: disclosureCount + lobbyingCount + contractCount + corporateCount,
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
      collections:    ['financial_disclosures', 'lobbying_activity', 'contracts', 'corporate_affiliations'],
      recordsUpdated: disclosureCount + lobbyingCount + contractCount + corporateCount,
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
//    3. Build expense leaderboard with trend arrows (vs previous run)
//    4. Upload leader_expenses to Firestore
//    5. Upload expense_leaderboard to Firestore

async function runLeaderExpenseCycle() {
  const startedAt = new Date();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:leader-expense] Cycle started at ${startedAt.toISOString()}`);
  console.log('='.repeat(60));

  let leaderCount = 0, leaderboardCount = 0, aiCalls = 0;

  try {
    console.log('\n[scheduler:leader-expense] Step 1/5 — Fetching leader expenses (CA / US / UK / AU)...');
    await fetchAllLeaderExpenses();

    console.log('\n[scheduler:leader-expense] Step 2/5 — Processing with Claude AI (waste scores + summaries)...');
    const leaderResult = await processLeaderExpenses();
    aiCalls = leaderResult.apiCallsMade || 0;

    console.log('\n[scheduler:leader-expense] Step 3/5 — Building expense leaderboard with trend arrows...');
    buildLeaderboard();

    console.log('\n[scheduler:leader-expense] Step 4/5 — Uploading leader_expenses to Firebase...');
    leaderCount = await uploadLeaderExpenses();

    console.log('\n[scheduler:leader-expense] Step 5/5 — Uploading expense_leaderboard to Firebase...');
    leaderboardCount = await uploadLeaderboard();

    console.log(`\n[scheduler:leader-expense] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:leader-expense]   leader_expenses: ${leaderCount}  expense_leaderboard: ${leaderboardCount}`);

    await writeSchedulerStatus('leader_expense_weekly', {
      startedAt,
      status:         'success',
      collections:    ['leader_expenses', 'expense_leaderboard'],
      recordsUpdated: leaderCount + leaderboardCount,
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
      collections:    ['leader_expenses', 'expense_leaderboard'],
      recordsUpdated: leaderCount + leaderboardCount,
      recordsSkipped: 0,
      aiCallsMade:    aiCalls,
      cronSchedule:   LEADER_EXPENSE_SCHEDULE,
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

const RUN_NOW                = process.argv.includes('--now');
const RUN_DAILY_NOW          = process.argv.includes('--daily');
const RUN_WEEKLY_NOW         = process.argv.includes('--weekly');
const RUN_MONTHLY_NOW        = process.argv.includes('--monthly');
const RUN_BIMONTHLY_NOW      = process.argv.includes('--bimonthly');
const RUN_EXPENSE_NOW        = process.argv.includes('--expenses');
const RUN_LEADER_EXPENSE_NOW = process.argv.includes('--leader-expenses');

if (RUN_NOW) {
  runDailyCycle()
    .then(() => runWeeklyCycle())
    .then(() => runMonthlyCycle())
    .then(() => runBiMonthlyCycle())
    .then(() => runExpenseCycle())
    .then(() => runLeaderExpenseCycle())
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
} else {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         CIVIC VOICE ENGINE — SCHEDULER STARTED       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Daily           (bills + votes)                          → ${DAILY_SCHEDULE}`);
  console.log(`  Weekly          (member profiles)                        → ${WEEKLY_SCHEDULE}`);
  console.log(`  Monthly         (efficiency, budget, audits, performance) → ${MONTHLY_SCHEDULE}`);
  console.log(`  Bimonthly       (disclosures, lobbying, contracts)        → ${BIMONTHLY_SCHEDULE}`);
  console.log(`  Expense/Waste   (dept expenses + waste analysis)          → ${EXPENSE_SCHEDULE}`);
  console.log(`  Leader Expenses (minister/secretary expenses + leaderboard) → ${LEADER_EXPENSE_SCHEDULE}`);
  console.log('\n  Flags: --now (all), --daily, --weekly, --monthly, --bimonthly, --expenses, --leader-expenses\n');

  cron.schedule(DAILY_SCHEDULE,          () => runDailyCycle());
  cron.schedule(WEEKLY_SCHEDULE,         () => runWeeklyCycle());
  cron.schedule(MONTHLY_SCHEDULE,        () => runMonthlyCycle());
  cron.schedule(BIMONTHLY_SCHEDULE,      () => runBiMonthlyCycle());
  cron.schedule(EXPENSE_SCHEDULE,        () => runExpenseCycle());
  cron.schedule(LEADER_EXPENSE_SCHEDULE, () => runLeaderExpenseCycle());

  // Run all tiers on startup
  console.log('[scheduler] Running initial cycles on startup...');
  runDailyCycle()
    .then(() => runWeeklyCycle())
    .then(() => runMonthlyCycle())
    .then(() => runBiMonthlyCycle())
    .then(() => runExpenseCycle())
    .then(() => runLeaderExpenseCycle());
}
