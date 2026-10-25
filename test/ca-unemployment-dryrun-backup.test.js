/**
 * Safety tests for the first controlled Canada unemployment update: --dry-run, the pre-write
 * backup, the project guard and the strict command-line rule.
 *
 *   node test/ca-unemployment-dryrun-backup.test.js     (or: npm run test:ca-unemployment-safety)
 *
 * No network, no real Firestore, no real firebase-admin. Unit tests use in-memory stubs. The
 * command-line tests spawn the REAL `node src/scheduler.js ...` with test/helpers/fake-admin-preload.cjs,
 * which swaps firebase-admin for an in-memory fake, blocks every network call except canned
 * StatCan answers, and records each Firestore operation so the exact reads/writes can be asserted.
 * Backup files only ever go to a fresh temp directory outside this repository.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ENGINE = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ENGINE, rel), 'utf8').replace(/\r\n/g, '\n');

const U = require('../src/ingestion/caUnemploymentMonthly');
const C = require('../src/ingestion/caUnemploymentCheck');
const B = require('../src/ingestion/caUnemploymentBackup');
const G = require('../src/firebase/projectGuard');

const queue = [];
let passed = 0;
let failed = 0;
const test = (name, fn) => queue.push({ name, fn });
async function run() {
  for (const { name, fn } of queue) {
    try { await fn(); passed += 1; console.log(`  ok - ${name}`); } catch (e) { failed += 1; console.log(`  FAIL - ${name}\n    ${String(e.stack || e.message).slice(0, 700)}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed (no network, no real Firestore)`);
  if (failed) process.exitCode = 1;
}
console.log('test/ca-unemployment-dryrun-backup.test.js\n');

// ─── fixtures ───────────────────────────────────────────────────────────────
const NOW = '2026-10-15T10:00:00.000Z';
const PROJECT = 'civic-voice-5ea94';
const silent = { log() {}, warn() {} };
const lines = () => { const out = []; return { log: (m) => out.push(String(m)), warn: (m) => out.push(String(m)), out }; };

function builtFor(period, value = 6.5) {
  const [y, m] = period.split('-').map(Number);
  const pts = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    pts.push({ period: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, value: i === 0 ? value : 6 + (i % 5) / 10 });
  }
  return U.buildSocialStatDoc(pts, { nowIso: NOW });
}
const fetchReturning = (period, value) => async () => builtFor(period, value);
const ours = (period, value = 6.5) => ({ ...builtFor(period, value).data });
const legacyDoc = {
  country: 'CA', statName: 'unemploymentRate', value: 6.9, updated: '2026-02',
  source: 'Statistics Canada — Labour Force Survey, table 14-10-0017-01',
  sourceUrl: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410001701', last_updated: '2026-03-23T23:49:58.644Z',
};

/** In-memory Firestore that records EVERY operation, in order, so tests can assert exactly what happened. */
function recordingDb(initial) {
  const state = { doc: initial === undefined ? undefined : JSON.parse(JSON.stringify(initial)), ops: [], getDbCalls: 0 };
  const refOf = (name, id) => ({
    path: `${name}/${id}`,
    id,
    get: async () => { state.ops.push(['get', `${name}/${id}`]); return { exists: state.doc !== undefined, data: () => JSON.parse(JSON.stringify(state.doc)) }; },
    set: async () => { state.ops.push(['set', `${name}/${id}`]); },
    update: async () => { state.ops.push(['update', `${name}/${id}`]); },
    delete: async () => { state.ops.push(['delete', `${name}/${id}`]); },
  });
  const db = {
    state,
    collection: (name) => ({ doc: (id) => refOf(name, id), add: async () => { state.ops.push(['add', name]); } }),
    async runTransaction(fn) {
      state.ops.push(['runTransaction']);
      const pending = [];
      const result = await fn({
        get: async (ref) => { state.ops.push(['tx.get', ref.path]); return { exists: state.doc !== undefined, data: () => JSON.parse(JSON.stringify(state.doc)) }; },
        set: (ref, data, opts) => { state.ops.push(['tx.set', ref.path]); pending.push({ data, opts }); },
      });
      for (const w of pending) { state.doc = w.opts && w.opts.merge ? { ...(state.doc || {}), ...w.data } : { ...w.data }; }
      return result;
    },
    batch: () => { state.ops.push(['batch']); return { set() {}, delete() {}, commit: async () => {} }; },
  };
  return db;
}
const opNames = (db) => db.state.ops.map((o) => o.join(' '));
const projectOk = async () => PROJECT;

const mkTemp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `cv-${label}-`));
const rmrf = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } };
const gitFree = (d) => assert.strictEqual(B.findGitRepoAbove(d), null, `${d} must be outside any git repository for this test`);

