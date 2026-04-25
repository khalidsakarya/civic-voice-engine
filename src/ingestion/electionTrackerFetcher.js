'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'weekly';
const COLLECTION_NAME = 'elections';
const OUTPUT_DIR = path.resolve(__dirname, '../../output/elections');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v)  { return (v == null) ? null : String(v).trim() || null; }
function safeNum(v)  {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}
function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ').trim();
}

function saveRecords(jurisdiction, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `elections_${jurisdiction}_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ jurisdiction, fetchedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[elections:${jurisdiction}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

// Lightweight CSV parser (BOM-safe)
function parseCsvToObjects(text) {
  text = text.replace(/^\uFEFF/, '');
  // Skip the header comment line that AEC uses
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  // First line might be a metadata comment (AEC uses this)
  const firstLine = lines[0];
  const isMetaLine = /^\d{4} Federal Election|^\[Event/.test(firstLine);
  const headerLine = isMetaLine ? lines[1] : lines[0];
  const dataStart  = isMetaLine ? 2 : 1;

  const headers = headerLine.split(',').map(h => h.trim());
  const rows = lines.slice(dataStart).map(line => {
    const vals = line.split(',').map(v => v.trim());
    const obj  = {};
    headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
    return obj;
  });
  return { headers, rows };
}

// ─── Canada — elections.ca Official Voting Results (GE45) ─────────────────────

// 45th General Election OVR base path (version 62 = final official results)
const CA_OVR_BASE   = 'https://www.elections.ca/res/rep/off/ovrGE45/62';
const CA_TABLE9_URL = `${CA_OVR_BASE}/table9E.html`;   // party vote % by province
const CA_TABLE11_URL = `${CA_OVR_BASE}/table11E.html`; // elected candidate per riding

// Known party name suffixes as they appear appended to candidate names in table11
const CA_PARTY_SUFFIXES = [
  'NDP-New Democratic Party',
  'Bloc Québécois',
  'Green Party of Canada',
  "People's Party - PPC",
  'Liberal',
  'Conservative',
  'Independent',
  'Animal Protection Party of Canada',
  'Parti Rhinocéros Party',
  'Christian Heritage Party of Canada',
  'Communist Party of Canada',
  'Libertarian Party of Canada',
  'Marxist-Leninist Party of Canada',
  'United Party of Canada (UP)',
  'Canadian Future Party',
  'No Affiliation',
].sort((a, b) => b.length - a.length); // longest first to avoid greedy sub-matches

function extractCAParty(cell) {
  for (const p of CA_PARTY_SUFFIXES) {
    if (cell.endsWith(p)) return p;
  }
  // Fallback substring match
  for (const p of CA_PARTY_SUFFIXES) {
    if (cell.includes(p)) return p;
  }
  return 'Other';
}

function parseTableRows(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let rm;
  while ((rm = rowRe.exec(html)) !== null) {
    const cells = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      cells.push(stripHtml(cm[1]));
    }
    rows.push(cells);
  }
  return rows;
}

async function fetchCanadaElections() {
  const records = [];

  // ── 1. GE45 party vote share (table 9) ───────────────────────────────────
  let partyVoteShare = {};
  try {
    console.log('[elections:CA] Fetching GE45 party vote share (table 9)...');
    const resp = await axios.get(CA_TABLE9_URL, { timeout: 30000 });
    const rows = parseTableRows(resp.data);

    // Data rows: cells[0]=party name, cells[14]=national total %
    for (const cells of rows) {
      if (!cells[0] || cells[0].length < 3) continue;
      if (/^Political affiliation|^Totals/i.test(cells[0])) continue;
      const national = safeNum(cells[14]) ?? safeNum(cells[cells.length - 1]);
      if (national != null && cells[0]) {
        partyVoteShare[cells[0]] = national;
      }
    }
    console.log(`[elections:CA] Vote share parsed for ${Object.keys(partyVoteShare).length} parties`);
  } catch (err) {
    console.warn(`[elections:CA] Table 9 error: ${err.message}`);
  }

  // ── 2. GE45 seats won per party (table 11 — elected candidate per riding) ──
  const seatsByParty = {};
  let totalRidings = 0;
  try {
    console.log('[elections:CA] Fetching GE45 elected candidates per riding (table 11, ~394KB)...');
    const resp = await axios.get(CA_TABLE11_URL, { timeout: 60000 });
    const rows = parseTableRows(resp.data);

    for (const cells of rows) {
      // Row has 12 TDs: Population, Electors, Desks, ValidNo, Valid%, RejNo, Rej%, Total, Turnout%, ElectedCandidate, VotesNo, Votes%
      // The electoral district name is in a TH (not counted in cells), so TD index 9 = elected candidate
      if (cells.length < 10) continue;
      const electedCell = cells[9]; // "LastName, FirstNamePartyName"
      if (!electedCell || electedCell.length < 5) continue;
      if (/^\d/.test(electedCell)) continue; // skip numeric cells

      const party = extractCAParty(electedCell);
      seatsByParty[party] = (seatsByParty[party] || 0) + 1;
      totalRidings++;
    }
    console.log(`[elections:CA] Seats parsed: ${totalRidings} ridings across ${Object.keys(seatsByParty).length} parties`);
  } catch (err) {
    console.warn(`[elections:CA] Table 11 error: ${err.message}`);
  }

  // ── 3. Build GE45 election record ─────────────────────────────────────────
  const majorParties = ['Liberal', 'Conservative', 'NDP-New Democratic Party', 'Bloc Québécois', 'Green Party of Canada', "People's Party - PPC", 'Independent'];
  const results = majorParties
    .filter(p => (seatsByParty[p] || 0) > 0 || (partyVoteShare[p] || 0) >= 1)
    .map(p => ({
      party:          p,
      seats:          seatsByParty[p] || 0,
      vote_share_pct: partyVoteShare[p] || null,
    }))
    .sort((a, b) => b.seats - a.seats);

  // Determine winner
  const winner = results[0];

  records.push({
    id:             'ca-ge-45-2025-04-28',
    jurisdiction:   'CA',
    election_type:  '45th Federal General Election',
    election_date:  '2025-04-28',
    status:         'completed',
    seats_total:    totalRidings || 343,
    winner_party:   winner?.seats > (totalRidings / 2) ? winner?.party + ' (majority)' : winner?.party + ' (minority)',
    results,
    candidates:     null,
    source_url:     'https://www.elections.ca/res/rep/off/ovrGE45/home.html',
    data_note:      'Official Voting Results — Elections Canada',
  });

  // ── 4. Check for upcoming by-elections from the main elections page ────────
  try {
    console.log('[elections:CA] Checking for upcoming by-elections...');
    const resp = await axios.get('https://www.elections.ca/content.aspx?section=ele&document=index&lang=e', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
    });
    const html = resp.data;

    // Look for by-election date mentions
    const byElections = [...html.matchAll(/by-election[^<]{0,100}(\w+ \d{1,2},? \d{4})/gi)]
      .map(m => m[1].trim())
      .filter(Boolean);

    for (const dateStr of byElections.slice(0, 5)) {
      records.push({
        id:            `ca-byelection-${slug(dateStr)}`,
        jurisdiction:  'CA',
        election_type: 'Federal By-Election',
        election_date: dateStr,
        status:        'upcoming',
        seats_total:   1,
        results:       [],
        candidates:    null,
        source_url:    'https://www.elections.ca/content.aspx?section=ele&document=index&lang=e',
      });
    }
  } catch (err) {
    // By-election check is best-effort
  }

  return saveRecords('CA', records);
}

// ─── United States — FEC Campaign Finance API ─────────────────────────────────
// Note: FEC tracks campaign finance and candidate registration, not vote totals.
// Official election results are administered by individual states.

const FEC_BASE = 'https://api.open.fec.gov/v1';
const FEC_KEY  = process.env.FEC_API_KEY || 'DEMO_KEY';

async function fetchUSElections() {
  const records = [];

  // ── 1. 2024 Presidential Election candidates ──────────────────────────────
  try {
    console.log('[elections:US] Fetching 2024 presidential candidates from FEC...');
    const url = `${FEC_BASE}/candidates/totals/?cycle=2024&office=P&sort=-receipts&per_page=10&api_key=${FEC_KEY}`;
    const resp = await axios.get(url, { timeout: 30000 });
    const candidates = (resp.data?.results || []).filter(c => c.party_full && c.receipts > 1_000_000);

    const presidentialCandidates = candidates.slice(0, 10).map(c => ({
      name:         safeStr(c.name),
      party:        safeStr(c.party_full),
      total_raised: c.receipts ?? null,
      disbursements: c.disbursements ?? null,
      incumbent:    c.incumbent_challenge_full || null,
    }));

    records.push({
      id:             'us-presidential-2024',
      jurisdiction:   'US',
      election_type:  'Presidential Election',
      election_date:  '2024-11-05',
      status:         'completed',
      seats_total:    538, // Electoral College votes
      winner_party:   'Republican Party',
      results: [
        { party: 'Republican Party',  candidate: 'Donald Trump',  electoral_votes: 312, popular_vote_pct: 49.8 },
        { party: 'Democratic Party',  candidate: 'Kamala Harris', electoral_votes: 226, popular_vote_pct: 48.3 },
      ],
      candidates:     presidentialCandidates,
      source_url:     'https://www.fec.gov/data/elections/president/2024/',
      data_note:      'Candidate data from FEC; results from National Archives Electoral College.',
    });
    console.log(`[elections:US] 2024 presidential: ${presidentialCandidates.length} candidates loaded`);
  } catch (err) {
    console.warn(`[elections:US] 2024 presidential FEC error: ${err.message}`);
  }

  // ── 2. 2026 Midterm — active Senate and House candidates ─────────────────
  try {
    console.log('[elections:US] Fetching 2026 midterm Senate candidates from FEC...');
    const senateUrl = `${FEC_BASE}/candidates/?cycle=2026&office=S&has_raised_funds=true&sort=-receipts&per_page=10&api_key=${FEC_KEY}`;
    const senateResp = await axios.get(senateUrl, { timeout: 30000 });
    const senateCandidates = (senateResp.data?.results || []).map(c => ({
      name:   safeStr(c.name),
      party:  safeStr(c.party_full || c.party),
      state:  safeStr(c.state),
      office: 'Senate',
    }));

    records.push({
      id:             'us-midterm-senate-2026',
      jurisdiction:   'US',
      election_type:  'Senate Midterm Election',
      election_date:  '2026-11-03',
      status:         'upcoming',
      seats_total:    34, // Senate seats up for election in 2026
      winner_party:   null,
      results:        [],
      candidates:     senateCandidates,
      source_url:     'https://www.fec.gov/data/elections/?cycle=2026&office=S',
      data_note:      'Candidate registration data from FEC — campaign ongoing.',
    });

    console.log(`[elections:US] 2026 Senate midterm: ${senateCandidates.length} active candidates`);
  } catch (err) {
    console.warn(`[elections:US] 2026 Senate FEC error: ${err.message}`);
  }

  try {
    console.log('[elections:US] Fetching 2026 midterm House candidates from FEC...');
    const houseUrl = `${FEC_BASE}/candidates/?cycle=2026&office=H&has_raised_funds=true&sort=-receipts&per_page=10&api_key=${FEC_KEY}`;
    const houseResp = await axios.get(houseUrl, { timeout: 30000 });
    const houseCandidates = (houseResp.data?.results || []).map(c => ({
      name:   safeStr(c.name),
      party:  safeStr(c.party_full || c.party),
      state:  safeStr(c.state),
      district: safeStr(c.district),
      office: 'House',
    }));

    records.push({
      id:             'us-midterm-house-2026',
      jurisdiction:   'US',
      election_type:  'House of Representatives Midterm Election',
      election_date:  '2026-11-03',
      status:         'upcoming',
      seats_total:    435,
      winner_party:   null,
      results:        [],
      candidates:     houseCandidates,
      source_url:     'https://www.fec.gov/data/elections/?cycle=2026&office=H',
      data_note:      'Candidate registration data from FEC — campaign ongoing.',
    });
    console.log(`[elections:US] 2026 House midterm: ${houseCandidates.length} active candidates`);
  } catch (err) {
    console.warn(`[elections:US] 2026 House FEC error: ${err.message}`);
  }

  return saveRecords('US', records);
}

// ─── United Kingdom — Democracy Club API ─────────────────────────────────────
// Note: electoralcommission.org.uk is Cloudflare-protected. Democracy Club
// (candidates.democracyclub.org.uk) is the canonical open UK elections API,
// used by media organisations and government bodies. It sources official data
// from returning officers and the Electoral Commission.

const DC_BASE = 'https://candidates.democracyclub.org.uk/api/next';

// Hardcoded GE2024 national result (final, official) — avoids 650 API calls
const UK_GE2024_NATIONAL = [
  { party: 'Labour Party',                   seats: 412, vote_share_pct: 33.7 },
  { party: 'Conservative Party',             seats: 121, vote_share_pct: 23.7 },
  { party: 'Liberal Democrats',              seats:  72, vote_share_pct: 12.2 },
  { party: 'Scottish National Party',        seats:   9, vote_share_pct:  2.5 },
  { party: 'Sinn Féin',                      seats:   7, vote_share_pct:  0.7 },
  { party: 'Reform UK',                      seats:   5, vote_share_pct: 14.3 },
  { party: 'Green Party',                    seats:   4, vote_share_pct:  6.7 },
  { party: 'Plaid Cymru',                    seats:   4, vote_share_pct:  0.7 },
  { party: 'Democratic Unionist Party',      seats:   5, vote_share_pct:  0.6 },
  { party: 'Independent',                    seats:   6, vote_share_pct:  1.7 },
];

async function fetchUKElections() {
  const records = [];

  // ── 1. 2024 UK General Election (final results) ───────────────────────────
  records.push({
    id:             'uk-parl-ge-2024-07-04',
    jurisdiction:   'UK',
    election_type:  'UK Parliamentary General Election',
    election_date:  '2024-07-04',
    status:         'completed',
    seats_total:    650,
    winner_party:   'Labour Party (majority)',
    results:        UK_GE2024_NATIONAL,
    candidates:     null,
    source_url:     'https://candidates.democracyclub.org.uk/api/next/elections/parl.2024-07-04/',
    data_note:      'National seat and vote share totals — Official results via Democracy Club / Electoral Commission.',
  });

  // ── 2. Upcoming elections (Democracy Club current elections API) ───────────
  try {
    console.log('[elections:UK] Fetching upcoming UK elections from Democracy Club...');
    const resp = await axios.get(`${DC_BASE}/elections/?current=true&limit=50`, { timeout: 30000 });
    const elections = resp.data?.results || [];

    // Filter to significant elections (Parliamentary, devolved assemblies, Mayoral)
    const significant = elections.filter(e => {
      const name = (e.name || '').toLowerCase();
      return /parliament|assembly|senedd|mayor of london|mayor of|police and crime|combined authority/i.test(name);
    });

    for (const election of significant) {
      const eid = safeStr(election.election_id || election.slug);
      if (!eid) continue;

      records.push({
        id:             `uk-${slug(eid)}`,
        jurisdiction:   'UK',
        election_type:  safeStr(election.name),
        election_date:  safeStr(election.election_date),
        status:         'upcoming',
        seats_total:    election.seats_contested ?? null,
        winner_party:   null,
        results:        [],
        candidates:     null,
        source_url:     `https://candidates.democracyclub.org.uk/elections/${eid}/`,
        data_note:      'Election data via Democracy Club / Electoral Commission.',
      });
    }
    console.log(`[elections:UK] Upcoming elections: ${significant.length} significant elections`);
  } catch (err) {
    console.warn(`[elections:UK] Democracy Club upcoming elections error: ${err.message}`);
  }

  return saveRecords('UK', records);
}

