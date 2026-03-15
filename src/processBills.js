require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { processBill } = require('./processing/billProcessor');

const BILL_INPUT_DIR = path.resolve(__dirname, '../output/bill');
const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');

async function run() {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });

  // Load all bill files, use the most recent file per source
  const files = fs.readdirSync(BILL_INPUT_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  // Deduplicate: keep only the latest file per source prefix
  const latestBySource = {};
  for (const file of files) {
    const prefix = file.replace(/_\d{4}-\d{2}-\d{2}T.*\.json$/, '');
    latestBySource[prefix] = file;
  }
  const filesToProcess = Object.values(latestBySource);

  // Collect all bills across files
  const allBills = [];
  for (const file of filesToProcess) {
    const raw = JSON.parse(fs.readFileSync(path.join(BILL_INPUT_DIR, file)));
    for (const record of raw.records) {
      allBills.push({ record, source: raw.source, jurisdiction: raw.jurisdiction });
    }
  }

  console.log(`[billProcessor] Found ${allBills.length} bills across ${filesToProcess.length} source file(s)`);

  const results = [];
  let count = 0;

  for (const { record, source, jurisdiction } of allBills) {
    count++;
    process.stdout.write(`[billProcessor] (${count}/${allBills.length}) Processing: ${record.title?.slice(0, 60)}...\n`);

    try {
      const enriched = await processBill(record);
      results.push(enriched);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      results.push({ ...record, analysis: null, processedAt: new Date().toISOString(), error: err.message });
    }
  }

  // Write full output
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(PROCESSED_DIR, `bills_enriched_${timestamp}.json`);
  const payload = {
    generatedAt: new Date().toISOString(),
    totalBills: results.length,
    bills: results,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));

  console.log(`\n[billProcessor] Done. ${results.length} bills written → ${outFile}`);

  // Print first bill to stdout
  console.log('\n========== FIRST PROCESSED BILL ==========');
  console.log(JSON.stringify(results[0], null, 2));
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
