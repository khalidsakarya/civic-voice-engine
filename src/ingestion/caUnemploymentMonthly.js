/**
 * Canada federal unemployment rate — single source of truth for the engine.
 *
 * Source: Statistics Canada, Labour Force Survey, Table 14-10-0287-01
 * ("Labour force characteristics, monthly, seasonally adjusted and
 * trend-cycle"), via the Web Data Service (WDS) API:
 *   Canada · Unemployment rate · Total - Gender · 15 years and over ·
 *   Estimate · Seasonally adjusted      (coordinate 1.7.1.1.1.1.0.0.0.0)
 *
 * WHY THIS FILE EXISTS (ownership of social_stats/CA_unemploymentRate)
 * The app's Government Stats card reads social_stats documents keyed by
 * `statName`; for Canada's unemployment card that is `unemploymentRate`
 * (document id CA_unemploymentRate). Before this module, that document was only
 * written by MANUAL pipelines (upload:social-stats / upload:live-stats) from
 * table 14-10-0017-01, while the SCHEDULED monthly job wrote a differently named
 * document (CA_unemployment) that the card never reads — so the card's document
 * went stale. Now every engine path that can write CA_unemploymentRate gets its
 * content from this one module, so they can never disagree:
 *   - SCHEDULED: ./caUnemploymentCheck.js (the only scheduled writer; it writes
 *     only when StatCan's reporting month advances; see CA_UNEMPLOYMENT_SCHEDULE
 *     in scheduler.js). The monthly targeted job no longer touches Canada's
 *     unemployment at all.
 *   - MANUAL (operator-run): live:fetch + upload:social-stats / upload:live-stats.
 *
 * KEEP IN SYNC with civic-voice-app/engine/lib/canada-federal-unemployment.cjs
 * (the app repo's one-off ingestion script). Both build the identical document;
 * test/ca-unemployment-ownership.test.js and the app's engine/test-canada-federal-mvp.cjs
 * each compare the two implementations when the sibling repo is present.
 *
 * Pure builders are separate from the network fetch so they can be tested with
 * no network and no Firestore.
 */

'use strict';

const axios = require('axios');
const { execFile } = require('child_process');

const WDS_BASE = 'https://www150.statcan.gc.ca/t1/wds/rest';
const PRODUCT_ID = 14100287;
const TABLE_ID = '14-10-0287-01';
const COORDINATE = '1.7.1.1.1.1.0.0.0.0';
const SOURCE_URL = 'https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410028701';
const SOURCE_LABEL = 'Statistics Canada, Labour Force Survey (Table 14-10-0287-01)';
const UNIT = '% (seasonally adjusted, monthly)';
const TREND_POINTS = 12;

/** The series identity that must be confirmed against StatCan's own metadata before a value is trusted. */
const EXPECTED_MEMBERS = [
  'Canada',
  'Unemployment rate',
  'Total - Gender',
  '15 years and over',
  'Estimate',
  'Seasonally adjusted',
];

const COUNTRY = 'CA';
/** Must match the app's firestoreKey for the Canada unemployment card. */
const STAT_NAME = 'unemploymentRate';
const DOC_ID = `${COUNTRY}_${STAT_NAME}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function periodYmFromRefPer(refPer) {
  const s = String(refPer == null ? '' : refPer).trim();
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return s;
}

/** "2026-09" -> "Sep 2026" */
function formatMonthLabel(ym) {
  const m = String(ym).match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(ym);
  const mi = Number(m[2]) - 1;
  return mi >= 0 && mi <= 11 ? `${MONTHS[mi]} ${m[1]}` : String(ym);
}

/**
 * Resolve a WDS coordinate against the cube's dimension metadata and compare the
 * member names to what we expect. Pure.
 * @returns {{ ok: boolean, members: string[], mismatches: string[] }}
 */
function verifySeriesIdentity(cubeMetadataObject, coordinate = COORDINATE, expected = EXPECTED_MEMBERS) {
  const dims = (cubeMetadataObject && cubeMetadataObject.dimension) || [];
  const positions = String(coordinate).split('.').map(Number);
  const members = [];
  const mismatches = [];
  expected.forEach((want, i) => {
    const dim = dims[i];
    const member = dim && (dim.member || []).find((m) => m.memberId === positions[i]);
    const got = member ? String(member.memberNameEn).trim() : '(missing)';
    members.push(got);
    if (got !== want) mismatches.push(`dimension ${i + 1}: expected "${want}", got "${got}"`);
  });
  if (dims.length < expected.length) mismatches.push(`cube has ${dims.length} dimensions, expected at least ${expected.length}`);
  return { ok: mismatches.length === 0, members, mismatches };
}

/**
 * Build the social_stats document. Pure.
 * @param {Array<{ period: string, value: number }>} points monthly points, any order, period "YYYY-MM"
 * @param {{ nowIso?: string, releaseTime?: string }} [opts]
 * @returns {{ id: string, data: Record<string, unknown>, latest: { period: string, value: number } }}
 */
function buildSocialStatDoc(points, opts = {}) {
  const clean = (points || [])
    .filter((p) => p && /^\d{4}-\d{2}$/.test(String(p.period)) && Number.isFinite(p.value))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  if (clean.length === 0) throw new Error('No valid monthly unemployment points to build a document from');
  const latest = clean[clean.length - 1];
  const trendPts = clean.slice(-TREND_POINTS);
  const data = {
    country: COUNTRY,
    statName: STAT_NAME,
    value: `${latest.value.toFixed(1)}%`,
    updated: formatMonthLabel(latest.period),
    trend: trendPts.map((p) => p.value),
    trend_periods: trendPts.map((p) => p.period),
    sub: 'Seasonally adjusted · ages 15 and over',
    source: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
    table: TABLE_ID,
    coordinate: COORDINATE,
    verified_series: EXPECTED_MEMBERS.join(' · '),
    latest_period: latest.period,
    last_updated: opts.nowIso || new Date().toISOString(),
  };
  if (opts.releaseTime) data.statcan_release_time = opts.releaseTime;
  return { id: DOC_ID, data, latest: { period: latest.period, value: latest.value } };
}

// ─── network (robust: axios -> global fetch -> curl; StatCan resets some Node HTTPS clients) ───

function curlPost(url, bodyJson, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-s', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-X', 'POST', url, '-H', 'Content-Type: application/json', '-d', bodyJson],
      { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
      });
  });
}

async function wdsPost(pathName, body, { timeoutMs = 20000, retries = 2 } = {}) {
  const url = `${WDS_BASE}/${pathName}`;
  const errors = [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const r = await axios.post(url, body, { timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'User-Agent': 'CivicVoice-DataEngine/1.0' } });
      return r.data;
    } catch (e) { errors.push(`axios#${attempt + 1}: ${e.code || e.message}`); }
    await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
  }
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { errors.push(`fetch: ${e.message}`); }
  try {
    return await curlPost(url, JSON.stringify(body), timeoutMs);
  } catch (e) { errors.push(`curl: ${e.message}`); }
  throw new Error(`StatCan WDS ${pathName} failed after all strategies — ${errors.join(' | ')}`);
}

