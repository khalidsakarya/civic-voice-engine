/**
 * Tests for the change-gated Canada unemployment check and its scheduling.
 *
 *   node test/ca-unemployment-schedule.test.js     (or: npm run test:ca-unemployment-schedule)
 *
 * No network and no Firestore: StatCan is stubbed (axios.post) or injected, and the database is an
 * in-memory stub that implements runTransaction / get / set.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ENGINE = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ENGINE, rel), 'utf8').replace(/\r\n/g, '\n');
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-scheduler.json'), 'utf8'));

const U = require('../src/ingestion/caUnemploymentMonthly');
const C = require('../src/ingestion/caUnemploymentCheck');

const queue = [];
let passed = 0;
let failed = 0;
const test = (name, fn) => queue.push({ name, fn });
async function run() {
  for (const { name, fn } of queue) {
    try { await fn(); passed += 1; console.log(`  ok - ${name}`); } catch (e) { failed += 1; console.log(`  FAIL - ${name}\n    ${String(e.message).slice(0, 600)}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed (no network, no Firestore)`);
  if (failed) process.exitCode = 1;
}
console.log('test/ca-unemployment-schedule.test.js\n');

// ─── fixtures ───────────────────────────────────────────────────────────────
const NOW = '2026-10-15T10:00:00.000Z';
const silent = { log() {}, warn() {} };

/** StatCan result as the check receives it: a built document whose latest month is `period`. */
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

/** An in-memory Firestore stand-in with real transaction semantics (reads before writes, merge sets). */
function memoryDb(initial) {
  const state = { doc: initial === undefined ? undefined : { ...initial }, commits: 0, txAttempts: 0, writes: [], collectionsUsed: [], getDbCalls: 0 };
  const db = {
    state,
    collection(name) {
      state.collectionsUsed.push(name);
      return { doc: (id) => ({ path: `${name}/${id}`, id }) };
    },
    async runTransaction(fn) {
      state.txAttempts += 1;
      const pending = [];
      const tx = {
        get: async (ref) => ({ exists: state.doc !== undefined, data: () => state.doc, ref }),
        set: (ref, data, opts) => { pending.push({ ref, data, opts }); },
      };
      const result = await fn(tx);
      for (const w of pending) {
        state.doc = w.opts && w.opts.merge ? { ...(state.doc || {}), ...w.data } : { ...w.data };
        state.writes.push(w);
      }
      if (pending.length) state.commits += 1;
      return result;
    },
  };
  return db;
}
const runWith = async ({ db, fetchBuilt, writeAudit, onGetDb }) => C.runCaUnemploymentCheck({
  getDb: () => { if (onGetDb) onGetDb(); return db; }, fetchBuilt, nowIso: NOW, writeAudit, logger: silent,
});
const ours = (period, value = 6.5) => ({ ...builtFor(period, value).data });
const legacyEngineDoc = (updated) => ({
  country: 'CA', statName: 'unemploymentRate', value: 6.9, updated,
  source: 'Statistics Canada — Labour Force Survey, table 14-10-0017-01',
  sourceUrl: 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410001701', last_updated: '2026-03-23T23:49:58.644Z',
});

// ─── 1. new reporting month ────────────────────────────────────────────────
test('NEW reporting month: StatCan has September, we hold August -> exactly one write', async () => {
  const db = memoryDb(ours('2026-08', 6.4));
  const audits = [];
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09', 6.5), writeAudit: async (e) => audits.push(e) });
  assert.strictEqual(r.status, 'WRITTEN');
  assert.strictEqual(r.reason, 'NEWER_PERIOD');
  assert.strictEqual(r.storedPeriod, '2026-08');
  assert.strictEqual(r.newPeriod, '2026-09');
  assert.strictEqual(db.state.commits, 1);
  assert.strictEqual(db.state.writes.length, 1);
  assert.strictEqual(db.state.doc.latest_period, '2026-09');
  assert.strictEqual(db.state.doc.value, '6.5%');
  assert.strictEqual(db.state.doc.updated, 'Sep 2026');
  assert.deepStrictEqual(db.state.writes[0].opts, { merge: true });
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].import_status, 'success');
});

test('NEW reporting month: a stored document with unrelated extra fields keeps them (merge)', async () => {
  const db = memoryDb({ ...ours('2026-08'), someOtherField: 'keep me' });
  await runWith({ db, fetchBuilt: fetchReturning('2026-09') });
  assert.strictEqual(db.state.doc.someOtherField, 'keep me');
  assert.strictEqual(db.state.doc.latest_period, '2026-09');
});