// ─── 1. DRY RUN ────────────────────────────────────────────────────────────
test('DRY RUN: shows existing month/value, proposed month/value, and WRITE vs SKIP — and performs exactly one read', async () => {
  const db = recordingDb(legacyDoc);
  const out = lines();
  const audits = []; const backups = [];
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09', 6.5), nowIso: NOW, dryRun: true,
    writeAudit: async (e) => audits.push(e), writeBackup: async (a) => { backups.push(a); return { path: 'x' }; }, logger: out,
  });
  assert.strictEqual(r.status, 'DRY_RUN');
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.wouldWrite, true);
  assert.strictEqual(r.reason, 'NEWER_PERIOD');
  assert.strictEqual(r.projectId, PROJECT);
  assert.strictEqual(r.existing.period, '2026-02');
  assert.strictEqual(r.existing.value, 6.9);
  assert.strictEqual(r.proposed.period, '2026-09');
  assert.strictEqual(r.proposed.value, '6.5%');
  assert.deepStrictEqual(opNames(db), ['get social_stats/CA_unemploymentRate'], 'one read of the one document, nothing else');
  assert.strictEqual(audits.length, 0, 'no audit-log write');
  assert.strictEqual(backups.length, 0, 'no backup file in a dry run');
  const text = out.out.join('\n');
  assert.match(text, /DRY RUN/);
  assert.match(text, /existing : month 2026-02, value 6\.9/);
  assert.match(text, /proposed : month 2026-09, value 6\.5%/);
  assert.match(text, /decision : WRITE \(NEWER_PERIOD\)/);
  assert.match(text, /Firestore writes: 0 · audit-log writes: 0/);
  assert.deepStrictEqual(db.state.doc, legacyDoc, 'the stored document is untouched');
});

test('DRY RUN: same month and older month are reported as SKIP', async () => {
  for (const [stored, fetched, reason] of [['2026-09', '2026-09', 'UNCHANGED_PERIOD'], ['2026-09', '2026-08', 'OLDER_PERIOD_NEVER_OVERWRITES_NEWER']]) {
    const db = recordingDb(ours(stored));
    const r = await C.runCaUnemploymentCheck({ getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning(fetched), nowIso: NOW, dryRun: true, logger: silent });
    assert.strictEqual(r.status, 'DRY_RUN');
    assert.strictEqual(r.wouldWrite, false, `${stored} vs ${fetched}`);
    assert.strictEqual(r.reason, reason);
    assert.deepStrictEqual(opNames(db), ['get social_stats/CA_unemploymentRate']);
  }
});

test('DRY RUN: no document yet is reported as a would-write with existing = null', async () => {
  const db = recordingDb(undefined);
  const out = lines();
  const r = await C.runCaUnemploymentCheck({ getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, dryRun: true, logger: out });
  assert.strictEqual(r.wouldWrite, true);
  assert.strictEqual(r.existing, null);
  assert.match(out.out.join('\n'), /existing : none \(no document yet\)/);
  assert.deepStrictEqual(opNames(db), ['get social_stats/CA_unemploymentRate']);
});

test('DRY RUN is safe BY CONSTRUCTION: even if every write method throws, the dry run completes', async () => {
  const state = { reads: [] };
  const tripwire = (what) => () => { throw new Error(`dry run attempted ${what}`); };
  const db = {
    collection: (name) => ({
      add: tripwire('collection.add'),
      doc: (id) => ({ path: `${name}/${id}`, get: async () => { state.reads.push(`${name}/${id}`); return { exists: true, data: () => legacyDoc }; }, set: tripwire('set'), update: tripwire('update'), delete: tripwire('delete') }),
    }),
    runTransaction: tripwire('runTransaction'),
    batch: tripwire('batch'),
  };
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, dryRun: true,
    writeAudit: tripwire('audit write'), writeBackup: tripwire('backup write'), logger: silent,
  });
  assert.strictEqual(r.status, 'DRY_RUN');
  assert.deepStrictEqual(state.reads, ['social_stats/CA_unemploymentRate']);
});

test('DRY RUN: a StatCan failure is reported, nothing is read or written, and NO failure audit entry is created', async () => {
  const db = recordingDb(legacyDoc);
  const audits = [];
  let getDbCalls = 0;
  const r = await C.runCaUnemploymentCheck({
    getDb: () => { getDbCalls += 1; return db; }, getProjectId: projectOk, fetchBuilt: async () => { throw new Error('ECONNRESET'); },
    nowIso: NOW, dryRun: true, writeAudit: async (e) => audits.push(e), logger: silent,
  });
  assert.strictEqual(r.status, 'FETCH_FAILED');
  assert.strictEqual(getDbCalls, 0);
  assert.deepStrictEqual(db.state.ops, []);
  assert.strictEqual(audits.length, 0, 'a dry run never writes an audit entry, even for a failure');
});

test('DRY RUN: a read failure is DRY_RUN_FAILED (not a write failure) and nothing is written', async () => {
  const db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('PERMISSION_DENIED'); } }) }), runTransaction: () => { throw new Error('must not run'); } };
  const r = await C.runCaUnemploymentCheck({ getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, dryRun: true, logger: silent });
  assert.strictEqual(r.status, 'DRY_RUN_FAILED');
  assert.match(r.error, /PERMISSION_DENIED/);
});

