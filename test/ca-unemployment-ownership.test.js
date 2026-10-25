/**
 * Ownership tests for social_stats/CA_unemploymentRate.
 *
 *   node test/ca-unemployment-ownership.test.js        (or: npm run test:ca-unemployment)
 *
 * No network and no Firestore: the StatCan calls are stubbed, and the uploaders are
 * exercised only through their pure document builders.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ENGINE = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ENGINE, rel), 'utf8').replace(/\r\n/g, '\n');

const queue = [];
let passed = 0;
let failed = 0;
const test = (name, fn) => queue.push({ name, fn });
async function run() {
  for (const { name, fn } of queue) {
    try { await fn(); passed += 1; console.log(`  ok - ${name}`); } catch (e) { failed += 1; console.log(`  FAIL - ${name}\n    ${e.message}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed (no network, no Firestore)`);
  if (failed) process.exitCode = 1;
}

const U = require('../src/ingestion/caUnemploymentMonthly');
const axios = require('axios');
// Requiring the uploader loads firebase-admin but creates no client until a write function is called.
const uploader = require('../src/firebase/uploader');

console.log('test/ca-unemployment-ownership.test.js\n');

// ─── fixtures ───────────────────────────────────────────────────────────────
function cube(overrides = {}) {
  const names = [['Canada'], ['a', 'b', 'c', 'd', 'e', 'f', 'Unemployment rate'], ['Total - Gender'], ['15 years and over'], ['Estimate'], ['Seasonally adjusted']];
  return {
    cubeTitleEn: 'Labour force characteristics, monthly, seasonally adjusted and trend-cycle',
    cubeEndDate: '2026-09-01',
    releaseTime: '2026-10-09T08:30',
    dimension: names.map((arr, i) => ({
      dimensionPositionId: i + 1,
      member: arr.map((n, j) => ({ memberId: j + 1, memberNameEn: overrides[i] && arr.length === 1 ? overrides[i] : n })),
    })),
  };
}
function monthlyPoints() {
  // Oct 2025 .. Sep 2026 plus earlier months, values 6.0 + small steps; latest (2026-09) = 6.5
  const out = [];
  const vals = [6.4, 6.5, 6.7, 6.9, 6.6, 6.8, 6.5, 6.7, 6.7, 6.9, 6.6, 6.5, 6.4, 6.4, 6.5, 6.9, 6.9, 6.6, 6.8, 6.5, 6.7, 6.7, 6.9, 6.5];
  let y = 2024; let m = 10;
  for (const v of vals) { out.push({ period: `${y}-${String(m).padStart(2, '0')}`, value: v }); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
}
const NOW = '2026-10-25T12:00:00.000Z';

// ─── correct Statistics Canada series ───────────────────────────────────────
test('the series is Table 14-10-0287-01, coordinate 1.7.1.1.1.1.0.0.0.0 (monthly, seasonally adjusted) — not 14-10-0017-01', () => {
  assert.strictEqual(U.PRODUCT_ID, 14100287);
  assert.strictEqual(U.TABLE_ID, '14-10-0287-01');
  assert.strictEqual(U.COORDINATE, '1.7.1.1.1.1.0.0.0.0');
  assert.match(U.SOURCE_URL, /pid=1410028701$/);
  assert.match(U.SOURCE_LABEL, /14-10-0287-01/);
  assert.ok(!/0017/.test(JSON.stringify([U.TABLE_ID, U.SOURCE_URL, U.SOURCE_LABEL, U.UNIT])));
  assert.deepStrictEqual(U.EXPECTED_MEMBERS, ['Canada', 'Unemployment rate', 'Total - Gender', '15 years and over', 'Estimate', 'Seasonally adjusted']);
});

test('series identity: the expected cube is accepted', () => {
  const r = U.verifySeriesIdentity(cube());
  assert.strictEqual(r.ok, true, r.mismatches.join('; '));
});

test('series identity: unadjusted / trend-cycle / wrong geography / wrong measure are rejected', () => {
  assert.strictEqual(U.verifySeriesIdentity(cube({ 5: 'Trend-cycle' })).ok, false);
  assert.strictEqual(U.verifySeriesIdentity(cube({ 5: 'Unadjusted' })).ok, false);
  assert.strictEqual(U.verifySeriesIdentity(cube({ 0: 'Ontario' })).ok, false);
  assert.strictEqual(U.verifySeriesIdentity(cube({ 4: 'Standard error' })).ok, false);
  assert.strictEqual(U.verifySeriesIdentity({ dimension: [] }).ok, false);
  assert.strictEqual(U.verifySeriesIdentity(null).ok, false);
});

test('fetch: a coordinate that resolves to the wrong series throws BEFORE any data is requested', async () => {
  const orig = axios.post;
  const calls = [];
  axios.post = async (url) => { calls.push(url); return { data: [{ status: 'SUCCESS', object: cube({ 5: 'Trend-cycle' }) }] }; };
  try {
    await assert.rejects(() => U.fetchCaUnemployment({ nowIso: NOW }), /identity check FAILED/);
    assert.strictEqual(calls.length, 1, 'only the metadata call may be made');
    assert.match(calls[0], /getCubeMetadata$/);
  } finally { axios.post = orig; }
});

test('fetch: verified series -> document built from the stubbed data points', async () => {
  const orig = axios.post;
  const pts = monthlyPoints().map((p) => ({ refPer: `${p.period}-01`, value: String(p.value) }));
  axios.post = async (url, body) => {
    if (url.endsWith('getCubeMetadata')) return { data: [{ status: 'SUCCESS', object: cube() }] };
    assert.strictEqual(body[0].productId, 14100287);
    assert.strictEqual(body[0].coordinate, '1.7.1.1.1.1.0.0.0.0');
    return { data: [{ status: 'SUCCESS', object: { vectorDataPoint: pts } }] };
  };
  try {
    const b = await U.fetchCaUnemployment({ nowIso: NOW });
    assert.strictEqual(b.id, 'CA_unemploymentRate');
    assert.strictEqual(b.data.latest_period, '2026-09');
    assert.strictEqual(b.data.statcan_release_time, '2026-10-09T08:30');
  } finally { axios.post = orig; }
});

// ─── correct reporting period and percentage ───────────────────────────────
test('reporting period: the latest month wins regardless of input order; label is "Mon YYYY"', () => {
  const shuffled = [...monthlyPoints()].sort(() => 0.5 - Math.random());
  const { data } = U.buildSocialStatDoc(shuffled, { nowIso: NOW });
  assert.strictEqual(data.latest_period, '2026-09');
  assert.strictEqual(data.updated, 'Sep 2026');
  assert.strictEqual(data.trend_periods.length, 12);
  assert.strictEqual(data.trend_periods[0], '2025-10');
  assert.strictEqual(data.trend_periods[11], '2026-09');
  assert.deepStrictEqual(data.trend_periods, [...data.trend_periods].sort());
});

test('percentage: value is a string with one decimal and a % sign, equal to the latest trend point', () => {
  const { data } = U.buildSocialStatDoc(monthlyPoints(), { nowIso: NOW });
  assert.strictEqual(data.value, '6.5%');
  assert.strictEqual(data.trend[data.trend.length - 1], 6.5);
  assert.strictEqual(U.buildSocialStatDoc([{ period: '2026-09', value: 7 }]).data.value, '7.0%');
  assert.strictEqual(U.buildSocialStatDoc([{ period: '2026-09', value: 6.45 }]).data.value, `${(6.45).toFixed(1)}%`);
});

test('malformed points are ignored and nothing is built from nothing', () => {
  assert.strictEqual(U.buildSocialStatDoc([{ period: 'x', value: 1 }, { period: '2026-08', value: 6.4 }, { period: '2026-09', value: NaN }]).data.latest_period, '2026-08');
  assert.throws(() => U.buildSocialStatDoc([]));
});

// ─── no duplicate stat documents ────────────────────────────────────────────
test('the app card key and every engine path agree on one document id: CA_unemploymentRate', () => {
  assert.strictEqual(U.STAT_NAME, 'unemploymentRate');
  assert.strictEqual(U.DOC_ID, 'CA_unemploymentRate');
  const built = U.buildSocialStatDoc(monthlyPoints(), { nowIso: NOW });
  const live = U.toLiveRecord(built, NOW);
  assert.strictEqual(built.id, 'CA_unemploymentRate');                       // the scheduled check writes this id
  assert.strictEqual(`${live.country}_${live.metric}`, 'CA_unemploymentRate'); // the manual live/canonical path writes the same id
  // and the app's card looks for exactly this key
  const app = path.join(ENGINE, '..', 'civic-voice-app', 'src', 'App.js');
  if (fs.existsSync(app)) assert.ok(fs.readFileSync(app, 'utf8').includes("firestoreKey: 'unemploymentRate'"));
});

test('the monthly targeted job no longer fetches or writes Canada unemployment in any form (old stat name, old function, shared module)', () => {
  const targeted = read('src/ingestion/targetedFetch.js');
  assert.ok(!/result\(\s*'CA',\s*'unemployment/.test(targeted), 'a CA unemployment result() call remains');
  assert.ok(!targeted.includes('fetchCA_Unemployment'));
  assert.ok(!targeted.includes('caUnemploymentMonthly'));
  assert.ok(!targeted.includes('toTargetedResult'));
  assert.strictEqual(U.toTargetedResult, undefined, 'the targeted-result helper must be gone');
});

test('the old table 14-10-0017-01 is no longer referenced by any engine code that can write the card document', () => {
  const offenders = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|cjs)$/.test(e.name)) continue;
      const rel = path.relative(ENGINE, p).replace(/\\/g, '/');
      if (/^src\/ingestion\/subnational/.test(rel)) continue;
      const txt = fs.readFileSync(p, 'utf8');
      // Functional references only: the old CSV download (14100017-eng.zip) and the old table URL
      // (pid=1410001701). Explanatory comments that mention the table number are fine.
      if (/14100017|1410001701/.test(txt)) offenders.push(rel);
    }
  })(path.join(ENGINE, 'src'));
  assert.deepStrictEqual(offenders, [], `still reference the old table: ${offenders.join(', ')}`);
});

test('exactly ONE scheduled writer of Canada unemployment exists (the change-gated check); the monthly job lists none; no manual writer is scheduled', () => {
  const targeted = read('src/ingestion/targetedFetch.js');
  assert.strictEqual(targeted.split('\n').filter((l) => /^\s*\{ label: 'CA\s+Unemployment/.test(l)).length, 0);
  const scheduler = read('src/scheduler.js');
  const crons = scheduler.split('\n').filter((l) => /^\s*cron\.schedule\(/.test(l) && /runCaUnemploymentCycle/.test(l));
  assert.strictEqual(crons.length, 1, 'exactly one cron registration for the check');
  assert.match(crons[0], /CA_UNEMPLOYMENT_SCHEDULE/);
  ['uploadSocialStatsCanonical', 'uploadLiveStats', 'uploadSocialStats(', 'liveFetch'].forEach((s) => assert.ok(!scheduler.includes(s), `scheduler must not reference ${s}`));
  assert.ok(scheduler.includes('uploadTargetedStats'), 'the targeted uploader is still the monthly social_stats writer for everything else');
  assert.ok(!read('functions/index.js').includes('social_stats'), 'no Cloud Function writes social_stats');
  // the check is the only code that writes the document in a scheduled path
  assert.match(read('src/ingestion/caUnemploymentCheck.js'), /tx\.set\(ref, built\.data, \{ merge: true \}\)/);
});

test('the check\'s document, the manual live:fetch document and the canonical document are IDENTICAL; the monthly targeted uploader cannot produce it', () => {
  const built = U.buildSocialStatDoc(monthlyPoints(), { nowIso: NOW });
  const liveDoc = uploader.buildLiveDoc(U.toLiveRecord(built, NOW), NOW, NOW);
  const def = uploader.CANONICAL_STAT_DEFS.unemploymentRate.CA;
  const canonicalDoc = uploader.buildCanonicalDoc('CA', 'unemploymentRate', def, U.toLiveRecord(built, NOW), NOW);
  const { id, ...liveWithoutId } = liveDoc;
  assert.strictEqual(id, 'CA_unemploymentRate');
  assert.deepStrictEqual(liveWithoutId, canonicalDoc);
  assert.deepStrictEqual(canonicalDoc, built.data, 'the scheduled check writes built.data; the manual paths must store the same thing');
  assert.strictEqual(canonicalDoc.value, '6.5%');
  // a record that merely LOOKS like Canada unemployment cannot smuggle a document through the monthly uploader
  const smuggle = uploader.buildTargetedDoc({ country: 'CA', stat: 'unemploymentRate', value: 1, unit: 'u', date: 'd', source: 's', sourceUrl: 'x', docOverride: built.data }, NOW, NOW);
  assert.notDeepStrictEqual(smuggle, built.data);
  assert.strictEqual(smuggle.value, 1);
  assert.ok(!('docOverride' in smuggle) && !('trend' in smuggle));
});

test('canonical definitions: all 39 other country/stat combinations are identical to the committed originals', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-canonical-stat-defs.json'), 'utf8'));
  const now = uploader.CANONICAL_STAT_DEFS;
  assert.deepStrictEqual(Object.keys(now), Object.keys(golden), 'stat list changed');
  let combos = 0; const changed = [];
  for (const stat of Object.keys(golden)) {
    assert.deepStrictEqual(Object.keys(now[stat]), Object.keys(golden[stat]), `${stat}: country list changed`);
    for (const c of Object.keys(golden[stat])) {
      combos += 1;
      if (JSON.stringify(now[stat][c]) !== JSON.stringify(golden[stat][c])) changed.push(`${c}.${stat}`);
    }
  }
  assert.strictEqual(combos, 40);
  assert.deepStrictEqual(changed, ['CA.unemploymentRate']);
  const g = golden.unemploymentRate.CA; const n = now.unemploymentRate.CA;
  assert.strictEqual(n.liveKey, g.liveKey);
  assert.notStrictEqual(n.source, g.source);
});

test('scheduled job list: every other fetcher entry is identical to the committed original, in order; only the CA Unemployment entry was removed', () => {
  // Normalise line endings: git's autocrlf checks this fixture out with CRLF on Windows.
  const golden = fs.readFileSync(path.join(__dirname, 'fixtures', 'golden-targeted-fetchers.txt'), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const src = read('src/ingestion/targetedFetch.js');
  const start = src.indexOf('const FETCHERS = [');
  const block = src.slice(start, src.indexOf('\n];', start));
  const now = block.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{ label:'));
  const removed = golden.filter((l) => /CA\s+Unemployment/.test(l));
  assert.strictEqual(removed.length, 1, 'the golden list should contain exactly one CA Unemployment entry');
  const expected = golden.filter((l) => !/CA\s+Unemployment/.test(l));
  assert.strictEqual(now.length, golden.length - 1, 'exactly one scheduled fetch job was removed');
  assert.deepStrictEqual(now, expected, 'a job other than CA Unemployment changed');
});

test('records WITHOUT docOverride produce exactly the documents the writers always produced', () => {
  // targeted (US unemployment)
  const t = { country: 'US', stat: 'unemploymentRate', value: 4.1, unit: '% (seasonally adjusted)', date: '2026-08', source: 'BLS', sourceUrl: 'https://bls', notes: 'n', fetchedAt: 'F' };
  assert.deepStrictEqual(uploader.buildTargetedDoc(t, 'F2', NOW), {
    country: 'US', statName: 'unemploymentRate', value: 4.1, unit: '% (seasonally adjusted)', date: '2026-08', source: 'BLS',
    sourceUrl: 'https://bls', notes: 'n', fetchedAt: 'F2', last_updated: NOW,
  });
  // live (UK, with a number date coerced to string, and topAgencies preserved)
  const l = { country: 'US', metric: 'federalAgencySpending', value: 1, unit: 'USD', date: 2026, source: 'S', sourceUrl: 'U', topAgencies: [{ a: 1 }], fetchedAt: 'F' };
  const ld = uploader.buildLiveDoc(l, null, NOW);
  assert.strictEqual(ld.id, 'US_federalAgencySpending');
  assert.strictEqual(ld.date, '2026');
  assert.deepStrictEqual(ld.topAgencies, [{ a: 1 }]);
  assert.strictEqual(ld.updateFrequency, 'Monthly (fiscal period, USAspending)');
  assert.strictEqual(ld.fetchedAt, 'F');
  // canonical (AU unemployment, null live value stays null)
  const def = uploader.CANONICAL_STAT_DEFS.unemploymentRate.AU;
  assert.deepStrictEqual(uploader.buildCanonicalDoc('AU', 'unemploymentRate', def, null, NOW), {
    country: 'AU', statName: 'unemploymentRate', value: null, source: def.source, sourceUrl: def.sourceUrl, updated: null, last_updated: NOW,
  });
  const live = { value: 4.0, date: '2026-08' };
  assert.deepStrictEqual(uploader.buildCanonicalDoc('AU', 'unemploymentRate', def, live, NOW), {
    country: 'AU', statName: 'unemploymentRate', value: 4.0, source: def.source, sourceUrl: def.sourceUrl, updated: '2026-08', last_updated: NOW,
  });
});

test('only records that carry docOverride change behaviour; US, UK and AU unemployment are untouched', () => {
  const src = read('src/ingestion/targetedFetch.js');
  const has = (re) => re.test(src);
  assert.ok(has(/['"]US['"],\s*['"]unemploymentRate['"]/), 'US unemployment fetcher changed');
  assert.ok(has(/['"]UK['"],\s*['"]unemploymentRate['"]/), 'UK unemployment fetcher changed');
  assert.ok(has(/['"]AU['"],\s*['"]unemployment['"]/), 'AU unemployment fetcher changed');   // unchanged (Australia is out of scope)
  const withOverride = Object.keys(uploader).filter((k) => /^build/.test(k));
  assert.strictEqual(withOverride.length, 3);
});

// ─── stale saved files must not slip the old table in under the new label ──
test('pre-flight: a live_fetch record from before this change (no docOverride) is refused; a current one passes', () => {
  const built = U.buildSocialStatDoc(monthlyPoints(), { nowIso: NOW });
  const current = U.toLiveRecord(built, NOW);
  const stale = { country: 'CA', metric: 'unemploymentRate', value: 6.9, unit: '% (3-month moving average, seasonally adjusted)', date: '2026-02', source: 'Statistics Canada — Labour Force Survey, table 14-10-0017-01', sourceUrl: 'x' };
  U.assertCurrentCaUnemploymentRecord([current]);
  U.assertCurrentCaUnemploymentRecord([current], { requirePresent: true });
  assert.throws(() => U.assertCurrentCaUnemploymentRecord([stale]), /old table 14-10-0017-01/);
  assert.throws(() => U.assertCurrentCaUnemploymentRecord([stale], { requirePresent: true }), /old table 14-10-0017-01/);
  // other countries / stats never trigger it
  U.assertCurrentCaUnemploymentRecord([{ country: 'US', metric: 'unemploymentRate', value: 4.1 }, { country: 'CA', metric: 'bankRate', value: 2.5 }]);
});

test('pre-flight: an ABSENT Canada record aborts the canonical upload (it would write null after wiping) but not the merge-only live upload', () => {
  assert.throws(() => U.assertCurrentCaUnemploymentRecord([{ country: 'US', metric: 'bankRate', value: 1 }], { requirePresent: true }), /no Canada unemploymentRate record/);
  assert.throws(() => U.assertCurrentCaUnemploymentRecord([], { requirePresent: true }), /no Canada unemploymentRate record/);
  assert.doesNotThrow(() => U.assertCurrentCaUnemploymentRecord([{ country: 'US', metric: 'bankRate', value: 1 }], { requirePresent: false }));
});

test('pre-flight is wired BEFORE the destructive step: the canonical upload checks before getDb() and before wiping the collection', () => {
  const src = read('src/firebase/uploader.js');
  const a = src.indexOf('async function uploadSocialStatsCanonical');
  const body = src.slice(a, src.indexOf('\n}\n', a));
  const guard = body.indexOf('assertCurrentCaUnemploymentRecord');
  assert.ok(guard > 0, 'canonical upload does not call the pre-flight');
  assert.ok(guard < body.indexOf('getDb()'), 'pre-flight must come before the database is even opened');
  assert.ok(guard < body.indexOf("db.collection('social_stats').get()"), 'pre-flight must come before the collection is read for wiping');
  assert.ok(guard < body.indexOf('delBatch.delete'), 'pre-flight must come before the wipe');
  const live = src.slice(src.indexOf('async function uploadLiveStats'), src.indexOf('async function uploadLiveStats') + 2500);
  assert.ok(live.indexOf('assertCurrentCaUnemploymentRecord') > 0 && live.indexOf('assertCurrentCaUnemploymentRecord') < live.indexOf('buildLiveDoc'));
});

// ─── consistency with the civic-voice-app implementation ───────────────────
test('(if the sibling app repo is present) engine and app build the identical document from the same data', () => {
  const appLib = path.join(ENGINE, '..', 'civic-voice-app', 'engine', 'lib', 'canada-federal-unemployment.cjs');
  if (!fs.existsSync(appLib)) { console.log('    (skipped: civic-voice-app not found)'); return; }
  const A = require(appLib);
  ['PRODUCT_ID', 'TABLE_ID', 'COORDINATE', 'SOURCE_URL', 'SOURCE_LABEL', 'STAT_NAME', 'COUNTRY', 'DOC_ID', 'TREND_POINTS'].forEach((k) => assert.strictEqual(A[k], U[k], `constant ${k} differs`));
  assert.deepStrictEqual(A.EXPECTED_MEMBERS, U.EXPECTED_MEMBERS);
  const pts = monthlyPoints();
  const a = A.buildSocialStatDoc(pts, { nowIso: NOW, releaseTime: '2026-10-09T08:30' });
  const e = U.buildSocialStatDoc(pts, { nowIso: NOW, releaseTime: '2026-10-09T08:30' });
  assert.strictEqual(a.id, e.id);
  assert.deepStrictEqual(a.data, e.data);
  assert.deepStrictEqual(A.verifySeriesIdentity(cube()), U.verifySeriesIdentity(cube()));
  assert.strictEqual(A.verifySeriesIdentity(cube({ 5: 'Trend-cycle' })).ok, U.verifySeriesIdentity(cube({ 5: 'Trend-cycle' })).ok);
});

run();
