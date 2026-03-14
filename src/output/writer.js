const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output');

/**
 * Write processed Civic Voice records to disk as JSON.
 * @param {Object|Array} records - Processed Civic Voice record(s)
 * @param {Object} source - Source config
 */
async function writeOutput(records, source) {
  const dir = path.join(OUTPUT_DIR, source.type);
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${source.jurisdiction || 'unknown'}_${source.name}_${timestamp}.json`;
  const filepath = path.join(dir, filename);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: source.name,
    type: source.type,
    jurisdiction: source.jurisdiction,
    records: Array.isArray(records) ? records : [records],
  };

  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2));
  console.log(`[writer] Saved ${payload.records.length} record(s) → ${filepath}`);
}

module.exports = { writeOutput };