// ─── 2. PRE-WRITE BACKUP (injected writer) ──────────────────────────────────
test('BACKUP: the complete original document is handed to the backup writer BEFORE the write, then exactly one write follows', async () => {
  const original = { ...legacyDoc, extraField: { nested: [1, 2, 3] }, another: 'kept' };
  const db = recordingDb(original);
  const events = [];
  let backupArgs = null;
  const audits = [];
  const origRun = db.runTransaction.bind(db);
  db.runTransaction = (fn) => origRun((tx) => fn({ get: tx.get, set: (ref, d, o) => { events.push('tx.set'); return tx.set(ref, d, o); } }));
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
    writeBackup: async (args) => { events.push('backup'); backupArgs = args; return { path: '/somewhere/backup.json' }; },
    writeAudit: async (e) => audits.push(e), logger: silent,
  });
  assert.strictEqual(r.status, 'WRITTEN');
  assert.deepStrictEqual(events, ['backup', 'tx.set'], 'backup first, then the write');
  assert.deepStrictEqual(backupArgs.data, original, 'the COMPLETE original document, including fields we do not write');
  assert.strictEqual(backupArgs.docId, 'CA_unemploymentRate');
  assert.strictEqual(backupArgs.collection, 'social_stats');
  assert.strictEqual(backupArgs.projectId, PROJECT);
  assert.strictEqual(r.backup.path, '/somewhere/backup.json');
});

test('BACKUP FAILURE: the update is abandoned — no write, document unchanged, BACKUP_FAILED, failure audited', async () => {
  const db = recordingDb(legacyDoc);
  const audits = [];
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
    writeBackup: async () => { throw new Error('ENOSPC: no space left on device'); },
    writeAudit: async (e) => audits.push(e), logger: silent,
  });
  assert.strictEqual(r.status, 'BACKUP_FAILED');
  assert.match(r.error, /ENOSPC/);
  assert.ok(!db.state.ops.some((o) => o[0] === 'tx.set' || o[0] === 'set'), `no write may happen: ${opNames(db).join(', ')}`);
  assert.deepStrictEqual(db.state.doc, legacyDoc, 'the original document is intact');
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].import_status, 'failed');
  assert.match(audits[0].error_message, /backup failed/);
});

test('BACKUP FAILURE: a missing / non-function backup writer also stops the update (the backup cannot be switched off)', async () => {
  for (const writeBackup of [null, 'not a function', 42]) {
    const db = recordingDb(legacyDoc);
    const r = await C.runCaUnemploymentCheck({ getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, writeBackup, logger: silent });
    assert.strictEqual(r.status, 'BACKUP_FAILED', String(writeBackup));
    assert.deepStrictEqual(db.state.doc, legacyDoc);
  }
});

test('BACKUP: a first-ever write (no document) has nothing to preserve; skips never create a backup', async () => {
  let calls = 0;
  const writeBackup = async () => { calls += 1; return { path: 'x' }; };
  const first = await C.runCaUnemploymentCheck({ getDb: () => recordingDb(undefined), getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, writeBackup, logger: silent });
  assert.strictEqual(first.status, 'WRITTEN');
  assert.strictEqual(first.backup, null);
  for (const [stored, fetched] of [['2026-09', '2026-09'], ['2026-09', '2026-08']]) {
    const r = await C.runCaUnemploymentCheck({ getDb: () => recordingDb(ours(stored)), getProjectId: projectOk, fetchBuilt: fetchReturning(fetched), nowIso: NOW, writeBackup, logger: silent });
    assert.strictEqual(r.status, 'SKIPPED');
  }
  assert.strictEqual(calls, 0);
});

test('SKIPS: same-month and older-month data write nothing, back up nothing and audit nothing (real run)', async () => {
  for (const [stored, fetched] of [['2026-09', '2026-09'], ['2026-09', '2026-08']]) {
    const db = recordingDb(ours(stored));
    const audits = [];
    let backups = 0;
    const r = await C.runCaUnemploymentCheck({
      getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning(fetched), nowIso: NOW,
      writeBackup: async () => { backups += 1; return { path: 'x' }; }, writeAudit: async (e) => audits.push(e), logger: silent,
    });
    assert.strictEqual(r.status, 'SKIPPED');
    assert.ok(!db.state.ops.some((o) => o[0] === 'tx.set'));
    assert.strictEqual(backups, 0);
    assert.strictEqual(audits.length, 0);
  }
});

// ─── 3. AUDIT-LOG BEHAVIOUR PRESERVED ───────────────────────────────────────
test('AUDIT: a successful update writes exactly social_stats/CA_unemploymentRate plus ONE data_audit_log entry — nothing else', async () => {
  const db = recordingDb(legacyDoc);
  const audits = [];
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
    writeBackup: async () => ({ path: 'x' }), writeAudit: async (e) => audits.push(e), logger: silent,
  });
  assert.strictEqual(r.status, 'WRITTEN');
  const writes = db.state.ops.filter((o) => /^(tx\.set|set|update|delete|add|batch)/.test(o[0]));
  assert.deepStrictEqual(writes, [['tx.set', 'social_stats/CA_unemploymentRate']], 'one document written, no other collection or document');
  assert.strictEqual(audits.length, 1);
  assert.deepStrictEqual(
    { collection_name: audits[0].collection_name, jurisdiction: audits[0].jurisdiction, import_status: audits[0].import_status, record_count: audits[0].record_count, scheduler_tier: audits[0].scheduler_tier },
    { collection_name: 'social_stats', jurisdiction: 'CA', import_status: 'success', record_count: 1, scheduler_tier: 'ca_unemployment' });
  assert.strictEqual(db.state.doc.latest_period, '2026-09');
  assert.strictEqual(db.state.doc.value, '6.5%');
});

