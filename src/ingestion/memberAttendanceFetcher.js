/**
 * Member Attendance Fetcher — Civic Voice Engine
 *
 * Computes attendance_pct (votes participated / total votes held) for each MP
 * from three official government sources and writes one Firestore document per
 * member with their participation rate, raw counts, and period metadata.
 *
 * Sources & methodology
 * ─────────────────────────────────────────────────────────────────────────────
 * CA   openparliament.ca/api/
 *      1. GET /votes/?session=45-1&limit=200 → all 94 votes in current session
 *      2. GET /votes/ballots/?vote={url}&limit=350 for each vote → every MP who
 *         voted (Yes / No / Paired)
 *      3. Aggregate: per-MP voted count / 94 = attendance_pct
 *      Enriched with name/party/riding from GET /politicians/?current=true
 *
 * US   clerk.house.gov/evs/{year}/
 *      1. Parse HTML index → highest roll-call number (= total rolls this year)
 *      2. Fetch the US_ROLLS_SAMPLE most recent roll-call XML files
 *      3. Parse <recorded-vote> elements; "Not Voting" = absent
 *      4. attendance_pct = (voted yes|no|present in sample) / sample_size × 100
 *      Stores sample_size and total_rolls_in_year for transparency.
 *
 * UK   members-api.parliament.uk / commonsvotes-api.parliament.uk
 *      1. Count total divisions in the calendar year by paginating the divisions
 *         search (25/page cap) → total_divisions
 *      2. For each of UK_MP_TARGET current Commons MPs, GET /Members/{id}/Voting
 *         (paginated) and count records whose date falls in the current year
 *      3. attendance_pct = year_votes / total_divisions × 100
 *
 * Output: output/member_attendance/{source}_{timestamp}.json
 * Firestore: member_attendance collection
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'weekly';
const COLLECTION_NAME = 'member_attendance';
const OUTPUT_DIR    = path.resolve(__dirname, '../../output/member_attendance');
const TIMEOUT_MS    = 45_000;
const CURRENT_YEAR  = new Date().getFullYear();

// ─── Shared helpers ───────────────────────────────────────────────────────────

const safeStr  = v => (v != null ? String(v).trim().slice(0, 500) || null : null);
const safeNum  = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const round1   = n  => Math.round(n * 10) / 10;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts       = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(OUTPUT_DIR, `${sourceName}_${ts}.json`);
  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));
  return { filepath, count: records.length };
}

// ─── Canada — openparliament.ca ───────────────────────────────────────────────

const CA_API     = 'https://api.openparliament.ca';
const CA_SESSION = '45-1';

/**
 * Build a slug → {name, party, riding, province} map for all current MPs.
 * Paginates the /politicians/?current=true endpoint (offset-based, no total count).
 */