// ─── 2. unchanged reporting month ──────────────────────────────────────────
test('UNCHANGED reporting month: no write, no audit entry, and repeating the run never writes', async () => {
  const db = memoryDb(ours('2026-09'));
  const audits = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09'), writeAudit: async (e) => audits.push(e) });
    assert.strictEqual(r.status, 'SKIPPED');
    assert.strictEqual(r.reason, 'UNCHANGED_PERIOD');
  }
  assert.strictEqual(db.state.writes.length, 0, 'an unchanged month must never be rewritten');
  assert.strictEqual(audits.length, 0, 'a skip must not create an audit-log document');
});

test('UNCHANGED month: a same-month value revision is NOT rewritten (only newer reporting periods update)', async () => {
  const db = memoryDb(ours('2026-09', 6.5));
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09', 6.8) });
  assert.strictEqual(r.status, 'SKIPPED');
  assert.strictEqual(db.state.doc.value, '6.5%');
});

// ─── 3. missing publication ────────────────────────────────────────────────
test('MISSING publication (release not out yet): StatCan still shows the stored month -> no write', async () => {
  const db = memoryDb(ours('2026-08'));
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-08') });
  assert.strictEqual(r.status, 'SKIPPED');
  assert.strictEqual(db.state.writes.length, 0);
});

test('MISSING publication (StatCan down): fetch fails -> document untouched, Firestore handle never requested, one failure audit entry', async () => {
  const db = memoryDb(ours('2026-08'));
  let getDbCalls = 0;
  const audits = [];
  const r = await runWith({ db, fetchBuilt: async () => { throw new Error('ECONNRESET'); }, writeAudit: async (e) => audits.push(e), onGetDb: () => { getDbCalls += 1; } });
  assert.strictEqual(r.status, 'FETCH_FAILED');
  assert.match(r.error, /ECONNRESET/);
  assert.strictEqual(getDbCalls, 0, 'the database handle must not be requested when the fetch failed');
  assert.strictEqual(db.state.txAttempts, 0);
  assert.strictEqual(db.state.writes.length, 0);
  assert.strictEqual(db.state.doc.latest_period, '2026-08');
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].import_status, 'failed');
});

test('MISSING publication (empty data from StatCan): the real fetch path fails safely and writes nothing', async () => {
  const orig = axios.post;
  axios.post = async (url) => (url.endsWith('getCubeMetadata')
    ? { data: [{ status: 'SUCCESS', object: cubeMeta() }] }
    : { data: [{ status: 'SUCCESS', object: { vectorDataPoint: [] } }] });
  try {
    const db = memoryDb(ours('2026-08'));
    const r = await C.runCaUnemploymentCheck({ getDb: () => db, nowIso: NOW, logger: silent });
    assert.strictEqual(r.status, 'FETCH_FAILED');
    assert.match(r.error, /No valid monthly unemployment points/);
    assert.strictEqual(db.state.writes.length, 0);
  } finally { axios.post = orig; }
});

test('MISSING publication (wrong series came back): identity check fails -> nothing written', async () => {
  const orig = axios.post;
  let dataRequests = 0;
  axios.post = async (url) => {
    if (url.endsWith('getCubeMetadata')) return { data: [{ status: 'SUCCESS', object: cubeMeta('Trend-cycle') }] };
    dataRequests += 1;
    return { data: [{ status: 'SUCCESS', object: { vectorDataPoint: [] } }] };
  };
  try {
    const db = memoryDb(ours('2026-08'));
    const r = await C.runCaUnemploymentCheck({ getDb: () => db, nowIso: NOW, logger: silent });
    assert.strictEqual(r.status, 'FETCH_FAILED');
    assert.match(r.error, /identity check FAILED/);
    assert.strictEqual(dataRequests, 0, 'no data may be requested for an unverified series');
    assert.strictEqual(db.state.writes.length, 0);
  } finally { axios.post = orig; }
});

// ─── 4. older reporting month ──────────────────────────────────────────────
test('OLDER reporting month: StatCan returns August but we hold September -> never overwrites the newer value', async () => {
  const db = memoryDb(ours('2026-09', 6.5));
  const audits = [];
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-08', 6.4), writeAudit: async (e) => audits.push(e) });
  assert.strictEqual(r.status, 'SKIPPED');
  assert.strictEqual(r.reason, 'OLDER_PERIOD_NEVER_OVERWRITES_NEWER');
  assert.strictEqual(db.state.writes.length, 0);
  assert.strictEqual(db.state.doc.latest_period, '2026-09');
  assert.strictEqual(audits.length, 0);
});

