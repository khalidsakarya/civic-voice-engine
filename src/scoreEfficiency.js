require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PROCESSED_DIR = path.resolve(__dirname, '../output/processed');
const BILL_DIR = path.resolve(__dirname, '../output/bill');

/**
 * Score data completeness of a bill record (0–1).
 * Checks all core Civic Voice schema fields.
 */
function completenessScore(bill) {
  const fields = ['id', 'title', 'status', 'summary', 'jurisdiction',
                  'introducedDate', 'lastActionDate', 'tags', 'url'];
  const filled = fields.filter(f => {
    const v = bill[f];
    return v !== null && v !== undefined && v !== '' &&
           !(Array.isArray(v) && v.length === 0);
  });
  return filled.length / fields.length;
}

/**
 * Map bill status string to a normalised passed/introduced/other bucket.
 */
function classifyStatus(status) {
  if (!status) return 'unknown';
  const s = status.toLowerCase();
  if (/passed|enacted|signed|royal.assent|law|act/.test(s)) return 'passed';
  if (/introduced|first.read|tabled/.test(s)) return 'introduced';
  if (/failed|rejected|withdrawn|defeated/.test(s)) return 'failed';
  if (/committee|referr|second.read|third.read|consideration/.test(s)) return 'in_progress';
  return 'other';
}

/**
 * Calculate efficiency score for one jurisdiction's bill set.
 *
 * Components (each 0–100, then weighted):
 *  - passRate        (35%) : passed / (passed + failed + in_progress)
 *  - activityVolume  (30%) : log-scaled bill count vs benchmark of 50
 *  - completeness    (35%) : avg field completeness across all bills
 */
function scoreJurisdiction(bills, jurisdictionLabel) {
  const total = bills.length;
  if (total === 0) return null;

  // Status breakdown
  const buckets = { passed: 0, introduced: 0, in_progress: 0, failed: 0, other: 0, unknown: 0 };
  for (const b of bills) buckets[classifyStatus(b.status)]++;

  // Pass rate: passed vs all decided (passed + failed); in_progress excluded from denominator
  const decided = buckets.passed + buckets.failed;
  const passRateRaw = decided > 0 ? buckets.passed / decided : null;
  const passRateScore = passRateRaw !== null ? Math.round(passRateRaw * 100) : 50; // 50 if undecidable

  // Activity volume: log scale, benchmark = 50 bills → score 70
  const BENCHMARK = 50;
  const activityScore = Math.min(100, Math.round((Math.log(total + 1) / Math.log(BENCHMARK + 1)) * 70));

  // Data completeness
  const avgCompleteness = bills.reduce((sum, b) => sum + completenessScore(b), 0) / total;
  const completenessScoreVal = Math.round(avgCompleteness * 100);

  // Weighted total
  const overall = Math.round(
    passRateScore    * 0.35 +
    activityScore    * 0.30 +
    completenessScoreVal * 0.35
  );

  return {
    jurisdiction: jurisdictionLabel,
    overallScore: overall,
    grade: gradeFrom(overall),
    components: {
      passRate:    { score: passRateScore,        weight: '35%', raw: passRateRaw !== null ? `${Math.round(passRateRaw * 100)}%` : 'n/a (no decided bills)' },
      activity:    { score: activityScore,         weight: '30%', raw: `${total} bills` },
      completeness:{ score: completenessScoreVal,  weight: '35%', raw: `${Math.round(avgCompleteness * 100)}% avg field fill` },
    },
    statusBreakdown: buckets,
    billCount: total,
  };
}

function gradeFrom(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function run() {
  // Load the latest enriched bills file
  const processedFiles = fs.readdirSync(PROCESSED_DIR)
    .filter(f => f.startsWith('bills_enriched') && f.endsWith('.json'))
    .sort();

  if (processedFiles.length === 0) {
    console.error('[scorer] No processed bills found. Run npm run process:bills first.');
    process.exit(1);
  }

  const latest = processedFiles[processedFiles.length - 1];
  const { bills } = JSON.parse(fs.readFileSync(path.join(PROCESSED_DIR, latest)));

  // Group by jurisdiction
  const byJurisdiction = {};
  for (const bill of bills) {
    const j = bill.jurisdiction || 'UNKNOWN';
    if (!byJurisdiction[j]) byJurisdiction[j] = [];
    byJurisdiction[j].push(bill);
  }

  // Score target jurisdictions
  const targetJurisdictions = ['CA', 'UK', 'US', 'AU'];
  const jurisdictionLabels = { CA: 'Canada', UK: 'United Kingdom', US: 'United States', AU: 'Australia' };

  const scores = [];
  for (const [code, label] of Object.entries(jurisdictionLabels)) {
    const bills = byJurisdiction[code] || [];
    const result = scoreJurisdiction(bills, label);
    if (result) scores.push({ code, ...result });
    else console.warn(`[scorer] No data for ${label} (${code})`);
  }

  // Sort by overall score descending
  scores.sort((a, b) => b.overallScore - a.overallScore);

  // Output report
  const report = {
    generatedAt: new Date().toISOString(),
    sourceFile: latest,
    summary: scores.map(s => ({
      jurisdiction: s.jurisdiction,
      overallScore: s.overallScore,
      grade: s.grade,
      billCount: s.billCount,
    })),
    detail: scores,
  };

  const outPath = path.resolve(__dirname, '../output/efficiency_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // Pretty print to console
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║      CIVIC VOICE — GOVERNMENT EFFICIENCY REPORT      ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  for (const s of scores) {
    console.log(`  ${s.grade}  ${s.jurisdiction.padEnd(20)} ${String(s.overallScore).padStart(3)}/100`);
    console.log(`     Pass Rate    ${String(s.components.passRate.score).padStart(3)}/100  (${s.components.passRate.raw})`);
    console.log(`     Activity     ${String(s.components.activity.score).padStart(3)}/100  (${s.components.activity.raw})`);
    console.log(`     Completeness ${String(s.components.completeness.score).padStart(3)}/100  (${s.components.completeness.raw})`);
    console.log(`     Status: ${JSON.stringify(s.statusBreakdown)}`);
    console.log();
  }

  console.log(`Report saved → ${outPath}\n`);
}

run();
