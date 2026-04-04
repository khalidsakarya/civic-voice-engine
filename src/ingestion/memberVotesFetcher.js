/**
 * Member Voting Records Fetcher — Civic Voice Engine
 *
 * Fetches real parliamentary/congressional voting records — one Firestore
 * document per member per vote — from three official government sources.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * CA   openparliament.ca/api/votes/
 *      Step 1 — GET /votes/?format=json&limit=N   → recent vote summaries
 *      Step 2 — GET /votes/ballots/?vote={url}&format=json&limit=300
 *               → per-MP ballot ("Yes" / "No" / "Paired") for each vote
 *      No auth required.
 *
 * US   clerk.house.gov/evs/{year}/roll{NNN}.xml
 *      Step 1 — Parse the Clerk's HTML index page to find the highest
 *               roll-call number for the current year.
 *      Step 2 — Fetch the most recent N roll-call XML files, each of which
 *               contains a <recorded-vote> element for every voting member
 *               (Yes / No / Present / Not Voting).
 *      No auth required.
 *
 * UK   commonsvotes-api.parliament.uk
 *      Step 1 — GET /data/divisions.json/search?queryParameters.take=N
 *               → recent division list (Ayes/Noes arrays are empty here)
 *      Step 2 — GET /data/division/{DivisionId}.json for each division
 *               → full Ayes and Noes arrays with member name, party, constituency
 *      No auth required.
 *
 * Output: output/member_votes/{source}_{timestamp}.json
 * Firestore collection: member_votes
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR  = path.resolve(__dirname, '../../output/member_votes');
const TIMEOUT_MS  = 45_000;
const CURRENT_YEAR = new Date().getFullYear();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 600) || null : null);
const safeNum = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath  = path.join(OUTPUT_DIR, `${sourceName}_${timestamp}.json`);
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
//
//  Two-step fetch:
//    1. GET /votes/?format=json&limit=VOTE_LIMIT   → recent vote summaries
//    2. GET /votes/ballots/?vote={url}&…limit=300  → per-MP ballot per vote
//
//  Ballot object: { vote_url, politician_url, politician_membership_url, ballot }
//  ballot values: "Yes", "No", "Paired"
//
//  Document ID: ca-vote-{session}-{number}-{politician_slug}
//  politician_slug derived from politician_url: "/politicians/jane-doe/" → "jane-doe"

const CA_API        = 'https://api.openparliament.ca';
const CA_VOTE_LIMIT = 10;   // recent votes to fetch
const CA_BALLOT_LIMIT = 300; // ballots per vote (typically 300-330 MPs total)

async function fetchCanadaVotes() {
  console.log(`[votes:CA] Fetching ${CA_VOTE_LIMIT} most recent parliamentary votes…`);

  const listResp = await axios.get(`${CA_API}/votes/`, {
    params:  { format: 'json', limit: CA_VOTE_LIMIT },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const votes = listResp.data?.objects || [];
  if (votes.length === 0) throw new Error('[votes:CA] No votes returned from openparliament.ca');

  console.log(`[votes:CA] Retrieved ${votes.length} votes — fetching per-MP ballots…`);

  const records = [];

  for (let i = 0; i < votes.length; i++) {
    const vote    = votes[i];
    const voteUrl = vote.url; // e.g. "/votes/45-1/94/"

    // Extract session and vote number from url like "/votes/45-1/94/"
    const urlParts  = voteUrl.replace(/^\/votes\//, '').replace(/\/$/, '').split('/');
    const session   = urlParts[0] || null;  // "45-1"
    const voteNum   = safeNum(urlParts[1]); // 94

    let ballots = [];
    try {
      const ballotResp = await axios.get(`${CA_API}/votes/ballots/`, {
        params: {
          vote:   voteUrl,
          format: 'json',
          limit:  CA_BALLOT_LIMIT,
        },
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      ballots = ballotResp.data?.objects || [];
    } catch (err) {
      console.warn(`[votes:CA]   ⚠ ballot fetch failed for vote ${voteUrl}: ${err.message}`);
    }

    for (const ballot of ballots) {
      // politician_url like "/politicians/ziad-aboultaif/" → slug "ziad-aboultaif"
      const politicianUrl  = ballot.politician_url || '';
      const politicianSlug = politicianUrl.replace(/^\/politicians\//, '').replace(/\/$/, '') || null;
      const voteKey        = `${session}-${voteNum}`.replace(/[^a-zA-Z0-9-]/g, '-');

      records.push({
        id:              `ca-vote-${voteKey}-${politicianSlug || 'unknown'}`,
        vote_id:         voteUrl,
        session,
        vote_number:     voteNum,
        date:            safeStr(vote.date),
        description_en:  safeStr(vote.description?.en),
        description_fr:  safeStr(vote.description?.fr),
        result:          safeStr(vote.result),       // "Passed" / "Failed" / "Tie"
        yea_total:       safeNum(vote.yea_total),
        nay_total:       safeNum(vote.nay_total),
        paired_total:    safeNum(vote.paired_total),
        bill_url:        safeStr(vote.bill_url),
        politician_slug: politicianSlug,
        politician_url:  safeStr(ballot.politician_url),
        member_vote:     safeStr(ballot.ballot),    // "Yes" / "No" / "Paired"
        jurisdiction:    'CA',
        chamber:         'House of Commons',
        sourceUrl:       `${CA_API}${voteUrl}`,
      });
    }

    if (i < votes.length - 1) await sleep(200);
  }

  const voteIds = [...new Set(records.map(r => r.vote_id))].length;
  console.log(`[votes:CA] ${records.length} ballot records across ${voteIds} votes`);

  return saveRecords('ca_parliament_votes', records, {
    votesProcessed:  votes.length,
    sourceApi:       `${CA_API}/votes/`,
  });
}

// ─── US — House Clerk Roll-Call XML ──────────────────────────────────────────
//
//  The House Clerk publishes every roll-call vote as an XML file:
//    https://clerk.house.gov/evs/{year}/roll{NNN}.xml
//
//  Discovery: parse the index page https://clerk.house.gov/evs/{year}/index.asp
//  to extract all rollnumber values, then fetch the most recent US_ROLLS_LIMIT.
//
//  XML parsing uses targeted regex (no external XML library required).
//  <recorded-vote> elements contain one <legislator> (with attrs) + one <vote>.
//
//  Legislator attrs: name-id (bioguide ID), sort-field, party, state, role
//  Vote values: "Yes" / "No" / "Present" / "Not Voting"
//
//  Document ID: us-house-{year}-roll{num}-{bioguide}

const CLERK_BASE   = 'https://clerk.house.gov';
const US_ROLLS_LIMIT = 5; // roll calls to fetch per run

/** Extract inner text of the first occurrence of <tag>…</tag> */
function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return m ? m[1].trim() : null;
}