test('OLDER reporting month: a newer value written by something else between our read and write is not overwritten (transaction retry)', async () => {
  // Model Firestore's contention retry: attempt 1 sees August, then attempt 2 sees that September landed.
  const state = { doc: ours('2026-08'), attempts: 0, committed: [] };
  const db = {
    collection: () => ({ doc: (id) => ({ id }) }),
    async runTransaction(fn) {
      state.attempts += 1;
      if (state.attempts === 2) state.doc = ours('2026-09', 6.5); // concurrent writer lands between attempts
      const pending = [];
      const result = await fn({ get: async () => ({ exists: true, data: () => state.doc }), set: (r, d) => pending.push(d) });
      if (state.attempts === 1) return fn2(); // first attempt "fails" to commit (contention) -> retried
      state.committed.push(...pending);
      return result;
      async function fn2() { return db.runTransaction(fn); }
    },
  };
  const r = await C.runCaUnemploymentCheck({ getDb: () => db, fetchBuilt: fetchReturning('2026-09', 6.4), nowIso: NOW, logger: silent });
  assert.strictEqual(r.status, 'SKIPPED');
  assert.strictEqual(state.committed.length, 0, 'the stale attempt must not commit');
});

// ─── 5. handover from the engine's old document, and other starting states ──
test('HANDOVER: the old engine document (unadjusted, "2026-02") is replaced once by the verified series', async () => {
  const db = memoryDb(legacyEngineDoc('2026-02'));
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09') });
  assert.strictEqual(r.status, 'WRITTEN');
  assert.strictEqual(r.reason, 'NEWER_PERIOD');
  assert.strictEqual(db.state.doc.table, '14-10-0287-01');
  assert.strictEqual(db.state.doc.value, '6.5%');
  const again = await runWith({ db, fetchBuilt: fetchReturning('2026-09') });
  assert.strictEqual(again.status, 'SKIPPED');
  assert.strictEqual(db.state.writes.length, 1, 'handover is a single write');
});

test('SERIES CORRECTION: same month but stored by the old unadjusted series -> one corrective write, then stable', async () => {
  const db = memoryDb(legacyEngineDoc('2026-09'));
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09') });
  assert.strictEqual(r.reason, 'SERIES_CORRECTION_SAME_PERIOD');
  assert.strictEqual((await runWith({ db, fetchBuilt: fetchReturning('2026-09') })).status, 'SKIPPED');
  assert.strictEqual(db.state.writes.length, 1);
});

test('NO document yet -> written; a stored document whose month is unreadable is repaired', async () => {
  assert.strictEqual((await runWith({ db: memoryDb(undefined), fetchBuilt: fetchReturning('2026-09') })).reason, 'NO_EXISTING_DOCUMENT');
  const r = await runWith({ db: memoryDb({ value: 'garbage' }), fetchBuilt: fetchReturning('2026-09') });
  assert.strictEqual(r.reason, 'STORED_PERIOD_UNREADABLE');
});

test('a write failure is reported, audited, and never throws out of the scheduler', async () => {
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw new Error('RESOURCE_EXHAUSTED'); } };
  const audits = [];
  const r = await C.runCaUnemploymentCheck({ getDb: () => db, fetchBuilt: fetchReturning('2026-09'), nowIso: NOW, writeAudit: async (e) => audits.push(e), logger: silent });
  assert.strictEqual(r.status, 'WRITE_FAILED');
  assert.match(r.error, /RESOURCE_EXHAUSTED/);
  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].import_status, 'failed');
});

test('an audit-log failure never breaks the check', async () => {
  const db = memoryDb(ours('2026-08'));
  const r = await runWith({ db, fetchBuilt: fetchReturning('2026-09'), writeAudit: async () => { throw new Error('audit down'); } });
  assert.strictEqual(r.status, 'WRITTEN');
});

// ─── 6. document id ────────────────────────────────────────────────────────
test('DOCUMENT ID: reads and writes social_stats/CA_unemploymentRate, and nothing else', async () => {
  const db = memoryDb(ours('2026-08'));
  const seenRefs = [];
  const origRun = db.runTransaction.bind(db);
  db.runTransaction = (fn) => origRun((tx) => fn({ get: (ref) => { seenRefs.push(['get', ref.path]); return tx.get(ref); }, set: (ref, d, o) => { seenRefs.push(['set', ref.path]); return tx.set(ref, d, o); } }));
  await runWith({ db, fetchBuilt: fetchReturning('2026-09') });
  assert.deepStrictEqual(seenRefs, [['get', 'social_stats/CA_unemploymentRate'], ['set', 'social_stats/CA_unemploymentRate']]);
  assert.deepStrictEqual([...new Set(db.state.collectionsUsed)], ['social_stats']);
  assert.strictEqual(C.COLLECTION, 'social_stats');
  assert.strictEqual(U.DOC_ID, 'CA_unemploymentRate');
  assert.strictEqual(db.state.writes[0].data.country, 'CA');
  assert.strictEqual(db.state.writes[0].data.statName, 'unemploymentRate');
});

