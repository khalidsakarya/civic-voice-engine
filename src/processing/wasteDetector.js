/**
 * Government Waste Pattern Detector — Civic Voice Engine
 *
 * Loads enriched expense data (output/processed/expenses_enriched.json)
 * and raw historical snapshots from output/expenses/ to detect:
 *
 *  1. Spend spikes       — same department up >50% vs previous snapshot
 *  2. Sole-source        — contracts awarded without competition
 *  3. Luxury spending    — Claude-assessed: hotels >$500/night, meals >$200/person,
 *                          business class for short trips
 *  4. Contractor cluster — same recipient winning 2+ contracts within 90 days
 *  5. Department Waste Score — weighted aggregate per department (0–100)
 *  6. Top 10 per country — ranked by (wasteScore × amount), plain-language reason
 *
 * Saves to output/processed/waste_report.json
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXPENSES_DIR  = path.resolve(__dirname, '../../output/expenses');
const PROCESSED_DIR = path.resolve(__dirname, '../../output/processed');
const ENRICHED_FILE = path.join(PROCESSED_DIR, 'expenses_enriched.json');
const OUTPUT_FILE   = path.join(PROCESSED_DIR, 'waste_report.json');

// ─── Sole-source / no-competition keywords ────────────────────────────────────

const SOLE_SOURCE_KEYWORDS = [
  'sole source', 'sole-source', 'single source', 'single-source',
  'limited tender', 'direct award', 'no competition', 'non-competitive',
  'emergency procurement', 'emergency contract', 'proprietary', 'exclusive',
  'direct engagement', 'direct procurement',
];

// ─── Luxury keyword triggers (sent to Claude for confirmation) ────────────────

const LUXURY_KEYWORDS = [
  'hotel', 'accommodation', 'lodging', 'resort', 'suite',
  'flight', 'airfare', 'air travel', 'business class', 'first class',
  'meal', 'dinner', 'lunch', 'breakfast', 'catering', 'hospitality',
  'entertainment', 'conference', 'gala', 'event',
];

const LUXURY_BATCH_SIZE = 8;

// ─── Load helpers ─────────────────────────────────────────────────────────────

function loadEnriched() {
  if (!fs.existsSync(ENRICHED_FILE)) {
    throw new Error('expenses_enriched.json not found — run npm run process:expenses first');
  }
  return JSON.parse(fs.readFileSync(ENRICHED_FILE));
}

/**
 * Load all raw expense snapshots grouped by jurisdiction.
 * Returns { AU: [{ timestamp, records: [...] }, ...], CA: [...], ... }
 * Each array is sorted oldest→newest so index -1 is latest, -2 is previous.
 */
function loadAllSnapshots() {
  const files = fs.readdirSync(EXPENSES_DIR)
    .filter(f => f.endsWith('.json'))
    .sort(); // ISO timestamp in filename → lexicographic = chronological

  const bySource = {};
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(EXPENSES_DIR, file)));
    const key = `${payload.jurisdiction}_${payload.source}`;
    if (!bySource[key]) bySource[key] = [];
    bySource[key].push({ timestamp: payload.generatedAt, records: payload.records });
  }
  return bySource;
}

// ─── 1. Spend spike detection ─────────────────────────────────────────────────
//
// For each source that has ≥2 snapshots, aggregate total authorised/spent
// per department across both snapshots and flag >50% increase.