test('AUDIT: the production audit writer is data_audit_log.add and the scheduler passes it only for real runs', () => {
  assert.match(read('src/firebase/auditLog.js'), /collection\('data_audit_log'\)\.add\(/);
  const src = read('src/scheduler.js');
  assert.match(src, /writeAudit: dryRun \? null : writeAuditLog/);
});

// ─── 4. PROJECT GUARD ───────────────────────────────────────────────────────
test('PROJECT GUARD: a mismatching or unknown project stops the run before ANY read, write, backup or audit entry', async () => {
  for (const verifier of [async () => { throw new Error('credential is bound to "other-project"'); }, undefined, null]) {
    for (const dryRun of [true, false]) {
      const db = recordingDb(legacyDoc);
      const audits = []; let backups = 0;
      const r = await C.runCaUnemploymentCheck({
        getDb: () => db, getProjectId: verifier, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, dryRun,
        writeBackup: async () => { backups += 1; return { path: 'x' }; }, writeAudit: async (e) => audits.push(e), logger: silent,
      });
      assert.strictEqual(r.status, 'PROJECT_MISMATCH');
      assert.deepStrictEqual(db.state.ops, [], 'no Firestore operation at all');
      assert.strictEqual(backups, 0);
      assert.strictEqual(audits.length, 0, 'not even a failure entry: it would be written to the wrong project');
    }
  }
});

test('PROJECT GUARD: assertExpectedProjectIds accepts only civic-voice-5ea94 and rejects every conflicting hint', () => {
  assert.strictEqual(G.EXPECTED_PROJECT_ID, PROJECT);
  assert.strictEqual(G.assertExpectedProjectIds({ credential: PROJECT, appOptions: null, env: {} }), PROJECT);
  assert.strictEqual(G.assertExpectedProjectIds({ credential: PROJECT, appOptions: PROJECT, env: { GOOGLE_CLOUD_PROJECT: PROJECT, GCLOUD_PROJECT: PROJECT } }), PROJECT);
  assert.throws(() => G.assertExpectedProjectIds({ credential: 'civic-voice-staging', appOptions: null, env: {} }), /expected project "civic-voice-5ea94"/);
  assert.throws(() => G.assertExpectedProjectIds({ credential: null, appOptions: null, env: {} }), /could not determine/);
  assert.throws(() => G.assertExpectedProjectIds({ credential: PROJECT, appOptions: 'other', env: {} }), /app options/);
  assert.throws(() => G.assertExpectedProjectIds({ credential: PROJECT, appOptions: null, env: { GOOGLE_CLOUD_PROJECT: 'other' } }), /GOOGLE_CLOUD_PROJECT/);
  assert.throws(() => G.assertExpectedProjectIds({ credential: PROJECT, appOptions: null, env: { GCLOUD_PROJECT: 'other' } }), /GCLOUD_PROJECT/);
});

test('PROJECT GUARD: collectProjectIds reads the credential locally (no network) and honours env hints', async () => {
  const admin = { app: () => ({ options: { credential: { getProjectId: async () => PROJECT }, projectId: undefined } }) };
  const ids = await G.collectProjectIds(admin, { GOOGLE_CLOUD_PROJECT: ' x ', GCLOUD_PROJECT: '' });
  assert.deepStrictEqual(ids, { credential: PROJECT, appOptions: null, env: { GOOGLE_CLOUD_PROJECT: 'x' } });
  assert.strictEqual(await G.verifyFirestoreProject({ admin, env: {} }), PROJECT);
  await assert.rejects(() => G.verifyFirestoreProject({ admin, env: { GOOGLE_CLOUD_PROJECT: 'x' } }), /GOOGLE_CLOUD_PROJECT/);
  const throwing = { app: () => ({ options: { credential: { getProjectId: async () => { throw new Error('boom'); } } } }) };
  await assert.rejects(() => G.verifyFirestoreProject({ admin: throwing, env: {} }), /could not determine/);
});

// ─── 5. THE REAL LOCAL BACKUP WRITER ────────────────────────────────────────
test('BACKUP FILE: contains document id, path, backup timestamp, project and the COMPLETE original data; mode 0600', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  try {
    const original = { ...legacyDoc, nested: { a: [1, { b: null }], c: true }, zero: 0, empty: '', unicode: 'é—✓' };
    const when = new Date('2026-10-15T12:34:56.789Z');
    const w = B.createLocalBackupWriter({ dir, now: () => when });
    const res = await w({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: original, projectId: PROJECT });
    assert.ok(res.path.startsWith(dir));
    assert.ok(res.bytes > 0 && /^[0-9a-f]{64}$/.test(res.sha256));
    const file = JSON.parse(fs.readFileSync(res.path, 'utf8'));
    assert.strictEqual(file.backup_format, 1);
    assert.deepStrictEqual(file.document, { collection: 'social_stats', id: 'CA_unemploymentRate', path: 'social_stats/CA_unemploymentRate' });
    assert.strictEqual(file.backed_up_at, '2026-10-15T12:34:56.789Z');
    assert.strictEqual(file.firebase_project, PROJECT);
    assert.deepStrictEqual(file.data, original, 'complete and unaltered');
    assert.match(path.basename(res.path), /^social_stats__CA_unemploymentRate__2026-10-15T12-34-56-789Z\.json$/);
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(res.path).mode & 0o777, 0o600);
    assert.deepStrictEqual(Object.keys(file).sort(), ['backed_up_at', 'backup_format', 'data', 'document', 'firebase_project', 'written_by']);
  } finally { rmrf(dir); }
});

