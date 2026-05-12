'use strict';
/**
 * Civic Voice — Firebase Cloud Functions
 *
 * Scheduled pre-aggregation functions that reduce live Firestore reads
 * in the app by pre-computing summary statistics into summary_stats/.
 *
 * Functions:
 *   aggregateDepartmentSummary — daily   → summary_stats/department_summary
 *   aggregateMemberStats       — weekly  → summary_stats/member_stats
 *   aggregateContractStats     — weekly  → summary_stats/contract_stats
 */

const { onSchedule }   = require('firebase-functions/v2/scheduler');
const { logger }       = require('firebase-functions');
const admin            = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const REGION = 'us-central1';

// ─── Helper ───────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ─── 1. aggregateDepartmentSummary ───────────────────────────────────────────
// Reads: department_budgets
// Writes: summary_stats/department_summary
// Schedule: daily at 03:00 UTC

exports.aggregateDepartmentSummary = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'UTC', region: REGION },
  async () => {
    logger.info('[aggregateDepartmentSummary] Starting…');

    const snap = await db.collection('department_budgets').get();
    logger.info(`[aggregateDepartmentSummary] Read ${snap.size} department_budgets docs`);

    const byCountry = {};

    snap.forEach(doc => {
      const d = doc.data();
      const country = d.jurisdiction || 'UNKNOWN';

      if (!byCountry[country]) {
        byCountry[country] = {
          department_count:  0,
          total_budget:      0,
          total_spent:       0,
          total_employees:   0,
          currency:          d.currency || null,
        };
      }

      const c = byCountry[country];
      c.department_count += 1;
      c.total_budget     += typeof d.total_budget === 'number' ? d.total_budget : 0;
      c.total_spent      += typeof d.total_spent  === 'number' ? d.total_spent  : 0;
      if (typeof d.employee_count === 'number' && d.employee_count > 0) {
        c.total_employees += d.employee_count;
      }
    });

    // Round totals
    for (const c of Object.values(byCountry)) {
      c.total_budget    = round2(c.total_budget);
      c.total_spent     = round2(c.total_spent);
    }

    await db.collection('summary_stats').doc('department_summary').set({
      generatedAt:  admin.firestore.FieldValue.serverTimestamp(),
      source:       'department_budgets',
      total_docs_read: snap.size,
      byCountry,
    });

    logger.info('[aggregateDepartmentSummary] Done.', { countries: Object.keys(byCountry) });
  }
);

// ─── 2. aggregateMemberStats ──────────────────────────────────────────────────
// Reads: member_attendance
// Writes: summary_stats/member_stats
// Schedule: weekly on Mondays at 04:00 UTC

exports.aggregateMemberStats = onSchedule(
  { schedule: '0 4 * * 1', timeZone: 'UTC', region: REGION },
  async () => {
    logger.info('[aggregateMemberStats] Starting…');

    const snap = await db.collection('member_attendance').get();
    logger.info(`[aggregateMemberStats] Read ${snap.size} member_attendance docs`);

    const byJurisdiction = {};

    snap.forEach(doc => {
      const d = doc.data();
      const jur = d.jurisdiction || 'UNKNOWN';

      if (!byJurisdiction[jur]) {
        byJurisdiction[jur] = {
          member_count:        0,
          attendance_pct_sum:  0,
          attendance_pct_n:    0,
          votes_participated:  0,
          votes_total:         0,
        };
      }

      const s = byJurisdiction[jur];
      s.member_count += 1;

      if (typeof d.attendance_pct === 'number') {
        s.attendance_pct_sum += d.attendance_pct;
        s.attendance_pct_n   += 1;
      }
      if (typeof d.votes_participated === 'number') s.votes_participated += d.votes_participated;
      if (typeof d.votes_total        === 'number') s.votes_total        += d.votes_total;
    });

    // Compute final stats per jurisdiction
    const result = {};
    for (const [jur, s] of Object.entries(byJurisdiction)) {
      result[jur] = {
        member_count: s.member_count,
        avg_attendance_pct: s.attendance_pct_n
          ? round2(s.attendance_pct_sum / s.attendance_pct_n)
          : null,
        total_votes_participated: s.votes_participated,
        total_votes_total:        s.votes_total,
        overall_vote_participation_pct: s.votes_total > 0
          ? round2((s.votes_participated / s.votes_total) * 100)
          : null,
      };
    }

    await db.collection('summary_stats').doc('member_stats').set({
      generatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      source:          'member_attendance',
      total_docs_read: snap.size,
      byJurisdiction:  result,
    });

    logger.info('[aggregateMemberStats] Done.', { jurisdictions: Object.keys(result) });
  }
);

// ─── 3. aggregateContractStats ────────────────────────────────────────────────
// Reads: government_contracts
// Writes: summary_stats/contract_stats
// Schedule: weekly on Tuesdays at 04:00 UTC

exports.aggregateContractStats = onSchedule(
  { schedule: '0 4 * * 2', timeZone: 'UTC', region: REGION },
  async () => {
    logger.info('[aggregateContractStats] Starting…');

    const snap = await db.collection('government_contracts').get();
    logger.info(`[aggregateContractStats] Read ${snap.size} government_contracts docs`);

    const byJurisdiction = {};

    snap.forEach(doc => {
      const d = doc.data();
      const jur = d.jurisdiction || 'UNKNOWN';

      if (!byJurisdiction[jur]) {
        byJurisdiction[jur] = {
          contract_count: 0,
          total_value:    0,
          currency:       d.currency || null,
        };
      }

      const s = byJurisdiction[jur];
      s.contract_count += 1;
      if (typeof d.value === 'number' && d.value > 0) {
        s.total_value += d.value;
      }
    });

    // Compute final stats per jurisdiction
    const result = {};
    for (const [jur, s] of Object.entries(byJurisdiction)) {
      result[jur] = {
        contract_count:    s.contract_count,
        total_value:       round2(s.total_value),
        avg_contract_value: s.contract_count > 0
          ? round2(s.total_value / s.contract_count)
          : null,
        currency: s.currency,
      };
    }

    await db.collection('summary_stats').doc('contract_stats').set({
      generatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      source:          'government_contracts',
      total_docs_read: snap.size,
      byJurisdiction:  result,
    });

    logger.info('[aggregateContractStats] Done.', { jurisdictions: Object.keys(result) });
  }
);