/** Parse all <recorded-vote> blocks and return ballot objects */
function parseRecordedVotes(xml) {
  const results = [];
  // Match each <recorded-vote>…</recorded-vote> block
  const blockRe  = /<recorded-vote>([\s\S]*?)<\/recorded-vote>/g;
  // Within each block match the <legislator> element and its attributes
  const legRe    = /<legislator\s+([^>]+)>([^<]+)<\/legislator>/;
  const voteRe   = /<vote>([^<]+)<\/vote>/;
  // Parse attribute key="value" pairs from the legislator tag
  const attrRe   = /(\w+(?:-\w+)*)="([^"]*)"/g;

  let block;
  while ((block = blockRe.exec(xml)) !== null) {
    const inner   = block[1];
    const legM    = legRe.exec(inner);
    const voteM   = voteRe.exec(inner);
    if (!legM || !voteM) continue;

    const attrs   = {};
    let am;
    attrRe.lastIndex = 0;
    while ((am = attrRe.exec(legM[1])) !== null) {
      attrs[am[1]] = am[2];
    }

    results.push({
      bioguide:   attrs['name-id']     || null,
      sort_field: attrs['sort-field']  || null,
      party:      attrs['party']       || null,
      state:      attrs['state']       || null,
      district:   attrs['district']    || null,
      role:       attrs['role']        || null,
      name:       legM[2].trim()       || null,
      vote_value: voteM[1].trim()      || null,
    });
  }
  return results;
}