async function buildCAMpMap() {
  const map = {};
  let offset = 0;
  const limit = 200;

  while (true) {
    const r = await axios.get(`${CA_API}/politicians/`, {
      params:  { format: 'json', current: 'true', limit, offset },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const objects = r.data?.objects || [];
    for (const mp of objects) {
      const slug = mp.url?.replace(/^\/politicians\//, '').replace(/\/$/, '') || null;
      if (!slug) continue;
      map[slug] = {
        member_name: safeStr(mp.name),
        party:       safeStr(mp.current_party?.short_name?.en),
        riding:      safeStr(mp.current_riding?.name?.en),
        province:    safeStr(mp.current_riding?.province),
      };
    }
    if (!r.data?.pagination?.next_url) break;
    offset += limit;
    await sleep(150);
  }
  return map;
}

async function fetchCanadaAttendance() {
  const _ts = new Date().toISOString();
  try {
  // Step 1 — build MP metadata lookup
  console.log('[attendance:CA] Building current MP map…');
  const mpMap = await buildCAMpMap();
  const mpCount = Object.keys(mpMap).length;
  console.log(`[attendance:CA] ${mpCount} current MPs found`);

  // Step 2 — fetch all vote URLs in current session
  console.log(`[attendance:CA] Fetching all votes in session ${CA_SESSION}…`);
  const voteResp = await axios.get(`${CA_API}/votes/`, {
    params:  { format: 'json', limit: 200, session: CA_SESSION },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });
  const votes      = voteResp.data?.objects || [];
  const totalVotes = votes.length;
  if (totalVotes === 0) throw new Error(`[attendance:CA] No votes found for session ${CA_SESSION}`);
  console.log(`[attendance:CA] ${totalVotes} votes in session ${CA_SESSION} — fetching ballots…`);

  // Step 3 — for each vote, fetch all ballots and accumulate per-MP counts
  // accumulator: { slug: { participated: N } }
  const acc = {};

  for (let i = 0; i < votes.length; i++) {
    const voteUrl = votes[i].url;      // e.g. "/votes/45-1/94/"
    let ballots = [];

    try {
      // A session typically has ~300 MPs voting; limit=350 covers all in one page
      const bResp = await axios.get(`${CA_API}/votes/ballots/`, {
        params:  { vote: voteUrl, format: 'json', limit: 350 },
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      ballots = bResp.data?.objects || [];
    } catch (err) {
      console.warn(`[attendance:CA]   ⚠ ballots failed for ${voteUrl}: ${err.message}`);
    }

    for (const ballot of ballots) {
      const slug = ballot.politician_url
        ?.replace(/^\/politicians\//, '').replace(/\/$/, '') || null;
      if (!slug) continue;
      if (!acc[slug]) acc[slug] = { participated: 0 };
      acc[slug].participated++;
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[attendance:CA]   processed ${i + 1}/${totalVotes} votes…`);
    }
    await sleep(150);
  }

  // Step 4 — build records (all MPs who appear in the ballot data)
  const records = Object.entries(acc).map(([slug, data]) => {
    const meta = mpMap[slug] || {};
    return {
      id:                `ca-attendance-${slug}-${CA_SESSION}`,
      politician_slug:   slug,
      member_name:       meta.member_name || null,
      party:             meta.party        || null,
      riding:            meta.riding       || null,
      province:          meta.province     || null,
      session:           CA_SESSION,
      votes_participated: data.participated,
      votes_total:        totalVotes,
      attendance_pct:    round1((data.participated / totalVotes) * 100),
      jurisdiction:      'CA',
      chamber:           'House of Commons',
      period_label:      `Session ${CA_SESSION} (${totalVotes} votes)`,
      sourceUrl:         `${CA_API}/votes/ballots/`,
    };
  });

  // Include any current MPs with zero participation
  for (const [slug, meta] of Object.entries(mpMap)) {
    if (!acc[slug]) {
      records.push({
        id:                `ca-attendance-${slug}-${CA_SESSION}`,
        politician_slug:   slug,
        member_name:       meta.member_name,
        party:             meta.party,
        riding:            meta.riding,
        province:          meta.province,
        session:           CA_SESSION,
        votes_participated: 0,
        votes_total:        totalVotes,
        attendance_pct:    0,
        jurisdiction:      'CA',
        chamber:           'House of Commons',
        period_label:      `Session ${CA_SESSION} (${totalVotes} votes)`,
        sourceUrl:         `${CA_API}/votes/ballots/`,
      });
    }
  }

  records.sort((a, b) => b.attendance_pct - a.attendance_pct);
  console.log(`[attendance:CA] ${records.length} MP attendance records built`);

  const result = saveRecords('ca_parliament_attendance', records, {
    session:    CA_SESSION,
    totalVotes,
    mpsInData:  Object.keys(acc).length,
    sourceApi:  `${CA_API}/votes/`,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://api.openparliament.ca/votes/', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://api.openparliament.ca/votes/', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── US — House Clerk roll-call XML ──────────────────────────────────────────

const CLERK_BASE       = 'https://clerk.house.gov';
const US_ROLLS_SAMPLE  = 25;   // most recent roll calls to sample

/** Extract inner text of the first matching XML tag */
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
}

/**
 * Parse all <recorded-vote> blocks from a Clerk XML roll-call file.
 * Returns: [{ bioguide, name, party, state, district, vote_value }]
 */
function parseRecordedVotes(xml) {
  const results  = [];
  const blockRe  = /<recorded-vote>([\s\S]*?)<\/recorded-vote>/g;
  const legRe    = /<legislator\s+([^>]+)>([^<]+)<\/legislator>/;
  const voteRe   = /<vote>([^<]+)<\/vote>/;
  const attrRe   = /(\w+(?:-\w+)*)="([^"]*)"/g;
  let block;
  while ((block = blockRe.exec(xml)) !== null) {
    const inner = block[1];
    const legM  = legRe.exec(inner);
    const voteM = voteRe.exec(inner);
    if (!legM || !voteM) continue;
    const attrs = {};
    let am;
    attrRe.lastIndex = 0;
    while ((am = attrRe.exec(legM[1])) !== null) attrs[am[1]] = am[2];
    results.push({
      bioguide:   attrs['name-id']    || null,
      name:       legM[2].trim()      || null,
      party:      attrs['party']      || null,
      state:      attrs['state']      || null,
      district:   attrs['district']   || null,
      vote_value: voteM[1].trim()     || null,   // "Yes"|"No"|"Present"|"Not Voting"
    });
  }
  return results;
}

async function fetchUSAttendance() {
  const _ts = new Date().toISOString();
  try {
  // Step 1 — discover roll-call count from the Clerk index page
  console.log(`[attendance:US] Fetching House Clerk index for ${CURRENT_YEAR}…`);
  const idxResp = await axios.get(`${CLERK_BASE}/evs/${CURRENT_YEAR}/index.asp`, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  const indexHtml   = String(idxResp.data || '');
  const allNums     = [...new Set(
    [...indexHtml.matchAll(/rollnumber=(\d+)/g)].map(m => parseInt(m[1]))
  )].sort((a, b) => b - a);

  if (allNums.length === 0) throw new Error('[attendance:US] No roll call numbers found in Clerk index');

  // The highest number on the index = total roll calls issued this year so far
  const totalRollsInYear = allNums[0];
  // Fetch the US_ROLLS_SAMPLE most recent (sequential from max down)
  const toFetch = [];
  for (let n = totalRollsInYear; n > 0 && toFetch.length < US_ROLLS_SAMPLE; n--) {
    toFetch.push(n);
  }
  console.log(`[attendance:US] Total rolls in ${CURRENT_YEAR}: ${totalRollsInYear} — sampling last ${toFetch.length}…`);

  // Step 2 — fetch XMLs and accumulate per-member vote counts
  // acc: { bioguide: { participated: N, absent: N, name, party, state, district } }
  const acc = {};
  let rollsFetched = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const rollNum = toFetch[i];
    const padded  = String(rollNum).padStart(3, '0');
    const xmlUrl  = `${CLERK_BASE}/evs/${CURRENT_YEAR}/roll${padded}.xml`;

    let xml = '';
    try {
      const xmlResp = await axios.get(xmlUrl, {
        headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
        timeout: TIMEOUT_MS,
      });
      xml = String(xmlResp.data || '');
    } catch (err) {
      console.warn(`[attendance:US]   ⚠ roll ${rollNum} failed: ${err.message}`);
      continue;
    }

    const ballots = parseRecordedVotes(xml);
    rollsFetched++;

    for (const b of ballots) {
      const key = b.bioguide || b.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
      if (!acc[key]) {
        acc[key] = { participated: 0, absent: 0, name: b.name, party: b.party, state: b.state, district: b.district };
      }
      if (b.vote_value === 'Not Voting') {
        acc[key].absent++;
      } else {
        // "Yes" | "No" | "Present" all count as participating
        acc[key].participated++;
      }
    }

    await sleep(200);
  }

  const sampleSize = rollsFetched;
  console.log(`[attendance:US] ${sampleSize} roll calls processed — building records…`);

  // Step 3 — build records
  const records = Object.entries(acc).map(([bioguide, d]) => ({
    id:                  `us-attendance-${CURRENT_YEAR}-${bioguide}`,
    bioguide_id:         bioguide,
    member_name:         safeStr(d.name),
    party:               safeStr(d.party),
    state:               safeStr(d.state),
    district:            safeStr(d.district),
    year:                CURRENT_YEAR,
    votes_participated:  d.participated,
    votes_absent:        d.absent,
    votes_total:         sampleSize,
    attendance_pct:      sampleSize > 0 ? round1((d.participated / sampleSize) * 100) : 0,
    total_rolls_in_year: totalRollsInYear,
    sample_size:         sampleSize,
    jurisdiction:        'US',
    chamber:             'House',
    period_label:        `${CURRENT_YEAR} (last ${sampleSize} of ${totalRollsInYear} roll calls)`,
    sourceUrl:           `${CLERK_BASE}/evs/${CURRENT_YEAR}/`,
  }));

  records.sort((a, b) => b.attendance_pct - a.attendance_pct);
  console.log(`[attendance:US] ${records.length} member attendance records`);

  const result = saveRecords('us_house_attendance', records, {
    year:            CURRENT_YEAR,
    sampleSize,
    totalRollsInYear,
    sourceBase:      `${CLERK_BASE}/evs/${CURRENT_YEAR}/`,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://clerk.house.gov/evs/', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://clerk.house.gov/evs/', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── UK — members-api.parliament.uk ──────────────────────────────────────────

const UK_MEMBERS_API    = 'https://members-api.parliament.uk/api';
const UK_VOTES_API      = 'https://commonsvotes-api.parliament.uk';
const UK_MP_TARGET      = 50;   // MPs to process per run
const UK_MP_PAGE_SIZE   = 20;   // members-api hard cap per page
const YEAR_PREFIX       = String(CURRENT_YEAR); // "2026"

/**
 * Count total Commons divisions in the current calendar year by paginating
 * the divisions search endpoint (hard cap: 25 per page).
 */
async function countUKDivisionsThisYear() {
  let total = 0, skip = 0;
  const startDate = `${CURRENT_YEAR}-01-01`;
  while (true) {
    const r = await axios.get(`${UK_VOTES_API}/data/divisions.json/search`, {
      params: { 'queryParameters.take': 25, 'queryParameters.startDate': startDate, 'queryParameters.skip': skip },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const items = r.data || [];
    total += items.length;
    if (items.length < 25) break;
    skip += 25;
    await sleep(150);
  }
  return total;
}

/**
 * For one MP, count how many of their recorded votes fall in the current year
 * by paging through /Members/{id}/Voting until we reach a prior-year date.
 */
async function countUKMpVotesThisYear(memberId) {
  let count = 0, skip = 0;
  while (true) {
    const r = await axios.get(`${UK_MEMBERS_API}/Members/${memberId}/Voting`, {
      params:  { house: 1, skip, take: 25 },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const items = r.data?.items || [];
    if (items.length === 0) break;

    let hitPriorYear = false;
    for (const item of items) {
      const date = item.value?.date || '';
      if (date.startsWith(YEAR_PREFIX)) {
        count++;
      } else {
        // Votes are sorted most-recent first; first non-current-year → stop paging
        hitPriorYear = true;
        break;
      }
    }
    if (hitPriorYear || items.length < 25) break;
    skip += 25;
    await sleep(100);
  }
  return count;
}

async function fetchUKAttendance() {
  const _ts = new Date().toISOString();
  try {
  // Step 1 — count total divisions in current year
  console.log(`[attendance:UK] Counting Commons divisions in ${CURRENT_YEAR}…`);
  const totalDivisions = await countUKDivisionsThisYear();
  if (totalDivisions === 0) throw new Error('[attendance:UK] No divisions found for current year');
  console.log(`[attendance:UK] ${totalDivisions} divisions in ${CURRENT_YEAR}`);

  // Step 2 — paginate current Commons MPs up to UK_MP_TARGET
  console.log(`[attendance:UK] Fetching up to ${UK_MP_TARGET} current Commons MPs…`);
  const members = [];
  for (let skip = 0; members.length < UK_MP_TARGET; skip += UK_MP_PAGE_SIZE) {
    const r = await axios.get(`${UK_MEMBERS_API}/Members/Search`, {
      params:  { house: 1, isCurrentMember: true, skip, take: UK_MP_PAGE_SIZE },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });
    const items = r.data?.items || [];
    if (items.length === 0) break;
    members.push(...items.map(i => i.value || i));
    if (items.length < UK_MP_PAGE_SIZE) break;
    await sleep(200);
  }
  const batch = members.slice(0, UK_MP_TARGET);
  console.log(`[attendance:UK] Processing ${batch.length} MPs — fetching their ${CURRENT_YEAR} votes…`);

  // Step 3 — for each MP count their year votes and compute attendance
  const records = [];
  for (let i = 0; i < batch.length; i++) {
    const mp         = batch[i];
    const memberId   = mp.id;
    const party      = mp.latestParty || {};
    const membership = mp.latestHouseMembership || {};

    let yearVotes = 0;
    try {
      yearVotes = await countUKMpVotesThisYear(memberId);
    } catch (err) {
      console.warn(`[attendance:UK]   ⚠ MP ${memberId} voting fetch failed: ${err.message}`);
    }

    records.push({
      id:                 `uk-attendance-${CURRENT_YEAR}-${memberId}`,
      member_id:          memberId,
      member_name:        safeStr(mp.nameDisplayAs || mp.nameListAs),
      party:              safeStr(party.name),
      party_abbr:         safeStr(party.abbreviation),
      constituency:       safeStr(membership.membershipFrom),
      gender:             safeStr(mp.gender),
      year:               CURRENT_YEAR,
      votes_participated: yearVotes,
      votes_total:        totalDivisions,
      attendance_pct:     totalDivisions > 0 ? round1((yearVotes / totalDivisions) * 100) : 0,
      jurisdiction:       'UK',
      chamber:            'Commons',
      period_label:       `${CURRENT_YEAR} (${totalDivisions} divisions)`,
      sourceUrl:          `${UK_MEMBERS_API}/Members/${memberId}/Voting`,
    });

    if ((i + 1) % 10 === 0) {
      console.log(`[attendance:UK]   ${i + 1}/${batch.length} MPs processed…`);
    }
    await sleep(150);
  }

  records.sort((a, b) => b.attendance_pct - a.attendance_pct);
  console.log(`[attendance:UK] ${records.length} MP attendance records built`);

  const result = saveRecords('uk_commons_attendance', records, {
    year:             CURRENT_YEAR,
    totalDivisions,
    mpsProcessed:     records.length,
    sourceApi:        `${UK_MEMBERS_API}/Members/{id}/Voting`,
  });
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: 'https://members-api.parliament.uk/api', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
  } catch (err) {
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: 'https://members-api.parliament.uk/api', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    throw err;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'CA — openparliament.ca session attendance',   fn: fetchCanadaAttendance },
  { name: 'US — House Clerk roll-call attendance',        fn: fetchUSAttendance     },
  { name: 'UK — Parliament members-api attendance',       fn: fetchUKAttendance     },
];

async function fetchAllMemberAttendance() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[memberAttendanceFetcher] Starting member attendance ingestion');
  console.log('='.repeat(60));

  const summary = [];
  for (const source of SOURCES) {
    console.log(`\n[memberAttendanceFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[memberAttendanceFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, status: 'ok', records: result.count, file: result.filepath });
    } catch (err) {
      console.error(`[memberAttendanceFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[memberAttendanceFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60) + '\n');

  return summary;
}

module.exports = {
  fetchAllMemberAttendance,
  fetchCanadaAttendance,
  fetchUSAttendance,
  fetchUKAttendance,
};

if (require.main === module) {
  fetchAllMemberAttendance().then(summary => {
    process.exit(summary.some(r => r.status === 'error') ? 1 : 0);
  }).catch(err => {
    console.error('[memberAttendanceFetcher] Fatal:', err.message);
    process.exit(1);
  });
}
