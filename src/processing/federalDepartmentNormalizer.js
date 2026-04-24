'use strict';

/**
 * Federal Department Normalizer
 *
 * Merges department_budgets, department_heads, and department_expenses
 * Firestore documents into one unified FederalDepartment record per
 * department for all 4 jurisdictions (CA, US, UK, AU).
 *
 * Uploads to Firestore collection: federal_departments
 */

require('dotenv').config();
const { getDb }                 = require('../firebase/client');
const { createDepartmentRecord } = require('../schemas/federalDepartment');

// ─── Local currency per jurisdiction ─────────────────────────────────────────
const JUR_CURRENCY = { CA: 'CAD', US: 'USD', UK: 'GBP', AU: 'AUD' };

// ─── Unit multipliers per jurisdiction ───────────────────────────────────────
// CA: raw CAD | US: raw USD | UK: GBP billions | AU: AUD thousands
const BUDGET_MULTIPLIER = { CA: 1, US: 1, UK: 1_000_000_000, AU: 1_000 };

/** Convert a raw source value to the jurisdiction's local currency (no FX). */
function toLocalAmount(value, jurisdiction) {
  if (value == null) return null;
  return Math.round(value * (BUDGET_MULTIPLIER[jurisdiction] || 1));
}

// ─── Name normalisation for fuzzy matching ────────────────────────────────────
const STRIP_PREFIXES = [
  /^the\s+/i,
  /^department\s+of\s+the\s+/i,
  /^department\s+of\s+/i,
  /^ministry\s+of\s+/i,
  /^office\s+of\s+the\s+/i,
  /^office\s+of\s+/i,
  /^agency\s+for\s+/i,
  /^agency\s+of\s+/i,
  /^his\s+majesty.s\s+/i,
  /^her\s+majesty.s\s+/i,
];

function normalizeName(raw) {
  let s = (raw || '').toLowerCase()
    .replace(/\s*\|.*$/, '')           // strip French after |
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const re of STRIP_PREFIXES) s = s.replace(re, '');
  return s.trim();
}