// ─── 7. stored-period parsing ──────────────────────────────────────────────
test('stored month is understood from latest_period, the engine\'s "YYYY-MM", and display labels; junk is unreadable', () => {
  const p = C.storedPeriodOf;
  assert.strictEqual(p({ latest_period: '2026-09' }), '2026-09');
  assert.strictEqual(p({ updated: '2026-02' }), '2026-02');
  assert.strictEqual(p({ updated: 'Sep 2026' }), '2026-09');
  assert.strictEqual(p({ updated: 'September 2026' }), '2026-09');
  assert.strictEqual(p({ latest_period: '2026-09', updated: '2026-02' }), '2026-09', 'latest_period wins');
  ['', null, undefined, { updated: 'soon' }, { updated: '2026-13' }, { latest_period: '2026-9' }, { updated: 202609 }].forEach((d) => assert.strictEqual(p(d), null, JSON.stringify(d)));
});

// ─── 8. month-by-month simulation (the property that matters) ───────────────
test('SIMULATION: normal, late and never-arriving releases -> one write per genuinely new month, none otherwise', async () => {
  // Checks run on the 15th and the 22nd (the schedule). Release days: Sep data on the 9th (normal),
  // Oct data on the 18th (late, after the 15th), Nov data never arrives within the month.
  const db = memoryDb(ours('2026-08'));
  let available = '2026-08';
  const fetchBuilt = async () => builtFor(available, 6 + (Number(available.slice(5)) % 5) / 10);
  const log = [];
  const check = async (label) => { const r = await runWith({ db, fetchBuilt }); log.push([label, r.status, r.reason || '']); return r; };

  available = '2026-09';                       // September released on Oct 9
  await check('Oct-15'); await check('Oct-22');
  assert.strictEqual(db.state.writes.length, 1, 'normal release: written on the 15th, nothing on the 22nd');

  await check('Nov-15');                       // October not out yet on Nov 15 (still shows September)
  available = '2026-10';                       // ...released on Nov 18 (late)
  await check('Nov-22');
  assert.strictEqual(db.state.writes.length, 2, 'late release: skipped on the 15th, picked up on the 22nd');

  await check('Dec-15'); await check('Dec-22'); // November never arrives
  assert.strictEqual(db.state.writes.length, 2, 'no release: no writes');
  assert.strictEqual(db.state.doc.latest_period, '2026-10');
  assert.deepStrictEqual(log.map((l) => l[1]), ['WRITTEN', 'SKIPPED', 'SKIPPED', 'WRITTEN', 'SKIPPED', 'SKIPPED']);
});

// ─── 9. scheduling configuration ────────────────────────────────────────────
const schedulerSrc = read('src/scheduler.js');
const pkg = JSON.parse(read('package.json'));

test('SCHEDULE: a targeted Canada check on the 15th (second pass on the 22nd), overridable, and a valid cron expression', () => {
  const line = schedulerSrc.split('\n').find((l) => /^const CA_UNEMPLOYMENT_SCHEDULE\s*=/.test(l));
  assert.ok(line, 'schedule constant missing');
  const m = line.match(/process\.env\.CRON_CA_UNEMPLOYMENT\s*\|\|\s*'([^']+)'/);
  assert.ok(m, 'must be overridable via CRON_CA_UNEMPLOYMENT');
  const expr = m[1];
  assert.strictEqual(expr, '0 6 15,22 * *');
  const [minute, hour, dom, month, dow] = expr.split(' ');
  assert.deepStrictEqual([minute, hour, month, dow], ['0', '6', '*', '*']);
  assert.deepStrictEqual(dom.split(',').map(Number), [15, 22]);
  const cron = require('node-cron');
  assert.strictEqual(cron.validate(expr), true);
  // sits after StatCan's usual mid-month release and is NOT the monthly cycle's 1st-of-month slot
  assert.notStrictEqual(expr, GOLDEN.schedule_constants.find((l) => /MONTHLY_SCHEDULE/.test(l)));
});