async function fetchUSHouseVotes() {
  // Step 1 — discover the most recent roll-call numbers from the index page
  console.log(`[votes:US] Fetching House Clerk index for ${CURRENT_YEAR}…`);

  const indexResp = await axios.get(`${CLERK_BASE}/evs/${CURRENT_YEAR}/index.asp`, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });

  const indexHtml  = String(indexResp.data || '');
  // Index links look like: href="http://clerk.house.gov/cgi-bin/vote.asp?year=2026&rollnumber=108"
  const rollNums   = [...indexHtml.matchAll(/rollnumber=(\d+)/g)].map(m => parseInt(m[1]));
  if (rollNums.length === 0) throw new Error('[votes:US] No roll call numbers found in Clerk index');

  // De-duplicate and sort descending — take the most recent US_ROLLS_LIMIT
  const uniqueSorted = [...new Set(rollNums)].sort((a, b) => b - a);
  const toFetch      = uniqueSorted.slice(0, US_ROLLS_LIMIT);
  console.log(`[votes:US] Latest roll calls: ${toFetch.join(', ')} — fetching ${toFetch.length} XML files…`);

  const records = [];

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
      console.warn(`[votes:US]   ⚠ roll ${rollNum} fetch failed: ${err.message}`);
      continue;
    }

    // Extract vote-level metadata
    const rollcallNum  = safeNum(xmlTag(xml, 'rollcall-num')) ?? rollNum;
    const congress     = safeNum(xmlTag(xml, 'congress'));
    const voteQuestion = safeStr(xmlTag(xml, 'vote-question'));
    const voteResult   = safeStr(xmlTag(xml, 'vote-result'));
    const actionDate   = safeStr(xmlTag(xml, 'action-date'));
    const legisNum     = safeStr(xmlTag(xml, 'legis-num'));
    const chamber      = safeStr(xmlTag(xml, 'chamber')) || 'House';
    // yea/nay totals appear twice (by-party and overall) — take the last one
    const yeaMatches   = [...xml.matchAll(/<yea-total>(\d+)<\/yea-total>/g)];
    const nayMatches   = [...xml.matchAll(/<nay-total>(\d+)<\/nay-total>/g)];
    const yeaTotal     = safeNum(yeaMatches.at(-1)?.[1]);
    const nayTotal     = safeNum(nayMatches.at(-1)?.[1]);

    const ballots = parseRecordedVotes(xml);
    if (ballots.length === 0) {
      console.warn(`[votes:US]   ⚠ roll ${rollNum}: no recorded-vote elements found`);
      continue;
    }

    for (const b of ballots) {
      const bioguide = b.bioguide || b.sort_field?.toLowerCase().replace(/\s+/g, '-') || 'unknown';
      records.push({
        id:             `us-house-${CURRENT_YEAR}-roll${rollcallNum}-${bioguide}`,
        vote_id:        `${CURRENT_YEAR}-roll${rollcallNum}`,
        roll_call_number: rollcallNum,
        year:           CURRENT_YEAR,
        congress,
        vote_question:  voteQuestion,
        vote_result:    voteResult,
        action_date:    actionDate,
        legislation:    legisNum,
        yea_total:      yeaTotal,
        nay_total:      nayTotal,
        bioguide_id:    safeStr(b.bioguide),
        member_name:    safeStr(b.name),
        sort_field:     safeStr(b.sort_field),
        party:          safeStr(b.party),    // "D" / "R" / "I"
        state:          safeStr(b.state),
        district:       safeStr(b.district),
        member_vote:    safeStr(b.vote_value), // "Yes" / "No" / "Present" / "Not Voting"
        jurisdiction:   'US',
        chamber:        safeStr(chamber),
        sourceUrl:      xmlUrl,
      });
    }

    console.log(`[votes:US]   roll ${rollNum}: ${ballots.length} ballots (${voteQuestion})`);
    if (i < toFetch.length - 1) await sleep(300);
  }

  const rollsGot = [...new Set(records.map(r => r.roll_call_number))].length;
  console.log(`[votes:US] ${records.length} ballot records across ${rollsGot} roll calls`);

  return saveRecords('us_house_rollcall_votes', records, {
    rollCallsFetched: rollsGot,
    year:             CURRENT_YEAR,
    sourceBase:       `${CLERK_BASE}/evs/${CURRENT_YEAR}/`,
  });
}

// ─── UK — commonsvotes-api.parliament.uk ─────────────────────────────────────
//
//  Two-step fetch:
//    1. GET /data/divisions.json/search?queryParameters.take=N
//       → division list; Ayes/Noes arrays are EMPTY in list mode
//    2. GET /data/division/{DivisionId}.json  for each division
//       → full Ayes and Noes arrays with MemberId, Name, Party, MemberFrom
//
//  Aye member object: { MemberId, Name, Party, PartyAbbreviation,
//                       MemberFrom, ListAs, ProxyName }
//
//  Document ID: uk-division-{divisionId}-{memberId}

const UK_VOTES_API      = 'https://commonsvotes-api.parliament.uk';
const UK_DIVISIONS_LIMIT = 10;  // recent divisions per run

