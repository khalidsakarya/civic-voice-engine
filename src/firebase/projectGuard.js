/**
 * Project guard: refuse to touch Firestore unless the Admin SDK is bound to the expected project.
 *
 * The Canada unemployment update writes to production data, so it verifies — BEFORE its first
 * Firestore read — that the credential in use belongs to civic-voice-5ea94 and that no environment
 * hint points elsewhere. (firebase-admin falls back to GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT for the
 * project when the credential does not carry one, so those are checked too.)
 *
 * Learning the project id needs NO network: the credential object reads it from the local
 * service-account file. Nothing here talks to Google.
 */

'use strict';

const EXPECTED_PROJECT_ID = 'civic-voice-5ea94';

/**
 * Every project hint the Admin SDK could act on.
 * @param {any} admin the firebase-admin module (injectable for tests)
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{ credential: string|null, appOptions: string|null, env: Record<string,string> }>}
 */
async function collectProjectIds(admin, env = process.env) {
  const app = admin.app();
  const options = (app && app.options) || {};
  const cred = options.credential;
  let credential = null;
  if (cred && typeof cred.getProjectId === 'function') {
    try { credential = (await cred.getProjectId()) || null; } catch { credential = null; }
  }
  if (!credential && cred && typeof cred.projectId === 'string' && cred.projectId) credential = cred.projectId;
  const envHints = {};
  for (const k of ['GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
    if (typeof env[k] === 'string' && env[k].trim()) envHints[k] = env[k].trim();
  }
  return { credential, appOptions: options.projectId || null, env: envHints };
}

/**
 * Pure decision over the collected hints. Throws unless the credential's project is KNOWN and every
 * hint that is present equals `expected`.
 */
function assertExpectedProjectIds(ids, expected = EXPECTED_PROJECT_ID) {
  if (!ids.credential) {
    throw new Error(`Refusing to touch Firestore: could not determine the project the credential is bound to (expected ${expected}).`);
  }
  const bad = [];
  if (ids.credential !== expected) bad.push(`credential is bound to "${ids.credential}"`);
  if (ids.appOptions && ids.appOptions !== expected) bad.push(`app options say "${ids.appOptions}"`);
  for (const [k, v] of Object.entries(ids.env || {})) if (v !== expected) bad.push(`${k}="${v}"`);
  if (bad.length) throw new Error(`Refusing to touch Firestore: expected project "${expected}" but ${bad.join('; ')}.`);
  return ids.credential;
}

/**
 * Convenience used by the scheduler: resolves the hints from the real firebase-admin module and
 * asserts them. Call it AFTER getDb() (which initialises the default app) and BEFORE any read.
 * @returns {Promise<string>} the verified project id
 */
async function verifyFirestoreProject({ admin = require('firebase-admin'), env = process.env, expected = EXPECTED_PROJECT_ID } = {}) {
  return assertExpectedProjectIds(await collectProjectIds(admin, env), expected);
}

module.exports = { EXPECTED_PROJECT_ID, collectProjectIds, assertExpectedProjectIds, verifyFirestoreProject };
