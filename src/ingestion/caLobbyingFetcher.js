'use strict';
/**
 * Canadian MP Lobbying Fetcher
 *
 * Downloads the Office of the Commissioner of Lobbying (OCL) bulk
 * communications data from lobbycanada.gc.ca/en/open-data/ and extracts
 * all communication logs where a DPOH (Designated Public Office Holder)
 * matches a current Canadian MP name.
 *
 * Data sources:
 *   Bulk ZIP  — lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip
 *   MP names  — output/corporate_affiliations/CA_coi_*.json (ourcommons.ca)
 *
 * Saves to Firestore: member_lobbying (CA records, category: lobbying_communication)
 */

require('dotenv').config();

const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const AdmZip  = require('adm-zip');
const { parse: csvParse } = require('csv-parse/sync');
const { getDb } = require('../firebase/client');

const COLLECTION   = 'member_lobbying';
const OUTPUT_DIR   = path.resolve(__dirname, '../../output/lobbying');
const BATCH_SIZE   = 200;          // smaller batches to stay under rate limits
const BATCH_DELAY  = 500;          // ms between batch commits
const TIMEOUT_MS   = 120_000;

const ZIP_URL      = 'https://lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip';
const ZIP_CACHE    = path.resolve(__dirname, '../../tmp_communications_ocl_cal.zip');
const COMLOG_BASE  = 'https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/vwCmmLg?comlogId=';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function saveOutput(records) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `CA_lobbying_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), count: records.length, records }, null, 2));
  console.log(`[CA:LOB] Saved ${records.length} records → ${path.basename(file)}`);
}

// ─── Step 1: Load current MP names from COI output ──────────────────────────

function loadMPIndex() {
  const dir = path.resolve(__dirname, '../../output/corporate_affiliations');
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith('CA_coi_') && f.endsWith('.json'))
    .sort();
  if (!files.length) throw new Error('No CA COI output found — run caConflictOfInterestFetcher.js first');

  const latest = path.join(dir, files[files.length - 1]);
  const { records } = JSON.parse(fs.readFileSync(latest, 'utf8'));
  console.log(`[CA:LOB] Loaded ${records.length} current MP names from ${files[files.length - 1]}`);

  // Build lookup: normalizedFullName → { member_name, party, constituency, province }
  const index = new Map();
  for (const mp of records) {
    const key = normalize(mp.member_name);
    index.set(key, {
      member_name:  mp.member_name,
      party:        mp.party,
      constituency: mp.constituency,
      province:     mp.province,
    });
  }
  return index;
}

// ─── Step 2: Download & extract bulk ZIP ────────────────────────────────────

async function downloadZip() {
  if (fs.existsSync(ZIP_CACHE)) {
    const buf = fs.readFileSync(ZIP_CACHE);
    console.log(`[CA:LOB] Using cached ZIP (${(buf.length / 1024 / 1024).toFixed(1)} MB) — ${ZIP_CACHE}`);
    return buf;
  }
  console.log('[CA:LOB] Downloading OCL communications ZIP...');
  const r = await axios.get(ZIP_URL, {
    responseType: 'arraybuffer',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    timeout: TIMEOUT_MS,
  });
  const buf = Buffer.from(r.data);
  fs.writeFileSync(ZIP_CACHE, buf);
  console.log(`[CA:LOB] Downloaded ${(buf.length / 1024 / 1024).toFixed(1)} MB → cached`);
  return buf;
}

// ─── Step 3: Parse CSVs and match MPs ───────────────────────────────────────

function buildRecords(zipBuf, mpIndex) {
  const zip = new AdmZip(zipBuf);

  console.log('[CA:LOB] Parsing subject matter codes...');
  const codesBuf = zip.readFile('Codes_SubjectMatterTypesExport.csv');
  const codeRows = csvParse(codesBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
  const subjectMap = new Map(); // code → english description
  for (const r of codeRows) {
    subjectMap.set(r.SUBJECT_CODE_OBJET, r.SMT_EN_DESC || r.SUBJECT_CODE_OBJET);
  }

  console.log('[CA:LOB] Parsing subject matters...');
  const smBuf = zip.readFile('Communication_SubjectMattersExport.csv');
  const smRows = csvParse(smBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
  const smByComlog = new Map(); // comlogId → [desc, ...]
  for (const r of smRows) {
    const desc = subjectMap.get(r.SUBJECT_CODE_OBJET) || r.CUSTOM_SUBJ_OBJET_PERSO || r.SUBJECT_CODE_OBJET;
    if (!smByComlog.has(r.COMLOG_ID)) smByComlog.set(r.COMLOG_ID, []);
    smByComlog.get(r.COMLOG_ID).push(desc);
  }
  console.log(`[CA:LOB] ${smByComlog.size} communication logs have subject data`);

  console.log('[CA:LOB] Parsing DPOH export (55 MB)...');
  const dpohBuf = zip.readFile('Communication_DpohExport.csv');
  const dpohRows = csvParse(dpohBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
  console.log(`[CA:LOB] ${dpohRows.length} DPOH rows loaded`);

  // Filter DPOH rows to current MPs
  const matchedDpoh = new Map(); // comlogId → { mpInfo, dpohTitle, dpohInstitution }[]
  let matchCount = 0;
  for (const row of dpohRows) {
    const first = (row.DPOH_FIRST_NM_PRENOM_TCPD || '').trim();
    const last  = (row.DPOH_LAST_NM_TCPD || '').trim();
    if (!first || !last) continue;

    const fullName = normalize(`${first} ${last}`);
    if (!mpIndex.has(fullName)) continue;

    const mpInfo = mpIndex.get(fullName);
    matchCount++;

    if (!matchedDpoh.has(row.COMLOG_ID)) matchedDpoh.set(row.COMLOG_ID, []);
    matchedDpoh.get(row.COMLOG_ID).push({
      mpInfo,
      dpoh_title:       row.DPOH_TITLE_TITRE_TCPD || null,
      dpoh_institution: row.INSTITUTION || row.OTHER_INSTITUTION_AUTRE || null,
    });
  }
  console.log(`[CA:LOB] ${matchCount} DPOH rows matched to current MPs across ${matchedDpoh.size} unique communication logs`);

  console.log('[CA:LOB] Parsing Primary export (50 MB)...');
  const primBuf  = zip.readFile('Communication_PrimaryExport.csv');
  const primRows = csvParse(primBuf.toString('utf8'), { columns: true, skip_empty_lines: true });
  console.log(`[CA:LOB] ${primRows.length} primary rows loaded`);

  // Build primary lookup: comlogId → primary row
  const primByComlog = new Map();
  for (const row of primRows) {
    primByComlog.set(row.COMLOG_ID, row);
  }

  // Build final records
  const now = new Date().toISOString();
  const records = [];

  for (const [comlogId, dpohList] of matchedDpoh) {
    const prim = primByComlog.get(comlogId);
    if (!prim) continue;

    const lobbyistFirst = (prim.RGSTRNT_1ST_NM_PRENOM_DCLRNT || '').trim();
    const lobbyistLast  = (prim.RGSTRNT_LAST_NM_DCLRNT || '').trim();
    const lobbyistName  = [lobbyistFirst, lobbyistLast].filter(Boolean).join(' ') || null;
    const clientOrg     = (prim.EN_CLIENT_ORG_CORP_NM_AN || '').replace(/^"(.*)"$/, '$1').trim() || null;
    const meetingDate   = (prim.COMM_DATE || '').trim() || null;
    const subjects      = smByComlog.get(comlogId) || [];
    const subject       = subjects.length ? subjects.join('; ') : null;
    const sourceUrl     = `${COMLOG_BASE}${comlogId}`;

    for (const { mpInfo, dpoh_title, dpoh_institution } of dpohList) {
      const docId = `CA-LOB-${comlogId}-${slugify(mpInfo.member_name)}`;
      records.push({
        id:                docId,
        jurisdiction:      'CA',
        category:          'lobbying_communication',
        status:            'actual',
        member_name:       mpInfo.member_name,
        party:             mpInfo.party,
        constituency:      mpInfo.constituency,
        province:          mpInfo.province,
        dpoh_title,
        dpoh_institution,
        lobbyist_name:     lobbyistName,
        client_organization: clientOrg,
        meeting_date:      meetingDate,
        subject,
        comlog_id:         comlogId,
        source_url:        sourceUrl,
        source_name:       'Office of the Commissioner of Lobbying of Canada — Open Data',
        fetched_at:        now,
      });
    }
  }

  console.log(`[CA:LOB] Built ${records.length} lobbying records for current Canadian MPs`);
  return records;
}

// ─── Step 4: Upsert to Firestore (with resume + throttle) ───────────────────

async function upsertToFirestore(records) {
  const db = getDb();

  // Build set of doc IDs already in Firestore to allow resume
  console.log('[CA:LOB] Checking existing CA-LOB docs in Firestore for resume...');
  const existing = new Set();
  const existingSnap = await db.collection(COLLECTION)
    .where('jurisdiction', '==', 'CA')
    .where('category', '==', 'lobbying_communication')
    .select() // fetch no fields — just doc refs
    .get();
  existingSnap.forEach(doc => existing.add(doc.id));
  console.log(`[CA:LOB] ${existing.size} docs already in Firestore — skipping those`);

  const pending = records.filter(r => !existing.has(r.id));
  console.log(`[CA:LOB] ${pending.length} records remaining to upsert`);

  let upserted = 0;
  const sleep = ms => new Promise(res => setTimeout(res, ms));

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const rec of chunk) {
      const ref = db.collection(COLLECTION).doc(rec.id);
      batch.set(ref, rec, { merge: true });
    }

    await batch.commit();
    upserted += chunk.length;
    if (upserted % 2000 === 0 || upserted === pending.length) {
      console.log(`[CA:LOB] Upserted ${existing.size + upserted}/${records.length}…`);
    }
    if (i + BATCH_SIZE < pending.length) await sleep(BATCH_DELAY);
  }

  const total = existing.size + upserted;
  console.log(`[CA:LOB] Done — ${total} total records in Firestore collection "${COLLECTION}" (${upserted} new this run)`);
  return total;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[CA:LOB] Starting Canadian MP lobbying fetch…');

  const mpIndex = loadMPIndex();
  const zipBuf  = await downloadZip();
  const records = buildRecords(zipBuf, mpIndex);

  if (!records.length) throw new Error('No lobbying records matched current MPs — check MP name normalization');

  saveOutput(records);
  await upsertToFirestore(records);

  console.log('[CA:LOB] Complete.');
  return records.length;
}

main()
  .then(n => { console.log(`[CA:LOB] ${n} records written.`); process.exit(0); })
  .catch(e => { console.error('[CA:LOB] Fatal:', e.message); process.exit(1); });
