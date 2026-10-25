/**
 * Local pre-write backup for the Canada unemployment update.
 *
 * Before the check REPLACES an existing social_stats/CA_unemploymentRate document, the complete
 * original document is saved to a local JSON file so the change can be reversed by hand. If the
 * backup cannot be written and verified, the update is aborted (see caUnemploymentCheck.js).
 *
 * Properties enforced here (each is covered by a test):
 *   - OUTSIDE ANY GIT REPOSITORY: the target directory (default ~/civic-voice-backups/firestore,
 *     override with CIVIC_VOICE_BACKUP_DIR) is refused if it, or any ancestor, contains `.git`,
 *     so a backup can never be committed by accident.
 *   - NEVER OVERWRITES: files are created with the exclusive "wx" flag under a timestamped name.
 *   - VERIFIED: the file is read back and its document id and data are compared to what was meant
 *     to be saved; a mismatch removes the file and fails the backup.
 *   - NO CREDENTIALS: the file contains only the document's own data plus a fixed set of metadata
 *     fields. As a last line of defence the finished text is scanned for service-account / private
 *     key material and the backup is refused if any is found.
 *   - LOSSLESS: Firestore Timestamps, references, GeoPoints and bytes are serialised with explicit
 *     type tags (not flattened to strings) so the original can be reconstructed.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const BACKUP_FORMAT = 1;

function resolveBackupDir(env = process.env) {
  const fromEnv = typeof env.CIVIC_VOICE_BACKUP_DIR === 'string' ? env.CIVIC_VOICE_BACKUP_DIR.trim() : '';
  return path.resolve(fromEnv || path.join(os.homedir(), 'civic-voice-backups', 'firestore'));
}

/** The nearest ancestor (inclusive) containing `.git` (a directory, or the file a worktree uses), or null. */
function findGitRepoAbove(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** Convert a Firestore value to plain JSON with explicit type tags where JSON would lose information. */
function serializeFirestoreValue(v) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') return Number.isFinite(v) ? v : { __type: 'number', value: String(v) };
  if (t === 'bigint') return { __type: 'bigint', value: v.toString() };
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
  if (Array.isArray(v)) return v.map((x) => { const s = serializeFirestoreValue(x); return s === undefined ? null : s; });
  if (v instanceof Date) return { __type: 'timestamp', iso: v.toISOString() };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { __type: 'bytes', base64: Buffer.from(v).toString('base64') };
  const secs = v.seconds !== undefined ? v.seconds : v._seconds;
  if (typeof v.toDate === 'function' && typeof secs === 'number') {
    return { __type: 'timestamp', iso: v.toDate().toISOString(), seconds: secs, nanoseconds: v.nanoseconds !== undefined ? v.nanoseconds : v._nanoseconds };
  }
  if (typeof v.path === 'string' && v.firestore) return { __type: 'reference', path: v.path };
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 4) return { __type: 'geopoint', latitude: v.latitude, longitude: v.longitude };
  const out = {};
  for (const k of Object.keys(v)) {
    const s = serializeFirestoreValue(v[k]);
    if (s !== undefined) out[k] = s;
  }
  return out;
}

const CREDENTIAL_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"private_key"\s*:/,
  /"private_key_id"\s*:/,
  /"client_email"\s*:\s*"[^"]*gserviceaccount\.com"/,
  /"type"\s*:\s*"service_account"/,
];

/** Throws if the text looks like it contains service-account or private-key material. */
function assertNoCredentialMaterial(text) {
  for (const re of CREDENTIAL_PATTERNS) {
    if (re.test(text)) throw new Error('backup refused: the content contains credential-like material (service-account / private key)');
  }
}

/**
 * Build the writer used by the check. The returned function saves one document and resolves to
 * { path, bytes, sha256 }, or throws (and the caller must then stop).
 */
function createLocalBackupWriter({ dir = resolveBackupDir(), now = () => new Date() } = {}) {
  return async function writeBackup({ collection, docId, data, projectId = null }) {
    const resolvedDir = path.resolve(dir);
    const repo = findGitRepoAbove(resolvedDir);
    if (repo) throw new Error(`backup refused: ${resolvedDir} is inside the git repository at ${repo}; backups must live outside any repository`);
    fs.mkdirSync(resolvedDir, { recursive: true });

    const takenAt = now().toISOString();
    const payload = {
      backup_format: BACKUP_FORMAT,
      document: { collection, id: docId, path: `${collection}/${docId}` },
      backed_up_at: takenAt,
      firebase_project: projectId,
      written_by: 'civic-voice-engine src/ingestion/caUnemploymentBackup.js',
      data: serializeFirestoreValue(data),
    };
    const text = JSON.stringify(payload, null, 2) + '\n';
    assertNoCredentialMaterial(text);

    const base = `${collection}__${docId}__${takenAt.replace(/[:.]/g, '-')}`;
    let file = null;
    for (let n = 0; n < 20 && !file; n += 1) {
      const candidate = path.join(resolvedDir, `${base}${n ? `__${n}` : ''}.json`);
      try {
        fs.writeFileSync(candidate, text, { flag: 'wx', mode: 0o600 });
        file = candidate;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    if (!file) throw new Error('backup failed: could not choose an unused file name');

    // Read back and verify before anyone is allowed to rely on it.
    let ok = false;
    try {
      const back = JSON.parse(fs.readFileSync(file, 'utf8'));
      ok = back.document && back.document.id === docId && back.backup_format === BACKUP_FORMAT
        && JSON.stringify(back.data) === JSON.stringify(payload.data);
    } catch { ok = false; }
    if (!ok) {
      try { fs.unlinkSync(file); } catch { /* best effort */ }
      throw new Error('backup failed: the saved file did not verify when read back');
    }
    return { path: file, bytes: Buffer.byteLength(text), sha256: crypto.createHash('sha256').update(text).digest('hex') };
  };
}

module.exports = {
  BACKUP_FORMAT,
  resolveBackupDir,
  findGitRepoAbove,
  serializeFirestoreValue,
  assertNoCredentialMaterial,
  createLocalBackupWriter,
};
