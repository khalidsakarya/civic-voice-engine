/**
 * Member Committees Fetcher — Civic Voice Engine
 *
 * Fetches current committee assignments for legislators from official sources.
 * Each output record represents one member with a `committees` array listing
 * every committee/subcommittee they currently sit on, with role and rank where
 * available.
 *
 * Sources & methodology
 * ─────────────────────────────────────────────────────────────────────────────
 * CA   ourcommons.ca/Committees/en/
 *      1. GET /Committees/en/ HTML → extract current House committee acronyms
 *         (uppercase 2–8 letter codes, e.g. ETHI, FINA, HESA)
 *      2. For each acronym GET /Committees/en/{ACRONYM}/Members HTML
 *      3. Parse member cards: id from /members/en/{Name}({id}) href,
 *         role from preceding <h2 class="title">, name/party/riding spans
 *
 * US   clerk.house.gov
 *      1. GET /Committees HTML → build comcode→committee_name lookup map
 *      2. GET /xml/lists/MemberData.xml → per-member <committee-assignments>
 *         with comcode, rank, and optional leadership attribute
 *      Produces one record per member with their full committee list.
 *
 * UK   members-api.parliament.uk
 *      1. Paginate /api/Members/Search?house=1&isCurrentMember=true (20/page cap)
 *      2. For each MP GET /api/Members/{id}/Biography → committeeMemberships[]
 *      3. Filter to current assignments (endDate === null) and include recent
 *         ones (ended in the last 2 years) for context
 *
 * AU   aph.gov.au/Parliamentary_Business/Committees
 *      1. GET /Committees/House and /Committees/Joint HTML → committee slugs
 *      2. For each committee GET /Committee_Membership HTML
 *      3. Parse <li> member cards: role from <h3>, MPID from href, name/party
 *
 * Output: output/member_committees/{source}_{timestamp}.json
 * Firestore: member_committees collection  (doc id = {source}_{memberId})
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER = 'weekly';
const COLLECTION_NAME = 'member_committees';
const OUTPUT_DIR = path.resolve(__dirname, '../../output/member_committees');
const TIMEOUT_MS = 45_000;

// ─── Shared helpers ───────────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 500) || null : null);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

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

// ─── Canada — ourcommons.ca HTML scrape ───────────────────────────────────────

const CA_OC = 'https://www.ourcommons.ca';

async function fetchCACommitteeAcronyms() {
  const r = await axios.get(`${CA_OC}/Committees/en/`, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  // Extract unique House committee acronyms (e.g. ETHI, FINA)
  // Senate committees start with S; joint ones with J — include both for completeness
  const raw = r.data.match(/\/Committees\/en\/([A-Z]{2,8})(?:"|(?=\?))/g) || [];
  return [...new Set(raw.map(m => m.replace(/.*\/Committees\/en\//, '').replace(/["?].*/, '')))];
}

