const admin = require('firebase-admin');

let _db = null;

/**
 * Initialise Firebase Admin SDK once and return the Firestore instance.
 * Supports two auth methods:
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account JSON file
 *   2. Inline FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY env vars
 */
function getDb() {
  if (_db) return _db;

  if (admin.apps.length === 0) {
    let credential;

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      credential = admin.credential.applicationDefault();
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      credential = admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Env vars escape newlines as \n — restore them
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else {
      throw new Error(
        'Firebase credentials not configured. Set GOOGLE_APPLICATION_CREDENTIALS or ' +
        'FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in .env'
      );
    }

    admin.initializeApp({ credential });
  }

  _db = admin.firestore();
  return _db;
}

module.exports = { getDb };
