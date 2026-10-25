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
 * SAFETY RAILS (added for the first controlled live update)
 *   1. PROJECT GUARD — before the first Firestore read, the credential's project must be
 *      civic-voice-5ea94 and no GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT hint may disagree
 *      (PROJECT_MISMATCH; nothing is read, written or audit-logged).
 *   2. DRY RUN — fetch and validate StatCan, read ONLY social_stats/CA_unemploymentRate, report the
 *      stored and proposed month/value and whether the transaction would write or skip. Zero
 *      Firestore writes, zero audit-log writes, no backup file.
 *   3. PRE-WRITE BACKUP — when a write would REPLACE an existing document, its complete original
 *      contents are saved to a local JSON file outside any git repository, INSIDE the same
 *      transaction and BEFORE tx.set. If the backup cannot be written and verified the transaction
 *      is abandoned and nothing is written (BACKUP_FAILED). The backup always matches the exact
 *      version that gets replaced, even if the transaction retries. A first-ever write (no existing
 *      document) has nothing to preserve and creates no backup. Skips never create one.
 *
 * Audit log (unchanged behaviour): one data_audit_log entry after a successful write and after a
 * failure; never for a skip or a dry run; never when the project guard refuses (that would itself
 * be a write to the wrong project).
 *
 * Revisions: if StatCan revises the already-published latest month (same period, different value),
 * this check deliberately does NOT rewrite it — it waits for the next month's release, which
 * refreshes the whole 12-month trend. That is the stated rule: only newer reporting periods update.
 *
 * Nothing here runs on import. The Firestore handle (as a getter), the project resolver, the fetch
 * function, the backup writer and the audit writer are all injected, so the whole decision table is
 * tested with stubs (no network, no Firestore).
 */

'use strict';

const U = require('./caUnemploymentMonthly');
const { createLocalBackupWriter } = require('./caUnemploymentBackup');

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

/** Raised by the backup step so the caller can tell "backup failed" from "Firestore failed". */
class BackupError extends Error {}

const clip = (e) => String(e && e.message ? e.message : e).slice(0, 300);

/**
 * Run one check.
 * @param {object} deps
 * @param {() => { collection: Function, runTransaction: Function }} deps.getDb returns the Firestore handle; called only AFTER a successful, verified fetch
 * @param {() => Promise<string>} deps.getProjectId resolves (and verifies) the project the handle is bound to; throws to refuse
 * @param {(opts: { nowIso: string }) => Promise<any>} [deps.fetchBuilt] defaults to the verified StatCan fetch
 * @param {string} [deps.nowIso]
 * @param {boolean} [deps.dryRun] report the decision only: read the one document, write nothing, audit nothing
 * @param {(args: { collection: string, docId: string, data: object, projectId: string }) => Promise<{ path: string }>} [deps.writeBackup]
 *        defaults to the local-file writer; it cannot be switched off (a non-function aborts the write)
 * @param {(entry: object) => Promise<void>} [deps.writeAudit] called ONLY after a write or a failure, never for a skip or dry run
 * @param {{ log: Function, warn: Function }} [deps.logger]
 */