test('BACKUP FILE: Firestore Timestamps, references, GeoPoints and bytes are saved with explicit type tags (lossless)', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  try {
    const ts = { seconds: 1700000000, nanoseconds: 5, toDate: () => new Date(1700000000000) };
    const data = { when: ts, native: new Date('2026-01-02T03:04:05.000Z'), ref: { path: 'a/b', firestore: {} }, geo: { latitude: 45.4, longitude: -75.7 }, raw: Buffer.from('hi'), big: 10n, nan: NaN, list: [undefined, 1] };
    const res = await B.createLocalBackupWriter({ dir })({ collection: 'social_stats', docId: 'CA_unemploymentRate', data, projectId: PROJECT });
    const f = JSON.parse(fs.readFileSync(res.path, 'utf8')).data;
    assert.deepStrictEqual(f.when, { __type: 'timestamp', iso: '2023-11-14T22:13:20.000Z', seconds: 1700000000, nanoseconds: 5 });
    assert.deepStrictEqual(f.native, { __type: 'timestamp', iso: '2026-01-02T03:04:05.000Z' });
    assert.deepStrictEqual(f.ref, { __type: 'reference', path: 'a/b' });
    assert.deepStrictEqual(f.geo, { __type: 'geopoint', latitude: 45.4, longitude: -75.7 });
    assert.deepStrictEqual(f.raw, { __type: 'bytes', base64: Buffer.from('hi').toString('base64') });
    assert.deepStrictEqual(f.big, { __type: 'bigint', value: '10' });
    assert.deepStrictEqual(f.nan, { __type: 'number', value: 'NaN' });
    assert.deepStrictEqual(f.list, [null, 1]);
  } finally { rmrf(dir); }
});

test('BACKUP FILE: never overwrites an existing backup (same timestamp -> distinct file), never touches other files', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  try {
    const w = B.createLocalBackupWriter({ dir, now: () => new Date('2026-10-15T00:00:00.000Z') });
    const a = await w({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: { v: 1 }, projectId: PROJECT });
    const b = await w({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: { v: 2 }, projectId: PROJECT });
    assert.notStrictEqual(a.path, b.path);
    assert.strictEqual(JSON.parse(fs.readFileSync(a.path, 'utf8')).data.v, 1, 'first backup preserved');
    assert.strictEqual(JSON.parse(fs.readFileSync(b.path, 'utf8')).data.v, 2);
    assert.strictEqual(fs.readdirSync(dir).length, 2);
  } finally { rmrf(dir); }
});

test('BACKUP FILE: a directory inside a git repository is REFUSED (so a backup can never be committed), and nothing is created', async () => {
  const inRepo = path.join(ENGINE, 'test', '__never_created_backup_dir__');
  assert.ok(B.findGitRepoAbove(inRepo), 'precondition: this checkout is a git working tree');
  await assert.rejects(() => B.createLocalBackupWriter({ dir: inRepo })({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: { a: 1 }, projectId: PROJECT }), /inside the git repository/);
  assert.ok(!fs.existsSync(inRepo), 'the refused directory must not be created');
  const sub = mkTemp('repo'); gitFree(sub);
  try {
    fs.mkdirSync(path.join(sub, '.git'));
    await assert.rejects(() => B.createLocalBackupWriter({ dir: path.join(sub, 'deep', 'er') })({ collection: 'c', docId: 'd', data: {}, projectId: PROJECT }), /inside the git repository/);
  } finally { rmrf(sub); }
});

test('BACKUP FILE: the default location and the env override are outside this repository', () => {
  const def = B.resolveBackupDir({});
  assert.strictEqual(def, path.join(os.homedir(), 'civic-voice-backups', 'firestore'));
  assert.strictEqual(B.resolveBackupDir({ CIVIC_VOICE_BACKUP_DIR: '  C:/x/y  ' }), path.resolve('C:/x/y'));
  assert.ok(!def.startsWith(ENGINE));
});

