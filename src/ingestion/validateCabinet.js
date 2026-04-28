'use strict';

/**
 * Cabinet Validation — US, Canada, UK, Australia
 *
 * US (9 dept-direct sources + 1 WH fallback):
 *   Fetches the current secretary/head from each department's own website,
 *   diffs against Firestore, and auto-patches name changes.
 *   Acting detection: fetchWHCabinet() scans bio text for "Acting [title]"
 *   and prefixes the WH h3 title if the h3 hasn't been updated yet.
 *
 * CA / UK / AU (authoritative listing pages):
 *   Extracts key ministerial positions from the official government listing
 *   page, diffs name and title against Firestore key-position records, and
 *   patches changes. Acting designations appear in the title field on the
 *   listing page itself (no bio-text scan needed).
 *
 * Run:
 *   node src/ingestion/validateCabinet.js          → US only
 *   node src/ingestion/validateCabinet.js --all    → all 4 jurisdictions
 *
 * Scheduled: weekly (step 17 of runWeeklyCycle)
 */

require('dotenv').config();

const { getDb }         = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');
const {
  fetchDeptSources,
  titleToDeptKey,
  fetchDeptSourcesCA,
  fetchDeptSourcesUK,
  fetchDeptSourcesAU,
  CA_KEY_POSITIONS,
  UK_KEY_POSITIONS,
  AU_KEY_POSITIONS,
} = require('./departmentHeadsFetcher');

const COLLECTION     = 'department_heads';
const SCHEDULER_TIER = 'weekly';

// ─── Generic Firestore reader ─────────────────────────────────────────────────

async function readStoredCabinet(jurisdiction) {
  const db       = getDb();
  const snapshot = await db.collection(COLLECTION).where('jurisdiction', '==', jurisdiction).get();
  const stored   = new Map();
  snapshot.forEach(doc => {
    const d = doc.data();
    stored.set(doc.id, { docId: doc.id, name: d.name, title: d.title, department: d.department, source: d.source });
  });
  return stored;
}

// ─── US cabinet validation ────────────────────────────────────────────────────
// Uses dept-direct sources (9 individual department websites). Name-only diff
// (titles come from whitehouse.gov and are already updated by acting detection
// in fetchWHCabinet before they reach Firestore).

async function validateUSCabinet() {
  const _ts = new Date().toISOString();
  console.log('\n[validate:US] Starting cabinet validation...');

  const liveData = await fetchDeptSources();

  if (liveData.size === 0) {
    console.warn('[validate:US] No department data fetched — aborting validation');
    return { checked: 0, changed: 0, errors: ['No department data fetched'] };
  }

  const stored = await readStoredCabinet('US');
  console.log(`[validate:US] Live sources: ${liveData.size} | Stored records: ${stored.size}`);

  // Match stored records to dept keys via title-prefix lookup
  const storedByKey = new Map();
  for (const [docId, record] of stored) {
    const key = titleToDeptKey(record.title);
    if (key) storedByKey.set(key, { docId, ...record });
  }

  const changes   = [];
  const unchanged = [];
  const missing   = [];

  for (const [key, live] of liveData) {
    const storedEntry = storedByKey.get(key);
    if (!storedEntry) {
      missing.push({ key, liveName: live.name, url: live.url });
      console.warn(`[validate:US:${key}] No stored record found (title mapping may need update)`);
      continue;
    }

    if (storedEntry.name === live.name) {
      unchanged.push(key);
    } else {
      console.log(`[validate:US:${key}] CHANGE: "${storedEntry.name}" → "${live.name}"`);
      changes.push({ key, docId: storedEntry.docId, oldName: storedEntry.name, newName: live.name, title: storedEntry.title, url: live.url });
    }
  }

  console.log(`[validate:US] Unchanged: ${unchanged.join(', ') || 'none'}`);
  if (missing.length) console.log(`[validate:US] Missing:   ${missing.map(m => m.key).join(', ')}`);

  if (changes.length === 0) {
    console.log('[validate:US] No cabinet changes detected. Firestore is up to date.');
  } else {
    console.log(`[validate:US] ${changes.length} change(s) — updating Firestore...`);
    const db    = getDb();
    const batch = db.batch();
    for (const c of changes) {
      batch.update(db.collection(COLLECTION).doc(c.docId), {
        name:          c.newName,
        source_url:    c.url,
        source:        'department_website',
        last_updated:  _ts,
        previous_name: c.oldName,
      });
    }
    await batch.commit();
    console.log(`[validate:US] Firestore updated — ${changes.length} document(s) patched`);
  }

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'US',
    data_pull_timestamp: _ts,
    source_endpoint:     'dept-direct-validation',
    record_count:        liveData.size,
    import_status:       changes.length > 0 ? 'updated' : 'unchanged',
    scheduler_tier:      SCHEDULER_TIER,
    ...(changes.length > 0 && { changes: changes.map(c => `${c.key}: ${c.oldName} → ${c.newName}`) }),
  });

  return { checked: liveData.size, unchanged: unchanged.length, changed: changes.length, missing: missing.length, details: changes };
}

