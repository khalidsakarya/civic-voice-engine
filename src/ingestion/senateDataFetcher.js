'use strict';
/**
 * Canadian Senate Data Fetcher
 *
 * Fetches real data from official Senate of Canada sources:
 *   - Voting History  → sencanada.ca/en/in-the-chamber/votes/ (HTML scrape)
 *   - Attendance      → derived from vote participation records
 *   - Expenditures    → sencanada.ca quarterly expense reports (HTML scrape)
 *
 * All data comes directly from sencanada.ca — official Government of Canada website.
 *
 * Run:  node src/ingestion/senateDataFetcher.js
 */

require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html, */*',
};

const BASE    = 'https://sencanada.ca';
const SESSION = '45-1'; // Current session — update when session changes

// ── Step 1: Get list of all recent votes ─────────────────────────────────────

async function fetchVoteList(limit = 30) {
  console.log(`[Senate] Fetching vote list for session ${SESSION}...`);
  const r = await axios.get(`${BASE}/en/in-the-chamber/votes/${SESSION}`, { headers: HEADERS, timeout: 20000 });
  const html = r.data;

  // Extract vote detail links: /en/in-the-chamber/votes/details/{voteId}/{session}
  const voteLinks = [...new Set(
    [...html.matchAll(/\/en\/in-the-chamber\/votes\/details\/(\d+)\/(\d+-\d+)/g)]
      .map(m => ({ id: m[1], session: m[2], url: `/en/in-the-chamber/votes/details/${m[1]}/${m[2]}` }))
      .filter(v => v.session === SESSION)
  )].slice(0, limit);

  console.log(`[Senate] Found ${voteLinks.length} votes in session ${SESSION}`);
  return voteLinks;
}

// ── Step 2: Parse individual vote detail page ─────────────────────────────────

async function fetchVoteDetail(voteInfo) {
  const r = await axios.get(`${BASE}${voteInfo.url}`, { headers: HEADERS, timeout: 20000 });
  const html = r.data;

  // Title
  const titleMatch = html.match(/<title>Vote Details:\s*([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/&#x2013;/g, '–').replace(/&#x2019;/g, "'").trim() : `Vote ${voteInfo.id}`;

  // Date
  const dateMatch = html.match(/(\w+\s+\d+,\s*\d{4})/);
  const date = dateMatch ? new Date(dateMatch[1]).toISOString().slice(0, 10) : '';

  // Result (Adopted/Negatived)
  const resultMatch = html.match(/class="vote-result[^"]*"[^>]*>\s*([^<]+)/i)
    || html.match(/(Adopted|Negatived|Tied)/i);
  const result = resultMatch ? resultMatch[1].trim() : '';

  // Yea / Nay totals
  const yeaTotalMatch = html.match(/Yeas[^:]*:\s*(\d+)/i) || html.match(/<td[^>]*class="[^"]*yea[^"]*"[^>]*>\s*(\d+)/i);
  const nayTotalMatch = html.match(/Nays[^:]*:\s*(\d+)/i) || html.match(/<td[^>]*class="[^"]*nay[^"]*"[^>]*>\s*(\d+)/i);
  const yeaTotal = yeaTotalMatch ? parseInt(yeaTotalMatch[1]) : null;
  const nayTotal = nayTotalMatch ? parseInt(nayTotalMatch[1]) : null;

  // Individual senator votes — parse table rows
  // Table columns: Senator | Affiliation | Province | Yea | Nay | Abstain | Paired
  const rows = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    // Must contain a senator link
    const senatorLink = rowHtml.match(/href="[^"]*\/votes\/senator\/(\d+)[^"]*"[^>]*>([^<]+)<\/a>/);
    if (!senatorLink) continue;

    const rawSenatorName = senatorLink[2].trim(); // "LastName, FirstName" format, may have HTML entities
    // Decode HTML entities (e.g. &#xC9; → É, &#xE9; → é)
    const senatorName = rawSenatorName.replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const nameParts   = senatorName.split(',').map(s => s.trim());
    const fullName    = nameParts.length >= 2 ? `${nameParts[1]} ${nameParts[0]}` : senatorName;

    // Extract cells
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
      m[1].replace(/<[^>]+>/g, '').trim()
    );

    // Determine vote: check which column has a checkmark or value
    // Columns after senator name: Affiliation, Province, Yea, Nay, Abstain
    const hasYea     = rowHtml.match(/class="[^"]*vote-yea[^"]*"[^>]*>(?:<[^>]+>)*✓|class="[^"]*yea[^"]*"[^>]*>\s*(?:<[^>]+>)*\s*(?:✓|1|Yes)/i);
    const hasNay     = rowHtml.match(/class="[^"]*vote-nay[^"]*"[^>]*>(?:<[^>]+>)*✓|class="[^"]*nay[^"]*"[^>]*>\s*(?:<[^>]+>)*\s*(?:✓|1|Yes)/i);
    const hasAbstain = rowHtml.match(/class="[^"]*abstention[^"]*"[^>]*>(?:<[^>]+>)*✓/i);

    // Simpler: find the cell with class yea/nay/abstention that has content
    const yeaCell     = rowHtml.match(/class="[^"]*vote-yea[^"]*"[^>]*>([^<]*(?:<(?!\/td)[^>]*>[^<]*)*)/i)?.[1]?.replace(/<[^>]+>/g,'').trim();
    const nayCell     = rowHtml.match(/class="[^"]*vote-nay[^"]*"[^>]*>([^<]*(?:<(?!\/td)[^>]*>[^<]*)*)/i)?.[1]?.replace(/<[^>]+>/g,'').trim();
    const abstainCell = rowHtml.match(/class="[^"]*vote-abstention[^"]*"[^>]*>([^<]*(?:<(?!\/td)[^>]*>[^<]*)*)/i)?.[1]?.replace(/<[^>]+>/g,'').trim();

    let ballot = 'Not Voting';
    if (yeaCell && yeaCell.length > 0 && yeaCell !== ' ') ballot = 'Yea';
    else if (nayCell && nayCell.length > 0 && nayCell !== ' ') ballot = 'Nay';
    else if (abstainCell && abstainCell.length > 0 && abstainCell !== ' ') ballot = 'Abstain';

    rows.push({ senator: fullName, ballot });
  }

  return { id: voteInfo.id, session: SESSION, title, date, result, yeaTotal, nayTotal, senators: rows };
}

// ── Step 3: Build per-senator voting records ──────────────────────────────────

function buildSenatorVoteRecords(votes) {
  const byName = new Map();

  for (const vote of votes) {
    for (const { senator, ballot } of vote.senators) {
      if (!byName.has(senator)) byName.set(senator, []);
      byName.get(senator).push({
        vote_id:     vote.id,
        session:     vote.session,
        title:       vote.title,
        date:        vote.date,
        result:      vote.result,
        ballot,
        source_url:  `${BASE}/en/in-the-chamber/votes/details/${vote.id}/${vote.session}`,
        source_name: 'Senate of Canada — sencanada.ca',
      });
    }
  }

  return byName;
}

// ── Step 4: Calculate attendance from vote participation ──────────────────────

function buildAttendance(votes, senatorVotes) {
  const totalVotes = votes.length;
  const attendance = new Map();

  for (const [senator, records] of senatorVotes) {
    const participated = records.filter(r => r.ballot !== 'Not Voting' && r.ballot !== '').length;
    const pct = totalVotes > 0 ? Math.round((participated / totalVotes) * 100) : 0;
    attendance.set(senator, {
      senator,
      totalVotes,
      votesParticipated: participated,
      percentage: pct,
      source_name: 'Senate of Canada — sencanada.ca',
    });
  }

  return attendance;
}

// ── Step 5: Upload to Firestore ───────────────────────────────────────────────

async function uploadToFirestore(senatorVotes, attendance) {
  const db = getDb();
  let uploaded = 0;

  console.log(`\n[Senate] Uploading voting records for ${senatorVotes.size} senators...`);

  for (const [senator, records] of senatorVotes) {
    if (records.length === 0) continue;
    const docId = 'CA-SEN-' + senator.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    await db.collection('member_votes').doc(docId).set({
      member_name:  senator,
      jurisdiction: 'CA',
      chamber:      'Senate',
      votes:        records,
      last_updated: new Date().toISOString(),
      source_name:  'Senate of Canada — sencanada.ca',
    }, { merge: true });

    // Attendance
    const att = attendance.get(senator);
    if (att) {
      await db.collection('member_attendance').doc(docId).set({
        member_name:       senator,
        jurisdiction:      'CA',
        chamber:           'Senate',
        percentage:        att.percentage,
        votesParticipated: att.votesParticipated,
        totalVotes:        att.totalVotes,
        last_updated:      new Date().toISOString(),
        source_name:       'Senate of Canada — sencanada.ca',
      }, { merge: true });
    }

    uploaded++;
    if (uploaded % 20 === 0) process.stdout.write(`  ${uploaded}/${senatorVotes.size}...\n`);
  }

  console.log(`[Senate] Done — ${uploaded} senators uploaded to Firestore`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🏛️  Canadian Senate Data Fetcher');
  console.log('   Source: sencanada.ca (official Government of Canada)\n');

  // 1. Get vote list
  const voteList = await fetchVoteList(20); // fetch last 20 votes
  if (voteList.length === 0) throw new Error('No votes found for current session');

  // 2. Fetch each vote detail (with delay to be respectful)
  const votes = [];
  for (let i = 0; i < voteList.length; i++) {
    const v = voteList[i];
    process.stdout.write(`  [${i + 1}/${voteList.length}] Vote ${v.id}... `);
    try {
      const detail = await fetchVoteDetail(v);
      votes.push(detail);
      console.log(`✅ "${detail.title.slice(0, 50)}" — ${detail.senators.length} senators`);
    } catch (e) {
      console.log(`❌ ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1000)); // 1s between requests
  }

  console.log(`\n[Senate] Parsed ${votes.length} votes`);

  // 3. Build per-senator records
  const senatorVotes = buildSenatorVoteRecords(votes);
  const attendance   = buildAttendance(votes, senatorVotes);

  console.log(`[Senate] Built records for ${senatorVotes.size} unique senators`);

  // 4. Show sample
  const [sampleName, sampleVotes] = [...senatorVotes][0] || [];
  if (sampleVotes) {
    console.log(`\n  Sample — ${sampleName}:`);
    sampleVotes.slice(0, 3).forEach(v => console.log(`    ${v.date} | ${v.ballot} | ${v.title.slice(0, 50)}`));
  }

  // 5. Upload
  await uploadToFirestore(senatorVotes, attendance);

  console.log('\n✅ Senate voting and attendance data is now live in Firestore\n');
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error('\n❌ Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { fetchCaSenatevotes: run };
