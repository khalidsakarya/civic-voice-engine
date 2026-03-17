/**
 * Government Expense Processor — Civic Voice Engine
 *
 * Loads raw expense records from output/expenses/, runs them through
 * Claude AI for waste analysis, and saves enriched output to
 * output/processed/expenses_enriched.json
 *
 * Per-record output fields:
 *   category    — Travel | Food & Entertainment | Contracts |
 *                  Military | Infrastructure | Other
 *   wasteScore  — integer 1–10  (10 = most wasteful/concerning)
 *   isFlagged   — boolean
 *   flagReason  — plain-English explanation for citizens
 *   severity    — Critical (9-10) | High (7-8) | Medium (4-6) | Low (1-3)
 *
 * Flagging thresholds (user-configured):
 *   Meals / Food & Entertainment   > $5,000 CAD
 *   Travel                         > $50,000 CAD
 *   Contracts with no competition  > $1,000,000 (any currency)
 *
 * Cost control: capped at MAX_PER_JURISDICTION records per source,
 * batched at BATCH_SIZE per Claude call.
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXPENSES_DIR  = path.resolve(__dirname, '../../output/expenses');
const PROCESSED_DIR = path.resolve(__dirname, '../../output/processed');
const OUTPUT_FILE   = path.join(PROCESSED_DIR, 'expenses_enriched.json');

// Per-jurisdiction record cap (keeps analysis focused and cost predictable)
const MAX_PER_JURISDICTION = 20;
// Records per Claude batch call
const BATCH_SIZE = 5;

// Flagging thresholds (in source-currency amounts)
const THRESHOLDS = {
  meals:            5_000,
  travel:          50_000,
  no_competition: 1_000_000,
};

// Keywords that suggest limited/no-competition procurement
const NO_COMP_KEYWORDS = [
  'limited tender', 'sole source', 'direct award', 'no competition',
  'single source', 'non-competitive', 'emergency procurement',
];

// ─── Load & prepare records ───────────────────────────────────────────────────

/**
 * Load the latest expense file per source from output/expenses/.
 * Cap to MAX_PER_JURISDICTION records per jurisdiction (sorted by amount desc
 * so the most significant items are always included).
 */
function loadExpenseRecords() {
  if (!fs.existsSync(EXPENSES_DIR)) {
    throw new Error(`output/expenses/ not found — run npm run ingest:expenses first`);
  }

  const files = fs.readdirSync(EXPENSES_DIR).filter(f => f.endsWith('.json')).sort();

  // Keep only the latest file per source prefix
  const latestBySource = {};
  for (const file of files) {
    const key = file.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latestBySource[key] = file;
  }

  // Load, combine, cap per jurisdiction
  const byJurisdiction = {};
  for (const file of Object.values(latestBySource)) {
    const payload = JSON.parse(fs.readFileSync(path.join(EXPENSES_DIR, file)));
    const jur = payload.jurisdiction || 'XX';
    if (!byJurisdiction[jur]) byJurisdiction[jur] = [];
    byJurisdiction[jur].push(...payload.records);
  }

  const all = [];
  for (const [jur, records] of Object.entries(byJurisdiction)) {
    const sorted = records
      .filter(r => r.amount != null)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    const capped = sorted.slice(0, MAX_PER_JURISDICTION);
    console.log(`[expenseProcessor] ${jur}: ${records.length} records → top ${capped.length} selected`);
    all.push(...capped);
  }

  return all;
}

// ─── Pre-flagging (rules-based, before Claude) ────────────────────────────────

/**
 * Apply threshold rules to add a `preFlagHints` field before sending to Claude.
 * Claude uses these as guidance but makes the final call on wasteScore.
 */
