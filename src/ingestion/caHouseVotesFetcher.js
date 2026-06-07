'use strict';
/**
 * Canadian House of Commons Votes + Attendance Fetcher
 *
 * Sources (all public, no auth):
 *   Bulk vote list  — ourcommons.ca/Members/en/votes/xml?parliament={P}&session={S}
 *   Per-vote detail — ourcommons.ca/Members/en/votes/{P}/{S}/{N}/xml
 *
 * Writes to Firestore:
 *   member_attendance  — one doc per MP, CA House, with percentage/votesParticipated/totalVotes
 *   member_votes       — one doc per MP, CA House, with nested votes[] array
 */

require('dotenv').config();

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { getDb } = require('../firebase/client');

const PARLIAMENT = 45;
const SESSION    = 1;
const BATCH_SIZE = 200;
const TIMEOUT_MS = 15_000;
const DELAY_MS   = 200; // polite delay between vote XML requests

const OUTPUT_DIR = path.resolve(__dirname, '../../output/ca_house_votes');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'CivicVoiceEngine/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        else resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── XML helpers ─────────────────────────────────────────────────────────────

function tag(xml, tagName) {
  const m = xml.match(new RegExp(`<${tagName}>([^<]*)</${tagName}>`));
  return m ? m[1].trim() : '';
}

function allElements(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, 'g'))].map(m => m[1]);
}

// ─── Step 1: Fetch all vote numbers for the parliament/session ────────────────

async function fetchVoteNumbers() {
  const url = `https://www.ourcommons.ca/Members/en/votes/xml?parliament=${PARLIAMENT}&session=${SESSION}`;
  console.log(`[CA:House:votes] Fetching vote list for parliament ${PARLIAMENT} session ${SESSION}…`);
  const xml = await httpsGet(url);
  const voteNumbers = allElements(xml, 'Vote')
    .map(v => tag(v, 'DecisionDivisionNumber'))
    .filter(n => n && n !== '0')
    .map(n => parseInt(n, 10))
    .filter(n => !isNaN(n));
  console.log(`[CA:House:votes] Found ${voteNumbers.length} votes.`);
  return voteNumbers;
}

// ─── Step 2: Fetch per-vote participant XML and aggregate per member ──────────

async function aggregateMemberVotes(voteNumbers) {
  // memberMap: { personId -> { name, party, constituency, province, yea, nay, paired, notVoting, votes[] } }
  const memberMap = new Map();

  for (let i = 0; i < voteNumbers.length; i++) {
    const voteNum = voteNumbers[i];
    const url = `https://www.ourcommons.ca/Members/en/votes/${PARLIAMENT}/${SESSION}/${voteNum}/xml`;
    try {
      const xml = await httpsGet(url);
      const participants = allElements(xml, 'VoteParticipant');

      // Extract vote metadata once (same for all participants)
      const firstP    = participants[0] || '';
      const voteDate  = tag(firstP, 'DecisionEventDateTime').split('T')[0] || '';
      const subject   = tag(firstP, 'DecisionDivisionSubject') || '';
      const result    = tag(firstP, 'DecisionResultName') || '';

      for (const p of participants) {
        const personId   = tag(p, 'PersonId');
        const firstName  = tag(p, 'PersonOfficialFirstName');
        const lastName   = tag(p, 'PersonOfficialLastName');
        const ballot     = tag(p, 'VoteValueName'); // Yea | Nay | Paired | Not Voting
        const party      = tag(p, 'CaucusShortName');
        const const_     = tag(p, 'ConstituencyName');
        const province   = tag(p, 'ConstituencyProvinceTerritoryName');
        const fullName   = `${firstName} ${lastName}`.trim();

        if (!personId || !fullName) continue;

        if (!memberMap.has(personId)) {
          memberMap.set(personId, {
            personId, name: fullName, party, constituency: const_, province,
            yea: 0, nay: 0, paired: 0, notVoting: 0, total: 0, votes: [],
          });
        }
        const m = memberMap.get(personId);
        m.total += 1;
        if (ballot === 'Yea')        m.yea        += 1;
        else if (ballot === 'Nay')   m.nay        += 1;
        else if (ballot === 'Paired') m.paired     += 1;
        else                          m.notVoting  += 1;

        m.votes.push({
          vote_number: voteNum,
          ballot,
          description: subject,
          date:        voteDate,
          result,
        });
      }

      if ((i + 1) % 10 === 0 || i === voteNumbers.length - 1) {
        console.log(`[CA:House:votes] Processed ${i + 1}/${voteNumbers.length} votes (${memberMap.size} members so far)`);
      }

      await delay(DELAY_MS);
    } catch (err) {
      console.warn(`[CA:House:votes] Skipping vote ${voteNum}: ${err.message}`);
    }
  }

  return memberMap;
}