// ─── Australia — AEC Official Results (2025 Federal Election) ─────────────────

const AEC_EVENT_ID  = 31496; // 2025 FE (Final Results)
const AEC_BASE      = `https://results.aec.gov.au/${AEC_EVENT_ID}/Website/Downloads`;
const AEC_PARTY_CSV = `${AEC_BASE}/HousePartyRepresentationLeadingDownload-${AEC_EVENT_ID}.csv`;
const AEC_PREFS_CSV = `${AEC_BASE}/HouseFirstPrefsByPartyDownload-${AEC_EVENT_ID}.csv`;

async function fetchAUElections() {
  const records = [];
  const partySeats = {};
  const partyVotes = {};

  // ── 1. Party seat representation CSV ─────────────────────────────────────
  try {
    console.log('[elections:AU] Fetching AEC party representation CSV...');
    const resp = await axios.get(AEC_PARTY_CSV, { timeout: 30000, responseType: 'arraybuffer' });
    const text = Buffer.from(resp.data).toString('utf8');
    const { rows } = parseCsvToObjects(text);

    for (const row of rows) {
      const party   = safeStr(row['Party']);
      const national = safeNum(row['National']);
      if (!party || national == null) continue;
      partySeats[party] = national;
    }
    console.log(`[elections:AU] Party seats: ${Object.keys(partySeats).length} parties`);
  } catch (err) {
    console.warn(`[elections:AU] Party representation CSV error: ${err.message}`);
  }

  // ── 2. National first preferences CSV ────────────────────────────────────
  try {
    console.log('[elections:AU] Fetching AEC national first preferences CSV...');
    const resp = await axios.get(AEC_PREFS_CSV, { timeout: 30000, responseType: 'arraybuffer' });
    const text = Buffer.from(resp.data).toString('utf8');
    const { rows } = parseCsvToObjects(text);

    for (const row of rows) {
      const partyAb  = safeStr(row['PartyAb']);
      const partyNm  = safeStr(row['PartyNm']);
      const totalPct = safeNum(row['TotalPercentage']);
      const totalVotes = safeNum(row['TotalVotes']);
      const elected  = safeNum(row['Elected']);
      const key = partyNm || partyAb;
      if (!key) continue;
      partyVotes[key] = { pct: totalPct, votes: totalVotes, elected };
    }
    console.log(`[elections:AU] First preferences: ${Object.keys(partyVotes).length} parties`);
  } catch (err) {
    console.warn(`[elections:AU] First preferences CSV error: ${err.message}`);
  }

  // ── 3. Build 2025 FE result record ───────────────────────────────────────
  const allParties = new Set([...Object.keys(partySeats), ...Object.keys(partyVotes)]);
  const results = [];
  for (const party of allParties) {
    const seats        = partySeats[party] ?? partyVotes[party]?.elected ?? 0;
    const vote_share   = partyVotes[party]?.pct ?? null;
    const votes        = partyVotes[party]?.votes ?? null;
    if (seats === 0 && (vote_share == null || vote_share < 0.5)) continue;
    results.push({ party, seats, votes, vote_share_pct: vote_share });
  }
  results.sort((a, b) => b.seats - a.seats);

  const totalSeats = results.reduce((s, r) => s + (r.seats || 0), 0);
  const winner     = results[0];

  records.push({
    id:             'au-fe-2025-05-03',
    jurisdiction:   'AU',
    election_type:  '2025 Australian Federal Election (House of Representatives)',
    election_date:  '2025-05-03',
    status:         'completed',
    seats_total:    151,
    winner_party:   winner && winner.seats > 75 ? `${winner.party} (majority)` : `${winner?.party} (minority)`,
    results,
    candidates:     null,
    source_url:     `https://results.aec.gov.au/${AEC_EVENT_ID}/Website/HouseDefault-${AEC_EVENT_ID}.htm`,
    data_note:      'Official results — Australian Electoral Commission. Final results phase.',
  });
  console.log(`[elections:AU] 2025 FE built: ${results.length} parties, ${totalSeats} seats counted`);

  // ── 4. Check AEC for upcoming elections ──────────────────────────────────
  try {
    const resp = await axios.get('https://www.aec.gov.au/Elections/', {
      timeout: 20000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
    });
    const html = resp.data;
    const upcoming = [...html.matchAll(/(?:by-election|election)[^<]{0,100}(\d{1,2}\s+\w+\s+\d{4})/gi)]
      .map(m => m[1].trim()).filter(Boolean);

    for (const dateStr of upcoming.slice(0, 3)) {
      records.push({
        id:             `au-upcoming-${slug(dateStr)}`,
        jurisdiction:   'AU',
        election_type:  'Federal By-Election',
        election_date:  dateStr,
        status:         'upcoming',
        seats_total:    1,
        winner_party:   null,
        results:        [],
        candidates:     null,
        source_url:     'https://www.aec.gov.au/Elections/',
      });
    }
  } catch { /* best-effort */ }

  return saveRecords('AU', records);
}

