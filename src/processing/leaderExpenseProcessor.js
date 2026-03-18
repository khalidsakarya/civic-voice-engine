/**
 * Leader Expense Processor — Civic Voice Engine
 *
 * Loads raw leader expense files from output/expenses/leaders/,
 * aggregates per-leader trip statistics, computes peer-group comparisons,
 * then runs Claude AI to generate waste scores and plain-language summaries.
 *
 * Output: output/processed/leader_expenses_enriched.json
 *
 * Per-leader output fields:
 *   totalExpenses, tripCount, mostExpensiveTrip, averageTripCost,
 *   peerAverage, peerRank, peerGroupSize, peerComparison,
 *   wasteScore (1–10), severity, isFlagged,
 *   plainLanguageSummary, flagReason, trips
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LEADERS_DIR   = path.resolve(__dirname, '../../output/expenses/leaders');
const PROCESSED_DIR = path.resolve(__dirname, '../../output/processed');
const OUTPUT_FILE   = path.join(PROCESSED_DIR, 'leader_expenses_enriched.json');

const BATCH_SIZE = 5; // leaders per Claude call

const CURRENCY_BY_JUR = { AU: 'AUD', CA: 'CAD', UK: 'GBP', US: 'USD' };

// ─── Role tier classification for peer comparison ─────────────────────────────

function roleTier(role) {
  const r = (role || '').toLowerCase();
  if (r.includes('prime minister') || r === 'president' || r.includes('chief of staff')) return 'head_of_government';
  if (r.includes('minister') || r.includes('secretary') || r.includes('attorney general') || r.includes('treasurer')) return 'cabinet';
  if (r.includes('parliamentary secretary') || r.includes('assistant minister')) return 'parliamentary_secretary';
  return 'other';
}

// ─── Load latest leader files ─────────────────────────────────────────────────

function loadLatestLeaderFiles() {
  if (!fs.existsSync(LEADERS_DIR)) {
    throw new Error(`output/expenses/leaders/ not found — run npm run ingest:leaders first`);
  }

  const files = fs.readdirSync(LEADERS_DIR).filter(f => f.endsWith('.json')).sort();

  // Keep only the most recent file per source prefix
  const latestBySource = {};
  for (const file of files) {
    const key = file.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latestBySource[key] = file;
  }

  const allRecords = [];
  for (const file of Object.values(latestBySource)) {
    const payload = JSON.parse(fs.readFileSync(path.join(LEADERS_DIR, file)));
    const records = payload.records || [];
    allRecords.push(...records);
    console.log(`[leaderProcessor] Loaded ${records.length} records from ${file}`);
  }
  return allRecords;
}

// ─── Aggregate per-leader stats ───────────────────────────────────────────────

function aggregateByLeader(records) {
  const leaderMap = {};

  for (const rec of records) {
    const person = (rec.person || 'Unknown').trim();
    const key    = `${rec.jurisdiction}::${person}`;

    if (!leaderMap[key]) {
      leaderMap[key] = {
        id:           `${rec.jurisdiction.toLowerCase()}-${person.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`,
        person,
        role:         rec.role        || null,
        jurisdiction: rec.jurisdiction,
        currency:     CURRENCY_BY_JUR[rec.jurisdiction] || null,
        department:   rec.department  || null,
        party:        rec.party       || null,
        parliamentId: rec.parliamentId || null,
        hasAmounts:   false,
        totalExpenses:      0,
        tripCount:          0,
        transportation:     0,
        accommodation:      0,
        mealsEntertainment: 0,
        otherExpenses:      0,
        trips:              [],
        dataNote:     rec.dataNote  || null,
        sourceUrl:    rec.sourceUrl || null,
      };
    }

    const leader = leaderMap[key];
    const total  = rec.total != null ? Number(rec.total) : null;

    if (total !== null && !isNaN(total) && total !== 0) {
      leader.hasAmounts = true;
      leader.totalExpenses      += total;
      leader.transportation     += Number(rec.transportation     || 0);
      leader.accommodation      += Number(rec.accommodation      || 0);
      leader.mealsEntertainment += Number(rec.mealsEntertainment || 0);
      leader.otherExpenses      += Number(rec.otherExpenses      || 0);
    }

    leader.tripCount++;
    leader.trips.push({
      destination:        rec.destination,
      startDate:          rec.startDate,
      endDate:            rec.endDate,
      purpose:            rec.purpose,
      total,
      transportation:     rec.transportation,
      accommodation:      rec.accommodation,
      mealsEntertainment: rec.mealsEntertainment,
      rawCategory:        rec.rawCategory,
    });

    // Prefer more specific values discovered later
    if (!leader.role       && rec.role)       leader.role       = rec.role;
    if (!leader.department && rec.department) leader.department = rec.department;
    if (!leader.party      && rec.party)      leader.party      = rec.party;
    if (!leader.dataNote   && rec.dataNote)   leader.dataNote   = rec.dataNote;
  }

  return Object.values(leaderMap).map(leader => {
    const tripsWithAmount = leader.trips.filter(t => t.total != null && t.total > 0);

    const mostExpensiveTrip = tripsWithAmount.length > 0
      ? tripsWithAmount.reduce((best, t) => t.total > best.total ? t : best)
      : null;

    const averageTripCost = leader.hasAmounts && leader.tripCount > 0
      ? Math.round(leader.totalExpenses / leader.tripCount * 100) / 100
      : null;

    // Round currency accumulators
    for (const k of ['totalExpenses', 'transportation', 'accommodation', 'mealsEntertainment', 'otherExpenses']) {
      leader[k] = Math.round(leader[k] * 100) / 100;
    }

    return {
      ...leader,
      mostExpensiveTrip,
      averageTripCost,
      roleTier:      roleTier(leader.role),
      peerAverage:   null,
      peerRank:      null,
      peerGroupSize: null,
      peerComparison: null,
      // Claude fills these:
      wasteScore:           null,
      severity:             null,
      isFlagged:            false,
      plainLanguageSummary: null,
      flagReason:           null,
      processedAt:          null,
    };
  });
}

// ─── Peer group comparisons ───────────────────────────────────────────────────

function addPeerComparisons(leaders) {
  const groups = {};
  for (const l of leaders) {
    if (!l.hasAmounts) continue;
    const key = `${l.jurisdiction}::${l.roleTier}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  }

  for (const group of Object.values(groups)) {
    group.sort((a, b) => b.totalExpenses - a.totalExpenses);
    const avg = group.reduce((s, l) => s + l.totalExpenses, 0) / group.length;
    const peerAvg = Math.round(avg * 100) / 100;

    group.forEach((l, idx) => {
      l.peerAverage   = peerAvg;
      l.peerRank      = idx + 1;
      l.peerGroupSize = group.length;
      l.peerComparison =
        l.totalExpenses > peerAvg * 1.5 ? 'significantly above average'
        : l.totalExpenses > peerAvg * 1.1 ? 'above average'
        : l.totalExpenses < peerAvg * 0.5 ? 'significantly below average'
        : l.totalExpenses < peerAvg * 0.9 ? 'below average'
        : 'near average';
    });
  }

  return leaders;
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a nonpartisan government expense analyst for the Civic Voice civic engagement app.
Your job is to review individual expense profiles for government ministers and officials, assess whether their spending is reasonable, and produce citizen-friendly plain-language summaries.

Guidelines:
- Be factual and nonpartisan. Never make political judgments about policies or parties.
- Travelling to international summits, trade missions, or official state visits is normal and expected.
- Flag spending that is unusually high compared to peers, lacks clear public purpose, or shows luxury patterns.
- Scores: 1–2 = routine, fully justified.  3–4 = slightly elevated but not concerning.  5–6 = worth noting, somewhat high.  7–8 = clearly elevated, explain why.  9–10 = egregious or unexplained.
- For US records (agency-level aggregate, not individual): note in summary that figures represent the entire agency, not one person.
- For UK records (IPSA data unavailable): return wasteScore null, isFlagged false, and note unavailability in plainLanguageSummary.
- For leaders where hasAmounts is false: return wasteScore null, isFlagged false.
- plainLanguageSummary format: "[Name] spent [formatted amount + currency] on [N] trips this period, averaging [avg] per trip[, which is X% above/below the peer average of Y]."
- Keep plainLanguageSummary to 1–2 sentences max.

Always respond with a valid JSON array only — no markdown, no explanation.`;

function buildPrompt(leaders) {
  return `Analyse each of the following government official expense profiles. Return a JSON array with exactly one object per leader, in the same order as the input.

Each object must have exactly these fields:
{
  "id": "<copy id exactly>",
  "wasteScore": <integer 1–10, or null if no amounts available>,
  "isFlagged": <true if wasteScore >= 5, false otherwise, always false if null>,
  "severity": "<Critical if 9–10 | High if 7–8 | Medium if 5–6 | Low if 1–4 | None if null>",
  "plainLanguageSummary": "<1–2 sentences following the format described above>",
  "flagReason": "<null if not flagged, otherwise 1 concise sentence naming the specific concern>"
}

Leader profiles:
${JSON.stringify(leaders, null, 2)}`;
}

async function analyzeLeaderBatch(leaders) {
  const profiles = leaders.map(l => ({
    id:                l.id,
    person:            l.person,
    role:              l.role,
    jurisdiction:      l.jurisdiction,
    currency:          l.currency,
    hasAmounts:        l.hasAmounts,
    totalExpenses:     l.hasAmounts ? l.totalExpenses      : null,
    tripCount:         l.tripCount,
    averageTripCost:   l.averageTripCost,
    transportation:    l.transportation   || null,
    accommodation:     l.accommodation    || null,
    mealsEntertainment: l.mealsEntertainment || null,
    mostExpensiveTrip: l.mostExpensiveTrip ? {
      destination: l.mostExpensiveTrip.destination,
      total:       l.mostExpensiveTrip.total,
      purpose:     l.mostExpensiveTrip.purpose,
      startDate:   l.mostExpensiveTrip.startDate,
    } : null,
    peerAverage:   l.peerAverage,
    peerComparison: l.peerComparison,
    peerRank:      l.peerRank,
    peerGroupSize: l.peerGroupSize,
    dataNote:      l.dataNote,
  }));

  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 512 + leaders.length * 300,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildPrompt(profiles) }],
  });

  const text      = message.content[0].text.trim();
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const analyses  = JSON.parse(jsonMatch[1]);

  if (!Array.isArray(analyses) || analyses.length !== leaders.length) {
    throw new Error(`Expected ${leaders.length} results, got ${Array.isArray(analyses) ? analyses.length : typeof analyses}`);
  }

  return analyses;
}

// ─── Main processing pipeline ─────────────────────────────────────────────────

async function processLeaderExpenses() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[leaderProcessor] Starting leader expense analysis');
  console.log('='.repeat(60));

  // 1. Load raw records
  const rawRecords = loadLatestLeaderFiles();
  console.log(`\n[leaderProcessor] ${rawRecords.length} raw records loaded`);

  // 2. Aggregate per-leader
  let leaders = aggregateByLeader(rawRecords);
  console.log(`[leaderProcessor] ${leaders.length} unique leaders identified`);
  leaders.forEach(l =>
    console.log(`  ${l.jurisdiction}  ${l.person.padEnd(35)}  trips: ${l.tripCount}  ${l.hasAmounts ? `total: ${l.currency} ${l.totalExpenses.toLocaleString()}` : '(no amounts)'}`)
  );

  // 3. Peer comparisons
  leaders = addPeerComparisons(leaders);

  // 4. Claude analysis (batched)
  const analysisMap = {};
  let batchNum = 0, apiCalls = 0, errors = 0;

  for (let i = 0; i < leaders.length; i += BATCH_SIZE) {
    const batch = leaders.slice(i, i + BATCH_SIZE);
    batchNum++;
    const nums = `${i + 1}–${Math.min(i + BATCH_SIZE, leaders.length)}`;
    process.stdout.write(`[leaderProcessor] Batch ${batchNum} (leaders ${nums})... `);

    try {
      const analyses = await analyzeLeaderBatch(batch);
      apiCalls++;
      for (const a of analyses) analysisMap[String(a.id)] = a;
      console.log(`✓  flagged: ${analyses.filter(a => a.isFlagged).length}/${analyses.length}`);
    } catch (err) {
      errors++;
      console.error(`✗ ${err.message}`);
      for (const l of batch) {
        analysisMap[String(l.id)] = {
          id: l.id, wasteScore: null, isFlagged: false, severity: 'None',
          plainLanguageSummary: `Analysis unavailable: ${err.message}`,
          flagReason: null,
        };
      }
    }
  }

  // 5. Merge AI analysis onto leader profiles
  const enriched = leaders.map(leader => {
    const a = analysisMap[String(leader.id)] || {
      id: leader.id, wasteScore: null, isFlagged: false, severity: 'None',
      plainLanguageSummary: null, flagReason: null,
    };
    return {
      ...leader,
      wasteScore:           a.wasteScore ?? null,
      isFlagged:            a.isFlagged  ?? false,
      severity:             a.severity   ?? 'None',
      plainLanguageSummary: a.plainLanguageSummary ?? null,
      flagReason:           a.flagReason ?? null,
      processedAt:          new Date().toISOString(),
    };
  });

  // 6. Build summary stats
  const flagged = enriched.filter(l => l.isFlagged);
  const bySev   = { Critical: 0, High: 0, Medium: 0, Low: 0, None: 0 };
  const byJur   = {};
  for (const l of enriched) {
    bySev[l.severity] = (bySev[l.severity] || 0) + 1;
    byJur[l.jurisdiction] = (byJur[l.jurisdiction] || 0) + 1;
  }

  const topFlagged = enriched
    .filter(l => l.isFlagged && l.wasteScore != null)
    .sort((a, b) => (b.wasteScore - a.wasteScore) || (b.totalExpenses - a.totalExpenses))
    .slice(0, 10)
    .map(l => ({
      id:          l.id,
      person:      l.person,
      role:        l.role,
      jurisdiction: l.jurisdiction,
      totalExpenses: l.totalExpenses,
      currency:    l.currency,
      wasteScore:  l.wasteScore,
      severity:    l.severity,
      plainLanguageSummary: l.plainLanguageSummary,
    }));

  // 7. Save output
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const output = {
    generatedAt:  new Date().toISOString(),
    durationMs:   Date.now() - startedAt,
    totalLeaders: enriched.length,
    flaggedCount: flagged.length,
    apiCallsMade: apiCalls,
    errors,
    summary: { bySeverity: bySev, byJurisdiction: byJur, topFlagged },
    leaders: enriched,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  // 8. Print report
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('[leaderProcessor] Analysis complete');
  console.log('='.repeat(60));
  console.log(`  Leaders processed : ${enriched.length}`);
  console.log(`  Flagged           : ${flagged.length}  (${Math.round(flagged.length / enriched.length * 100)}%)`);
  console.log(`  Severity  Critical: ${bySev.Critical}  High: ${bySev.High}  Medium: ${bySev.Medium}  Low: ${bySev.Low}`);
  console.log(`  Claude API calls  : ${apiCalls}  (${errors} errors)`);
  console.log(`  Duration          : ${durationS}s`);
  console.log(`  Output            : ${OUTPUT_FILE}`);
  if (topFlagged.length) {
    console.log('\n  Top flagged leaders:');
    topFlagged.slice(0, 5).forEach(l =>
      console.log(`    [${l.severity}/${l.wasteScore}] ${l.jurisdiction} — ${l.person.padEnd(30)}  ${l.currency} ${(l.totalExpenses || 0).toLocaleString()}`)
    );
  }
  console.log('='.repeat(60) + '\n');

  return output;
}

module.exports = { processLeaderExpenses };

// Run directly when invoked as a script
if (require.main === module) {
  processLeaderExpenses()
    .then(out => process.exit(out.errors > 0 ? 1 : 0))
    .catch(err => { console.error('[leaderProcessor] Fatal:', err.message); process.exit(1); });
}