// ─── Step 3: Build Firestore records ─────────────────────────────────────────

function buildRecords(memberMap) {
  const now = new Date().toISOString();
  const attendanceRecords = [];
  const voteRecords       = [];

  for (const m of memberMap.values()) {
    const participated = m.yea + m.nay + m.paired;
    const percentage   = m.total > 0 ? Math.round((participated / m.total) * 100) : 0;

    attendanceRecords.push({
      id:               `CA-HOUSE-ATT-${m.personId}`,
      member_name:      m.name,
      person_id:        m.personId,
      jurisdiction:     'CA',
      chamber:          'House',
      parliament:       PARLIAMENT,
      session:          SESSION,
      party:            m.party,
      constituency:     m.constituency,
      province:         m.province,
      totalVotes:       m.total,
      votesParticipated: participated,
      votesYea:         m.yea,
      votesNay:         m.nay,
      votesPaired:      m.paired,
      votesNotVoting:   m.notVoting,
      percentage,
      source_name:      'House of Commons of Canada — ourcommons.ca',
      last_updated:     now,
    });

    voteRecords.push({
      id:           `CA-HOUSE-VOTES-${m.personId}`,
      member_name:  m.name,
      person_id:    m.personId,
      jurisdiction: 'CA',
      chamber:      'House',
      parliament:   PARLIAMENT,
      session:      SESSION,
      party:        m.party,
      constituency: m.constituency,
      province:     m.province,
      votes:        m.votes, // nested array of individual ballots
      source_name:  'House of Commons of Canada — ourcommons.ca',
      last_updated: now,
    });
  }

  return { attendanceRecords, voteRecords };
}

// ─── Step 4: Write to Firestore ───────────────────────────────────────────────

async function upsertToFirestore(records, collectionName) {
  const db = getDb();
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const r of chunk) {
      const ref = db.collection(collectionName).doc(r.id);
      batch.set(ref, r, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  console.log(`[CA:House:votes] ${collectionName}: ${written} docs upserted`);
  return written;
}

// ─── Step 5: Save local JSON output ──────────────────────────────────────────

function saveOutput(attendanceRecords, voteRecords) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const attFile  = path.join(OUTPUT_DIR, `CA_house_attendance_${ts}.json`);
  const votesFile = path.join(OUTPUT_DIR, `CA_house_votes_${ts}.json`);
  fs.writeFileSync(attFile, JSON.stringify({ generatedAt: new Date().toISOString(), records: attendanceRecords }, null, 2));
  fs.writeFileSync(votesFile, JSON.stringify({ generatedAt: new Date().toISOString(), records: voteRecords }, null, 2));
  console.log(`[CA:House:votes] Saved output → ${path.basename(attFile)}, ${path.basename(votesFile)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[CA:House:votes] Starting House of Commons votes + attendance fetch…');
  const voteNumbers = await fetchVoteNumbers();
  if (!voteNumbers.length) throw new Error('No votes found — check parliament/session numbers');

  const memberMap = await aggregateMemberVotes(voteNumbers);
  console.log(`[CA:House:votes] Aggregated data for ${memberMap.size} MPs`);

  const { attendanceRecords, voteRecords } = buildRecords(memberMap);
  saveOutput(attendanceRecords, voteRecords);

  await upsertToFirestore(attendanceRecords, 'member_attendance');
  await upsertToFirestore(voteRecords, 'member_votes');

  console.log(`[CA:House:votes] Complete — ${attendanceRecords.length} MPs processed`);
  return attendanceRecords.length;
}

if (require.main === module) {
  main()
    .then(n => { console.log(`[CA:House:votes] Done — ${n} MPs.`); process.exit(0); })
    .catch(e => { console.error('[CA:House:votes] Fatal:', e.message); process.exit(1); });
}

module.exports = { fetchCaHouseVotes: main };