async function fetchCACommitteeMembers(acronym) {
  const url = `${CA_OC}/Committees/en/${acronym}/Members`;
  const r = await axios.get(url, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  const html = r.data;

  // Committee name from <title> or <h1>
  const titleMatch = html.match(/<h1[^>]*>([^<]+)/i);
  const committeeName = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').trim() : acronym;

  // Each section has class containing "chair", "deputy-chair", or "member-section"
  // followed by an <h2 class="title">Role</h2> then member cards
  const members = [];

  // Parse member sections by splitting on section class markers
  const sectionPattern = /class="committee-(?:chair|vice-chair|deputy-chair|member)[^"]*"[\s\S]*?(?=class="committee-(?:chair|vice-chair|deputy-chair|member)|$)/gi;
  const allSections   = [];
  let sm;
  while ((sm = sectionPattern.exec(html)) !== null) allSections.push(sm[0]);

  // If section split fails, fall back to parsing role headings
  const fallbackSections = html.split(/<h2[^>]+class="title"/i).slice(1);
  const sections = allSections.length > 0 ? allSections : fallbackSections;

  for (const section of sections) {
    // Extract role from <h2> title
    const roleMatch = section.match(/class="title"[^>]*>\s*([^<]+)/i)
                   || section.match(/<h2[^>]*>\s*([^<]+)/i);
    const role = roleMatch ? roleMatch[1].trim() : 'Member';

    // Extract all member hrefs in this section
    const memberPattern = /href="[^"]*\/members\/en\/[^(]+\((\d+)\)"[^>]*>[\s\S]*?<span class="first-name">([^<]*)<\/span>[\s\S]*?<span class="last-name">([^<]*)<\/span>[\s\S]*?<span class="caucus">([^<]*)<\/span>[\s\S]*?<span class="constituency">([^<]*)<\/span>[\s\S]*?<span class="province">([^<]*)<\/span>/gi;
    let mm;
    while ((mm = memberPattern.exec(section)) !== null) {
      members.push({
        mp_id:       mm[1],
        first_name:  mm[2].trim(),
        last_name:   mm[3].trim(),
        party:       mm[4].trim(),
        constituency: mm[5].trim(),
        province:    mm[6].trim(),
        role:        role,
      });
    }

    // Fallback: just grab MPIDs from href if detailed spans not found
    if (members.length === 0 || (sections === fallbackSections)) {
      const hrefPattern = /href="[^"]*\/members\/en\/[^(]+\((\d+)\)"/gi;
      const namePattern = /<span class="full-name"[^>]*>[\s\S]*?<span class="first-name">([^<]*)<\/span>[\s\S]*?<span class="last-name">([^<]*)<\/span>/gi;
    }
  }

  // If structured parsing fails, fall through to a simpler approach
  if (members.length === 0) {
    // Simple: find all member card links and pair with surrounding role heading
    const cardPattern = /(<h2[^>]+class="title"[^>]*>\s*([^<]+)\s*<\/h2>[\s\S]*?)(?=<h2[^>]+class="title"|$)/gi;
    let cm;
    while ((cm = cardPattern.exec(html)) !== null) {
      const roleText = cm[2].trim();
      const block    = cm[1];
      const hrefPat  = /href="[^"]*\/members\/en\/[^(]+\((\d+)\)"[^>]*>\s*<span[^>]*>\s*(?:<span[^>]*><abbr[^>]*><\/abbr><\/span>)?\s*<span class="first-name">([^<]*)<\/span>\s*<span class="last-name">([^<]*)<\/span>/gi;
      let hm;
      while ((hm = hrefPat.exec(block)) !== null) {
        members.push({
          mp_id:      hm[1],
          first_name: hm[2].trim(),
          last_name:  hm[3].trim(),
          role:       roleText,
          party:      null,
          constituency: null,
          province:   null,
        });
      }
    }
  }

  return { committeeName, acronym, members };
}

async function fetchCanadaCommittees() {
  const _ts = new Date().toISOString();
  console.log('[ca-cmte] Fetching committee acronyms...');
  const acronyms = await fetchCACommitteeAcronyms();
  console.log(`[ca-cmte] ${acronyms.length} committees found`);

  // Map: mp_id → { member info, committees[] }
  const memberMap = {};

  let done = 0;
  for (const acronym of acronyms) {
    try {
      const { committeeName, members } = await fetchCACommitteeMembers(acronym);
      for (const m of members) {
        const key = m.mp_id;
        if (!memberMap[key]) {
          memberMap[key] = {
            id:          `ca_${key}`,
            source:      'canada',
            mp_id:       key,
            first_name:  m.first_name,
            last_name:   m.last_name,
            party:       m.party,
            constituency: m.constituency,
            province:    m.province,
            committees:  [],
          };
        }
        memberMap[key].committees.push({
          name:    committeeName,
          acronym,
          role:    m.role,
        });
      }
    } catch (err) {
      console.warn(`[ca-cmte] ⚠ ${acronym}: ${err.message}`);
    }
    done++;
    if (done % 10 === 0) console.log(`[ca-cmte] ${done}/${acronyms.length} committees processed`);
    await sleep(300);
  }

  const records = Object.values(memberMap);
  const result  = saveRecords('canada', records);
  console.log(`[ca-cmte] ✓ ${result.count} members → ${result.filepath}`);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://www.ourcommons.ca/Committees/en/', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
}

// ─── US — clerk.house.gov XML + HTML ─────────────────────────────────────────

const CLERK_BASE = 'https://clerk.house.gov';

async function buildUSComcodeMap() {
  const r = await axios.get(`${CLERK_BASE}/Committees`, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0' },
    timeout: TIMEOUT_MS,
  });
  const html  = r.data;
  const map   = {};
  // Pattern: href="/committees/AG00">Committee on Agriculture
  const pat = /href="\/committees\/([A-Z0-9]{4})">([^<]+)</gi;
  let m;
  while ((m = pat.exec(html)) !== null) {
    map[m[1]] = m[2].trim();
  }
  return map;
}

