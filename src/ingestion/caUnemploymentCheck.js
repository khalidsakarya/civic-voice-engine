/**
 * Canada unemployment — change-gated check for social_stats/CA_unemploymentRate.
 *
 * WHY A SEPARATE, TARGETED JOB
 * Statistics Canada publishes the Labour Force Survey partway through the month (e.g. September
 * 2026 data came out on 2026-10-09). The engine's monthly cycle fires on the 1st, BEFORE the new
 * month is out, so a monthly write would only ever restate last month's figure (with a fresh
 * "last_updated" that makes it look new). This check runs later in the month instead (see
 * CA_UNEMPLOYMENT_SCHEDULE in scheduler.js: the 15th, with a second pass on the 22nd for a late
 * release) and is safe to run at ANY time, any number of times, because it only writes when the
 * official reporting period actually advances:
 *
 *   newer period than stored          -> write
 *   same period, already our series   -> NO write (unchanged; also no audit-log entry)
 *   older period than stored          -> NO write (a missing/rolled-back release never overwrites a newer value)
 *   StatCan unreachable / no data /
 *   series identity check fails       -> NO write; the stat document is never read or written and the
 *                                        Firestore handle is not even requested (only a failure entry is audit-logged)
 *   no document yet                   -> write
 *   same period but stored by another
 *   series (e.g. the old unadjusted
 *   14-10-0017-01 value)              -> write once (series correction)
 *
 * The compare-and-write happens inside ONE Firestore transaction, so a value written by anything
 * else between "read" and "write" can never be silently overwritten by an older one.
 *
 * Revisions: if StatCan revises the already-published latest month (same period, different value),
 * this check deliberately does NOT rewrite it — it waits for the next month's release, which
 * refreshes the whole 12-month trend. That is the stated rule: only newer reporting periods update.
 *
 * Nothing here runs on import. The Firestore handle (as a getter) and the fetch function are injected,
 * so the whole decision table is tested with stubs (no network, no Firestore).
 */

'use strict';

const U = require('./caUnemploymentMonthly');

const COLLECTION = 'social_stats';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The reporting month (YYYY-MM) of a stored document, or null if unreadable. Understands:
 *   - our own documents:           latest_period "2026-09"
 *   - the engine's older documents: updated "2026-02"
 *   - display labels:               updated "Sep 2026"
 * @param {Record<string, any>|null|undefined} data
 */
function storedPeriodOf(data) {
  if (!data || typeof data !== 'object') return null;
  const ym = /^(\d{4})-(0[1-9]|1[0-2])$/;
  if (typeof data.latest_period === 'string' && ym.test(data.latest_period.trim())) return data.latest_period.trim();
  const u = typeof data.updated === 'string' ? data.updated.trim() : '';
  if (ym.test(u)) return u;
  const m = u.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    if (mi >= 0) return `${m[2]}-${String(mi + 1).padStart(2, '0')}`;
  }
  return null;
}

/** True when the stored document was produced from the verified series (table + coordinate). */
function hasVerifiedProvenance(data) {
  return !!data && data.table === U.TABLE_ID && data.coordinate === U.COORDINATE;
}

/**
 * The whole decision, as a pure function.
 * @param {Record<string, any>|null} existing stored document data, or null if none exists
 * @param {{ latest: { period: string } }} built result of buildSocialStatDoc / fetchCaUnemployment
 * @returns {{ action: 'write'|'skip', reason: string, storedPeriod: string|null, newPeriod: string }}
 */
function decideCaUnemploymentWrite(existing, built) {
  const newPeriod = built.latest.period;
  if (!existing) return { action: 'write', reason: 'NO_EXISTING_DOCUMENT', storedPeriod: null, newPeriod };
  const storedPeriod = storedPeriodOf(existing);
  if (!storedPeriod) return { action: 'write', reason: 'STORED_PERIOD_UNREADABLE', storedPeriod: null, newPeriod };
  if (newPeriod > storedPeriod) return { action: 'write', reason: 'NEWER_PERIOD', storedPeriod, newPeriod };
  if (newPeriod < storedPeriod) return { action: 'skip', reason: 'OLDER_PERIOD_NEVER_OVERWRITES_NEWER', storedPeriod, newPeriod };
  // same period
  if (hasVerifiedProvenance(existing)) return { action: 'skip', reason: 'UNCHANGED_PERIOD', storedPeriod, newPeriod };
  return { action: 'write', reason: 'SERIES_CORRECTION_SAME_PERIOD', storedPeriod, newPeriod };
}