async function fetchUKDivisions() {
  console.log(`[votes:UK] Fetching ${UK_DIVISIONS_LIMIT} most recent Commons divisions…`);

  const listResp = await axios.get(`${UK_VOTES_API}/data/divisions.json/search`, {
    params: { 'queryParameters.take': UK_DIVISIONS_LIMIT },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const divisionList = listResp.data || [];
  if (divisionList.length === 0) throw new Error('[votes:UK] No divisions returned from commonsvotes-api');

  console.log(`[votes:UK] Retrieved ${divisionList.length} divisions — fetching full Ayes/Noes…`);

  const records = [];

  for (let i = 0; i < divisionList.length; i++) {
    const summary    = divisionList[i];
    const divisionId = summary.DivisionId;

    let detail;
    try {
      const detailResp = await axios.get(`${UK_VOTES_API}/data/division/${divisionId}.json`, {
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      detail = detailResp.data || {};
    } catch (err) {
      console.warn(`[votes:UK]   ⚠ detail fetch failed for division ${divisionId}: ${err.message}`);
      continue;
    }

    const divDate    = safeStr(detail.Date  || summary.Date);
    const title      = safeStr(detail.Title || summary.Title);
    const ayeCount   = safeNum(detail.AyeCount ?? summary.AyeCount);
    const noCount    = safeNum(detail.NoCount  ?? summary.NoCount);
    const divNumber  = safeNum(detail.Number   ?? summary.Number);

    const ayes = detail.Ayes  || [];
    const noes = detail.Noes  || [];

    for (const member of ayes) {
      const memberId = member.MemberId;
      records.push({
        id:              `uk-division-${divisionId}-${memberId}`,
        division_id:     divisionId,
        division_number: divNumber,
        date:            divDate,
        title,
        aye_count:       ayeCount,
        no_count:        noCount,
        is_deferred:     detail.IsDeferred ?? summary.IsDeferred ?? null,
        member_id:       memberId,
        member_name:     safeStr(member.Name),
        list_as:         safeStr(member.ListAs),
        party:           safeStr(member.Party),
        party_abbr:      safeStr(member.PartyAbbreviation),
        constituency:    safeStr(member.MemberFrom),
        proxy_name:      safeStr(member.ProxyName) || null,
        member_vote:     'Aye',
        jurisdiction:    'UK',
        chamber:         'Commons',
        sourceUrl:       `${UK_VOTES_API}/data/division/${divisionId}.json`,
      });
    }

    for (const member of noes) {
      const memberId = member.MemberId;
      records.push({
        id:              `uk-division-${divisionId}-${memberId}`,
        division_id:     divisionId,
        division_number: divNumber,
        date:            divDate,
        title,
        aye_count:       ayeCount,
        no_count:        noCount,
        is_deferred:     detail.IsDeferred ?? summary.IsDeferred ?? null,
        member_id:       memberId,
        member_name:     safeStr(member.Name),
        list_as:         safeStr(member.ListAs),
        party:           safeStr(member.Party),
        party_abbr:      safeStr(member.PartyAbbreviation),
        constituency:    safeStr(member.MemberFrom),
        proxy_name:      safeStr(member.ProxyName) || null,
        member_vote:     'No',
        jurisdiction:    'UK',
        chamber:         'Commons',
        sourceUrl:       `${UK_VOTES_API}/data/division/${divisionId}.json`,
      });
    }

    console.log(`[votes:UK]   division ${divisionId}: ${ayes.length} Ayes + ${noes.length} Noes (${title?.slice(0, 60)})`);
    if (i < divisionList.length - 1) await sleep(200);
  }

  const divisionsGot = [...new Set(records.map(r => r.division_id))].length;
  console.log(`[votes:UK] ${records.length} ballot records across ${divisionsGot} divisions`);

  return saveRecords('uk_commons_divisions', records, {
    divisionsFetched: divisionsGot,
    sourceApi:        `${UK_VOTES_API}/data/divisions.json/search`,
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'CA — openparliament.ca parliamentary votes', fn: fetchCanadaVotes   },
  { name: 'US — House Clerk roll-call XML',             fn: fetchUSHouseVotes  },
  { name: 'UK — Commons Votes API divisions',           fn: fetchUKDivisions   },
];

async function fetchAllMemberVotes() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[memberVotesFetcher] Starting member votes ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[memberVotesFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[memberVotesFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, status: 'ok', records: result.count, file: result.filepath });
    } catch (err) {
      console.error(`[memberVotesFetcher]   ✗ Failed: ${err.message}`);
      summary.push({ source: source.name, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[memberVotesFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '✗'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60) + '\n');

  return summary;
}

module.exports = { fetchAllMemberVotes, fetchCanadaVotes, fetchUSHouseVotes, fetchUKDivisions };

if (require.main === module) {
  fetchAllMemberVotes().then(summary => {
    process.exit(summary.some(r => r.status === 'error') ? 1 : 0);
  }).catch(err => {
    console.error('[memberVotesFetcher] Fatal:', err.message);
    process.exit(1);
  });
}
