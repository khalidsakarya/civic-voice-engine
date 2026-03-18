/**
 * Leader Expense Leaderboard Builder — Civic Voice Engine
 *
 * Builds a "most expensive leaders" ranking per country from the enriched
 * leader expense data. Computes trend arrows by comparing to the previous
 * leaderboard snapshot saved from the last run.
 *
 * Trend logic (based on totalExpenses change):
 *   "up"     — increased by more than 5%
 *   "down"   — decreased by more than 5%
 *   "stable" — within ±5% of previous total
 *   "new"    — person not present in previous leaderboard
 *
 * Output files:
 *   output/processed/expense_leaderboard.json      — current leaderboard
 *   output/processed/expense_leaderboard_prev.json — snapshot for next run's trend comparison
 *
 * Firestore collection "expense_leaderboard":
 *   One document per country (doc ID = jurisdiction: AU | CA | UK | US)
 *   One global summary document (doc ID = _global)
 */

const fs   = require('fs');
const path = require('path');

const PROCESSED_DIR     = path.resolve(__dirname, '../../output/processed');
const ENRICHED_FILE     = path.join(PROCESSED_DIR, 'leader_expenses_enriched.json');
const LEADERBOARD_FILE  = path.join(PROCESSED_DIR, 'expense_leaderboard.json');
const PREV_FILE         = path.join(PROCESSED_DIR, 'expense_leaderboard_prev.json');