/**
 * Run one check.
 * @param {object} deps
 * @param {() => { collection: Function, runTransaction: Function }} deps.getDb returns the Firestore handle; called only AFTER a successful, verified fetch
 * @param {(opts: { nowIso: string }) => Promise<any>} [deps.fetchBuilt] defaults to the verified StatCan fetch
 * @param {string} [deps.nowIso]
 * @param {(entry: object) => Promise<void>} [deps.writeAudit] called ONLY after a write or a fetch failure, never for a skip
 * @param {{ log: Function, warn: Function }} [deps.logger]
 * @returns {Promise<{ status: 'WRITTEN'|'SKIPPED'|'FETCH_FAILED'|'WRITE_FAILED', reason?: string, storedPeriod?: string|null, newPeriod?: string, docId: string, error?: string }>}
 */
async function runCaUnemploymentCheck({ getDb, fetchBuilt = U.fetchCaUnemployment, nowIso = new Date().toISOString(), writeAudit = null, logger = console } = {}) {
  const docId = U.DOC_ID;
  const audit = async (entry) => {
    if (!writeAudit) return;
    try { await writeAudit(entry); } catch (e) { logger.warn(`[ca-unemployment] audit log failed: ${e.message}`); }
  };

  // 1. Fetch + verify first. Any failure leaves Firestore completely untouched.
  let built;
  try {
    built = await fetchBuilt({ nowIso });
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 300);
    logger.warn(`[ca-unemployment] no update — StatCan fetch/verification failed: ${error}`);
    await audit({ collection_name: COLLECTION, jurisdiction: 'CA', data_pull_timestamp: nowIso, source_endpoint: U.SOURCE_URL, record_count: 0, import_status: 'failed', error_message: error, scheduler_tier: 'ca_unemployment' });
    return { status: 'FETCH_FAILED', docId, error };
  }

  // 2. Compare and write atomically.
  let decision;
  try {
    const db = getDb();
    const ref = db.collection(COLLECTION).doc(docId);
    decision = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = decideCaUnemploymentWrite(snap.exists ? snap.data() : null, built);
      if (d.action === 'write') tx.set(ref, built.data, { merge: true });
      return d;
    });
  } catch (err) {
    const error = String(err && err.message ? err.message : err).slice(0, 300);
    logger.warn(`[ca-unemployment] write failed: ${error}`);
    await audit({ collection_name: COLLECTION, jurisdiction: 'CA', data_pull_timestamp: nowIso, source_endpoint: U.SOURCE_URL, record_count: 0, import_status: 'failed', error_message: error, scheduler_tier: 'ca_unemployment' });
    return { status: 'WRITE_FAILED', docId, error };
  }

  if (decision.action === 'skip') {
    logger.log(`[ca-unemployment] no change — ${decision.reason} (stored ${decision.storedPeriod}, StatCan latest ${decision.newPeriod})`);
    return { status: 'SKIPPED', reason: decision.reason, storedPeriod: decision.storedPeriod, newPeriod: decision.newPeriod, docId };
  }

  logger.log(`[ca-unemployment] ✓ wrote ${COLLECTION}/${docId}: ${built.data.value} for ${built.data.updated} (${decision.reason}; previously ${decision.storedPeriod || 'none'})`);
  await audit({ collection_name: COLLECTION, jurisdiction: 'CA', data_pull_timestamp: nowIso, source_endpoint: U.SOURCE_URL, record_count: 1, import_status: 'success', scheduler_tier: 'ca_unemployment' });
  return { status: 'WRITTEN', reason: decision.reason, storedPeriod: decision.storedPeriod, newPeriod: decision.newPeriod, docId };
}

module.exports = {
  COLLECTION,
  storedPeriodOf,
  hasVerifiedProvenance,
  decideCaUnemploymentWrite,
  runCaUnemploymentCheck,
};