function applyPreFlags(record) {
  const amount  = Math.abs(record.amount || 0);
  const cat     = (record.category || '').toLowerCase();
  const title   = (record.title   || '').toLowerCase();
  const combined = cat + ' ' + title;

  const hints = [];

  const noComp = NO_COMP_KEYWORDS.some(kw => combined.includes(kw));

  if (noComp && amount > THRESHOLDS.no_competition) {
    hints.push(`no-competition contract over $${(THRESHOLDS.no_competition / 1e6).toFixed(0)}M`);
  }
  if (['meal', 'food', 'dinner', 'lunch', 'breakfast', 'hospitality', 'entertainment', 'catering']
      .some(kw => combined.includes(kw)) && amount > THRESHOLDS.meals) {
    hints.push(`food/entertainment expense over $${THRESHOLDS.meals.toLocaleString()}`);
  }
  if (['travel', 'flight', 'hotel', 'accommodation', 'per diem', 'airfare']
      .some(kw => combined.includes(kw)) && amount > THRESHOLDS.travel) {
    hints.push(`travel expense over $${THRESHOLDS.travel.toLocaleString()}`);
  }
  if (amount > 1_000_000_000) {
    hints.push('amount exceeds $1 billion — verify this is a large budget allocation, not an individual purchase');
  }

  return { ...record, preFlagHints: hints.length ? hints : null };
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a nonpartisan government waste analyst for the Civic Voice civic engagement app.
Your job is to review government expense and procurement records and assess whether each one is potentially wasteful, mismanaged, or unusually expensive — giving everyday citizens clear, honest analysis.

Important context:
- Large mandatory social programs (Social Security, Medicaid, national debt interest, pension funds, healthcare) are NOT wasteful even at enormous amounts. Score these 1-2.
- Core infrastructure and essential public services are generally not wasteful.
- Concerning patterns: consulting fees at premium rates, no-competition contracts for large sums, unclear purpose, luxury goods, unusual procurement methods, single-source awards for commodities.
- The record may include "preFlagHints" — rule-based signals to guide (but not override) your analysis.

Always respond with a valid JSON array only — one object per record, in the same order as the input.`;

const USER_PROMPT_TEMPLATE = (records) => `Analyse each of the following government expense records and return a JSON array with exactly one object per record, in the same order.

Each object must have exactly these fields:
{
  "id": "<the record's id field, copied exactly>",
  "category": "<one of: Travel | Food & Entertainment | Contracts | Military | Infrastructure | Other>",
  "wasteScore": <integer 1-10, where 1=routine/justified spending, 10=clearly wasteful or improper>,
  "isFlagged": <true if wasteScore >= 4 OR a threshold hint was triggered, otherwise false>,
  "flagReason": "<1-2 plain English sentences a citizen would understand — explain why it is or is not concerning. Be specific about amounts, recipients, and procurement method>",
  "severity": "<Critical if score 9-10 | High if score 7-8 | Medium if score 4-6 | Low if score 1-3>"
}

Records to analyse:
${JSON.stringify(records, null, 2)}`;

async function analyzeExpenseBatch(records) {
  const stripped = records.map(r => ({
    id:           r.id,
    title:        r.title,
    amount:       r.amount,
    recipient:    r.recipient,
    category:     r.category,
    department:   r.department,
    jurisdiction: r.jurisdiction,
    date:         r.date,
    preFlagHints: r.preFlagHints || null,
    // AU-specific
    ...(r.fiscal_year        ? { fiscal_year: r.fiscal_year }               : {}),
    // UK-specific
    ...(r.notice_id          ? { notice_id: r.notice_id }                   : {}),
    // CA-specific
    ...(r.vote_number        ? { vote_number: r.vote_number }               : {}),
    // US-specific
    ...(r.account_code       ? { account_code: r.account_code }             : {}),
  }));

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024 + (records.length * 200), // scale with batch size
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: USER_PROMPT_TEMPLATE(stripped) }],
  });

  const text      = message.content[0].text.trim();
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const analyses  = JSON.parse(jsonMatch[1]);

  if (!Array.isArray(analyses) || analyses.length !== records.length) {
    throw new Error(`Expected ${records.length} results, got ${Array.isArray(analyses) ? analyses.length : typeof analyses}`);
  }

  return analyses;
}

// ─── Main processing pipeline ─────────────────────────────────────────────────

async function processExpenses() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[expenseProcessor] Starting expense analysis');
  console.log('='.repeat(60));

  // 1. Load
  const rawRecords   = loadExpenseRecords();
  const preProcessed = rawRecords.map(applyPreFlags);
  console.log(`\n[expenseProcessor] ${preProcessed.length} records loaded across ${[...new Set(preProcessed.map(r => r.jurisdiction))].join(', ')}`);

  // 2. Batch through Claude
  const analysisMap = {}; // id → analysis
  let batchNum = 0, apiCalls = 0, errors = 0;

  for (let i = 0; i < preProcessed.length; i += BATCH_SIZE) {
    const batch = preProcessed.slice(i, i + BATCH_SIZE);
    batchNum++;
    const nums = `${i + 1}–${Math.min(i + BATCH_SIZE, preProcessed.length)}`;
    process.stdout.write(`[expenseProcessor] Batch ${batchNum} (records ${nums})... `);

    try {
      const analyses = await analyzeExpenseBatch(batch);
      apiCalls++;
      for (const analysis of analyses) {
        analysisMap[String(analysis.id)] = analysis;
      }
      console.log(`✓  flagged: ${analyses.filter(a => a.isFlagged).length}/${analyses.length}`);
    } catch (err) {
      errors++;
      console.error(`✗ ${err.message}`);
      // Mark all records in this batch as unanalyzed
      for (const r of batch) {
        analysisMap[String(r.id)] = {
          id:         r.id,
          category:   'Other',
          wasteScore: null,
          isFlagged:  r.preFlagHints?.length > 0,
          flagReason: `Analysis unavailable: ${err.message}`,
          severity:   'Low',
        };
      }
    }
  }

  // 3. Merge analysis onto original records
  const enriched = rawRecords.map(record => {
    const analysis = analysisMap[String(record.id)] || {
      id: record.id, category: 'Other', wasteScore: null, isFlagged: false, flagReason: null, severity: 'Low',
    };
    return {
      ...record,
      category:   analysis.category,
      wasteScore: analysis.wasteScore,
      isFlagged:  analysis.isFlagged,
      flagReason: analysis.flagReason,
      severity:   analysis.severity,
      processedAt: new Date().toISOString(),
    };
  });

  // 4. Build summary stats
  const flagged  = enriched.filter(r => r.isFlagged);
  const bySev    = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const byCat    = {};
  for (const r of enriched) {
    if (r.severity) bySev[r.severity] = (bySev[r.severity] || 0) + 1;
    if (r.category) byCat[r.category] = (byCat[r.category] || 0) + 1;
  }

  const topFlagged = enriched
    .filter(r => r.isFlagged && r.wasteScore != null)
    .sort((a, b) => (b.wasteScore - a.wasteScore) || (Math.abs(b.amount) - Math.abs(a.amount)))
    .slice(0, 10)
    .map(r => ({ id: r.id, title: r.title, jurisdiction: r.jurisdiction, amount: r.amount, wasteScore: r.wasteScore, severity: r.severity, flagReason: r.flagReason }));

  // 5. Save output
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const output = {
    generatedAt:    new Date().toISOString(),
    durationMs:     Date.now() - startedAt,
    totalRecords:   enriched.length,
    flaggedCount:   flagged.length,
    apiCallsMade:   apiCalls,
    errors,
    thresholds:     THRESHOLDS,
    summary: {
      bySeverity:   bySev,
      byCategory:   byCat,
      topFlagged,
    },
    records: enriched,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // 6. Print report
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('[expenseProcessor] Analysis complete');
  console.log('='.repeat(60));
  console.log(`  Records processed : ${enriched.length}`);
  console.log(`  Flagged as waste  : ${flagged.length}  (${Math.round(flagged.length / enriched.length * 100)}%)`);
  console.log(`  Severity — Critical: ${bySev.Critical}  High: ${bySev.High}  Medium: ${bySev.Medium}  Low: ${bySev.Low}`);
  console.log(`  Claude API calls  : ${apiCalls}  (${errors} errors)`);
  console.log(`  Duration          : ${durationS}s`);
  console.log(`  Output            : ${OUTPUT_FILE}`);
  if (topFlagged.length) {
    console.log('\n  Top flagged items:');
    topFlagged.slice(0, 5).forEach(r =>
      console.log(`    [${r.severity}/${r.wasteScore}] ${r.jurisdiction} — ${(r.title || '').slice(0, 55).padEnd(55)}  $${(Math.abs(r.amount) / 1e6).toFixed(2)}M`)
    );
  }
  console.log('='.repeat(60) + '\n');

  return output;
}

module.exports = { processExpenses };

// Run directly when invoked as a script
if (require.main === module) {
  processExpenses()
    .then(out => process.exit(out.errors > 0 ? 1 : 0))
    .catch(err => { console.error('[expenseProcessor] Fatal:', err.message); process.exit(1); });
}
