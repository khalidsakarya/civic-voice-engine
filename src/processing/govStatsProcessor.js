/**
 * Government Stats Processor — Civic Voice Engine
 *
 * Loads the latest quarterly gov stats files from output/govstats/,
 * runs each country's fiscal data through Claude AI to produce:
 *   - fiscalHealthScore (1–10) and rating
 *   - Plain-language citizen summary
 *   - Key insights (revenue, spending, debt, foreign aid)
 *   - Alerts for concerning fiscal patterns
 *   - Department trends analysis
 *
 * Output: output/processed/gov_stats_enriched.json
 *
 * Firestore doc fields (per country):
 *   country, quarter, year, revenue, spending, deficit, nationalDebt,
 *   unemployment, foreignAid, grants, departmentTrends,
 *   fiscalHealthScore, fiscalHealthRating, plainLanguageSummary,
 *   keyInsights, alerts, processedAt
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GOVSTATS_DIR  = path.resolve(__dirname, '../../output/govstats');
const PROCESSED_DIR = path.resolve(__dirname, '../../output/processed');
const OUTPUT_FILE   = path.join(PROCESSED_DIR, 'gov_stats_enriched.json');

// ─── Load latest govstats files ───────────────────────────────────────────────

function loadLatestGovStats() {
  if (!fs.existsSync(GOVSTATS_DIR)) {
    throw new Error('output/govstats/ not found — run npm run ingest:gov-stats first');
  }

  const files = fs.readdirSync(GOVSTATS_DIR).filter(f => f.endsWith('.json')).sort();

  // Keep the latest file per country prefix (govstats_{JUR}_...)
  const latestByCountry = {};
  for (const file of files) {
    const key = file.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latestByCountry[key] = file;
  }

  const records = [];
  for (const file of Object.values(latestByCountry)) {
    const data = JSON.parse(fs.readFileSync(path.join(GOVSTATS_DIR, file)));
    records.push(data);
    console.log(`[govStatsProcessor] Loaded ${data.country} (${data.quarter} ${data.year}) from ${file}`);
  }

  return records;
}

// ─── Compact stats for Claude (avoid token-heavy dept arrays) ─────────────────

function compactForClaude(doc) {
  const fmt = (n, decimals = 1) => (n != null ? Number(n).toFixed(decimals) : 'N/A');
  const fmtB = n => n != null ? `$${(n / 1e9).toFixed(1)}B` : 'N/A';

  // Top 8 departments only (keep prompt lean)
  const topDepts = (doc.spending?.topDepartments || []).slice(0, 8).map(d => ({
    name:       d.agency     || d.department || 'Unknown',
    amountUSD:  d.amountUSD  || d.amountLocal || null,
    pctOfTotal: d.pctOfTotal || null,
  }));

  // Top 5 grants by dept
  const topGrants = (
    doc.grantsByDept?.topDepartments ||
    doc.grantsByDept?.topAgencies    || []
  ).slice(0, 5).map(g => ({
    name:   g.agency || g.department || 'Unknown',
    amount: g.amountUSD || g.totalCAD || g.amountLocal || null,
  }));

  return {
    country:  doc.country,
    quarter:  doc.quarter,
    year:     doc.year,
    currency: doc.currency,
    gdpUSD:   fmtB(doc.gdpUSD),
    gdpYear:  doc.gdpYear,

    revenue: {
      totalUSD:         fmtB(doc.revenue?.totalUSD),
      pctGDP:           fmt(doc.revenue?.totalPctGDP) + '%',
      perCapitaUSD:     fmt(doc.revenue?.perCapitaUSD, 0),
      trend:            doc.revenue?.trend?.direction,
      trendPct:         fmt(doc.revenue?.trend?.percentChange) + '%',
      taxRevenuePctGDP: fmt(doc.revenue?.sources?.taxRevenuePctGDP) + '%',
      taxRevenueUSD:    fmtB(doc.revenue?.sources?.taxRevenueUSD),
      incomeTaxPctRev:  fmt(doc.revenue?.sources?.incomeTaxPctOfRevenue) + '% of revenue',
      goodsTaxPctRev:   fmt(doc.revenue?.sources?.goodsServicesTaxPctOfRevenue) + '% of revenue',
      socialContribPctGDP: fmt(doc.revenue?.sources?.socialContributionsPctGDP) + '% of GDP',
      dataYear:         doc.revenue?.dataYear,
    },

    spending: {
      totalUSD:     fmtB(doc.spending?.totalUSD),
      pctGDP:       fmt(doc.spending?.totalPctGDP) + '%',
      perCapitaUSD: fmt(doc.spending?.perCapitaUSD, 0),
      trend:        doc.spending?.trend?.direction,
      trendPct:     fmt(doc.spending?.trend?.percentChange) + '%',
      topDepts,
      fiscalYear:   doc.spending?.fiscalYear,
    },

    deficitSurplus: {
      status:     doc.deficitSurplus?.status,
      pctGDP:     fmt(doc.deficitSurplus?.cashBalancePctGDP) + '% of GDP',
      totalUSD:   fmtB(doc.deficitSurplus?.cashBalanceUSD),
      trend:      doc.deficitSurplus?.trend?.direction,
      trendPct:   fmt(doc.deficitSurplus?.trend?.percentChange) + '%',
      dataYear:   doc.deficitSurplus?.dataYear,
    },

    nationalDebt: {
      totalUSD:     fmtB(doc.nationalDebt?.totalUSD),
      pctGDP:       fmt(doc.nationalDebt?.totalPctGDP) + '%',
      perCapitaUSD: fmt(doc.nationalDebt?.perCapitaUSD, 0),
      trend:        doc.nationalDebt?.trend?.direction,
      trendPct:     fmt(doc.nationalDebt?.trend?.percentChange) + '%',
      dataYear:     doc.nationalDebt?.dataYear,
    },

    unemployment: {
      rate:   fmt(doc.unemployment?.rate) + '%',
      period: doc.unemployment?.period || 'annual',
      trend:  doc.unemployment?.trend?.direction,
    },

    foreignAid: {
      netOdaUSD: fmtB(doc.foreignAid?.netOdaUSD),
      pctGDP:    fmt(doc.foreignAid?.netOdaPctGDP, 3) + '%',
      trend:     doc.foreignAid?.trend?.direction,
      dataYear:  doc.foreignAid?.dataYear,
    },

    grants: {
      topDepts: topGrants,
      totalNote: doc.grantsByDept?.note || null,
    },

    spendingTrend: {
      direction:  doc.spendingTrends?.direction,
      changePct:  fmt(doc.spendingTrends?.percentChange) + '%',
      currentPct: fmt(doc.spendingTrends?.currentPctGDP) + '% of GDP',
      prevPct:    fmt(doc.spendingTrends?.previousPctGDP) + '% of GDP',
    },
  };
}

// ─── Claude system prompt ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a nonpartisan fiscal analyst for Civic Voice, a citizen engagement app. \
Your job is to assess a country's quarterly government finances and produce clear, factual, citizen-friendly analysis.

Guidelines:
- Be strictly nonpartisan. Never comment on political parties, leaders, or policies by name.
- Focus on data: revenue vs spending, debt trajectory, deficit or surplus, foreign aid generosity, grants distribution.
- Fiscal health scoring (1–10): 10 = exemplary surplus, low debt, strong revenue. 1 = severe deficit crisis, runaway debt, unsustainable trajectory. Use the full range.
  Rough guide: 8–10 Excellent | 6–7 Good | 4–5 Fair | 2–3 Poor | 1 Critical
- keyInsights: 3–5 bullet-point strings, each starting with a bolded category label like "**Revenue:**", "**Debt:**", "**Spending:**", "**Foreign Aid:**", "**Unemployment:**". Keep each under 30 words.
- alerts: 0–3 strings flagging genuinely concerning fiscal patterns (high deficit trend, debt-to-GDP above 100%, revenue falling, etc.). Empty array if no concerns.
- departmentTrends: Array of objects for the top departments provided. For each: name, share (pct of total spending), trend ("growing"|"stable"|"shrinking"|"unknown"), and a 1-sentence note explaining what this department does and its fiscal significance.
- plainLanguageSummary: 2–3 sentences a citizen can understand. Include revenue, spending, deficit/surplus status, and one forward-looking note.
- Do NOT include dollar figures in plainLanguageSummary — percentages and qualitative terms only.
- revenueInsight, spendingInsight, debtInsight, foreignAidInsight: each exactly 1 concise sentence.

Always respond with a single valid JSON object only — no markdown fences, no explanation.`;

function buildPrompt(compact) {
  return `Analyse the following quarterly government fiscal data for ${compact.country} and return a JSON object with exactly these fields:

{
  "country": "${compact.country}",
  "fiscalHealthScore": <integer 1–10>,
  "fiscalHealthRating": "<Excellent|Good|Fair|Poor|Critical>",
  "plainLanguageSummary": "<2–3 sentences, no dollar amounts, citizen-friendly>",
  "keyInsights": ["<**Category:** insight>", ...],
  "alerts": ["<concern>", ...],
  "revenueInsight": "<1 sentence>",
  "spendingInsight": "<1 sentence>",
  "debtInsight": "<1 sentence>",
  "foreignAidInsight": "<1 sentence>",
  "departmentTrends": [
    {
      "name": "<dept name>",
      "shareOfSpending": <pct or null>,
      "trend": "<growing|stable|shrinking|unknown>",
      "note": "<1-sentence description of this dept's fiscal role>"
    }
  ]
}

Fiscal data:
${JSON.stringify(compact, null, 2)}`;
}

// ─── Claude analysis per country ───────────────────────────────────────────────

async function analyzeCountry(doc) {
  const compact = compactForClaude(doc);

  const message = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildPrompt(compact) }],
  });

  const text      = message.content[0].text.trim();
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const result    = JSON.parse(jsonMatch[1]);

  if (typeof result !== 'object' || !result.fiscalHealthScore) {
    throw new Error(`Unexpected Claude response shape for ${doc.country}`);
  }

  return result;
}

// ─── Merge raw + Claude into final Firestore doc ──────────────────────────────

function buildEnrichedDoc(raw, ai) {
  return {
    // Identity
    id:      raw.id      || `${raw.country}_${raw.year}_${raw.quarter}`,
    country: raw.country,
    quarter: raw.quarter,
    year:    raw.year,
    currency: raw.currency,
    gdpUSD:  raw.gdpUSD  || null,
    gdpYear: raw.gdpYear || null,

    // ── Fiscal sections (exact field names requested) ──────────────────────
    revenue: {
      totalUSD:         raw.revenue?.totalUSD         ?? null,
      totalPctGDP:      raw.revenue?.totalPctGDP      ?? null,
      perCapitaUSD:     raw.revenue?.perCapitaUSD     ?? null,
      trend:            raw.revenue?.trend            ?? null,
      sources:          raw.revenue?.sources          ?? null,
      dataYear:         raw.revenue?.dataYear         ?? null,
      source:           raw.revenue?.source           ?? null,
      insight:          ai.revenueInsight             ?? null,
    },

    spending: {
      totalUSD:         raw.spending?.totalUSD        ?? null,
      totalPctGDP:      raw.spending?.totalPctGDP     ?? null,
      perCapitaUSD:     raw.spending?.perCapitaUSD    ?? null,
      topDepartments:   raw.spending?.topDepartments  ?? null,
      fiscalYear:       raw.spending?.fiscalYear      ?? null,
      trend:            raw.spending?.trend           ?? null,
      source:           raw.spending?.source          ?? null,
      insight:          ai.spendingInsight            ?? null,
    },

    deficit: {
      status:            raw.deficitSurplus?.status           ?? null,
      cashBalancePctGDP: raw.deficitSurplus?.cashBalancePctGDP ?? null,
      cashBalanceUSD:    raw.deficitSurplus?.cashBalanceUSD    ?? null,
      trend:             raw.deficitSurplus?.trend            ?? null,
      dataYear:          raw.deficitSurplus?.dataYear         ?? null,
      source:            raw.deficitSurplus?.source           ?? null,
    },

    nationalDebt: {
      totalUSD:     raw.nationalDebt?.totalUSD     ?? null,
      totalPctGDP:  raw.nationalDebt?.totalPctGDP  ?? null,
      perCapitaUSD: raw.nationalDebt?.perCapitaUSD ?? null,
      trend:        raw.nationalDebt?.trend        ?? null,
      dataYear:     raw.nationalDebt?.dataYear     ?? null,
      source:       raw.nationalDebt?.source       ?? null,
      insight:      ai.debtInsight                 ?? null,
    },

    unemployment: {
      rate:    raw.unemployment?.rate    ?? null,
      period:  raw.unemployment?.period  ?? null,
      year:    raw.unemployment?.year    ?? null,
      trend:   raw.unemployment?.trend   ?? null,
      source:  raw.unemployment?.source  ?? null,
    },

    foreignAid: {
      netOdaUSD:    raw.foreignAid?.netOdaUSD    ?? null,
      netOdaPctGDP: raw.foreignAid?.netOdaPctGDP ?? null,
      trend:        raw.foreignAid?.trend        ?? null,
      dataYear:     raw.foreignAid?.dataYear     ?? null,
      note:         raw.foreignAid?.note         ?? null,
      source:       raw.foreignAid?.source       ?? null,
      insight:      ai.foreignAidInsight         ?? null,
    },

    grants: {
      topAgencies:    raw.grantsByDept?.topAgencies     ?? null,
      topDepartments: raw.grantsByDept?.topDepartments  ?? null,
      totalUSD:       raw.grantsByDept?.totalUSD        ?? null,
      totalCAD:       raw.grantsByDept?.totalCAD        ?? null,
      fiscalYear:     raw.grantsByDept?.fiscalYear      ?? null,
      recordCount:    raw.grantsByDept?.recordCount     ?? null,
      note:           raw.grantsByDept?.note            ?? null,
      source:         raw.grantsByDept?.source          ?? null,
    },

    foreignLoans: raw.foreignLoans ?? null,

    // ── Claude AI analysis ─────────────────────────────────────────────────
    departmentTrends:     ai.departmentTrends    ?? [],
    fiscalHealthScore:    ai.fiscalHealthScore   ?? null,
    fiscalHealthRating:   ai.fiscalHealthRating  ?? null,
    plainLanguageSummary: ai.plainLanguageSummary ?? null,
    keyInsights:          ai.keyInsights         ?? [],
    alerts:               ai.alerts              ?? [],

    // ── Spending trends (raw) ──────────────────────────────────────────────
    spendingTrends: raw.spendingTrends ?? null,

    dataSources:  raw.dataSources  ?? [],
    processedAt:  new Date().toISOString(),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function processGovStats() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[govStatsProcessor] Starting government stats AI analysis');
  console.log('='.repeat(60));

  // 1. Load latest raw govstats files
  const rawDocs = loadLatestGovStats();
  if (rawDocs.length === 0) throw new Error('No govstats files found — run npm run ingest:gov-stats first');

  // 2. Process each country through Claude
  const enriched = [];
  let apiCallsMade = 0;
  let errors = 0;

  for (const doc of rawDocs) {
    const label = `${doc.country} (${doc.quarter} ${doc.year})`;
    process.stdout.write(`[govStatsProcessor] Analysing ${label}... `);

    try {
      const ai = await analyzeCountry(doc);
      apiCallsMade++;
      const merged = buildEnrichedDoc(doc, ai);
      enriched.push(merged);
      console.log(`✓  health score: ${ai.fiscalHealthScore}/10 (${ai.fiscalHealthRating})  alerts: ${ai.alerts?.length ?? 0}`);
    } catch (err) {
      errors++;
      console.error(`✗ ${err.message}`);
      // Fallback: include raw data without AI analysis
      enriched.push(buildEnrichedDoc(doc, {
        fiscalHealthScore:    null,
        fiscalHealthRating:   null,
        plainLanguageSummary: `AI analysis unavailable: ${err.message}`,
        keyInsights:          [],
        alerts:               [],
        revenueInsight:       null,
        spendingInsight:      null,
        debtInsight:          null,
        foreignAidInsight:    null,
        departmentTrends:     [],
      }));
    }
  }

  // 3. Save output
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  const output = {
    generatedAt:  new Date().toISOString(),
    totalCountries: enriched.length,
    apiCallsMade,
    errors,
    countries: enriched,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n[govStatsProcessor] ✓ Saved ${enriched.length} countries → ${OUTPUT_FILE}`);

  // 4. Print summary
  console.log('\n[govStatsProcessor] Summary:');
  for (const e of enriched) {
    const score  = e.fiscalHealthScore != null ? `${e.fiscalHealthScore}/10` : '  --';
    const rating = e.fiscalHealthRating || 'N/A';
    const alerts = e.alerts?.length ? `  ⚠ ${e.alerts.length} alert(s)` : '';
    console.log(`  ${e.country}  ${rating.padEnd(10)}  score: ${score}${alerts}`);
  }

  const elapsed = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(`\n[govStatsProcessor] Done in ${elapsed}s  |  ${apiCallsMade} API call(s)  |  ${errors} error(s)`);

  return { countries: enriched, apiCallsMade, errors };
}

module.exports = { processGovStats };

// ── Standalone run ─────────────────────────────────────────────────────────────
if (require.main === module) {
  processGovStats()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
