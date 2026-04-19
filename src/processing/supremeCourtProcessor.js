'use strict';

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs   = require('fs');
const path = require('path');

const client     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const COURT_DIR  = path.resolve(__dirname, '../../output/supreme_court');
const OUTPUT_DIR = COURT_DIR;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function loadLatestCaseFiles() {
  if (!fs.existsSync(COURT_DIR)) throw new Error('output/supreme_court/ not found — run npm run ingest:supreme-court first');
  const files = fs.readdirSync(COURT_DIR).filter(f => f.startsWith('cases_') && !f.startsWith('cases_enriched') && f.endsWith('.json')).sort();
  const latest = {};
  for (const f of files) {
    const key = f.replace(/_\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/, '');
    latest[key] = f;
  }
  const records = [];
  for (const f of Object.values(latest)) {
    const { records: r } = JSON.parse(fs.readFileSync(path.join(COURT_DIR, f)));
    records.push(...r);
  }
  return records;
}

/** Normalize status to one of: decided | ongoing | upcoming */
function normalizeStatus(raw) {
  if (!raw) return 'ongoing';
  const s = raw.toLowerCase();
  if (s.includes('decid') || s.includes('judg')) return 'decided';
  if (s.includes('hear') || s.includes('listed') || s.includes('pending') || s.includes('argued') || s.includes('await')) return 'upcoming';
  return 'ongoing';
}

// ─── Claude Haiku prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a legal analyst producing plain-language summaries for a civic information platform.
Given a court case, return a JSON object with exactly these fields:
- arguments_for: array of 2-4 plain-language strings arguing in favour of the winning/majority side (or petitioner if undecided)
- arguments_against: array of 2-4 plain-language strings arguing against the winning/majority side (or petitioner if undecided)
- vote_distribution: string like "6-3" or "5-4" or "Unanimous" based on the case details (null if completely unknown and case is not decided)
- voting_reason: 1-2 sentence plain-language explanation of why the justices voted the way they did, or the central legal disagreement if pending

Return ONLY valid JSON, no markdown fences, no other text.`;

function buildPrompt(cas) {
  const parts = [
    `Court: ${cas.court}`,
    `Title: ${cas.title}`,
    `Status: ${cas.status}`,
    cas.citation   ? `Citation: ${cas.citation}` : null,
    cas.docket     ? `Docket: ${cas.docket}` : null,
    cas.date       ? `Date: ${cas.date}` : null,
    cas.issue      ? `Issue: ${cas.issue}` : null,
    cas.summary    ? `Summary: ${cas.summary?.slice(0, 500)}` : null,
    cas.decision   ? `Decision: ${cas.decision?.slice(0, 300)}` : null,
  ].filter(Boolean).join('\n');
  return `Analyse this court case and return the JSON object:\n\n${parts}`;
}

async function enrichCase(cas) {
  const message = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildPrompt(cas) }],
  });

  const text = message.content[0].text.trim();
  // Strip any accidental markdown fences
  const clean = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(clean);
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function processSupremeCourtCases() {
  const cases = loadLatestCaseFiles();
  console.log(`[court:process] Loaded ${cases.length} cases — enriching with Haiku...`);

  // Process in small parallel batches to stay within rate limits
  const BATCH = 5;
  const enriched = [];

  for (let i = 0; i < cases.length; i += BATCH) {
    const batch = cases.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(c => enrichCase(c)));

    results.forEach((res, idx) => {
      const cas = batch[idx];
      const status = normalizeStatus(cas.status);

      if (res.status === 'fulfilled') {
        const ai = res.value;
        enriched.push({
          ...cas,
          status,
          arguments_for:     Array.isArray(ai.arguments_for)     ? ai.arguments_for     : [],
          arguments_against: Array.isArray(ai.arguments_against) ? ai.arguments_against : [],
          vote_distribution: ai.vote_distribution || null,
          voting_reason:     ai.voting_reason     || null,
        });
      } else {
        console.warn(`[court:process] Haiku failed for "${cas.title}": ${res.reason?.message}`);
        enriched.push({
          ...cas,
          status,
          arguments_for:     [],
          arguments_against: [],
          vote_distribution: null,
          voting_reason:     null,
        });
      }
    });

    const done = Math.min(i + BATCH, cases.length);
    console.log(`[court:process] ${done}/${cases.length} cases enriched`);

    // Brief pause between batches to avoid rate-limiting
    if (done < cases.length) await new Promise(r => setTimeout(r, 500));
  }

  // Save enriched output
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outFile = path.join(OUTPUT_DIR, `cases_enriched_${ts()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ records: enriched }, null, 2));
  console.log(`[court:process] Saved ${enriched.length} enriched cases → ${path.basename(outFile)}`);
  return enriched;
}

module.exports = { processSupremeCourtCases };

if (require.main === module) {
  processSupremeCourtCases()
    .then(records => {
      console.log(`Done — ${records.length} cases processed.`);
      process.exit(0);
    })
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
