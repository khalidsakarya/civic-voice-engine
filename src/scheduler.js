require('dotenv').config();
const cron = require('node-cron');
const { runPipeline } = require('./pipeline');
const { processBill } = require('./processing/billProcessor');
const { uploadBills, uploadVotes, uploadMembers, uploadEfficiencyScores } = require('./firebase/uploader');
const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');
const BILL_DIR     = path.resolve(__dirname, '../output/bill');

// ─── Tier definitions ────────────────────────────────────────────────────────
//
//  DAILY  (02:00 every day)  — bills + votes
//    1. Ingest all bill and vote sources
//    2. Process bills with Claude AI
//    3. Score government efficiency
//    4. Upload bills, votes, efficiency_scores to Firestore
//
//  WEEKLY (03:00 every Sunday) — member profiles
//    1. Ingest all legislator sources
//    2. Upload members to Firestore
//
// ─────────────────────────────────────────────────────────────────────────────

const allSources = require('../config/sources.json');
const dailySources  = allSources.filter(s => s.type === 'bill' || s.type === 'vote');
const weeklySources = allSources.filter(s => s.type === 'legislator');

// ─── Daily cycle ─────────────────────────────────────────────────────────────

async function runDailyCycle() {
  const startedAt = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:daily] Cycle started at ${startedAt}`);
  console.log(`[scheduler:daily] Sources: ${dailySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  try {
    console.log('\n[scheduler:daily] Step 1/4 — Ingesting bills & votes...');
    await runPipeline(dailySources);

    console.log('\n[scheduler:daily] Step 2/4 — Processing bills with Claude AI...');
    await processBillsFromOutput();

    console.log('\n[scheduler:daily] Step 3/4 — Scoring government efficiency...');
    // Re-require each run to pick up fresh output
    delete require.cache[require.resolve('./scoreEfficiency')];
    require('./scoreEfficiency');

    console.log('\n[scheduler:daily] Step 4/4 — Uploading to Firebase...');
    const billCount  = await uploadBills();
    const voteCount  = await uploadVotes();
    const scoreCount = await uploadEfficiencyScores();

    console.log(`\n[scheduler:daily] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:daily]   bills: ${billCount}  votes: ${voteCount}  efficiency_scores: ${scoreCount}`);
  } catch (err) {
    console.error(`[scheduler:daily] ✗ Failed: ${err.message}`);
    console.error(err.stack);
  }
}

// ─── Weekly cycle ─────────────────────────────────────────────────────────────

async function runWeeklyCycle() {
  const startedAt = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler:weekly] Cycle started at ${startedAt}`);
  console.log(`[scheduler:weekly] Sources: ${weeklySources.map(s => s.name).join(', ')}`);
  console.log('='.repeat(60));

  try {
    console.log('\n[scheduler:weekly] Step 1/2 — Ingesting member profiles...');
    await runPipeline(weeklySources);

    console.log('\n[scheduler:weekly] Step 2/2 — Uploading members to Firebase...');
    const memberCount = await uploadMembers();

    console.log(`\n[scheduler:weekly] ✓ Done at ${new Date().toISOString()}`);
    console.log(`[scheduler:weekly]   members: ${memberCount}`);
  } catch (err) {
    console.error(`[scheduler:weekly] ✗ Failed: ${err.message}`);
    console.error(err.stack);
  }
}

// ─── Bill processing helper ───────────────────────────────────────────────────

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

  for (const bill of allBills) {
    try {
      results.push(await processBill(bill));
    } catch (err) {
      console.error(`  ✗ ${bill.title?.slice(0, 50)}: ${err.message}`);
      results.push({ ...bill, analysis: null, processedAt: new Date().toISOString(), error: err.message });
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(PROCESSED_DIR, `bills_enriched_${timestamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalBills: results.length,
    bills: results,
  }, null, 2));

  console.log(`[scheduler:daily] ${results.length} bills processed → ${outFile}`);
}

// ─── Start ────────────────────────────────────────────────────────────────────

const RUN_NOW        = process.argv.includes('--now');
const RUN_DAILY_NOW  = process.argv.includes('--daily');
const RUN_WEEKLY_NOW = process.argv.includes('--weekly');

if (RUN_NOW || RUN_DAILY_NOW) {
  runDailyCycle().then(() => RUN_NOW ? runWeeklyCycle() : null).then(() => process.exit(0)).catch(() => process.exit(1));
} else if (RUN_WEEKLY_NOW) {
  runWeeklyCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
  const DAILY_SCHEDULE  = process.env.CRON_DAILY  || '0 2 * * *';    // 02:00 every day
  const WEEKLY_SCHEDULE = process.env.CRON_WEEKLY || '0 3 * * 0';    // 03:00 every Sunday

  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         CIVIC VOICE ENGINE — SCHEDULER STARTED       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Daily  (bills + votes)    → ${DAILY_SCHEDULE}`);
  console.log(`  Weekly (member profiles)  → ${WEEKLY_SCHEDULE}`);
  console.log('\n  Flags: --now (both), --daily, --weekly\n');

  cron.schedule(DAILY_SCHEDULE,  () => runDailyCycle());
  cron.schedule(WEEKLY_SCHEDULE, () => runWeeklyCycle());

  // Run both tiers immediately on startup
  console.log('[scheduler] Running initial daily cycle on startup...');
  runDailyCycle().then(() => {
    console.log('[scheduler] Running initial weekly cycle on startup...');
    return runWeeklyCycle();
  });
}