function detectSpendSpikes(snapshots) {
  const spikes = [];

  for (const [sourceKey, runs] of Object.entries(snapshots)) {
    if (runs.length < 2) continue;

    const prev    = runs[runs.length - 2];
    const current = runs[runs.length - 1];

    // Aggregate by department for each snapshot
    const sumByDept = (records) => {
      const map = {};
      for (const r of records) {
        const dept = r.department || r.organization || 'Unknown';
        const amt  = Math.abs(parseFloat(r.amount) || parseFloat(r.authorities) || 0);
        map[dept] = (map[dept] || 0) + amt;
      }
      return map;
    };

    const prevMap    = sumByDept(prev.records);
    const currentMap = sumByDept(current.records);

    for (const [dept, currentAmt] of Object.entries(currentMap)) {
      const prevAmt = prevMap[dept];
      if (!prevAmt || prevAmt === 0) continue;

      const pctChange = (currentAmt - prevAmt) / prevAmt;
      if (pctChange > 0.5) {
        const jurisdiction = sourceKey.split('_')[0];
        spikes.push({
          jurisdiction,
          source:          sourceKey,
          department:      dept,
          previousAmount:  prevAmt,
          currentAmount:   currentAmt,
          percentIncrease: Math.round(pctChange * 100),
          previousSnapshot: prev.timestamp,
          currentSnapshot:  current.timestamp,
          reason: `${dept} spending rose ${Math.round(pctChange * 100)}% — from $${(prevAmt / 1e6).toFixed(2)}M to $${(currentAmt / 1e6).toFixed(2)}M between snapshots`,
        });
      }
    }
  }

  return spikes.sort((a, b) => b.percentIncrease - a.percentIncrease);
}

// ─── 2. Sole-source detection ─────────────────────────────────────────────────

