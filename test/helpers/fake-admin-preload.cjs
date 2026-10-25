/**
 * Test-only preload (node --require) for rehearsing the REAL command line with no external contact.
 *
 *  - `firebase-admin` is replaced by an in-memory fake; requiring the real Google/Firebase SDKs throws.
 *  - ALL outbound network is blocked. StatCan WDS calls (axios.post) are answered with canned data
 *    for the reporting month in FAKE_STATCAN_LATEST (default 2026-09).
 *  - Every Firestore operation is recorded and written to FAKE_OPS_FILE at exit, together with the
 *    final state of the one document, so a test can assert exactly what was read and written.
 *
 * Environment (all optional):
 *   FAKE_OPS_FILE        path the operation log is written to at exit
 *   FAKE_DOC_FILE        JSON file holding the EXISTING document; absent/"none" = no document yet
 *   FAKE_PROJECT_ID      project the fake credential claims to be bound to (default civic-voice-5ea94)
 *   FAKE_STATCAN_LATEST  latest reporting month served (default 2026-09); "none" = StatCan returns no data
 *   FAKE_STATCAN_FAIL    if set, StatCan calls reject (simulates an outage)
 *   FAKE_BACKUP_FAIL     (unused here; backup failures are simulated through CIVIC_VOICE_BACKUP_DIR)
 */

'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const https = require('https');
const dns = require('dns');

const ops = [];
const PROJECT = process.env.FAKE_PROJECT_ID || 'civic-voice-5ea94';
const DOC_PATH = 'social_stats/CA_unemploymentRate';
let doc;
if (process.env.FAKE_DOC_FILE && process.env.FAKE_DOC_FILE !== 'none' && fs.existsSync(process.env.FAKE_DOC_FILE)) {
  doc = JSON.parse(fs.readFileSync(process.env.FAKE_DOC_FILE, 'utf8'));
}

// ── network: nothing leaves the process ────────────────────────────────────
const blocked = (label) => function () { ops.push(['NETWORK_ATTEMPT', label]); throw new Error(`BLOCKED network: ${label}`); };
net.Socket.prototype.connect = blocked('net.Socket.connect');
['request', 'get'].forEach((f) => { http[f] = blocked(`http.${f}`); https[f] = blocked(`https.${f}`); });
dns.lookup = blocked('dns.lookup');
// The StatCan fetch falls back to `curl` as a last resort; a child process would bypass every block
// above, so no child process may start at all during a rehearsal.
const childProcess = require('child_process');
['execFile', 'exec', 'spawn', 'fork', 'execFileSync', 'execSync', 'spawnSync'].forEach((f) => {
  childProcess[f] = function (cmd, ...rest) {
    ops.push(['NETWORK_ATTEMPT', `child_process.${f} ${String(cmd).slice(0, 40)}`]);
    const cb = rest.find((a) => typeof a === 'function');
    const err = new Error(`BLOCKED child process: ${f}`);
    if (cb) { setImmediate(() => cb(err)); return { on() {}, kill() {} }; }
    throw err;
  };
});
globalThis.fetch = async (u) => { ops.push(['NETWORK_ATTEMPT', `fetch ${u}`]); throw new Error('BLOCKED network: fetch'); };

// ── canned StatCan answers ─────────────────────────────────────────────────
const axios = require('axios');
function cubeMeta() {
  const names = [['Canada'], ['a', 'b', 'c', 'd', 'e', 'f', 'Unemployment rate'], ['Total - Gender'], ['15 years and over'], ['Estimate'], ['Seasonally adjusted']];
  return { cubeTitleEn: 'Labour force characteristics, monthly, seasonally adjusted and trend-cycle', cubeEndDate: '2026-09-01', releaseTime: '2026-10-09T08:30', dimension: names.map((arr, i) => ({ dimensionPositionId: i + 1, member: arr.map((n, j) => ({ memberId: j + 1, memberNameEn: n })) })) };
}
function points(latest) {
  const [y, m] = latest.split('-').map(Number);
  const out = [];
  for (let i = 23; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push({ refPer: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`, value: String(i === 0 ? 6.5 : 6 + (i % 7) / 10) });
  }
  return out;
}
axios.post = async (url) => {
  ops.push(['STATCAN', url.split('/').pop()]);
  if (process.env.FAKE_STATCAN_FAIL) throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
  if (url.endsWith('getCubeMetadata')) return { data: [{ status: 'SUCCESS', object: cubeMeta() }] };
  const latest = process.env.FAKE_STATCAN_LATEST || '2026-09';
  return { data: [{ status: 'SUCCESS', object: { vectorDataPoint: latest === 'none' ? [] : points(latest) } }] };
};

// ── fake Firestore ─────────────────────────────────────────────────────────
const snapshot = () => ({ exists: doc !== undefined, data: () => (doc === undefined ? undefined : JSON.parse(JSON.stringify(doc))) });
const docRef = (collection, id) => {
  const p = `${collection}/${id}`;
  return {
    path: p, id,
    get: async () => { ops.push(['get', p]); return p === DOC_PATH ? snapshot() : { exists: false, data: () => undefined }; },
    set: async (data, opts) => { ops.push(['set', p]); if (p === DOC_PATH) doc = opts && opts.merge ? { ...(doc || {}), ...data } : { ...data }; },
    update: async () => { ops.push(['update', p]); },
    delete: async () => { ops.push(['delete', p]); },
  };
};
const fakeDb = {
  collection: (name) => ({
    doc: (id) => docRef(name, id),
    add: async (d) => { ops.push(['add', name, d && d.import_status]); },
    where: () => { ops.push(['QUERY_NOT_EXPECTED', name]); return { get: async () => ({ docs: [] }) }; },
    get: async () => { ops.push(['COLLECTION_SCAN', name]); return { docs: [] }; },
  }),
  runTransaction: async (fn) => {
    ops.push(['runTransaction']);
    const pending = [];
    const tx = {
      get: async (ref) => { ops.push(['tx.get', ref.path]); return ref.path === DOC_PATH ? snapshot() : { exists: false, data: () => undefined }; },
      set: (ref, data, opts) => { ops.push(['tx.set', ref.path]); pending.push([ref, data, opts]); },
    };
    const result = await fn(tx);
    for (const [ref, data, opts] of pending) if (ref.path === DOC_PATH) doc = opts && opts.merge ? { ...(doc || {}), ...data } : { ...data };
    return result;
  },
  batch: () => { ops.push(['batch_NOT_EXPECTED']); return { set() {}, delete() {}, commit: async () => {} }; },
};
const credential = { getProjectId: async () => PROJECT };
const fakeAdmin = {
  apps: [],
  credential: { applicationDefault: () => credential, cert: () => credential },
  initializeApp(opts) { const app = { options: { credential: opts && opts.credential } }; fakeAdmin.apps.push(app); fakeAdmin._app = app; return app; },
  app: () => fakeAdmin._app,
  firestore: () => fakeDb,
};

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'firebase-admin') return fakeAdmin;
  if (request.startsWith('firebase-admin/') || request.startsWith('@google-cloud/') || request.startsWith('firebase/')) {
    ops.push(['REAL_SDK_REQUIRED', request]);
    throw new Error(`BLOCKED: the real SDK "${request}" must not be loaded in a rehearsal`);
  }
  return realLoad.call(this, request, ...rest);
};

process.on('exit', () => {
  if (process.env.FAKE_OPS_FILE) {
    try { fs.writeFileSync(process.env.FAKE_OPS_FILE, JSON.stringify({ ops, finalDocument: doc === undefined ? null : doc }, null, 2)); } catch { /* ignore */ }
  }
});