test('OTHER SCHEDULES UNCHANGED: all 10 original cron constants, the monthly cycle body, and every original run flag are identical', () => {
  const lines = schedulerSrc.split('\n');
  const constants = lines.filter((l) => /^const [A-Z_]+_SCHEDULE\s*=/.test(l));
  assert.deepStrictEqual(constants.filter((l) => !/CA_UNEMPLOYMENT_SCHEDULE/.test(l)), GOLDEN.schedule_constants);
  assert.strictEqual(constants.length, GOLDEN.schedule_constants.length + 1);
  const start = schedulerSrc.indexOf('async function runMonthlyCycle');
  let depth = 0; let end = -1; let inStr = null;
  for (let k = schedulerSrc.indexOf('{', start); k < schedulerSrc.length; k += 1) {
    const ch = schedulerSrc[k];
    if (inStr) { if (ch === '\\') { k += 1; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '/' && schedulerSrc[k + 1] === '/') { k = schedulerSrc.indexOf('\n', k); continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
  }
  assert.strictEqual(schedulerSrc.slice(start, end + 1), GOLDEN.run_monthly_cycle, 'the monthly cycle must not change');
  const flags = lines.filter((l) => /^const RUN_[A-Z_]+\s*=/.test(l));
  assert.deepStrictEqual(flags.filter((l) => !/RUN_CA_UNEMPLOYMENT_NOW/.test(l)), GOLDEN.run_flags);
  assert.strictEqual(flags.length, GOLDEN.run_flags.length + 1);
});

test('OTHER CRON REGISTRATIONS UNCHANGED: the original 10 are intact and in order; exactly one was added', () => {
  const regs = schedulerSrc.split('\n').filter((l) => /^\s*cron\.schedule\(/.test(l)).map((l) => l.trim());
  assert.deepStrictEqual(regs.filter((l) => !/CA_UNEMPLOYMENT_SCHEDULE/.test(l)), GOLDEN.cron_registrations);
  assert.strictEqual(regs.length, GOLDEN.cron_registrations.length + 1);
  assert.deepStrictEqual(regs.filter((l) => /CA_UNEMPLOYMENT_SCHEDULE/.test(l)), ['cron.schedule(CA_UNEMPLOYMENT_SCHEDULE,  () => runCaUnemploymentCycle());']);
});

test('the check is NOT part of --now / --run-on-start chains; it appears only as definition, dispatch and cron', () => {
  const uses = schedulerSrc.split('\n').filter((l) => /runCaUnemploymentCycle/.test(l)).map((l) => l.trim());
  assert.strictEqual(uses.length, 3, uses.join(' | '));
  assert.ok(uses.some((l) => l.startsWith('async function runCaUnemploymentCycle')));
  assert.ok(uses.some((l) => l.startsWith('runCaUnemploymentCycle()')));
  assert.ok(uses.some((l) => l.includes('cron.schedule(CA_UNEMPLOYMENT_SCHEDULE')));
});

test('PACKAGE SCRIPTS: all 101 original scripts are untouched; only the three new ones were added', () => {
  const now = pkg.scripts;
  Object.entries(GOLDEN.package_scripts).forEach(([k, v]) => assert.strictEqual(now[k], v, `script ${k} changed`));
  const added = Object.keys(now).filter((k) => !(k in GOLDEN.package_scripts)).sort();
  assert.deepStrictEqual(added, ['scheduler:ca-unemployment', 'test:ca-unemployment', 'test:ca-unemployment-schedule']);
  assert.strictEqual(now['scheduler:ca-unemployment'], 'node src/scheduler.js --ca-unemployment');
});

test('the on-demand command is wired: --ca-unemployment dispatches the check and exits non-zero only on failure', () => {
  const i = schedulerSrc.indexOf('} else if (RUN_CA_UNEMPLOYMENT_NOW) {');
  assert.ok(i > 0);
  const branch = schedulerSrc.slice(i, i + 400);
  assert.match(branch, /runCaUnemploymentCycle\(\)/);
  assert.match(branch, /FETCH_FAILED.*WRITE_FAILED.*FAILED/);
  assert.match(schedulerSrc, /const RUN_CA_UNEMPLOYMENT_NOW\s*=\s*process\.argv\.includes\('--ca-unemployment'\)/);
});

// ─── helper used by the stubbed-StatCan tests ───────────────────────────────
function cubeMeta(seasonal = 'Seasonally adjusted') {
  const names = [['Canada'], ['a', 'b', 'c', 'd', 'e', 'f', 'Unemployment rate'], ['Total - Gender'], ['15 years and over'], ['Estimate'], [seasonal]];
  return { cubeTitleEn: 'Labour force characteristics', cubeEndDate: '2026-09-01', releaseTime: '2026-10-09T08:30', dimension: names.map((arr, i) => ({ dimensionPositionId: i + 1, member: arr.map((n, j) => ({ memberId: j + 1, memberNameEn: n })) })) };
}

run();
