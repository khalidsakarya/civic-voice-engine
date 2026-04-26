'use strict';

/**
 * Weekly US Cabinet Validation
 *
 * Fetches the current secretary/head from each major department's official website,
 * compares against stored Firestore records, and automatically updates Firestore
 * when a discrepancy is detected.
 *
 * Sources (8 direct, 1 fallback):
 *   DHS       → dhs.gov/leadership
 *   State     → state.gov/secretary/
 *   Treasury  → home.treasury.gov/about/general-information/officials
 *   DOJ       → justice.gov/ag
 *   HHS       → hhs.gov/about/leadership (Safari UA)
 *   Education → ed.gov/about/news
 *   Energy    → energy.gov/our-leadership-offices
 *   EPA       → epa.gov/aboutepa/epa-administrator
 *   Defense   → defense.gov (403) → whitehouse.gov fallback
 *
 * Run: node src/ingestion/validateCabinet.js
 * Scheduled: weekly (same tier as departmentHeadsFetcher)
 */

require('dotenv').config();

const { getDb }          = require('../firebase/client');
const { writeAuditLog }  = require('../firebase/auditLog');
const { fetchDeptSources, DEPT_DIRECT_SOURCES, titleToDeptKey, fetchUSDeptHeads } = require('./departmentHeadsFetcher');

const COLLECTION = 'department_heads';
const SCHEDULER_TIER = 'weekly';

// ─── Read stored US cabinet from Firestore ────────────────────────────────────

async function readStoredUSCabinet() {
  const db       = getDb();
  const snapshot = await db.collection(COLLECTION).where('jurisdiction', '==', 'US').get();
  const stored   = new Map();
  snapshot.forEach(doc => {
    const d = doc.data();
    stored.set(doc.id, { docId: doc.id, name: d.name, title: d.title, department: d.department, source: d.source });
  });
  return stored;
}

// ─── Main validation function ─────────────────────────────────────────────────

async function validateUSCabinet() {
  const _ts = new Date().toISOString();
  console.log('\n[validate:US] Starting cabinet validation...');

  // 1. Fetch live names from department websites
  const liveData = await fetchDeptSources();

  if (liveData.size === 0) {
    console.warn('[validate:US] No department data fetched — aborting validation');
    return { checked: 0, changed: 0, errors: ['No department data fetched'] };
  }

  // 2. Read current Firestore records
  const stored = await readStoredUSCabinet();
  console.log(`[validate:US] Live sources: ${liveData.size} | Stored records: ${stored.size}`);

  // 3. Build a lookup from dept key → stored record
  //    Match by title prefix using titleToDeptKey()
  const storedByKey = new Map();
  for (const [docId, record] of stored) {
    const key = titleToDeptKey(record.title);
    if (key) storedByKey.set(key, { docId, ...record });
  }

  // 4. Compare live vs stored, collect changes
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
      console.log(`[validate:US:${key}] CHANGE: "${storedEntry.name}" → "${live.name}" (${live.url})`);
      changes.push({
        key,
        docId:    storedEntry.docId,
        oldName:  storedEntry.name,
        newName:  live.name,
        title:    storedEntry.title,
        url:      live.url,
      });
    }
  }

  // 5. Print summary
  console.log(`[validate:US] Unchanged: ${unchanged.join(', ') || 'none'}`);
  if (missing.length)   console.log(`[validate:US] Missing:   ${missing.map(m => m.key).join(', ')}`);
  if (changes.length === 0) {
    console.log('[validate:US] No cabinet changes detected. Firestore is up to date.');
  } else {
    console.log(`[validate:US] ${changes.length} change(s) detected — updating Firestore...`);
  }

  // 6. Apply Firestore updates for changed entries
  if (changes.length > 0) {
    const db    = getDb();
    const batch = db.batch();
    for (const change of changes) {
      const ref = db.collection(COLLECTION).doc(change.docId);
      batch.update(ref, {
        name:           change.newName,
        source_url:     change.url,
        source:         'department_website',
        last_updated:   _ts,
        previous_name:  change.oldName,
      });
    }
    await batch.commit();
    console.log(`[validate:US] Firestore updated — ${changes.length} document(s) patched`);
  }

  // 7. Audit log
  await writeAuditLog({
    collection_name:    COLLECTION,
    jurisdiction:       'US',
    data_pull_timestamp: _ts,
    source_endpoint:    'dept-direct-validation',
    record_count:       liveData.size,
    import_status:      changes.length > 0 ? 'updated' : 'unchanged',
    scheduler_tier:     SCHEDULER_TIER,
    ...(changes.length > 0 && { changes: changes.map(c => `${c.key}: ${c.oldName} → ${c.newName}`) }),
  });

  return {
    checked:   liveData.size,
    unchanged: unchanged.length,
    changed:   changes.length,
    missing:   missing.length,
    details:   changes,
  };
}

// ─── Also validate Canada/UK/AU by re-running full fetchers ──────────────────
// For CA/UK/AU the source pages are the authoritative lists, so we just re-run
// the fetchers and upload the result; no manual name-by-name comparison needed.

async function validateAllCabinets() {
  console.log('\n[validate] Running full cabinet validation...\n');

  const usResult = await validateUSCabinet();

  // For CA/UK/AU: trigger a fresh fetch + upload (sources are authoritative lists)
  const { fetchAllDeptHeads } = require('./departmentHeadsFetcher');
  const { uploadDepartmentHeads } = require('../firebase/uploader');

  console.log('\n[validate] Re-fetching CA/UK/AU from official sources...');
  await fetchAllDeptHeads();
  const uploaded = await uploadDepartmentHeads();

  console.log(`\n[validate] Complete. US changes: ${usResult.changed} | Total docs pushed: ${uploaded}`);
  return { us: usResult, totalUploaded: uploaded };
}

// ─── Standalone runner ────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const fullRun = args.includes('--all');

  const run = fullRun ? validateAllCabinets : validateUSCabinet;

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

module.exports = { validateUSCabinet, validateAllCabinets };
