'use strict';
/**
 * subnationalOverlayMerge.js
 *
 * Reads ../civic-voice-app/engine/data/subnational-hardcoded-rich-overlay.json
 * Builds merge patches for Firestore collection `subnational_jurisdictions`.
 *
 * Default: DRY RUN — full report, no Firestore writes.
 * Pass --write to commit patches (merge only, no deletes, no nulls).
 *
 * Field mapping per country group:
 *   CA / US  — bio→leader_bio, ltGov*→deputy_leader_*, population_display
 *   AU       — bio→leader_bio, deputy*→deputy_leader_*, legislature.*→legislature_*,
 *              legislature.name→legislatureName
 *   UK       — minimal (nations); leaderBio→leader_bio, leaderSince→leader_since,
 *              regional stats for UK-ENG-* docs
 *
 * Intentionally skipped to avoid precision downgrade:
 *   since / leaderSince for CA and US (Firestore already has ISO leader_since from COI fetcher)
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

const OVERLAY_PATH = path.resolve(__dirname, '../../../civic-voice-app/engine/data/subnational-hardcoded-rich-overlay.json');
const COLLECTION   = 'subnational_jurisdictions';
const BATCH_SIZE   = 200;
const WRITE_MODE   = process.argv.includes('--write');

// ─── Field-value guard ────────────────────────────────────────────────────────
// Returns false for values that must not be written to Firestore.

function isWritable(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') {
    const t = val.trim();
    if (t === '')      return false; // empty string
    if (t.startsWith('—')) return false; // placeholder dash (e.g. "— (Senate President serves)")
    if (t === 'N/A')   return false;
    return true;
  }
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'number') return !Number.isNaN(val);
  if (typeof val === 'boolean') return true;
  return true;
}

function addField(patch, key, val) {
  if (!isWritable(val)) return;
  patch[key] = typeof val === 'string' ? val.trim() : val;
}

// ─── Build patch from one overlay record ─────────────────────────────────────

function buildPatch(docId, rec) {
  const p       = {};
  const country = (rec.country || '').toUpperCase();
  const isUKRegion = docId.startsWith('UK-ENG-');

  // ── Universal: leader bio ──────────────────────────────────────────────────
  addField(p, 'leader_bio', rec.bio || rec.leaderBio || null);

  // ── Population display (CA, AU have it; US overlay also has it) ───────────
  addField(p, 'population_display', rec.population_display || null);

  // ── Canada & US: Lieutenant Governor / deputy fields ──────────────────────
  if (country === 'CA' || country === 'US') {
    addField(p, 'deputy_leader_title', rec.ltGovTitle);
    addField(p, 'deputy_leader_name',  rec.ltGovernor);
    addField(p, 'deputy_leader_party', rec.ltGovParty);
    addField(p, 'deputy_leader_since', rec.ltGovSince);
    addField(p, 'deputy_leader_bio',   rec.ltGovBio);
    // NOTE: rec.since (e.g. "2018") intentionally skipped — Firestore already
    // holds ISO-date leader_since from the COI fetcher; overwriting with a year
    // string would be a precision downgrade.
  }

  // ── Australia: deputy + legislature ───────────────────────────────────────
  if (country === 'AU') {
    addField(p, 'deputy_leader_title',  rec.deputyTitle);
    addField(p, 'deputy_leader_name',   rec.deputy);
    addField(p, 'deputy_leader_party',  rec.deputyParty);
    addField(p, 'deputy_leader_since',  rec.deputySince);
    addField(p, 'deputy_leader_bio',    rec.deputyBio);

    if (rec.legislature) {
      addField(p, 'legislatureName',           rec.legislature.name);
      addField(p, 'legislature_total_seats',   rec.legislature.totalSeats);
      if (Array.isArray(rec.legislature.parties) && rec.legislature.parties.length) {
        p.legislature_party_breakdown = rec.legislature.parties;
      }
    }
  }

  // ── UK devolved nations (UK-SCT, UK-WLS, UK-NIR): flag emoji ─────────────
  if (country === 'UK' && !isUKRegion) {
    addField(p, 'flag', rec.flag);
    // leader_since intentionally skipped — not present in overlay for nations
  }

  // ── UK English regions (UK-ENG-*): full regional stats ───────────────────
  if (isUKRegion) {
    // Only write leader_since if the value is a valid ISO date (YYYY-MM-DD).
    // All current UK-ENG overlay values are "May 2024" / "May 2016" / "" — all excluded.
    const ls = (rec.leaderSince || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(ls)) addField(p, 'leader_since', ls);
    addField(p, 'hasRegionalMayor',  rec.hasRegionalMayor);
    addField(p, 'area',              rec.area);
    addField(p, 'populationRaw',     rec.populationRaw);
    addField(p, 'gdpPerCapita',      rec.gdpPerCapita);
    addField(p, 'gdpTotal',          rec.gdpTotal);
    addField(p, 'unemployment',      rec.unemployment);
    addField(p, 'emoji',             rec.emoji);
    if (Array.isArray(rec.cities)          && rec.cities.length)          p.cities          = rec.cities;
    if (Array.isArray(rec.subMayors)       && rec.subMayors.length)       p.subMayors       = rec.subMayors;
    if (Array.isArray(rec.economicSectors) && rec.economicSectors.length) p.economicSectors = rec.economicSectors;
    if (Array.isArray(rec.keyFacts)        && rec.keyFacts.length)        p.keyFacts        = rec.keyFacts;
    if (Array.isArray(rec.councils)        && rec.councils.length)        p.councils        = rec.councils;
  }

  return Object.keys(p).length ? p : null;
}

// ─── Load overlay ─────────────────────────────────────────────────────────────

function loadOverlay() {
  if (!fs.existsSync(OVERLAY_PATH)) {
    throw new Error(`Overlay not found: ${OVERLAY_PATH}`);
  }
  const raw = JSON.parse(fs.readFileSync(OVERLAY_PATH, 'utf8'));
  // Strip metadata keys
  return Object.fromEntries(
    Object.entries(raw).filter(([k]) => !k.startsWith('_'))
  );
}

// ─── Probe Firestore for existing doc IDs (read-only) ─────────────────────────

async function probeFirestoreIds() {
  const { getDb } = require('../firebase/client');
  const db = getDb();
  const snap = await db.collection(COLLECTION).select().get(); // no fields, just refs
  const ids = new Set();
  snap.forEach(doc => ids.add(doc.id));
  return ids;
}

// ─── Write to Firestore ────────────────────────────────────────────────────────

async function writePatches(patches) {
  const { getDb } = require('../firebase/client');
  const db   = getDb();
  const ids  = Object.keys(patches);
  let written = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const docId of chunk) {
      const ref = db.collection(COLLECTION).doc(docId);
      batch.set(ref, patches[docId], { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`[MERGE] Committed ${written}/${ids.length}…`);
  }
  return written;
}

// ─── Report helpers ───────────────────────────────────────────────────────────

function fieldSummary(patches) {
  const counts = {};
  for (const patch of Object.values(patches)) {
    for (const k of Object.keys(patch)) {
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return counts;
}

function printSamples(patches, firestoreIds, n = 5) {
  const ids = Object.keys(patches).slice(0, n);
  console.log(`\n[MERGE] ─── ${n} Sample Payloads ─────────────────────────────────`);
  for (const docId of ids) {
    const inFS = firestoreIds.has(docId) ? '✅ in Firestore' : '❌ missing from Firestore';
    console.log(`\n  ${docId}  (${inFS})`);
    const patch = patches[docId];
    for (const [k, v] of Object.entries(patch)) {
      let display;
      if (typeof v === 'string') display = v.length > 80 ? v.slice(0, 80) + '…' : v;
      else if (Array.isArray(v)) display = `[Array, ${v.length} items]`;
      else display = String(v);
      console.log(`    ${k.padEnd(30)} ${display}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[MERGE] subnationalOverlayMerge — ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  console.log(`[MERGE] Overlay: ${OVERLAY_PATH}`);
  console.log(`[MERGE] Collection: ${COLLECTION}\n`);

  // 1. Load overlay
  const overlay = loadOverlay();
  const overlayIds = Object.keys(overlay);
  console.log(`[MERGE] Overlay records found: ${overlayIds.length}`);

  // 2. Build patches
  const patches = {};
  const emptyPatches = [];
  for (const [docId, rec] of Object.entries(overlay)) {
    const patch = buildPatch(docId, rec);
    if (patch) patches[docId] = patch;
    else        emptyPatches.push(docId);
  }
  console.log(`[MERGE] Records with non-empty patches: ${Object.keys(patches).length}`);
  if (emptyPatches.length) {
    console.log(`[MERGE] Records with no enrichment fields (skipped): ${emptyPatches.length}`);
    console.log(`         ${emptyPatches.join(', ')}`);
  }

  // 3. Probe Firestore
  console.log('\n[MERGE] Probing Firestore for existing doc IDs…');
  const firestoreIds = await probeFirestoreIds();
  console.log(`[MERGE] Firestore docs found: ${firestoreIds.size}`);

  // 4. Match / missing analysis
  const patchIds    = Object.keys(patches);
  const matched     = patchIds.filter(id => firestoreIds.has(id));
  const missingInFS = patchIds.filter(id => !firestoreIds.has(id));
  const inFSNotOverlay = [...firestoreIds].filter(id => !overlayIds.includes(id));

  console.log(`\n[MERGE] ─── ID Match Report ────────────────────────────────────`);
  console.log(`  Overlay IDs:               ${overlayIds.length}`);
  console.log(`  Firestore IDs:             ${firestoreIds.size}`);
  console.log(`  Patches that match FS:     ${matched.length}  (will be merged)`);
  console.log(`  Patches missing from FS:   ${missingInFS.length}  (would be created — review before --write)`);
  if (missingInFS.length) console.log(`    → ${missingInFS.join(', ')}`);
  console.log(`  In Firestore, not overlay: ${inFSNotOverlay.length}  (untouched)`);
  if (inFSNotOverlay.length) console.log(`    → ${inFSNotOverlay.join(', ')}`);

  // 5. Field summary
  const summary = fieldSummary(patches);
  console.log(`\n[MERGE] ─── Fields That Would Be Written ───────────────────────`);
  const sortedFields = Object.entries(summary).sort((a, b) => b[1] - a[1]);
  for (const [field, count] of sortedFields) {
    const note = '';
    console.log(`  ${field.padEnd(35)} ${String(count).padStart(3)} records${note}`);
  }

  // 6. Sample payloads
  printSamples(patches, firestoreIds);

  // 7. Write or confirm
  if (WRITE_MODE) {
    if (missingInFS.length) {
      console.log(`\n[MERGE] ⚠  ${missingInFS.length} IDs not in Firestore — these will be CREATED as new docs.`);
    }
    console.log(`\n[MERGE] Writing ${Object.keys(patches).length} patches to Firestore…`);
    const n = await writePatches(patches);
    console.log(`[MERGE] ✅ Done — ${n} docs merged.`);
  } else {
    console.log(`\n[MERGE] DRY RUN complete — no writes performed.`);
    console.log(`[MERGE] To apply: node src/ingestion/subnationalOverlayMerge.js --write`);
  }
}

main().catch(e => { console.error('[MERGE] Fatal:', e.message); process.exit(1); });