// ─── Generic CA / UK / AU validator ──────────────────────────────────────────
// Compares live key-position data (Map<key, {name, title, url}>) against stored
// Firestore records for the given jurisdiction. Detects both name changes
// (minister replaced) and title changes (acting designation applied/lifted).
//
// storedByKey matching: for each stored record, test its title against each
// key position's titleRe. The regex includes (?:Acting\s+)? so it matches
// whether the stored title has the Acting prefix or not.

async function validateJurisdictionCabinet(jurisdiction, liveData, keyPositions) {
  const _ts    = new Date().toISOString();
  const stored = await readStoredCabinet(jurisdiction);
  console.log(`[validate:${jurisdiction}] Key positions live: ${liveData.size} | Stored records: ${stored.size}`);

  // Build storedByKey: first matching key position wins for each stored record.
  const storedByKey = new Map();
  for (const [docId, record] of stored) {
    const rawTitle     = record.title || '';
    const strippedTitle = rawTitle.replace(/^Acting\s+/i, '');
    for (const pos of keyPositions) {
      if (storedByKey.has(pos.key)) continue;
      if (pos.titleRe.test(rawTitle) || pos.titleRe.test(strippedTitle)) {
        storedByKey.set(pos.key, { docId, ...record });
        break;
      }
    }
  }

  const changes   = [];
  const unchanged = [];
  const missing   = [];

  for (const [key, live] of liveData) {
    const storedEntry = storedByKey.get(key);
    if (!storedEntry) {
      missing.push({ key, liveName: live.name, liveTitle: live.title });
      console.warn(`[validate:${jurisdiction}:${key}] No stored record — will be created by next full upload`);
      continue;
    }

    const nameChanged  = storedEntry.name  !== live.name;
    const titleChanged = storedEntry.title !== live.title;

    if (!nameChanged && !titleChanged) {
      unchanged.push(key);
    } else {
      if (nameChanged)  console.log(`[validate:${jurisdiction}:${key}] NAME:  "${storedEntry.name}" → "${live.name}"`);
      if (titleChanged) console.log(`[validate:${jurisdiction}:${key}] TITLE: "${storedEntry.title}" → "${live.title}"`);
      changes.push({ key, docId: storedEntry.docId, oldName: storedEntry.name, newName: live.name, oldTitle: storedEntry.title, newTitle: live.title, url: live.url });
    }
  }

  console.log(`[validate:${jurisdiction}] Unchanged: ${unchanged.join(', ') || 'none'}`);
  if (missing.length) console.log(`[validate:${jurisdiction}] Missing:   ${missing.map(m => m.key).join(', ')}`);

  if (changes.length === 0) {
    console.log(`[validate:${jurisdiction}] All key positions match. Firestore is up to date.`);
  } else {
    console.log(`[validate:${jurisdiction}] ${changes.length} change(s) — patching Firestore...`);
    const db    = getDb();
    const batch = db.batch();
    for (const c of changes) {
      const fields = { last_updated: _ts };
      if (c.oldName  !== c.newName)  Object.assign(fields, { name: c.newName, previous_name: c.oldName });
      if (c.oldTitle !== c.newTitle) fields.title = c.newTitle;
      if (c.url)                     fields.source_url = c.url;
      batch.update(db.collection(COLLECTION).doc(c.docId), fields);
    }
    await batch.commit();
    console.log(`[validate:${jurisdiction}] Firestore updated — ${changes.length} document(s) patched`);
  }

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction,
    data_pull_timestamp: _ts,
    source_endpoint:     `listing-page-validation-${jurisdiction.toLowerCase()}`,
    record_count:        liveData.size,
    import_status:       changes.length > 0 ? 'updated' : 'unchanged',
    scheduler_tier:      SCHEDULER_TIER,
    ...(changes.length > 0 && {
      changes: changes.map(c => `${c.key}: ${c.oldName}→${c.newName}; title ${c.oldTitle}→${c.newTitle}`),
    }),
  });

  return { checked: liveData.size, unchanged: unchanged.length, changed: changes.length, missing: missing.length, details: changes };
}