const TOP_N = 10; // leaders per country
const TREND_THRESHOLD = 0.05; // 5% change triggers up/down arrow

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(amount, currency) {
  if (amount == null) return null;
  return `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function computeTrend(currentTotal, previousTotal) {
  if (previousTotal == null || previousTotal === 0) return { trend: 'new', trendPercent: null, previousTotal: null };
  const delta = (currentTotal - previousTotal) / Math.abs(previousTotal);
  const trendPercent = Math.round(delta * 1000) / 10; // 1 dp
  if (delta > TREND_THRESHOLD)  return { trend: 'up',     trendPercent, previousTotal };
  if (delta < -TREND_THRESHOLD) return { trend: 'down',   trendPercent, previousTotal };
  return { trend: 'stable', trendPercent, previousTotal };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function buildLeaderboard() {
  console.log('\n' + '='.repeat(60));
  console.log('[leaderLeaderboard] Building expense leaderboard');
  console.log('='.repeat(60));

  // Load enriched leader data
  if (!fs.existsSync(ENRICHED_FILE)) {
    throw new Error(`leader_expenses_enriched.json not found — run npm run process:leaders first`);
  }
  const { leaders, generatedAt } = JSON.parse(fs.readFileSync(ENRICHED_FILE));

  // Load previous leaderboard for trend comparison (may not exist on first run)
  let prevByCountry = {};
  if (fs.existsSync(PREV_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(PREV_FILE));
      for (const entry of prev.countries || []) {
        const byId = {};
        for (const row of entry.top10 || []) byId[row.id] = row.totalExpenses;
        prevByCountry[entry.country] = byId;
      }
      console.log(`[leaderLeaderboard] Previous snapshot loaded (${prev.generatedAt})`);
    } catch (_) {
      console.warn('[leaderLeaderboard] Could not parse previous snapshot — all trends will be "new"');
    }
  } else {
    console.log('[leaderLeaderboard] No previous snapshot — all trends will be "new" on first run');
  }

  const jurisdictions = ['AU', 'CA', 'UK', 'US'];
  const countrySections = [];
  const allGlobal = [];

  for (const jur of jurisdictions) {
    const jurLeaders = leaders
      .filter(l => l.jurisdiction === jur && l.hasAmounts)
      .sort((a, b) => b.totalExpenses - a.totalExpenses)
      .slice(0, TOP_N);

    const prevById = prevByCountry[jur] || {};

    const top10 = jurLeaders.map((l, idx) => {
      const trendInfo = computeTrend(l.totalExpenses, prevById[l.id] ?? null);
      return {
        rank:            idx + 1,
        id:              l.id,
        person:          l.person,
        role:            l.role    || null,
        department:      l.department || null,
        party:           l.party   || null,
        jurisdiction:    l.jurisdiction,
        currency:        l.currency,
        totalExpenses:   l.totalExpenses,
        formattedTotal:  fmtCurrency(l.totalExpenses, l.currency),
        tripCount:       l.tripCount,
        averageTripCost: l.averageTripCost,
        wasteScore:      l.wasteScore,
        severity:        l.severity,
        isFlagged:       l.isFlagged,
        plainLanguageSummary: l.plainLanguageSummary,
        mostExpensiveTrip:    l.mostExpensiveTrip
          ? {
              destination: l.mostExpensiveTrip.destination,
              total:       l.mostExpensiveTrip.total,
              purpose:     l.mostExpensiveTrip.purpose,
              startDate:   l.mostExpensiveTrip.startDate,
            }
          : null,
        peerAverage:   l.peerAverage,
        peerRank:      l.peerRank,
        peerGroupSize: l.peerGroupSize,
        ...trendInfo,
      };
    });

    // Country-level summary stats
    const totalFlaggedInTop10 = top10.filter(r => r.isFlagged).length;
    const totalSpendTop10     = top10.reduce((s, r) => s + r.totalExpenses, 0);
    const topSpender          = top10[0] || null;

    countrySections.push({
      country:           jur,
      generatedAt,
      leaderboardBuiltAt: new Date().toISOString(),
      totalLeadersRanked: jurLeaders.length,
      totalSpendTop10:   Math.round(totalSpendTop10 * 100) / 100,
      currency:          top10[0]?.currency || null,
      flaggedInTop10:    totalFlaggedInTop10,
      topSpender:        topSpender ? {
        person:        topSpender.person,
        totalExpenses: topSpender.totalExpenses,
        currency:      topSpender.currency,
        wasteScore:    topSpender.wasteScore,
        trend:         topSpender.trend,
      } : null,
      top10,
    });

    allGlobal.push(...top10.map(r => ({ ...r, countryRank: r.rank })));

    console.log(`[leaderLeaderboard] ${jur}: ${top10.length} entries  top spender: ${topSpender?.person || 'n/a'}  ${topSpender ? fmtCurrency(topSpender.totalExpenses, topSpender.currency) : ''}`);
    top10.forEach(r =>
      console.log(`  #${r.rank}  ${r.person.padEnd(35)}  ${fmtCurrency(r.totalExpenses, r.currency).padEnd(22)}  score: ${r.wasteScore ?? '—'}  trend: ${r.trend}`)
    );
  }

  // Global top 10 across all countries (leaders with amounts only, sorted by totalExpenses
  // in USD-equivalent isn't feasible without FX rates so we sort by wasteScore then total)
  const globalTop10 = allGlobal
    .sort((a, b) => (b.wasteScore ?? 0) - (a.wasteScore ?? 0) || b.totalExpenses - a.totalExpenses)
    .slice(0, 10)
    .map((r, i) => ({ ...r, globalRank: i + 1 }));

  const output = {
    generatedAt:   new Date().toISOString(),
    sourceDataAt:  generatedAt,
    totalCountries: jurisdictions.length,
    countries:     countrySections,
    globalTop10,
  };

  // Save current leaderboard
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(output, null, 2));

  // Save as new snapshot for next run
  fs.writeFileSync(PREV_FILE, JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(60));
  console.log('[leaderLeaderboard] Leaderboard built');
  console.log('='.repeat(60));
  console.log(`  Countries: ${jurisdictions.join(', ')}`);
  console.log(`  Output   : ${LEADERBOARD_FILE}`);
  console.log(`  Snapshot : ${PREV_FILE}`);
  console.log('='.repeat(60) + '\n');

  return output;
}

module.exports = { buildLeaderboard };

// Run directly when invoked as a script
if (require.main === module) {
  try {
    buildLeaderboard();
    process.exit(0);
  } catch (err) {
    console.error('[leaderLeaderboard] Fatal:', err.message);
    process.exit(1);
  }
}