function detectSoleSources(records) {
  return records
    .filter(r => {
      const text = `${r.title || ''} ${r.category || ''}`.toLowerCase();
      return SOLE_SOURCE_KEYWORDS.some(kw => text.includes(kw));
    })
    .map(r => ({
      id:            r.id,
      jurisdiction:  r.jurisdiction,
      title:         r.title,
      amount:        r.amount,
      recipient:     r.recipient,
      department:    r.department,
      wasteScore:    r.wasteScore,
      severity:      r.severity,
      matchedKeyword: SOLE_SOURCE_KEYWORDS.find(kw =>
        `${r.title || ''} ${r.category || ''}`.toLowerCase().includes(kw)
      ),
      flagReason: r.flagReason,
    }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// ─── 3. Luxury spending (Claude-assisted) ─────────────────────────────────────

const LUXURY_SYSTEM = `You are a government auditor reviewing expense records for luxury or excess spending.
For each record, assess whether it likely involves:
- Hotel/accommodation at rates exceeding $500/night
- Meals or catering exceeding $200/person
- Business class or first class flights for domestic or short-haul trips (<6 hours)
- Other clearly excessive or inappropriate spending for public servants

Consider the total amount AND the nature of the item. A $10,000 catering bill for a 50-person event is $200/person (borderline). A $1,500 hotel bill for one night is clearly excessive.
When exact unit costs cannot be derived, use your best professional judgement based on the title and amount.

Respond ONLY with a valid JSON array, one object per record in input order:
{
  "id": "<record id>",
  "isLuxury": <true|false>,
  "luxuryType": "<hotel_rate|meal_rate|business_class|other|null>",
  "estimatedUnitCost": "<e.g. ~$800/night or ~$250/person or null if indeterminate>",
  "concern": "<1 sentence plain English — or null if not luxury>"
}`;

async function detectLuxurySpending(records) {
  // Filter to records with luxury-relevant keywords
  const candidates = records.filter(r => {
    const text = `${r.title || ''} ${r.category || ''}`.toLowerCase();
    return LUXURY_KEYWORDS.some(kw => text.includes(kw));
  });

  if (candidates.length === 0) return [];

  console.log(`[wasteDetector] Luxury check: ${candidates.length} candidate records → Claude`);

  const luxuryItems = [];

  for (let i = 0; i < candidates.length; i += LUXURY_BATCH_SIZE) {
    const batch = candidates.slice(i, i + LUXURY_BATCH_SIZE);
    const stripped = batch.map(r => ({
      id:         r.id,
      title:      r.title,
      amount:     r.amount,
      recipient:  r.recipient,
      department: r.department,
      category:   r.category,
      jurisdiction: r.jurisdiction,
    }));

    try {
      const msg = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 512 + batch.length * 150,
        system:     LUXURY_SYSTEM,
        messages:   [{ role: 'user', content: `Analyse these expense records for luxury spending:\n${JSON.stringify(stripped, null, 2)}` }],
      });

      const text      = msg.content[0].text.trim();
      const match     = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
      const results   = JSON.parse(match[1]);

      for (let j = 0; j < results.length; j++) {
        if (results[j].isLuxury) {
          const rec = batch[j];
          luxuryItems.push({
            id:                rec.id,
            jurisdiction:      rec.jurisdiction,
            title:             rec.title,
            amount:            rec.amount,
            recipient:         rec.recipient,
            department:        rec.department,
            wasteScore:        rec.wasteScore,
            luxuryType:        results[j].luxuryType,
            estimatedUnitCost: results[j].estimatedUnitCost,
            concern:           results[j].concern,
          });
        }
      }
    } catch (err) {
      console.error(`[wasteDetector] Luxury batch error: ${err.message}`);
    }
  }

  return luxuryItems.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// ─── 4. Contractor clustering ─────────────────────────────────────────────────
//
// Group records by normalised recipient name.
// Flag any recipient that appears in 2+ contracts where dates are within 90 days.

function normalizeRecipient(name) {
  if (!name) return null;
  return name.toLowerCase()
    .replace(/\s+(pty|ltd|inc|llc|plc|corp|limited|pty\.?\s*ltd\.?|co\.|company)\b\.?/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectContractorClusters(records) {
  // Only records with a recipient and a parseable date
  const withRecipient = records.filter(r => r.recipient && r.date);

  // Group by normalised recipient
  const byRecipient = {};
  for (const r of withRecipient) {
    // Handle comma-separated multi-supplier fields (treat as non-cluster)
    if (r.recipient.includes(',')) continue;
    const key = normalizeRecipient(r.recipient);
    if (!key || key.length < 3) continue;
    if (!byRecipient[key]) byRecipient[key] = [];
    byRecipient[key].push(r);
  }

  const clusters = [];

  for (const [normName, group] of Object.entries(byRecipient)) {
    if (group.length < 2) continue;

    // Sort by date
    const sorted = group
      .map(r => ({ ...r, _ts: new Date(r.date).getTime() }))
      .filter(r => !isNaN(r._ts))
      .sort((a, b) => a._ts - b._ts);

    if (sorted.length < 2) continue;

    // Check if any two contracts are within 90 days
    let clusterFound = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const daysDiff = (sorted[i + 1]._ts - sorted[i]._ts) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 90) { clusterFound = true; break; }
    }
    if (!clusterFound) continue;

    const totalAmt     = sorted.reduce((s, r) => s + Math.abs(r.amount || 0), 0);
    const jurisdictions = [...new Set(sorted.map(r => r.jurisdiction))];

    clusters.push({
      recipient:           group[0].recipient,
      normalizedName:      normName,
      contractCount:       sorted.length,
      totalAmount:         totalAmt,
      jurisdictions,
      contracts: sorted.map(r => ({
        id:         r.id,
        title:      r.title,
        amount:     r.amount,
        date:       r.date,
        department: r.department,
        jurisdiction: r.jurisdiction,
      })),
      concern: `${group[0].recipient} received ${sorted.length} contracts totalling $${(totalAmt / 1e6).toFixed(2)}M within a short period across ${jurisdictions.join(', ')}`,
    });
  }

  return clusters.sort((a, b) => b.totalAmount - a.totalAmount);
}

// ─── 5. Department Waste Score (0–100) ────────────────────────────────────────
//
// Scoring formula per department:
//   baseScore   = mean wasteScore of all records (1–10 scale → 0–100)
//   flagBonus   = flagged% × 20 pts  (max 20)
//   soleBonus   = soleSource% × 15 pts  (max 15)
//   clampedScore = min(100, floor(baseScore + flagBonus + soleBonus))
//
// Only departments with ≥2 records are scored (single-record depts unreliable).

function scoreDepartments(records, soleSources) {
  const soleIds = new Set(soleSources.map(s => s.id));

  const byDept = {};
  for (const r of records) {
    const dept = r.department || 'Unknown';
    const jur  = r.jurisdiction;
    const key  = `${jur}::${dept}`;
    if (!byDept[key]) byDept[key] = { dept, jurisdiction: jur, records: [] };
    byDept[key].records.push(r);
  }

  const scores = [];

  for (const { dept, jurisdiction, records: recs } of Object.values(byDept)) {
    if (recs.length < 2) continue;

    const scored     = recs.filter(r => r.wasteScore != null);
    if (scored.length === 0) continue;

    const meanWaste  = scored.reduce((s, r) => s + r.wasteScore, 0) / scored.length;
    const baseScore  = (meanWaste / 10) * 100;

    const flaggedPct = recs.filter(r => r.isFlagged).length / recs.length;
    const solePct    = recs.filter(r => soleIds.has(r.id)).length / recs.length;

    const flagBonus  = flaggedPct * 20;
    const soleBonus  = solePct  * 15;

    const finalScore = Math.min(100, Math.round(baseScore + flagBonus + soleBonus));
    const totalSpend = recs.reduce((s, r) => s + Math.abs(r.amount || 0), 0);

    scores.push({
      jurisdiction,
      department:       dept,
      wasteScore:       finalScore,
      grade:            finalScore >= 75 ? 'F' : finalScore >= 50 ? 'D' : finalScore >= 35 ? 'C' : finalScore >= 20 ? 'B' : 'A',
      recordCount:      recs.length,
      flaggedCount:     recs.filter(r => r.isFlagged).length,
      soleSourceCount:  recs.filter(r => soleIds.has(r.id)).length,
      totalSpend,
      meanWasteScore:   parseFloat(meanWaste.toFixed(2)),
    });
  }

  return scores.sort((a, b) => b.wasteScore - a.wasteScore);
}

// ─── 6. Top 10 most wasteful per country ──────────────────────────────────────
//
// Ranking metric: wasteScore × log10(|amount| + 1)
// This surfaces genuinely wasteful large spends without letting $1B routine
// programs dominate purely on size.

function buildTop10(records) {
  const byJur = {};
  for (const r of records) {
    if (!byJur[r.jurisdiction]) byJur[r.jurisdiction] = [];
    byJur[r.jurisdiction].push(r);
  }

  const top10 = {};
  for (const [jur, recs] of Object.entries(byJur)) {
    top10[jur] = recs
      .filter(r => r.wasteScore != null && r.amount != null)
      .map(r => ({
        ...r,
        _rankScore: r.wasteScore * Math.log10(Math.abs(r.amount) + 1),
      }))
      .sort((a, b) => b._rankScore - a._rankScore)
      .slice(0, 10)
      .map(({ _rankScore, ...r }) => ({
        id:          r.id,
        title:       r.title,
        amount:      r.amount,
        recipient:   r.recipient,
        department:  r.department,
        jurisdiction: r.jurisdiction,
        wasteScore:  r.wasteScore,
        severity:    r.severity,
        isFlagged:   r.isFlagged,
        flagReason:  r.flagReason,
        sourceUrl:   r.sourceUrl,
      }));
  }

  return top10;
}

// ─── Summary stats ────────────────────────────────────────────────────────────

function buildSummary(spikes, soleSources, luxuryItems, clusters, deptScores, top10) {
  const highRiskDepts = deptScores.filter(d => d.wasteScore >= 50);
  const totalConcerns = spikes.length + soleSources.length + luxuryItems.length + clusters.length;

  return {
    totalConcernsFound: totalConcerns,
    spendSpikes:        spikes.length,
    soleSources:        soleSources.length,
    luxuryItems:        luxuryItems.length,
    contractorClusters: clusters.length,
    highRiskDepartments: highRiskDepts.length,
    topHighRiskDept:    highRiskDepts[0] ? `${highRiskDepts[0].jurisdiction} — ${highRiskDepts[0].department} (${highRiskDepts[0].wasteScore}/100)` : null,
    top1ByCountry: Object.fromEntries(
      Object.entries(top10).map(([jur, items]) => [jur, items[0] ? items[0].title?.slice(0, 80) : null])
    ),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function detectWaste() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[wasteDetector] Starting waste pattern analysis');
  console.log('='.repeat(60));

  // Load data
  const enriched  = loadEnriched();
  const records   = enriched.records;
  const snapshots = loadAllSnapshots();
  console.log(`\n[wasteDetector] ${records.length} enriched records loaded`);
  console.log(`[wasteDetector] ${Object.keys(snapshots).length} source snapshot groups loaded`);

  // ── Pattern 1: Spend spikes
  console.log('\n[wasteDetector] 1/5 Checking for spend spikes (>50% increase)...');
  const spikes = detectSpendSpikes(snapshots);
  console.log(`  → ${spikes.length} spike(s) detected`);

  // ── Pattern 2: Sole-source
  console.log('[wasteDetector] 2/5 Scanning for sole-source/no-competition contracts...');
  const soleSources = detectSoleSources(records);
  console.log(`  → ${soleSources.length} sole-source record(s) detected`);

  // ── Pattern 3: Luxury (Claude)
  console.log('[wasteDetector] 3/5 Running luxury spend analysis (Claude)...');
  const luxuryItems = await detectLuxurySpending(records);
  console.log(`  → ${luxuryItems.length} luxury item(s) confirmed`);

  // ── Pattern 4: Contractor clusters
  console.log('[wasteDetector] 4/5 Detecting contractor concentration...');
  const clusters = detectContractorClusters(records);
  console.log(`  → ${clusters.length} cluster(s) detected`);

  // ── Pattern 5: Department scores
  console.log('[wasteDetector] 5/5 Calculating department waste scores...');
  const deptScores = scoreDepartments(records, soleSources);
  console.log(`  → ${deptScores.length} departments scored`);

  // ── Top 10 per country
  const top10 = buildTop10(records);

  // ── Summary
  const summary = buildSummary(spikes, soleSources, luxuryItems, clusters, deptScores, top10);

  // ── Save
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const report = {
    generatedAt:         new Date().toISOString(),
    durationMs:          Date.now() - startedAt,
    basedOn:             ENRICHED_FILE,
    summary,
    spendSpikes:         spikes,
    soleSources,
    luxurySpending:      luxuryItems,
    contractorClusters:  clusters,
    departmentScores:    deptScores,
    top10ByCountry:      top10,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));

  // ── Report
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('[wasteDetector] Analysis complete');
  console.log('='.repeat(60));
  console.log(`  Spend spikes detected    : ${spikes.length}`);
  console.log(`  Sole-source contracts    : ${soleSources.length}`);
  console.log(`  Luxury items confirmed   : ${luxuryItems.length}`);
  console.log(`  Contractor clusters      : ${clusters.length}`);
  console.log(`  Departments scored       : ${deptScores.length}`);
  console.log(`  High-risk depts (≥50/100): ${deptScores.filter(d => d.wasteScore >= 50).length}`);
  if (summary.topHighRiskDept) {
    console.log(`  Top risk dept            : ${summary.topHighRiskDept}`);
  }
  console.log('\n  Top wasteful item per country:');
  for (const [jur, items] of Object.entries(top10)) {
    if (items[0]) {
      console.log(`    ${jur}: [${items[0].severity}/${items[0].wasteScore}] ${(items[0].title || '').slice(0, 55).padEnd(55)}  $${(Math.abs(items[0].amount) / 1e6).toFixed(2)}M`);
    }
  }
  console.log(`\n  Duration : ${durationS}s`);
  console.log(`  Output   : ${OUTPUT_FILE}`);
  console.log('='.repeat(60) + '\n');

  return report;
}

module.exports = { detectWaste };

// Run directly when invoked as a script
if (require.main === module) {
  detectWaste()
    .then(() => process.exit(0))
    .catch(err => { console.error('[wasteDetector] Fatal:', err.message); process.exit(1); });
}