async function fetchUSCommittees() {
  const _ts = new Date().toISOString();
  console.log('[us-cmte] Building committee code map from clerk.house.gov...');
  const comcodeMap = await buildUSComcodeMap();
  console.log(`[us-cmte] ${Object.keys(comcodeMap).length} committee codes mapped`);
  await sleep(500);

  console.log('[us-cmte] Fetching MemberData.xml...');
  const r = await axios.get(`${CLERK_BASE}/xml/lists/MemberData.xml`, {
    timeout: TIMEOUT_MS,
  });
  const xml = r.data;

  // Split into per-member blocks
  const memberBlocks = xml.match(/<member>[\s\S]*?<\/member>/gi) || [];
  console.log(`[us-cmte] Parsing ${memberBlocks.length} member blocks...`);

  const records = [];

  for (const block of memberBlocks) {
    const bioguideId  = xmlTag(block, 'bioguideID');
    const lastName    = xmlTag(block, 'lastname');
    const firstName   = xmlTag(block, 'firstname');
    const middleName  = xmlTag(block, 'middlename');
    const party       = xmlTag(block, 'party');
    const stateCode   = block.match(/<state postal-code="([^"]+)"/)?.[1] || null;
    const stateName   = xmlTag(block, 'state-fullname');
    const district    = xmlTag(block, 'district');

    // Parse committee-assignments block
    const caBlock = block.match(/<committee-assignments>([\s\S]*?)<\/committee-assignments>/)?.[1] || '';

    const committees = [];

    // <committee comcode="II00" rank="22"/>
    const comPat = /<committee\s+comcode="([^"]+)"\s+rank="(\d+)"(?:\s+leadership="([^"]*)")?\s*\/>/gi;
    let cm;
    while ((cm = comPat.exec(caBlock)) !== null) {
      const code = cm[1];
      committees.push({
        code,
        name:       comcodeMap[code] || code,
        rank:       parseInt(cm[2], 10),
        role:       cm[3] ? cm[3].trim() : 'Member',
        type:       'committee',
      });
    }

    // <subcommittee subcomcode="II06" rank="13" leadership="Vice Chair"/>
    const subPat = /<subcommittee\s+subcomcode="([^"]+)"\s+rank="(\d+)"(?:\s+leadership="([^"]*)")?\s*\/>/gi;
    while ((cm = subPat.exec(caBlock)) !== null) {
      const code     = cm[1];
      // Parent committee code is first 2 letters + "00"
      const parentCode = code.slice(0, 2) + '00';
      committees.push({
        code,
        name:       comcodeMap[code] || comcodeMap[parentCode] || code,
        parent_code: parentCode,
        rank:        parseInt(cm[2], 10),
        role:        cm[3] ? cm[3].trim() : 'Member',
        type:        'subcommittee',
      });
    }

    if (!bioguideId) continue;

    records.push({
      id:           `us_${bioguideId}`,
      source:       'usa',
      bioguide_id:  safeStr(bioguideId),
      first_name:   safeStr(firstName),
      last_name:    safeStr(lastName),
      middle_name:  safeStr(middleName),
      party:        safeStr(party),
      state:        safeStr(stateCode),
      state_name:   safeStr(stateName),
      district:     safeStr(district),
      committees,
    });
  }

  const result = saveRecords('usa', records);
  console.log(`[us-cmte] ✓ ${result.count} members → ${result.filepath}`);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'https://clerk.house.gov/xml/lists/MemberData.xml', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
}

// ─── UK — members-api.parliament.uk ──────────────────────────────────────────

const UK_API        = 'https://members-api.parliament.uk/api';
const UK_CMTE_TARGET = parseInt(process.env.UK_CMTE_TARGET || '150', 10);
const CURRENT_YEAR  = new Date().getFullYear();