/**
 * Fetch, VERIFY the series identity, and build the document. Never touches Firestore.
 * Throws (so the caller records a failure instead of storing a wrong number) if the
 * coordinate does not resolve to the expected series.
 */
async function fetchCaUnemployment({ latestN = 24, nowIso } = {}) {
  const meta = await wdsPost('getCubeMetadata', [{ productId: PRODUCT_ID }]);
  const obj = meta && meta[0] && meta[0].object;
  if (!obj) throw new Error('StatCan getCubeMetadata returned no object');
  const identity = verifySeriesIdentity(obj);
  if (!identity.ok) throw new Error('StatCan series identity check FAILED: ' + identity.mismatches.join('; '));

  const resp = await wdsPost('getDataFromCubePidCoordAndLatestNPeriods', [{ productId: PRODUCT_ID, coordinate: COORDINATE, latestN }]);
  const raw = (resp && resp[0] && resp[0].object && resp[0].object.vectorDataPoint) || [];
  const points = raw
    .map((p) => ({ period: periodYmFromRefPer(p.refPer), value: Number(p.value) }))
    .filter((p) => p.period && Number.isFinite(p.value));
  const built = buildSocialStatDoc(points, { nowIso, releaseTime: obj.releaseTime });
  return { ...built, identity, cubeTitle: obj.cubeTitleEn, cubeEndDate: obj.cubeEndDate, pointsFetched: points.length };
}

/** Record shape for the manual live-fetch file (output/socialstats/live_fetch_*.json). */
function toLiveRecord(built, fetchedAt) {
  return {
    country: COUNTRY,
    metric: STAT_NAME,
    value: built.latest.value,
    unit: UNIT,
    date: built.latest.period,
    source: SOURCE_LABEL,
    sourceUrl: SOURCE_URL,
    fetchedAt,
    docOverride: built.data,
  };
}

/**
 * Pre-flight for the MANUAL uploaders (upload:social-stats, upload:live-stats), which read a saved
 * live_fetch_*.json that may have been produced BEFORE this module existed. Such a file holds
 * Canada's unemployment from the old unadjusted table 14-10-0017-01 with no `docOverride`; writing it
 * under the 14-10-0287-01 source label would store a wrong number with a right-looking label.
 * Call this BEFORE any destructive step (the canonical upload wipes the collection first).
 *
 * @param {Array<Record<string, any>>} records live_fetch records
 * @param {{ requirePresent?: boolean }} [opts] requirePresent: also fail when Canada's record is absent
 *        (the canonical upload would otherwise write a null value for the card after wiping the collection)
 */
function assertCurrentCaUnemploymentRecord(records, { requirePresent = false } = {}) {
  const rec = (records || []).find((r) => r && r.country === COUNTRY && (r.metric === STAT_NAME || r.stat === STAT_NAME));
  if (!rec) {
    if (requirePresent) {
      throw new Error('Aborting before any write: the live_fetch file has no Canada unemploymentRate record. Re-run `npm run live:fetch` (the StatCan fetch may have failed).');
    }
    return;
  }
  if (!rec.docOverride) {
    throw new Error('Aborting before any write: this live_fetch file holds Canada unemploymentRate from the old table 14-10-0017-01 (no docOverride). Re-run `npm run live:fetch` to fetch table 14-10-0287-01.');
  }
}

/** The document an uploader should write for a record that carries docOverride. */
function docFromOverride(override, nowIso) {
  return { ...override, last_updated: nowIso };
}

module.exports = {
  PRODUCT_ID,
  TABLE_ID,
  COORDINATE,
  SOURCE_URL,
  SOURCE_LABEL,
  UNIT,
  EXPECTED_MEMBERS,
  TREND_POINTS,
  COUNTRY,
  STAT_NAME,
  DOC_ID,
  verifySeriesIdentity,
  buildSocialStatDoc,
  fetchCaUnemployment,
  toLiveRecord,
  docFromOverride,
  assertCurrentCaUnemploymentRecord,
};