test('BACKUP FILE: credential-like material is refused (service-account JSON, private keys), and nothing is left on disk', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  try {
    const w = B.createLocalBackupWriter({ dir });
    const bad = [
      { note: '-----BEGIN PRIVATE KEY-----\nabc' },
      { nested: { private_key: 'x' } },
      { type: 'service_account' },
      { private_key_id: 'abc' },
      { client_email: 'svc@proj.iam.gserviceaccount.com' },
    ];
    for (const data of bad) {
      // key names are matched as JSON keys, so feed them as such
      await assert.rejects(() => w({ collection: 'social_stats', docId: 'CA_unemploymentRate', data, projectId: PROJECT }), /credential-like material/, JSON.stringify(data));
    }
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'a refused backup leaves no file');
    // ordinary documents are fine, including the word "key"
    await w({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: { key: 'value', email_notes: 'ok' }, projectId: PROJECT });
  } finally { rmrf(dir); }
});

test('BACKUP FILE: the backup of a real engine document contains no credentials and no env values', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  const saved = { ...process.env };
  try {
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----SECRET-----END PRIVATE KEY-----';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:/secret/path/sa.json';
    const res = await B.createLocalBackupWriter({ dir })({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: legacyDoc, projectId: PROJECT });
    const text = fs.readFileSync(res.path, 'utf8');
    assert.ok(!/SECRET|secret\/path|sa\.json|PRIVATE KEY/.test(text));
  } finally { process.env = saved; rmrf(dir); }
});

test('BACKUP FAILURE: a file that does not verify on read-back is deleted and the backup fails', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  const realRead = fs.readFileSync;
  try {
    fs.readFileSync = function (p, ...rest) { return String(p).startsWith(dir) ? '{"corrupt":true}' : realRead.call(fs, p, ...rest); };
    await assert.rejects(() => B.createLocalBackupWriter({ dir })({ collection: 'social_stats', docId: 'CA_unemploymentRate', data: { a: 1 }, projectId: PROJECT }), /did not verify/);
  } finally { fs.readFileSync = realRead; }
  try { assert.deepStrictEqual(fs.readdirSync(dir), [], 'the unverified file was removed'); } finally { rmrf(dir); }
});

test('BACKUP FAILURE (real writer end to end): an unusable backup location stops the update; nothing is written', async () => {
  const blocker = mkTemp('bk'); gitFree(blocker);
  try {
    const asFile = path.join(blocker, 'iam-a-file');
    fs.writeFileSync(asFile, 'x');
    const db = recordingDb(legacyDoc);
    const audits = [];
    const r = await C.runCaUnemploymentCheck({
      getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
      writeBackup: B.createLocalBackupWriter({ dir: path.join(asFile, 'sub') }), writeAudit: async (e) => audits.push(e), logger: silent,
    });
    assert.strictEqual(r.status, 'BACKUP_FAILED');
    assert.ok(!db.state.ops.some((o) => o[0] === 'tx.set'));
    assert.deepStrictEqual(db.state.doc, legacyDoc);
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].import_status, 'failed');
  } finally { rmrf(blocker); }
});

test('BACKUP FAILURE (real writer end to end): a backup location inside the repo stops the update', async () => {
  const db = recordingDb(legacyDoc);
  const r = await C.runCaUnemploymentCheck({
    getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
    writeBackup: B.createLocalBackupWriter({ dir: path.join(ENGINE, 'test', '__never_created_backup_dir__') }), logger: silent,
  });
  assert.strictEqual(r.status, 'BACKUP_FAILED');
  assert.match(r.error, /inside the git repository/);
  assert.deepStrictEqual(db.state.doc, legacyDoc);
});

test('BACKUP + WRITE (real writer end to end): the backup on disk is the exact document that was replaced', async () => {
  const dir = mkTemp('bk'); gitFree(dir);
  try {
    const db = recordingDb(legacyDoc);
    const r = await C.runCaUnemploymentCheck({
      getDb: () => db, getProjectId: projectOk, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW,
      writeBackup: B.createLocalBackupWriter({ dir }), logger: silent,
    });
    assert.strictEqual(r.status, 'WRITTEN');
    const f = JSON.parse(fs.readFileSync(r.backup.path, 'utf8'));
    assert.deepStrictEqual(f.data, legacyDoc);
    assert.strictEqual(f.document.id, 'CA_unemploymentRate');
    assert.notStrictEqual(db.state.doc.value, legacyDoc.value, 'and the live document was replaced');
    assert.strictEqual(fs.readdirSync(dir).length, 1);
  } finally { rmrf(dir); }
});