async function fetchUKCommittees() {
  const _ts = new Date().toISOString();
  console.log('[uk-cmte] Fetching current Commons MPs...');
  const mpList = [];
  let skip     = 0;
  const take   = 20;

  while (mpList.length < UK_CMTE_TARGET) {
    const r = await axios.get(`${UK_API}/Members/Search`, {
      params:  { house: 1, isCurrentMember: 'true', skip, take },
      timeout: TIMEOUT_MS,
    });
    const items = r.data?.items || [];
    if (items.length === 0) break;
    mpList.push(...items);
    if (mpList.length >= (r.data?.totalResults || 0)) break;
    skip += take;
    await sleep(200);
  }

  const targetList = mpList.slice(0, UK_CMTE_TARGET);
  console.log(`[uk-cmte] ${targetList.length} MPs, fetching biographies...`);

  const records = [];
  let done = 0;
  const cutoff = new Date(`${CURRENT_YEAR - 2}-01-01`);

  for (const mp of targetList) {
    const id   = mp.value?.id;
    const name = mp.value?.nameDisplayAs;
    if (!id) continue;

    let committees = [];

    try {
      const bioR = await axios.get(`${UK_API}/Members/${id}/Biography`, { timeout: TIMEOUT_MS });
      const bio  = bioR.data?.value || {};

      const raw = bio.committeeMemberships || [];
      committees = raw
        .filter(c => !c.endDate || new Date(c.endDate) >= cutoff)
        .map(c => ({
          name:       safeStr(c.name),
          id:         c.id,
          role:       !c.endDate ? 'Current Member' : 'Former Member',
          start_date: safeStr(c.startDate ? c.startDate.slice(0, 10) : null),
          end_date:   safeStr(c.endDate   ? c.endDate.slice(0, 10)   : null),
          current:    !c.endDate,
        }));
    } catch (err) {
      console.warn(`[uk-cmte] ⚠ MP ${id}: ${err.message}`);
    }

    records.push({
      id:              `uk_${id}`,
      source:          'uk',
      parliament_id:   id,
      name:            safeStr(name),
      party:           safeStr(mp.value?.latestParty?.name),
      constituency:    safeStr(mp.value?.latestHouseMembership?.membershipFrom),
      committees,
    });

    done++;
    if (done % 25 === 0) console.log(`[uk-cmte] ${done}/${targetList.length} done`);
    await sleep(200);
  }

  const result = saveRecords('uk', records);
  console.log(`[uk-cmte] ✓ ${result.count} records → ${result.filepath}`);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: 'https://members-api.parliament.uk/api', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
}

// ─── Australia — aph.gov.au HTML scrape ──────────────────────────────────────

const AU_BASE = 'https://www.aph.gov.au';
const AU_HEADERS = { 'User-Agent': 'CivicVoiceBot/1.0 (research; contact@civicvoice.app)' };

async function fetchAUCommitteeSlugs() {
  const slugs = [];
  const sections = ['House', 'Joint'];

  for (const section of sections) {
    try {
      const r = await axios.get(`${AU_BASE}/Parliamentary_Business/Committees/${section}`, {
        headers: AU_HEADERS, timeout: TIMEOUT_MS,
      });
      const html = r.data;
      // /Parliamentary_Business/Committees/House/Economics  (no trailing slash, no sub-paths)
      const pat = new RegExp(`href="(/Parliamentary_Business/Committees/${section}/[A-Za-z_]+)"`, 'g');
      let m;
      while ((m = pat.exec(html)) !== null) {
        if (!slugs.includes(m[1])) slugs.push(m[1]);
      }
    } catch (err) {
      console.warn(`[au-cmte] ⚠ Could not fetch ${section} committee list: ${err.message}`);
    }
    await sleep(400);
  }
  return slugs;
}