// ─── Upcoming election detection (used by daily scheduler guard) ──────────────

/**
 * Returns true if any election in the latest output files is within 90 days.
 * Used by the daily scheduler to decide whether to run election refresh.
 */
function hasUpcomingElection() {
  if (!fs.existsSync(OUTPUT_DIR)) return false;
  const files = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  if (!files.length) return false;

  const now      = Date.now();
  const ninetyD  = 90 * 24 * 60 * 60 * 1000;

  for (const file of files.slice(0, 8)) { // check most recent per-jurisdiction files
    try {
      const { records } = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, file)));
      for (const r of (records || [])) {
        if (r.status !== 'upcoming') continue;
        const d = new Date(r.election_date).getTime();
        if (!isNaN(d) && d > now && d - now < ninetyD) return true;
      }
    } catch { /* skip corrupt files */ }
  }
  return false;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllElections() {
  const _ts = new Date().toISOString();
  console.log('\n[elections] Starting election tracker fetch (CA / US / UK / AU)...');
  const results = await Promise.allSettled([
    fetchCanadaElections(),
    fetchUSElections(),
    fetchUKElections(),
    fetchAUElections(),
  ]);

  const jurisdictions = ['CA', 'US', 'UK', 'AU'];
  const sources = [
    'https://elections.ca',
    'https://fec.gov',
    'https://electoralcommission.org.uk',
    'https://aec.gov.au',
  ];
  const counts = results.map(r => r.status === 'fulfilled' ? r.value : 0);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: jurisdictions[i], data_pull_timestamp: _ts, source_endpoint: sources[i], record_count: counts[i], import_status: 'success', scheduler_tier: SCHEDULER_TIER });
    } else {
      await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: jurisdictions[i], data_pull_timestamp: _ts, source_endpoint: sources[i], record_count: 0, import_status: 'failed', error_message: r.reason?.message || String(r.reason), scheduler_tier: SCHEDULER_TIER });
    }
  }

  const [ca, us, uk, au] = counts;
  const total = ca + us + uk + au;
  console.log(`\n[elections] Done — CA:${ca} US:${us} UK:${uk} AU:${au} (total: ${total})`);
  return total;
}

module.exports = {
  fetchAllElections,
  fetchCanadaElections,
  fetchUSElections,
  fetchUKElections,
  fetchAUElections,
  hasUpcomingElection,
};

if (require.main === module) {
  fetchAllElections()
    .then(n => { console.log(`\n[elections] ${n} total records saved.`); process.exit(0); })
    .catch(err => { console.error('[elections] Fatal:', err.message); process.exit(1); });
}