// ─── 6. STATIC CHECKS ───────────────────────────────────────────────────────
test('STATIC: only the Canada unemployment document is referenced, and the scheduler is not activated by this change', () => {
  const check = read('src/ingestion/caUnemploymentCheck.js');
  assert.strictEqual((check.match(/\.collection\(/g) || []).length, 1, 'exactly one collection() call');
  assert.match(check, /db\.collection\(COLLECTION\)\.doc\(docId\)/);
  assert.ok(!/\.(where|orderBy|batch)\(/.test(check), 'no queries or batches');
  const sch = read('src/scheduler.js');
  const regs = sch.split('\n').filter((l) => /^\s*cron\.schedule\(/.test(l) && /CA_UNEMPLOYMENT/.test(l));
  assert.deepStrictEqual(regs.map((l) => l.trim()), ['cron.schedule(CA_UNEMPLOYMENT_SCHEDULE,  () => runCaUnemploymentCycle());'], 'the cron registration is unchanged and never dry-run');
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(pkg.scripts['scheduler:ca-unemployment:dry-run'], 'node src/scheduler.js --ca-unemployment --dry-run');
  assert.strictEqual(pkg.scripts['scheduler:ca-unemployment'], 'node src/scheduler.js --ca-unemployment');
  assert.ok(!Object.values(pkg.scripts).some((v) => /--dry-run/.test(v) && v !== pkg.scripts['scheduler:ca-unemployment:dry-run'] && /scheduler\.js/.test(v) && !/--ca-unemployment/.test(v)));
});

test('STATIC: the strict --dry-run rule exists before the run flags are acted on', () => {
  const sch = read('src/scheduler.js');
  const guardAt = sch.indexOf("process.argv.includes('--dry-run')");
  const runNowAt = sch.indexOf('if (RUN_NOW) {');
  assert.ok(guardAt > 0 && runNowAt > guardAt, 'the guard must come before any run flag is acted on');
  assert.match(sch, /--dry-run is only supported as exactly: --ca-unemployment --dry-run\. Refusing to start; nothing was run\./);
});

// ─── 7. THE REAL COMMAND LINE, against the in-memory fake ──────────────────
const PRELOAD = path.join(__dirname, 'helpers', 'fake-admin-preload.cjs');
function cli(args, { doc, project, latest, statcanFail, backupDir } = {}) {
  const work = mkTemp('cli'); gitFree(work);
  const opsFile = path.join(work, 'ops.json');
  const docFile = path.join(work, 'doc.json');
  if (doc !== undefined) fs.writeFileSync(docFile, JSON.stringify(doc));
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GOOGLE_|GCLOUD_|FIREBASE_|CRON_|CIVIC_VOICE_)/.test(k)) env[k] = v;
  Object.assign(env, {
    GOOGLE_APPLICATION_CREDENTIALS: '(fake - never read)',
    FAKE_OPS_FILE: opsFile, FAKE_DOC_FILE: doc === undefined ? 'none' : docFile,
    FAKE_PROJECT_ID: project || PROJECT, FAKE_STATCAN_LATEST: latest || '2026-09',
    CIVIC_VOICE_BACKUP_DIR: backupDir || path.join(work, 'backups'),
  });
  if (statcanFail) env.FAKE_STATCAN_FAIL = '1';
  const res = spawnSync(process.execPath, ['-r', PRELOAD, path.join(ENGINE, 'src', 'scheduler.js'), ...args], { cwd: work, env, encoding: 'utf8', timeout: 90000 });
  const ops = fs.existsSync(opsFile) ? JSON.parse(fs.readFileSync(opsFile, 'utf8')) : null;
  const backups = fs.existsSync(path.join(work, 'backups')) ? fs.readdirSync(path.join(work, 'backups')) : [];
  return { code: res.status, out: `${res.stdout}\n${res.stderr}`, ops, backups, work, backupDir: backupDir || path.join(work, 'backups') };
}
const hasWrite = (ops) => ops.ops.some((o) => /^(set|tx\.set|update|delete|add|batch|runTransaction)/.test(o[0]));

test('CLI: `--ca-unemployment --dry-run` against an old stored month: exit 0, ONE read, zero writes/audits/backups, report printed', () => {
  const r = cli(['--ca-unemployment', '--dry-run'], { doc: legacyDoc });
  try {
    assert.strictEqual(r.code, 0, r.out);
    assert.match(r.out, /DRY RUN/);
    assert.match(r.out, /existing : month 2026-02, value 6\.9/);
    assert.match(r.out, /proposed : month 2026-09, value 6\.5%/);
    assert.match(r.out, /decision : WRITE \(NEWER_PERIOD\)/);
    assert.deepStrictEqual(r.ops.ops.filter((o) => o[0] !== 'STATCAN'), [['get', 'social_stats/CA_unemploymentRate']]);
    assert.ok(!hasWrite(r.ops));
    assert.deepStrictEqual(r.ops.finalDocument, legacyDoc, 'document unchanged');
    assert.deepStrictEqual(r.backups, [], 'no backup file in a dry run');
    assert.ok(!r.ops.ops.some((o) => /NETWORK_ATTEMPT|REAL_SDK/.test(o[0])), JSON.stringify(r.ops.ops));
  } finally { rmrf(r.work); }
});

test('CLI dry run: same-month and older-month data report SKIP and still write nothing', () => {
  for (const [stored, latest] of [['2026-09', '2026-09'], ['2026-09', '2026-08']]) {
    const doc = ours(stored);
    const r = cli(['--ca-unemployment', '--dry-run'], { doc, latest });
    try {
      assert.strictEqual(r.code, 0, r.out);
      assert.match(r.out, /decision : SKIP/);
      assert.ok(!hasWrite(r.ops));
      assert.deepStrictEqual(r.ops.finalDocument, doc);
    } finally { rmrf(r.work); }
  }
});

test('CLI dry run: wrong Firebase project -> exit 1, PROJECT_MISMATCH, NO Firestore operation at all', () => {
  const r = cli(['--ca-unemployment', '--dry-run'], { doc: legacyDoc, project: 'some-other-project' });
  try {
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /Refusing to touch Firestore/);
    assert.deepStrictEqual(r.ops.ops.filter((o) => o[0] !== 'STATCAN'), []);
  } finally { rmrf(r.work); }
});

