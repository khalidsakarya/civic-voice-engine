require('dotenv').config();
const cron = require('node-cron');
const { runPipeline } = require('./pipeline');
const { processBill } = require('./processing/billProcessor');
const { uploadAll } = require('./firebase/uploader');
const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');
const BILL_DIR = path.resolve(__dirname, '../output/bill');

/**
 * Run the full end-to-end pipeline:
 * ingest → process bills → score efficiency → upload to Firebase
 */
async function runFullCycle() {
  const startedAt = new Date().toISOString();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[scheduler] Full cycle started at ${startedAt}`);
  console.log('='.repeat(60));

  try {
    // 1. Ingest from all government API sources
    console.log('\n[scheduler] Step 1/4 — Ingesting government data...');
    const sources = require('../config/sources.json');
    await runPipeline(sources);

    // 2. Process bills with Claude
    console.log('\n[scheduler] Step 2/4 — Processing bills with Claude AI...');
    await processBillsFromOutput();

    // 3. Score efficiency
    console.log('\n[scheduler] Step 3/4 — Scoring government efficiency...');
    require('./scoreEfficiency');

    // 4. Upload to Firebase
    console.log('\n[scheduler] Step 4/4 — Uploading to Firebase...');
    await uploadAll();

    const finishedAt = new Date().toISOString();
    console.log(`\n[scheduler] ✓ Full cycle complete at ${finishedAt}`);
  } catch (err) {
    console.error(`[scheduler] ✗ Cycle failed: ${err.message}`);
    console.error(err.stack);
  }
}

/**
 * Inline bill processing (mirrors processBills.js logic).
 */
async function processBillsFromOutput() {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  const files = fs.readdirSync(BILL_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

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

  console.log(`[scheduler] Processing ${allBills.length} bills...`);
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

  console.log(`[scheduler] ${results.length} bills processed → ${outFile}`);
}

// ─── Start ───────────────────────────────────────────────────

const RUN_NOW = process.argv.includes('--now');

if (RUN_NOW) {
  // Immediate single run (useful for manual triggers / CI)
  runFullCycle().then(() => process.exit(0)).catch(() => process.exit(1));
} else {
  // Scheduled: every day at 02:00 local time
  const SCHEDULE = process.env.CRON_SCHEDULE || '0 2 * * *';
  console.log(`[scheduler] Civic Voice Engine started. Schedule: "${SCHEDULE}"`);
  console.log('[scheduler] Pass --now flag to run immediately.');

  cron.schedule(SCHEDULE, () => {
    runFullCycle();
  });

  // Also run once on startup so Firebase is populated immediately
  console.log('[scheduler] Running initial cycle on startup...');
  runFullCycle();
}
