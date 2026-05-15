'use strict';
/**
 * usGovernorFetcher.js
 *
 * Sets leader_title for all 51 US state/DC docs in subnational_jurisdictions.
 * Corrects leader_name where official state site differs from stored value.
 *
 * Sources:
 *   leader_title  — constitutional role; all 50 state executives titled "Governor",
 *                   DC executive titled "Mayor". Confirmed via official state sites
 *                   and NGA member directory (nga.org/governors).
 *   US-VA name    — governor.virginia.gov: "Governor Abigail D. Spanberger"
 *                   (Firestore stored "Abigail Spanberger", missing middle initial).
 *
 * Fields written:  leader_title, needs_manual_review (leader_title removed once set).
 * Optional write:  leader_name correction for US-VA.
 *
 * Merge only. No deletes. No new docs. No null overwrites.
 * Default: DRY RUN. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('../firebase/client');

const COLLECTION = 'subnational_jurisdictions';
const WRITE_MODE  = process.argv.includes('--write');

// ─── All US state doc IDs ─────────────────────────────────────────────────────
const US_DOCS = [
  'US-AL','US-AK','US-AZ','US-AR','US-CA','US-CO','US-CT','US-DE','US-DC','US-FL',
  'US-GA','US-HI','US-ID','US-IL','US-IN','US-IA','US-KS','US-KY','US-LA','US-ME',
  'US-MD','US-MA','US-MI','US-MN','US-MS','US-MO','US-MT','US-NE','US-NV','US-NH',
  'US-NJ','US-NM','US-NY','US-NC','US-ND','US-OH','US-OK','US-OR','US-PA','US-RI',
  'US-SC','US-SD','US-TN','US-TX','US-UT','US-VT','US-VA','US-WA','US-WV','US-WI','US-WY',
];

// ─── Official leader titles ───────────────────────────────────────────────────
// All 50 state chief executives hold the constitutional title "Governor".
// The District of Columbia chief executive holds the title "Mayor".
const LEADER_TITLE = {
  'US-DC': 'Mayor',
};
US_DOCS.forEach(id => { if (!LEADER_TITLE[id]) LEADER_TITLE[id] = 'Governor'; });

// ─── Official name corrections ────────────────────────────────────────────────
// Only entries where the stored name differs from the official state website.
// Source for each listed in the comment.
const NAME_CORRECTIONS = {
  // governor.virginia.gov: "Governor of Virginia Abigail D. Spanberger"
  'US-VA': 'Abigail D. Spanberger',
  // gov.georgia.gov: "Governor Brian P. Kemp"
  'US-GA': 'Brian P. Kemp',
  // governor.hawaii.gov: "Governor Josh Green, M.D."
  'US-HI': 'Josh Green, M.D.',
  // gov.illinois.gov: "JB Pritzker, Governor" (no periods)
  'US-IL': 'JB Pritzker',
  // maine.gov/governor: "Governor Janet T. Mills"
  'US-ME': 'Janet T. Mills',
  // oklahoma.gov/governor: "J. Kevin Stitt"
  'US-OK': 'J. Kevin Stitt',
  // governor.sc.gov: "Henry Dargan McMaster"
  'US-SC': 'Henry Dargan McMaster',
  // governor.utah.gov: "Spencer J. Cox"
  'US-UT': 'Spencer J. Cox',
  // governor.wv.gov: "Patrick James Morrisey"
  'US-WV': 'Patrick James Morrisey',
};

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function fetchCurrentDocs(db) {
  // Firestore 'in' limit is 30; split into two batches.
  const results = {};
  const b1 = US_DOCS.slice(0, 30);
  const b2 = US_DOCS.slice(30);
  const [s1, s2] = await Promise.all([
    db.collection(COLLECTION).where('__name__', 'in', b1).get(),
    db.collection(COLLECTION).where('__name__', 'in', b2).get(),
  ]);
  s1.forEach(doc => { results[doc.id] = doc.data(); });
  s2.forEach(doc => { results[doc.id] = doc.data(); });
  return results;
}

// ─── Build patches ────────────────────────────────────────────────────────────

function buildPatches(current) {
  const patches = {};

  for (const docId of US_DOCS) {
    const doc = current[docId];
    if (!doc) {
      console.warn(`[GOV] ${docId} not found in Firestore — skipped`);
      continue;
    }

    const patch = {};
    let changed = false;

    // 1. leader_title — set if currently null/absent
    const storedTitle = doc.leader_title || null;
    const officialTitle = LEADER_TITLE[docId];
    if (!storedTitle) {
      patch.leader_title = officialTitle;
      changed = true;
    }

    // 2. leader_name correction — apply only when official differs from stored
    const correction = NAME_CORRECTIONS[docId];
    if (correction && doc.leader_name !== correction) {
      patch.leader_name = correction;
      changed = true;
    }

    // 3. needs_manual_review — remove "leader_title" once set; preserve others
    const current_nmr = Array.isArray(doc.needs_manual_review) ? doc.needs_manual_review : [];
    if (current_nmr.includes('leader_title')) {
      patch.needs_manual_review = current_nmr.filter(f => f !== 'leader_title');
      changed = true;
    }

    if (changed) patches[docId] = patch;
  }

  return patches;
}

// ─── Write ────────────────────────────────────────────────────────────────────

async function writePatches(db, patches) {
  const ids = Object.keys(patches);
  const batch = db.batch();
  for (const docId of ids) {
    batch.set(db.collection(COLLECTION).doc(docId), patches[docId], { merge: true });
  }
  await batch.commit();
  return ids.length;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function report(patches, current) {
  const ids = Object.keys(patches).sort();
  console.log(`\n[GOV] ─── Patches (${ids.length} docs) ──────────────────────────────`);
  for (const docId of ids) {
    const p = patches[docId];
    const parts = [];
    if (p.leader_title)    parts.push(`title="${p.leader_title}"`);
    if (p.leader_name)     parts.push(`name="${p.leader_name}" (was "${current[docId]?.leader_name}")`);
    if (p.needs_manual_review) parts.push(`nmr=[${p.needs_manual_review.join(',')}]`);
    console.log(`  ${docId.padEnd(8)} ${parts.join(' | ')}`);
  }

  const needsReview = ids.filter(id => {
    const nmr = patches[id].needs_manual_review || current[id]?.needs_manual_review || [];
    return nmr.some(f => ['leader_name','leader_party','leader_since'].includes(f));
  });
  console.log(`\n[GOV] ─── Still in needs_manual_review ─────────────────────────────`);
  console.log(`  ${needsReview.length} docs still flag leader_name / leader_party / leader_since`);
  console.log(`  These require manual verification when governors change with elections.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[GOV] usGovernorFetcher — ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  console.log(`[GOV] Collection: ${COLLECTION} | Scope: US state docs only\n`);

  const db = getDb();

  console.log('[GOV] Fetching current Firestore state for US docs…');
  const current = await fetchCurrentDocs(db);
  console.log(`[GOV] Docs found: ${Object.keys(current).length}/${US_DOCS.length}`);

  const patches = buildPatches(current);
  console.log(`[GOV] Patches to apply: ${Object.keys(patches).length}`);

  report(patches, current);

  if (WRITE_MODE) {
    if (Object.keys(patches).length === 0) {
      console.log('\n[GOV] Nothing to write — all fields already set.');
      return;
    }
    console.log(`\n[GOV] Writing ${Object.keys(patches).length} patches…`);
    const n = await writePatches(db, patches);
    console.log(`[GOV] ✅ Done — ${n} docs updated.`);
  } else {
    console.log('\n[GOV] DRY RUN — no writes. To apply:');
    console.log('[GOV]   node src/ingestion/usGovernorFetcher.js --write');
  }
}

main().catch(e => { console.error('[GOV] Fatal:', e.message); process.exit(1); });