test('CLI dry run: StatCan outage -> exit 1, document never read, nothing written (fetch and curl fallbacks are blocked in the rehearsal)', () => {
  const r = cli(['--ca-unemployment', '--dry-run'], { doc: legacyDoc, statcanFail: true });
  try {
    assert.strictEqual(r.code, 1, r.out);
    assert.ok(r.ops.ops.some((o) => o[0] === 'NETWORK_ATTEMPT' && /child_process/.test(o[1])), 'the curl fallback was attempted and blocked');
    assert.deepStrictEqual(r.ops.ops.filter((o) => o[0] !== 'STATCAN' && o[0] !== 'NETWORK_ATTEMPT'), []);
  } finally { rmrf(r.work); }
});

test('CLI: `--dry-run` anywhere but exactly `--ca-unemployment --dry-run` is REFUSED — nothing runs, nothing is contacted', () => {
  for (const args of [['--dry-run'], ['--now', '--dry-run'], ['--dry-run', '--now'], ['--ca-unemployment', '--now', '--dry-run'], ['--ca-unemployment', '--dry-run', '--carney'], ['--run-on-start', '--dry-run'], ['--monthly', '--dry-run']]) {
    const r = cli(args, { doc: legacyDoc });
    try {
      assert.strictEqual(r.code, 1, `${args.join(' ')}\n${r.out}`);
      assert.match(r.out, /--dry-run is only supported as exactly: --ca-unemployment --dry-run\. Refusing to start; nothing was run\./);
      const ops = r.ops ? r.ops.ops : [];
      assert.deepStrictEqual(ops, [], `${args.join(' ')} must not contact anything`);
    } finally { rmrf(r.work); }
  }
});

test('CLI REAL RUN rehearsal on the in-memory fake: backup first, then ONE document write and ONE audit entry; same month afterwards is a skip', () => {
  const backupDir = mkTemp('bkcli'); gitFree(backupDir);
  const r = cli(['--ca-unemployment'], { doc: legacyDoc, backupDir });
  try {
    assert.strictEqual(r.code, 0, r.out);
    const ops = r.ops.ops.filter((o) => o[0] !== 'STATCAN');
    assert.deepStrictEqual(ops, [['runTransaction'], ['tx.get', 'social_stats/CA_unemploymentRate'], ['tx.set', 'social_stats/CA_unemploymentRate'], ['add', 'data_audit_log', 'success']]);
    assert.strictEqual(r.ops.finalDocument.latest_period, '2026-09');
    const files = fs.readdirSync(backupDir);
    assert.strictEqual(files.length, 1);
    const f = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));
    assert.deepStrictEqual(f.data, legacyDoc);
    assert.strictEqual(f.firebase_project, PROJECT);
    assert.ok(!/BEGIN|private_key/.test(JSON.stringify(f)));
    // the document that now exists: a second run with the same month does nothing
    const again = cli(['--ca-unemployment'], { doc: r.ops.finalDocument, backupDir });
    try {
      assert.strictEqual(again.code, 0, again.out);
      assert.ok(!hasWrite({ ops: again.ops.ops.filter((o) => o[0] === 'tx.set' || o[0] === 'add') }));
      assert.strictEqual(fs.readdirSync(backupDir).length, 1, 'no new backup for a skip');
    } finally { rmrf(again.work); }
  } finally { rmrf(r.work); rmrf(backupDir); }
});

test('CLI REAL RUN rehearsal: unusable backup location -> exit 1, document NOT written (only the failure audit entry)', () => {
  const blocker = mkTemp('blk'); gitFree(blocker);
  const asFile = path.join(blocker, 'file'); fs.writeFileSync(asFile, 'x');
  const r = cli(['--ca-unemployment'], { doc: legacyDoc, backupDir: path.join(asFile, 'sub') });
  try {
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /pre-write backup failed/);
    assert.ok(!r.ops.ops.some((o) => o[0] === 'tx.set'), JSON.stringify(r.ops.ops));
    assert.deepStrictEqual(r.ops.finalDocument, legacyDoc);
    assert.deepStrictEqual(r.ops.ops.filter((o) => o[0] === 'add'), [['add', 'data_audit_log', 'failed']]);
  } finally { rmrf(r.work); rmrf(blocker); }
});

test('CLI REAL RUN rehearsal: wrong project -> exit 1, no read, no write, no audit entry', () => {
  const r = cli(['--ca-unemployment'], { doc: legacyDoc, project: 'some-other-project' });
  try {
    assert.strictEqual(r.code, 1, r.out);
    assert.deepStrictEqual(r.ops.ops.filter((o) => o[0] !== 'STATCAN'), []);
    assert.deepStrictEqual(r.backups, []);
  } finally { rmrf(r.work); }
});

run();