async function runCaUnemploymentCheck({
  getDb,
  getProjectId,
  fetchBuilt = U.fetchCaUnemployment,
  nowIso = new Date().toISOString(),
  dryRun = false,
  writeBackup = createLocalBackupWriter(),
  writeAudit = null,
  logger = console,
} = {}) {
  const docId = U.DOC_ID;
  const audit = async (entry) => {
    if (dryRun || !writeAudit) return; // a dry run never writes an audit entry
    try { await writeAudit(entry); } catch (e) { logger.warn(`[ca-unemployment] audit log failed: ${e.message}`); }
  };
  const auditEntry = (status, extra = {}) => ({ collection_name: COLLECTION, jurisdiction: 'CA', data_pull_timestamp: nowIso, source_endpoint: U.SOURCE_URL, record_count: status === 'success' ? 1 : 0, import_status: status, scheduler_tier: 'ca_unemployment', ...extra });

  // 1. Fetch + verify first. Any failure leaves Firestore completely untouched.
  let built;
  try {
    built = await fetchBuilt({ nowIso });
  } catch (err) {
    const error = clip(err);
    logger.warn(`[ca-unemployment] no update — StatCan fetch/verification failed: ${error}`);
    await audit(auditEntry('failed', { error_message: error }));
    return { status: 'FETCH_FAILED', docId, error, dryRun };
  }

  // 2. Open the handle and verify the PROJECT before the first read (and before any audit write).
  let db;
  let projectId;
  try {
    if (typeof getProjectId !== 'function') throw new Error('Refusing to touch Firestore: no project verifier was supplied.');
    db = getDb();
    projectId = await getProjectId();
  } catch (err) {
    const error = clip(err);
    logger.warn(`[ca-unemployment] ${error}`);
    return { status: 'PROJECT_MISMATCH', docId, error, dryRun }; // deliberately NOT audit-logged: that write would go to the wrong project
  }
  const ref = db.collection(COLLECTION).doc(docId);

  // 3a. DRY RUN: one read of the one document; nothing else.
  if (dryRun) {
    try {
      const snap = await ref.get();
      const existing = snap.exists ? snap.data() : null;
      const decision = decideCaUnemploymentWrite(existing, built);
      const report = {
        status: 'DRY_RUN',
        docId,
        projectId,
        wouldWrite: decision.action === 'write',
        reason: decision.reason,
        existing: existing
          ? { period: decision.storedPeriod, value: existing.value ?? null, updated: existing.updated ?? null, table: existing.table ?? null, source: existing.source ?? null }
          : null,
        proposed: { period: decision.newPeriod, value: built.data.value, updated: built.data.updated, table: built.data.table, source: built.data.source },
        dryRun: true,
      };
      logger.log([
        `[ca-unemployment][DRY RUN] project ${projectId}, document ${COLLECTION}/${docId}`,
        `  existing : ${existing ? `month ${decision.storedPeriod || 'unreadable'}, value ${JSON.stringify(existing.value)}, updated ${JSON.stringify(existing.updated)}, table ${existing.table || 'n/a'}` : 'none (no document yet)'}`,
        `  proposed : month ${decision.newPeriod}, value ${built.data.value}, updated ${built.data.updated}, table ${built.data.table}`,
        `  decision : ${decision.action === 'write' ? 'WRITE' : 'SKIP'} (${decision.reason})`,
        '  Firestore writes: 0 · audit-log writes: 0 · backup files: 0 (dry run)',
      ].join('\n'));
      return report;
    } catch (err) {
      const error = clip(err);
      logger.warn(`[ca-unemployment][DRY RUN] could not read the document: ${error}`);
      return { status: 'DRY_RUN_FAILED', docId, projectId, error, dryRun: true };
    }
  }

  // 3b. REAL RUN: compare, back up (if replacing), and write — atomically.
  let decision;
  let backup = null;
  try {
    decision = await db.runTransaction(async (tx) => {
      backup = null; // a retried attempt starts clean
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data() : null;
      const d = decideCaUnemploymentWrite(existing, built);
      if (d.action === 'write') {
        if (existing) {
          // Preserve the COMPLETE original BEFORE replacing it; if this fails the transaction is abandoned.
          try {
            if (typeof writeBackup !== 'function') throw new Error('no backup writer is configured');
            backup = await writeBackup({ collection: COLLECTION, docId, data: existing, projectId });
          } catch (e) {
            throw new BackupError(clip(e));
          }
        }
        tx.set(ref, built.data, { merge: true });
      }
      return d;
    });
  } catch (err) {
    const error = clip(err);
    const status = err instanceof BackupError ? 'BACKUP_FAILED' : 'WRITE_FAILED';
    logger.warn(status === 'BACKUP_FAILED' ? `[ca-unemployment] NOT written — the pre-write backup failed: ${error}` : `[ca-unemployment] write failed: ${error}`);
    await audit(auditEntry('failed', { error_message: status === 'BACKUP_FAILED' ? `backup failed: ${error}` : error }));
    return { status, docId, projectId, error, dryRun: false };
  }

  if (decision.action === 'skip') {
    logger.log(`[ca-unemployment] no change — ${decision.reason} (stored ${decision.storedPeriod}, StatCan latest ${decision.newPeriod})`);
    return { status: 'SKIPPED', reason: decision.reason, storedPeriod: decision.storedPeriod, newPeriod: decision.newPeriod, docId, projectId, dryRun: false };
  }

  logger.log(`[ca-unemployment] ✓ wrote ${COLLECTION}/${docId}: ${built.data.value} for ${built.data.updated} (${decision.reason}; previously ${decision.storedPeriod || 'none'})${backup ? `; original saved to ${backup.path}` : ''}`);
  await audit(auditEntry('success'));
  return { status: 'WRITTEN', reason: decision.reason, storedPeriod: decision.storedPeriod, newPeriod: decision.newPeriod, docId, projectId, backup, dryRun: false };
}

module.exports = {
  COLLECTION,
  BackupError,
  storedPeriodOf,
  hasVerifiedProvenance,
  decideCaUnemploymentWrite,
  runCaUnemploymentCheck,
};