function matchScore(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  // token overlap (ignore short stop-words)
  const ta = new Set(na.split(' ').filter(t => t.length > 3));
  const tb = new Set(nb.split(' ').filter(t => t.length > 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  const intersection = [...ta].filter(t => tb.has(t)).length;
  const union = new Set([...ta, ...tb]).size;
  return intersection / union;
}

/**
 * Global optimal assignment — avoids the greedy-iteration bug where a
 * short-named head (e.g. "Health") matches the first budget whose name
 * contains that token (e.g. "Canadian Centre for Occupational Health and
 * Safety") before the correct target ("Department of Health") is reached.
 *
 * Algorithm:
 *   1. Score every (budget, candidate) pair.
 *   2. Sort all pairs by score descending.
 *   3. Assign greedily: take each pair only if neither side is already used.
 *
 * Returns a Map<budgetIndex, candidateObject> for matched pairs.
 */
function optimalAssign(budgets, candidates, budgetNameFn, candidateNameFn, threshold) {
  const pairs = [];
  budgets.forEach((b, bi) => {
    candidates.forEach((c, ci) => {
      const score = matchScore(budgetNameFn(b), candidateNameFn(c));
      if (score >= threshold) pairs.push({ bi, ci, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score);

  const usedBudgets    = new Set();
  const usedCandidates = new Set();
  const budgetMatch    = new Map(); // bi → candidate object
  const candidateUsed  = new Set(); // ci values consumed

  for (const { bi, ci, score } of pairs) {
    if (usedBudgets.has(bi) || usedCandidates.has(ci)) continue;
    usedBudgets.add(bi);
    usedCandidates.add(ci);
    budgetMatch.set(bi, candidates[ci]);
    candidateUsed.add(ci);
  }

  return { budgetMatch, candidateUsed };
}

// ─── Load all docs from a collection ─────────────────────────────────────────
async function loadCollection(db, collection) {
  const snap = await db.collection(collection).get();
  return snap.docs.map(d => d.data());
}

// ─── Jurisdiction-specific obligations / outlays mapping ─────────────────────
function getObligationsOutlays(budget, jurisdiction) {
  if (!budget) return { obligations: null, outlays: null };
  switch (jurisdiction) {
    case 'CA':
      // GC InfoBase: obligations = planned spending, outlays = actual spending
      return {
        obligations: toLocalAmount(budget.total_planned, jurisdiction),
        outlays:     toLocalAmount(budget.total_spent,   jurisdiction),
      };
    case 'US':
      // USASpending: obligations = obligations_incurred (total_spent), outlays = gross_outlays
      return {
        obligations: toLocalAmount(budget.total_spent,    jurisdiction),
        outlays:     toLocalAmount(budget.gross_outlays,  jurisdiction),
      };
    case 'UK':
      // HM Treasury DEL: obligations = Resource DEL (total_budget), outlays = Capital DEL
      return {
        obligations: toLocalAmount(budget.total_budget, jurisdiction),
        outlays:     toLocalAmount(budget.cdel_budget,  jurisdiction),
      };
    case 'AU':
      // PAES: obligations = administered expenses, outlays = departmental expenses
      return {
        obligations: toLocalAmount(budget.total_administered, jurisdiction),
        outlays:     toLocalAmount(budget.total_departmental, jurisdiction),
      };
    default:
      return { obligations: null, outlays: null };
  }
}

// ─── Build unified record ─────────────────────────────────────────────────────
function buildRecord(budget, head, expense, jurisdiction) {
  const currency  = JUR_CURRENCY[jurisdiction] || (budget?.currency ?? 'USD');
  const deptName  = budget?.name || head?.department || expense?.department || 'Unknown';
  const budgetId  = budget?.id || null;

  // Derive doc ID: prefer budget id, otherwise synthesise from name
  const rawId = budgetId
    || `${jurisdiction.toLowerCase()}-dept-${normalizeName(deptName).replace(/\s+/g, '-').slice(0, 80)}`;

  // Financial figures in local currency (unit-scaled, no FX)
  const budgetAuthority = toLocalAmount(budget?.total_budget, jurisdiction);
  const { obligations, outlays } = getObligationsOutlays(budget, jurisdiction);
  const remaining       = budgetAuthority != null && obligations != null ? budgetAuthority - obligations : null;

  // Expense figures: already in local currency, no conversion needed
  const expCurrency = expense?.currency || currency;
  const travelExp   = expense?.travel_expenses     != null ? Math.round(expense.travel_expenses)     : null;
  const creditExp   = expense?.credit_card_spending != null ? Math.round(expense.credit_card_spending) : null;
  const hospitality = expense?.hospitality_expenses != null ? Math.round(expense.hospitality_expenses) : null;
  const over25k     = expense?.total_spend_over_25k != null ? Math.round(expense.total_spend_over_25k) : null;

  // internal_spending: budget breakdown + expense line items, each with currency
  const internalSpending = [];
  if (Array.isArray(budget?.internal_spending)) {
    const seen = new Set();
    for (const item of budget.internal_spending) {
      const key = `${item.category}`;
      if (seen.has(key)) continue;
      seen.add(key);
      internalSpending.push({
        category:    item.category    || null,
        amount:      toLocalAmount(item.amount || item.amount_spent, jurisdiction),
        currency,
        description: item.description || null,
        fiscal_year: budget?.fiscal_year || null,
      });
    }
  }
  if (travelExp   != null) internalSpending.push({ category: 'Travel Expenses',     amount: travelExp,   currency: expCurrency, description: null, fiscal_year: expense?.fiscal_year || null });
  if (creditExp   != null) internalSpending.push({ category: 'Credit Card Spending', amount: creditExp,   currency: expCurrency, description: null, fiscal_year: expense?.fiscal_year || null });
  if (hospitality != null) internalSpending.push({ category: 'Hospitality Expenses', amount: hospitality, currency: expCurrency, description: null, fiscal_year: expense?.fiscal_year || null });
  if (over25k     != null) internalSpending.push({ category: 'Spending Over £25k',   amount: over25k,     currency: expCurrency, description: null, fiscal_year: expense?.fiscal_year || null });

  // grants: from budget grants_given, each with currency
  const grants = Array.isArray(budget?.grants_given)
    ? budget.grants_given.map(g => ({
        recipient:   g.recipient_name || g.recipient || g.name || null,
        amount:      toLocalAmount(g.amount || g.value, jurisdiction),
        currency,
        purpose:     g.purpose     || g.description || g.program_name || null,
        fiscal_year: g.fiscal_year || budget?.fiscal_year || null,
        source_url:  g.source_url  || budget?.source_url  || null,
      }))
    : [];

  // source_metadata (no fx_rate — amounts are in local currency)
  const sourceMeta = {
    source_name:  budget?.budget_note || null,
    source_url:   budget?.source_url  || expense?.source_url || head?.source_url || null,
    retrieved_at: budget?.last_updated || expense?.last_updated || null,
    fiscal_year:  budget?.fiscal_year || expense?.fiscal_year || null,
    currency,
  };

  return createDepartmentRecord({
    department_id:     rawId,
    department_name:   deptName,
    jurisdiction,
    currency,

    leader_name:     head?.name          || null,
    leader_title:    head?.title         || null,
    political_party: head?.party         || null,
    start_date:      head?.date_appointed || null,

    fiscal_year:       budget?.fiscal_year || expense?.fiscal_year || null,
    budget_authority:  budgetAuthority,
    obligations,
    outlays,
    remaining_balance: remaining,
    employees_count:   budget?.employee_count ?? null,
    responsibilities:  null,

    grants,
    internal_spending: internalSpending,
    source_metadata:   sourceMeta,
  });
}

// ─── Normalise one jurisdiction ───────────────────────────────────────────────
function normalizeJurisdiction(jurisdiction, budgets, heads, expenses) {
  const jBudgets  = budgets.filter(d => d.jurisdiction === jurisdiction);
  const jHeads    = heads.filter(d => d.jurisdiction   === jurisdiction);
  const jExpenses = expenses.filter(d => d.jurisdiction === jurisdiction);

  const THRESHOLD = 0.45;

  // Step 1: optimal global assignment — budgets ↔ heads
  const { budgetMatch: budgetToHead, candidateUsed: headsUsed } =
    optimalAssign(jBudgets, jHeads, b => b.name, h => h.department, THRESHOLD);

  // Step 2: optimal global assignment — budgets ↔ expenses
  const { budgetMatch: budgetToExp, candidateUsed: expUsed } =
    optimalAssign(jBudgets, jExpenses, b => b.name, e => e.department, THRESHOLD);

  const records = [];

  // Step 3: build one record per budget
  jBudgets.forEach((budget, bi) => {
    const head    = budgetToHead.get(bi) || null;
    const expense = budgetToExp.get(bi)  || null;
    records.push(buildRecord(budget, head, expense, jurisdiction));
  });

  // Step 4: heads that didn't match any budget — pair with unmatched expenses
  const unmatchedHeads    = jHeads.filter((_, i) => !headsUsed.has(i));
  const unmatchedExpenses = jExpenses.filter((_, i) => !expUsed.has(i));

  const { budgetMatch: headToExp, candidateUsed: expUsed2 } =
    optimalAssign(unmatchedHeads, unmatchedExpenses, h => h.department, e => e.department, THRESHOLD);

  unmatchedHeads.forEach((head, hi) => {
    const expense = headToExp.get(hi) || null;
    records.push(buildRecord(null, head, expense, jurisdiction));
  });

  // Step 5: expenses matched to neither budget nor head
  unmatchedExpenses.forEach((expense, i) => {
    if (expUsed2.has(i)) return;
    records.push(buildRecord(null, null, expense, jurisdiction));
  });

  console.log(`[normalizer:${jurisdiction}] ${jBudgets.length} budgets + ${jHeads.length} heads + ${jExpenses.length} expenses → ${records.length} unified records`);
  return records;
}

// ─── Upload to Firestore ──────────────────────────────────────────────────────
const BATCH_SIZE = 400;

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

async function batchWrite(db, collection, records) {
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const rec of chunk) {
      const docId = sanitizeId(rec.department_id);
      batch.set(db.collection(collection).doc(docId), rec, { merge: false });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function normalizeFederalDepartments() {
  const db = getDb();

  console.log('[normalizer] Loading source collections...');
  const [budgets, heads, expenses] = await Promise.all([
    loadCollection(db, 'department_budgets'),
    loadCollection(db, 'department_heads'),
    loadCollection(db, 'department_expenses'),
  ]);
  console.log(`[normalizer] Loaded: ${budgets.length} budgets, ${heads.length} heads, ${expenses.length} expenses`);

  const allRecords = [];
  for (const jur of ['CA', 'US', 'UK', 'AU']) {
    const records = normalizeJurisdiction(jur, budgets, heads, expenses);
    allRecords.push(...records);
  }
  console.log(`[normalizer] Total unified records: ${allRecords.length}`);

  // Delete existing federal_departments docs before re-uploading
  console.log('[normalizer] Clearing existing federal_departments collection...');
  const existing = await db.collection('federal_departments').get();
  if (!existing.empty) {
    for (let i = 0; i < existing.docs.length; i += BATCH_SIZE) {
      const delBatch = db.batch();
      existing.docs.slice(i, i + BATCH_SIZE).forEach(d => delBatch.delete(d.ref));
      await delBatch.commit();
    }
    console.log(`[normalizer] Deleted ${existing.size} existing docs`);
  }

  // Add last_updated timestamp
  const ts = new Date().toISOString();
  const stamped = allRecords.map(r => ({ ...r, last_updated: ts }));

  const written = await batchWrite(db, 'federal_departments', stamped);
  console.log(`[normalizer] ✓ federal_departments: ${written} documents written`);
  return written;
}

module.exports = { normalizeFederalDepartments };

if (require.main === module) {
  normalizeFederalDepartments()
    .then(n => { console.log(`Done — ${n} documents in federal_departments.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
