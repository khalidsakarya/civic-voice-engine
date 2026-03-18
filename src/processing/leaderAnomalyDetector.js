/**
 * Leader Expense Anomaly Detector — Civic Voice Engine
 *
 * Second AI pass over enriched leader expense data.
 * Looks for 6 anomaly types in each minister's trip history and generates
 * punchy scandal headlines with a scandal score 1–10.
 *
 * Anomaly types detected:
 *   luxury_destination   — trip to high-end resort destination, purpose unclear
 *   duplicate_trip       — same destination taken ≥2 times within 30 days
 *   large_entourage      — unusually high costs per trip day vs destination avg
 *   weekend_holiday      — expenses claimed on weekends or public holidays
 *   hotel_above_perdiem  — accommodation rate per night significantly above govt per diem
 *   back_to_back_trips   — consecutive trips ≤3 days apart, suggesting poor planning
 *
 * Input:  output/processed/leader_expenses_enriched.json
 * Output: output/processed/expense_anomalies.json
 *
 * Firestore collection: "expense_anomalies"
 *   One document per anomaly. Also writes per-country summary docs.
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROCESSED_DIR   = path.resolve(__dirname, '../../output/processed');
const ENRICHED_FILE   = path.join(PROCESSED_DIR, 'leader_expenses_enriched.json');
const ANOMALIES_FILE  = path.join(PROCESSED_DIR, 'expense_anomalies.json');

// Leaders per Claude call (keep low — each has multiple trips to analyse)
const BATCH_SIZE = 4;

// Government accommodation per diem rates (per night in local currency)
const PER_DIEM = {
  CA: { accommodation: 250, meals: 92,  currency: 'CAD' },
  AU: { accommodation: 290, meals: 107, currency: 'AUD' },
  US: { accommodation: 200, meals: 69,  currency: 'USD' },
  UK: { accommodation: 150, meals: 55,  currency: 'GBP' },
};

// Jurisdictions with trip-level data worth analysing
const ANALYSABLE_JURISDICTIONS = new Set(['CA', 'AU']);

// Minimum trips for meaningful pattern analysis
const MIN_TRIPS = 2;

// ─── Trip preprocessing — add computed signals for Claude ─────────────────────

function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const a = new Date(dateA);
  const b = new Date(dateB);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / (1000 * 60 * 60 * 24));
}

function dayOfWeek(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
}

function preprocessTrips(trips) {
  // Sort chronologically
  const sorted = [...trips]
    .filter(t => t.startDate)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  return sorted.map((t, idx) => {
    const nights           = Math.max(1, daysBetween(t.startDate, t.endDate) || 1);
    const hotelPerNight    = (t.accommodation && t.accommodation > 0 && nights > 0)
                             ? Math.round(t.accommodation / nights * 100) / 100
                             : null;
    const costPerDay       = (t.total && t.total > 0 && nights > 0)
                             ? Math.round(t.total / nights * 100) / 100
                             : null;
    const startDay         = dayOfWeek(t.startDate);
    const isWeekendStart   = startDay === 'Saturday' || startDay === 'Sunday';
    const prevTrip         = idx > 0 ? sorted[idx - 1] : null;
    const gapFromPrev      = prevTrip ? daysBetween(prevTrip.endDate || prevTrip.startDate, t.startDate) : null;
    const isBackToBack     = gapFromPrev !== null && gapFromPrev <= 3;

    // Check for duplicate destination within 30 days
    const dupWithin30 = sorted
      .filter((other, j) => j !== idx
        && other.destination
        && t.destination
        && other.destination.toLowerCase().slice(0, 10) === t.destination.toLowerCase().slice(0, 10)
        && daysBetween(t.startDate, other.startDate) <= 30
      ).length;

    return {
      ...t,
      _nights:         nights,
      _hotelPerNight:  hotelPerNight,
      _costPerDay:     costPerDay,
      _startDayOfWeek: startDay,
      _isWeekendStart: isWeekendStart,
      _gapFromPrevTrip: gapFromPrev,
      _isBackToBack:   isBackToBack,
      _dupDestWithin30: dupWithin30,
    };
  });
}

// ─── Claude analysis ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a government accountability journalist for the Civic Voice app, specialising in ministerial expense investigations.
Your job is to analyse a minister's trip history and identify specific expense anomalies that citizens should know about.

You will be given batches of minister profiles with preprocessed trip data. For each anomaly you find, write a short punchy headline (under 15 words) that a journalist would use, and assign a scandal score.

The 6 anomaly types to detect — only flag genuine concerns:

1. luxury_destination
   Trips to resort/leisure destinations (Monaco, Maldives, Dubai, Cannes, Ibiza, Mykonos, Bali, Davos, Aspen, Las Vegas, Palm Beach, St Moritz, etc.) where the stated purpose is vague or could have been a phone/video call.
   Headline style: "Minister billed taxpayers for weekend trip to Monaco — purpose listed as 'meetings'"

2. duplicate_trip
   The same destination visited ≥2 times within 30 days, where the trips could have been combined.
   Headline style: "Same minister flew to Vancouver three times in three weeks — each trip at taxpayer expense"

3. large_entourage
   Per-day or per-trip cost is so high relative to the destination that it implies a large entourage, or hospitality expenses suggest hosting many guests for one person.
   Headline style: "Single-day Ottawa meeting cost $8,400 — enough to fly a delegation of ten"

4. weekend_holiday
   Official expenses claimed on a Saturday or Sunday with no evident public-purpose context, or trips starting Friday and ending Monday.
   Headline style: "Minister claimed $1,200 in meals on a Sunday — no public events that weekend"

5. hotel_above_perdiem
   Accommodation cost per night (_hotelPerNight field) that exceeds the government per diem rate by more than 50%.
   Reference per diem rates (accommodation per night): CA CAD 250 | AU AUD 290 | US USD 200 | UK GBP 150
   Headline style: "Minister's Paris hotel ran $680/night — nearly 3× the government rate"

6. back_to_back_trips
   Two or more trips with ≤3 days between them (_isBackToBack: true) that could have been planned as one trip.
   Headline style: "Back-to-back Sydney trips 2 days apart cost $6,000 in duplicate flights"

RULES:
- Only flag anomalies where there is clear, specific numerical evidence. Do NOT flag routine official travel.
- Do NOT flag trips to international summits, G7, G20, UN, NATO, Commonwealth, or obviously necessary state visits.
- Scandal score: 1–3 = minor, worth noting. 4–6 = concerning. 7–9 = significant. 10 = egregious.
- Each anomaly must cite specific numbers (amount, rate, # of times, etc.) in the headline or description.
- If a minister has NO anomalies, include them in the response with an empty anomalies array.

Respond with a valid JSON array only — one object per minister in the same order as input.`;

function buildPrompt(batch) {
  return `Analyse the following minister expense profiles and return a JSON array with one object per minister (same order as input).

Each object must have:
{
  "leaderId": "<copy leaderId exactly>",
  "anomalies": [
    {
      "anomalyType": "<luxury_destination | duplicate_trip | large_entourage | weekend_holiday | hotel_above_perdiem | back_to_back_trips>",
      "headline": "<punchy journalistic headline under 15 words, must include specific numbers>",
      "description": "<1-2 sentences with specific evidence: amounts, dates, destinations, rates>",
      "scandalScore": <integer 1-10>,
      "severity": "<Critical if 9-10 | High if 7-8 | Medium if 4-6 | Low if 1-3>",
      "evidence": {
        "tripDestination": "<destination or null>",
        "tripDate": "<startDate of the relevant trip(s)>",
        "amount": <relevant dollar amount or null>,
        "detail": "<key fact that makes this anomalous>"
      }
    }
  ]
}

Per diem reference (accommodation per night): CA CAD 250 | AU AUD 290 | US USD 200

Minister profiles:
${JSON.stringify(batch, null, 2)}`;
}

async function analyseLeaderBatch(batch) {
  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048 + batch.length * 1200,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildPrompt(batch) }],
  });

  const text = message.content[0].text.trim();

  // Extract JSON — try fence block first, then bare array, then truncation recovery
  let jsonStr = text;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  } else {
    const start = text.indexOf('[');
    const end   = text.lastIndexOf(']');
    if (start !== -1 && end !== -1) jsonStr = text.slice(start, end + 1);
  }

  let results;
  try {
    results = JSON.parse(jsonStr);
  } catch (_) {
    // Response may be truncated — attempt recovery by closing the last open object/array
    // Find the last complete top-level array element: ends with "}\n  }" or similar
    const lastGoodBrace = jsonStr.lastIndexOf('\n  }');
    if (lastGoodBrace !== -1) {
      const recovered = jsonStr.slice(0, lastGoodBrace + 4).trimEnd().replace(/,$/, '') + '\n]';
      results = JSON.parse(recovered); // throws if still broken — caught by caller
    } else {
      throw new Error(`JSON parse failed and recovery unsuccessful. Raw: ${jsonStr.slice(0, 120)}`);
    }
  }

  if (!Array.isArray(results)) {
    throw new Error(`Expected array, got ${typeof results}`);
  }

  // Tolerate partial results — pad missing leaders with empty anomaly sets
  if (results.length < batch.length) {
    const foundIds = new Set(results.map(r => r.leaderId));
    for (const leader of batch) {
      if (!foundIds.has(leader.leaderId)) results.push({ leaderId: leader.leaderId, anomalies: [] });
    }
  }

  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function detectLeaderAnomalies() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[anomalyDetector] Starting leader expense anomaly detection');
  console.log('='.repeat(60));

  if (!fs.existsSync(ENRICHED_FILE)) {
    throw new Error(`leader_expenses_enriched.json not found — run npm run process:leaders first`);
  }

  const { leaders } = JSON.parse(fs.readFileSync(ENRICHED_FILE));

  // Filter to leaders with meaningful trip-level data
  const analysable = leaders.filter(l =>
    ANALYSABLE_JURISDICTIONS.has(l.jurisdiction) &&
    l.hasAmounts &&
    (l.trips || []).filter(t => t.total != null && t.total > 0).length >= MIN_TRIPS
  );

  console.log(`[anomalyDetector] ${leaders.length} total leaders → ${analysable.length} with analysable trip data (CA + AU, ≥${MIN_TRIPS} trips)`);

  // Build Claude input profiles — preprocessed trips only
  const profiles = analysable.map(l => {
    const processedTrips = preprocessTrips(l.trips || []);
    const pd = PER_DIEM[l.jurisdiction] || PER_DIEM.CA;
    return {
      leaderId:    l.id,
      person:      l.person,
      role:        l.role,
      jurisdiction: l.jurisdiction,
      currency:    l.currency,
      perDiemAccommodation: pd.accommodation,
      perDiemMeals:         pd.meals,
      totalExpenses:   l.totalExpenses,
      tripCount:       l.tripCount,
      wasteScore:      l.wasteScore,
      trips:           processedTrips.map(t => ({
        destination:      t.destination,
        startDate:        t.startDate,
        endDate:          t.endDate,
        purpose:          t.purpose,
        total:            t.total,
        transportation:   t.transportation,
        accommodation:    t.accommodation,
        mealsEntertainment: t.mealsEntertainment,
        rawCategory:      t.rawCategory,
        _nights:          t._nights,
        _hotelPerNight:   t._hotelPerNight,
        _costPerDay:      t._costPerDay,
        _startDayOfWeek:  t._startDayOfWeek,
        _isWeekendStart:  t._isWeekendStart,
        _gapFromPrevTrip: t._gapFromPrevTrip,
        _isBackToBack:    t._isBackToBack,
        _dupDestWithin30: t._dupDestWithin30,
      })),
    };
  });

  // ── Batch through Claude ──────────────────────────────────────────────────
  const allAnomalies = [];
  let batchNum = 0, apiCalls = 0, errors = 0;

  for (let i = 0; i < profiles.length; i += BATCH_SIZE) {
    const batch = profiles.slice(i, i + BATCH_SIZE);
    batchNum++;
    const nums = `${i + 1}–${Math.min(i + BATCH_SIZE, profiles.length)}`;
    process.stdout.write(`[anomalyDetector] Batch ${batchNum} (leaders ${nums})... `);

    try {
      const results = await analyseLeaderBatch(batch);
      apiCalls++;

      let batchAnomalyCount = 0;
      for (const res of results) {
        const leader = analysable.find(l => l.id === res.leaderId);
        if (!leader) continue;

        for (const [idx, a] of (res.anomalies || []).entries()) {
          if (!a.anomalyType || !a.headline) continue;
          allAnomalies.push({
            id:           `${leader.jurisdiction.toLowerCase()}-${leader.id}-${a.anomalyType}-${idx}`,
            leaderId:     leader.id,
            person:       leader.person,
            role:         leader.role     || null,
            department:   leader.department || null,
            jurisdiction: leader.jurisdiction,
            currency:     leader.currency,
            anomalyType:  a.anomalyType,
            headline:     a.headline,
            description:  a.description  || null,
            scandalScore: a.scandalScore  ?? null,
            severity:     a.severity      || null,
            evidence:     a.evidence      || null,
            detectedAt:   new Date().toISOString(),
          });
          batchAnomalyCount++;
        }
      }
      console.log(`✓  anomalies found: ${batchAnomalyCount}`);
    } catch (err) {
      errors++;
      console.error(`✗ ${err.message}`);
    }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const byType = {};
  const byJur  = {};
  const bySev  = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const a of allAnomalies) {
    byType[a.anomalyType] = (byType[a.anomalyType] || 0) + 1;
    byJur[a.jurisdiction] = (byJur[a.jurisdiction] || 0) + 1;
    if (a.severity) bySev[a.severity] = (bySev[a.severity] || 0) + 1;
  }

  const topScandals = [...allAnomalies]
    .sort((a, b) => (b.scandalScore ?? 0) - (a.scandalScore ?? 0))
    .slice(0, 10)
    .map(a => ({
      person:      a.person,
      jurisdiction: a.jurisdiction,
      anomalyType: a.anomalyType,
      headline:    a.headline,
      scandalScore: a.scandalScore,
      severity:    a.severity,
    }));

  // ── Save ──────────────────────────────────────────────────────────────────
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const output = {
    generatedAt:       new Date().toISOString(),
    durationMs:        Date.now() - startedAt,
    leadersAnalysed:   analysable.length,
    anomaliesDetected: allAnomalies.length,
    apiCallsMade:      apiCalls,
    errors,
    summary: { byType, byJurisdiction: byJur, bySeverity: bySev, topScandals },
    anomalies: allAnomalies,
  };
  fs.writeFileSync(ANOMALIES_FILE, JSON.stringify(output, null, 2));

  // ── Print report ──────────────────────────────────────────────────────────
  const durationS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('[anomalyDetector] Detection complete');
  console.log('='.repeat(60));
  console.log(`  Leaders analysed  : ${analysable.length}`);
  console.log(`  Anomalies found   : ${allAnomalies.length}`);
  console.log(`  By type           : ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join('  ')}`);
  console.log(`  Severity  Critical: ${bySev.Critical}  High: ${bySev.High}  Medium: ${bySev.Medium}  Low: ${bySev.Low}`);
  console.log(`  Claude API calls  : ${apiCalls}  (${errors} errors)`);
  console.log(`  Duration          : ${durationS}s`);
  console.log(`  Output            : ${ANOMALIES_FILE}`);
  if (topScandals.length) {
    console.log('\n  Top scandals:');
    topScandals.slice(0, 5).forEach(a =>
      console.log(`    [${a.severity}/${a.scandalScore}] ${a.jurisdiction} — ${a.person.slice(0, 28).padEnd(28)} | ${a.headline}`)
    );
  }
  console.log('='.repeat(60) + '\n');

  return output;
}

module.exports = { detectLeaderAnomalies };

// Run directly when invoked as a script
if (require.main === module) {
  detectLeaderAnomalies()
    .then(() => process.exit(0))
    .catch(err => { console.error('[anomalyDetector] Fatal:', err.message); process.exit(1); });
}