async function fetchAUCommitteeMembers(slug) {
  const url = `${AU_BASE}${slug}/Committee_Membership`;
  const r = await axios.get(url, { headers: AU_HEADERS, timeout: TIMEOUT_MS });
  const html = r.data;

  // Committee name from <h1> or page <title>
  const h1Match = html.match(/<h1[^>]*>([^<]+)/i);
  const committeeName = h1Match
    ? h1Match[1].replace(/&ndash;/g, '–').replace(/&amp;/g, '&').trim()
    : slug.split('/').pop().replace(/_/g, ' ');

  // Member list block: <ul class="search-filter-results...">
  //   <li> <h3> Chair </h3>
  //     <p class="title"><a href="/Senators_and_Members/Parliamentarian?MPID=12345">Name</a></p>
  //     <p> Party, Electorate STATE </p>
  //   </li>
  const members = [];

  const liPattern = /<li>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = liPattern.exec(html)) !== null) {
    const li = lm[1];

    // Role from <h3>
    const roleMatch = li.match(/<h3>\s*([^<]+)\s*<\/h3>/i);
    if (!roleMatch) continue;
    const role = roleMatch[1].trim();
    if (!role || role.length > 50) continue;

    // MPID and name from the title paragraph
    const mpidMatch = li.match(/Parliamentarian\?MPID=(\d+)"[^>]*>([^<]+)<\/a>/i);
    if (!mpidMatch) continue;
    const mpid     = mpidMatch[1];
    const fullName = mpidMatch[2].replace(/\s+/g, ' ').trim();

    // Party and electorate from the following <p>
    const partyMatch = li.match(/Parliamentarian\?MPID=\d+"[^>]*>[^<]+<\/a>[\s\S]{0,500}?<p>\s*([^<]+?)\s*<\/p>/i);
    let party = null, electorate = null, state = null;
    if (partyMatch) {
      const partyText = partyMatch[1].trim();
      // Format: "Australian Labor Party, Chifley NSW"
      const parts = partyText.split(',').map(s => s.trim());
      party = parts[0] || null;
      if (parts[1]) {
        // "Chifley NSW" → electorate + state
        const electorateParts = parts[1].trim().split(/\s+/);
        state       = electorateParts.pop() || null;
        electorate  = electorateParts.join(' ') || null;
      }
    }

    members.push({ mpid, full_name: fullName, role, party, electorate, state });
  }

  return { committeeName, slug, members };
}

async function fetchAUCommittees() {
  const _ts = new Date().toISOString();
  console.log('[au-cmte] Fetching AU committee slugs...');
  const slugs = await fetchAUCommitteeSlugs();
  console.log(`[au-cmte] ${slugs.length} committees found`);

  // Map: mpid → record
  const memberMap = {};
  let done = 0;

  for (const slug of slugs) {
    try {
      const { committeeName, members } = await fetchAUCommitteeMembers(slug);
      for (const m of members) {
        if (!memberMap[m.mpid]) {
          memberMap[m.mpid] = {
            id:         `au_${m.mpid}`,
            source:     'australia',
            mpid:       m.mpid,
            full_name:  m.full_name,
            party:      m.party,
            electorate: m.electorate,
            state:      m.state,
            committees: [],
          };
        }
        memberMap[m.mpid].committees.push({
          name:  committeeName,
          slug:  slug.split('/').pop(),
          role:  m.role,
        });
      }
    } catch (err) {
      console.warn(`[au-cmte] ⚠ ${slug}: ${err.message}`);
    }
    done++;
    if (done % 5 === 0) console.log(`[au-cmte] ${done}/${slugs.length} committees processed`);
    await sleep(500);
  }

  const records = Object.values(memberMap);
  const result  = saveRecords('australia', records);
  console.log(`[au-cmte] ✓ ${result.count} members → ${result.filepath}`);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: 'https://www.aph.gov.au/Parliamentary_Business/Committees', record_count: result.count, import_status: 'success', scheduler_tier: SCHEDULER_TIER });
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchAllMemberCommittees() {
  console.log('[member-committees] Starting committee fetch for all sources...');
  const results = {};

  try {
    results.canada = await fetchCanadaCommittees();
  } catch (err) {
    console.error('[member-committees] CA failed:', err.message);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://www.ourcommons.ca/Committees/en/', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.canada = { count: 0, error: err.message };
  }

  try {
    results.usa = await fetchUSCommittees();
  } catch (err) {
    console.error('[member-committees] US failed:', err.message);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://clerk.house.gov/xml/lists/MemberData.xml', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.usa = { count: 0, error: err.message };
  }

  try {
    results.uk = await fetchUKCommittees();
  } catch (err) {
    console.error('[member-committees] UK failed:', err.message);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://members-api.parliament.uk/api', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.uk = { count: 0, error: err.message };
  }

  try {
    results.australia = await fetchAUCommittees();
  } catch (err) {
    console.error('[member-committees] AU failed:', err.message);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: new Date().toISOString(), source_endpoint: 'https://www.aph.gov.au/Parliamentary_Business/Committees', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    results.australia = { count: 0, error: err.message };
  }

  const total = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);
  console.log(`[member-committees] Complete — ${total} total member records written`);
  return results;
}

module.exports = {
  fetchAllMemberCommittees,
  fetchCanadaCommittees,
  fetchUSCommittees,
  fetchUKCommittees,
  fetchAUCommittees,
};

// Direct execution
if (require.main === module) {
  fetchAllMemberCommittees()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