// ─── Per-jurisdiction validators ──────────────────────────────────────────────

async function validateCAcabinet() {
  console.log('\n[validate:CA] Starting key-position cabinet validation...');
  const liveData = await fetchDeptSourcesCA();
  if (liveData.size === 0) {
    console.warn('[validate:CA] No live data fetched — aborting');
    return { checked: 0, changed: 0, errors: ['No data fetched'] };
  }
  for (const [key, v] of liveData) console.log(`[validate:CA:${key}] ${v.name} — ${v.title}`);
  return validateJurisdictionCabinet('CA', liveData, CA_KEY_POSITIONS);
}

async function validateUKcabinet() {
  console.log('\n[validate:UK] Starting key-position cabinet validation...');
  const liveData = await fetchDeptSourcesUK();
  if (liveData.size === 0) {
    console.warn('[validate:UK] No live data fetched — aborting');
    return { checked: 0, changed: 0, errors: ['No data fetched'] };
  }
  for (const [key, v] of liveData) console.log(`[validate:UK:${key}] ${v.name} — ${v.title}`);
  return validateJurisdictionCabinet('UK', liveData, UK_KEY_POSITIONS);
}

async function validateAUcabinet() {
  console.log('\n[validate:AU] Starting key-position cabinet validation...');
  const liveData = await fetchDeptSourcesAU();
  if (liveData.size === 0) {
    console.warn('[validate:AU] No live data fetched — aborting');
    return { checked: 0, changed: 0, errors: ['No data fetched'] };
  }
  for (const [key, v] of liveData) console.log(`[validate:AU:${key}] ${v.name} — ${v.title}`);
  return validateJurisdictionCabinet('AU', liveData, AU_KEY_POSITIONS);
}

// ─── Full 4-country validation ────────────────────────────────────────────────

async function validateAllCabinets() {
  console.log('\n[validate] Running key-position validation for all 4 jurisdictions...\n');

  // Sequential to be polite to listing-page servers
  const usResult = await validateUSCabinet();
  const caResult = await validateCAcabinet();
  const ukResult = await validateUKcabinet();
  const auResult = await validateAUcabinet();

  // Full re-fetch and upload for all jurisdictions: creates any missing records
  // (e.g. newly discovered PM record after CA regex fix), keeps non-key-position
  // records in sync, and creates correct name-based docIds for changed ministers.
  const { fetchAllDeptHeads } = require('./departmentHeadsFetcher');
  const { uploadDepartmentHeads } = require('../firebase/uploader');

  console.log('\n[validate] Full re-sync: fetching all jurisdictions from official sources...');
  await fetchAllDeptHeads();
  const uploaded = await uploadDepartmentHeads();

  const totalChanged = [usResult, caResult, ukResult, auResult]
    .reduce((n, r) => n + (r?.changed || 0), 0);

  console.log(`\n[validate] Complete.`);
  console.log(`  Changes detected: US=${usResult?.changed || 0} CA=${caResult?.changed || 0} UK=${ukResult?.changed || 0} AU=${auResult?.changed || 0} (total: ${totalChanged})`);
  console.log(`  Docs synced to Firestore: ${uploaded}`);

  return { us: usResult, ca: caResult, uk: ukResult, au: auResult, totalUploaded: uploaded };
}

// ─── Standalone runner ────────────────────────────────────────────────────────

if (require.main === module) {
  const args    = process.argv.slice(2);
  const fullRun = args.includes('--all');
  const run     = fullRun ? validateAllCabinets : validateUSCabinet;

  run()
    .then(result => {
      console.log('\n[validate] Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('[validate] Fatal:', err.message);
      process.exit(1);
    });
}

module.exports = { validateUSCabinet, validateCAcabinet, validateUKcabinet, validateAUcabinet, validateAllCabinets };
