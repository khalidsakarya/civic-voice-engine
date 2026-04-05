/**
 * Member Bio Fetcher — Civic Voice Engine
 *
 * Fetches real member biographies from official government sources and writes
 * one Firestore document per member with identity, party, career history,
 * contact info, and a short biography where available.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * CA   openparliament.ca/api/politicians/
 *      List: GET /politicians/?format=json&current=true&limit=200
 *      Detail: GET /politicians/{slug}/?format=json
 *      Fields: given_name, family_name, gender, image, email, voice,
 *              memberships (party + riding), links (ourcommons URL), other_info
 *
 * US   api.congress.gov/v3/member
 *      List: GET /v3/member?format=json&currentMember=true&limit=250 (paginated)
 *      Detail: GET /v3/member/{bioguideId}?format=json
 *      Fields: firstName, lastName, birthYear, state, district, partyHistory,
 *              terms, addressInformation, officialWebsiteUrl, depiction.imageUrl
 *
 * UK   members-api.parliament.uk/api/Members
 *      List: GET /api/Members/Search?house=1&isCurrentMember=true (paginated 20/page)
 *      Synopsis: GET /api/Members/{id}/Synopsis → { value: "<html>" }
 *      Biography: GET /api/Members/{id}/Biography → { value: { representations,
 *                 governmentPosts, oppositionPosts, partyAffiliations,
 *                 committeeMemberships } }
 *
 * AU   aph.gov.au/Senators_and_Members/Members
 *      HTML scrape of the member listing and individual profile pages.
 *      No JSON API exists for federal members.
 *
 * Output: output/member_bios/{source}_{timestamp}.json
 * Firestore: member_bios collection
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR   = path.resolve(__dirname, '../../output/member_bios');
const TIMEOUT_MS   = 45_000;
const CONGRESS_KEY = process.env.CONGRESS_API_KEY || 'DEMO_KEY';

// ─── Shared helpers ───────────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().slice(0, 1000) || null : null);
const sleep   = ms => new Promise(r => setTimeout(r, ms));

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

// Strip HTML tags from a synopsis string
function stripHtml(html) {
  if (!html) return null;
  return html.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 2000) || null;
}

// ─── Canada — openparliament.ca ───────────────────────────────────────────────

const CA_API = 'https://api.openparliament.ca';

async function fetchCanadaBios() {
  console.log('[ca-bios] Fetching current MP list from openparliament.ca...');
  const slugs = [];
  let offset  = 0;
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
      if (slug) slugs.push(slug);
    }
    if (!r.data?.pagination?.next_url) break;
    offset += limit;
    await sleep(300);
  }

  console.log(`[ca-bios] ${slugs.length} MPs found, fetching details...`);
  const records = [];
  let done = 0;

  for (const slug of slugs) {
    try {
      const r = await axios.get(`${CA_API}/politicians/${slug}/`, {
        params:  { format: 'json' },
        headers: { Accept: 'application/json' },
        timeout: TIMEOUT_MS,
      });
      const d = r.data;

      // Most recent membership first
      const mem   = Array.isArray(d.memberships) ? d.memberships[0] : null;
      const party = mem?.party?.short_name?.en || mem?.party?.name?.en || null;
      const riding = mem?.riding?.name?.en || null;
      const province = mem?.riding?.province || null;

      // Find ourcommons link
      const ourcommonsUrl = (d.links || []).find(l => l.url?.includes('ourcommons'))?.url || null;

      records.push({
        id:             `ca_${slug}`,
        source:         'canada',
        slug,
        given_name:     safeStr(d.given_name),
        family_name:    safeStr(d.family_name),
        name:           safeStr(d.name),
        gender:         safeStr(d.gender),
        image_url:      safeStr(d.image),
        email:          safeStr(d.email),
        phone:          safeStr(d.voice),
        party,
        riding,
        province,
        twitter:        safeStr(d.other_info?.twitter?.[0]),
        parl_mp_id:     safeStr(d.other_info?.parl_mp_id?.[0]),
        ourcommons_url: safeStr(ourcommonsUrl),
        openparl_url:   `https://openparliament.ca/politicians/${slug}/`,
      });
    } catch (err) {
      console.warn(`[ca-bios] ⚠ ${slug}: ${err.message}`);
    }

    done++;
    if (done % 50 === 0) console.log(`[ca-bios] ${done}/${slugs.length} done`);
    await sleep(200);
  }

  const result = saveRecords('canada', records);
  console.log(`[ca-bios] ✓ ${result.count} records → ${result.filepath}`);
  return result;
}

// ─── US — api.congress.gov ────────────────────────────────────────────────────

const US_API = 'https://api.congress.gov';

async function fetchUSBios() {
  console.log('[us-bios] Fetching current members from api.congress.gov...');
  const members = [];
  let offset    = 0;
  const limit   = 250;

  while (true) {
    const r = await axios.get(`${US_API}/v3/member`, {
      params:  { format: 'json', currentMember: 'true', limit, offset, api_key: CONGRESS_KEY },
      timeout: TIMEOUT_MS,
    });
    const list = r.data?.members || [];
    members.push(...list);
    if (!r.data?.pagination?.next) break;
    offset += limit;
    await sleep(500);
  }

  console.log(`[us-bios] ${members.length} members found, fetching details...`);
  const records = [];
  let done = 0;

  for (const m of members) {
    const bioguideId = m.bioguideId;
    if (!bioguideId) continue;

    try {
      const r = await axios.get(`${US_API}/v3/member/${bioguideId}`, {
        params:  { format: 'json', api_key: CONGRESS_KEY },
        timeout: TIMEOUT_MS,
      });
      const d = r.data?.member || r.data || {};

      // Latest party from partyHistory
      const partyHistory = Array.isArray(d.partyHistory) ? d.partyHistory : [];
      const latestParty  = partyHistory.sort((a, b) =>
        (b.startYear || 0) - (a.startYear || 0)
      )[0];

      // Latest term
      const terms      = Array.isArray(d.terms?.item) ? d.terms.item : (Array.isArray(d.terms) ? d.terms : []);
      const latestTerm = terms.sort((a, b) => (b.startYear || 0) - (a.startYear || 0))[0];

      records.push({
        id:               `us_${bioguideId}`,
        source:           'usa',
        bioguide_id:      safeStr(bioguideId),
        first_name:       safeStr(d.firstName),
        last_name:        safeStr(d.lastName),
        middle_name:      safeStr(d.middleName),
        honorific:        safeStr(d.honorificName),
        birth_year:       d.birthYear ? Number(d.birthYear) : null,
        state:            safeStr(d.state || latestTerm?.stateName),
        district:         d.district != null ? Number(d.district) : null,
        chamber:          safeStr(latestTerm?.chamber),
        party:            safeStr(latestParty?.partyName),
        party_code:       safeStr(latestParty?.partyAbbreviation),
        office_address:   safeStr(d.addressInformation?.officeAddress),
        office_city:      safeStr(d.addressInformation?.city),
        office_zip:       safeStr(d.addressInformation?.zipCode),
        office_phone:     safeStr(d.addressInformation?.phoneNumber),
        official_url:     safeStr(d.officialWebsiteUrl),
        image_url:        safeStr(d.depiction?.imageUrl),
        image_attribution:safeStr(d.depiction?.attribution),
        current_member:   d.currentMember === true,
        term_start:       latestTerm?.startYear ? Number(latestTerm.startYear) : null,
        term_end:         latestTerm?.endYear   ? Number(latestTerm.endYear)   : null,
      });
    } catch (err) {
      console.warn(`[us-bios] ⚠ ${bioguideId}: ${err.message}`);
    }

    done++;
    if (done % 100 === 0) console.log(`[us-bios] ${done}/${members.length} done`);
    await sleep(350);
  }

  const result = saveRecords('usa', records);
  console.log(`[us-bios] ✓ ${result.count} records → ${result.filepath}`);
  return result;
}

// ─── UK — members-api.parliament.uk ──────────────────────────────────────────

const UK_API        = 'https://members-api.parliament.uk/api';
const UK_TARGET_MPs = parseInt(process.env.UK_BIO_TARGET || '100', 10);

async function fetchUKBios() {
  console.log('[uk-bios] Fetching current Commons MPs...');
  const mpList = [];
  let skip     = 0;
  const take   = 20; // API cap

  while (mpList.length < UK_TARGET_MPs) {
    const r = await axios.get(`${UK_API}/Members/Search`, {
      params:  { house: 1, isCurrentMember: 'true', skip, take },
      timeout: TIMEOUT_MS,
    });
    const items = r.data?.items || [];
    if (items.length === 0) break;
    mpList.push(...items);
    if (mpList.length >= r.data?.totalResults) break;
    skip += take;
    await sleep(200);
  }

  const targetList = mpList.slice(0, UK_TARGET_MPs);
  console.log(`[uk-bios] ${targetList.length} MPs, fetching bios...`);

  const records = [];
  let done = 0;

  for (const mp of targetList) {
    const id   = mp.value?.id;
    const name = mp.value?.nameDisplayAs;
    if (!id) continue;

    let synopsis    = null;
    let biography   = null;

    try {
      const synR = await axios.get(`${UK_API}/Members/${id}/Synopsis`, { timeout: TIMEOUT_MS });
      synopsis = stripHtml(synR.data?.value);
      await sleep(150);
    } catch (_) {}

    try {
      const bioR = await axios.get(`${UK_API}/Members/${id}/Biography`, { timeout: TIMEOUT_MS });
      biography = bioR.data?.value || null;
      await sleep(150);
    } catch (_) {}

    // Latest party affiliation
    const partyAffiliations = biography?.partyAffiliations || [];
    const currentParty = partyAffiliations
      .filter(p => !p.endDate)
      .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))[0];

    // Latest constituency representation
    const representations = biography?.representations || [];
    const currentConst = representations
      .filter(r => !r.endDate)
      .sort((a, b) => new Date(b.startDate || 0) - new Date(a.startDate || 0))[0];

    records.push({
      id:                   `uk_${id}`,
      source:               'uk',
      parliament_id:        id,
      name:                 safeStr(name),
      name_full_title:      safeStr(mp.value?.nameFullTitle),
      gender:               safeStr(mp.value?.gender),
      party:                safeStr(mp.value?.latestParty?.name),
      party_id:             mp.value?.latestParty?.id ?? null,
      constituency:         safeStr(mp.value?.latestHouseMembership?.membershipFrom),
      membership_start:     safeStr(mp.value?.latestHouseMembership?.membershipStartDate),
      thumbnail_url:        safeStr(mp.value?.thumbnailUrl),
      synopsis:             synopsis,
      govt_posts:           (biography?.governmentPosts || []).map(p => safeStr(p.name)).filter(Boolean),
      opposition_posts:     (biography?.oppositionPosts || []).map(p => safeStr(p.name)).filter(Boolean),
      committee_memberships:(biography?.committeeMemberships || []).map(p => safeStr(p.name)).filter(Boolean),
      current_party_start:  safeStr(currentParty?.startDate),
      current_constituency: safeStr(currentConst?.name),
    });

    done++;
    if (done % 25 === 0) console.log(`[uk-bios] ${done}/${targetList.length} done`);
    await sleep(200);
  }

  const result = saveRecords('uk', records);
  console.log(`[uk-bios] ✓ ${result.count} records → ${result.filepath}`);
  return result;
}

// ─── Australia — aph.gov.au (HTML scrape) ────────────────────────────────────

const AU_MEMBERS_URL = 'https://www.aph.gov.au/Senators_and_Members/Members';
// Profile base: https://www.aph.gov.au/Senators_and_Members/Members/Register
// Individual profile: https://www.aph.gov.au{href}

async function fetchAUBios() {
  console.log('[au-bios] Fetching AU member listing from aph.gov.au...');

  const listR = await axios.get(AU_MEMBERS_URL, {
    headers: { 'User-Agent': 'CivicVoiceBot/1.0 (research; contact@civicvoice.app)' },
    timeout: TIMEOUT_MS,
  });
  const html = listR.data;

  // Extract member rows from the listing table.
  // Each row looks like:
  //   <td><a href="/Senators_and_Members/Members/detail?Ident=XXX">Name, First</a></td>
  //   <td>Electorate</td><td>State</td><td>Party</td>
  const rowPattern = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const linkPattern = /href="(\/Senators_and_Members\/Members\/detail\?[^"]+)"[^>]*>([^<]+)<\/a>/i;
  const tdPattern = /<td[^>]*>([^<]*)<\/td>/gi;

  const rows = html.match(rowPattern) || [];
  const members = [];

  for (const row of rows) {
    const linkMatch = row.match(linkPattern);
    if (!linkMatch) continue;
    const href = linkMatch[1];
    const rawName = linkMatch[2].trim();
    if (!rawName || rawName.toLowerCase().includes('member')) continue;

    // Extract all <td> text values
    const tds = [];
    let m;
    while ((m = tdPattern.exec(row)) !== null) {
      tds.push(m[1].trim());
    }
    tdPattern.lastIndex = 0;

    // Name in listing is "Surname, Firstname" format
    const nameParts = rawName.split(',').map(s => s.trim());
    const lastName   = nameParts[0] || null;
    const firstName  = nameParts[1] || null;

    members.push({
      href,
      full_name: rawName,
      last_name: lastName,
      first_name: firstName,
      electorate: tds[1] || null,
      state:      tds[2] || null,
      party:      tds[3] || null,
    });
  }

  console.log(`[au-bios] ${members.length} AU members found from listing`);

  // Fetch individual profile pages for richer data
  const records = [];
  let done = 0;

  for (const mem of members) {
    const profileUrl = `https://www.aph.gov.au${mem.href}`;
    let bio = null;
    let email = null;
    let phone = null;
    let imageUrl = null;

    try {
      const profR = await axios.get(profileUrl, {
        headers: { 'User-Agent': 'CivicVoiceBot/1.0 (research; contact@civicvoice.app)' },
        timeout: TIMEOUT_MS,
      });
      const pHtml = profR.data;

      // Extract bio paragraph (first substantial <p> after the member details section)
      const bioMatch = pHtml.match(/<div[^>]+class="[^"]*biography[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (bioMatch) bio = stripHtml(bioMatch[1]);

      // Extract email
      const emailMatch = pHtml.match(/href="mailto:([^"]+)"/i);
      if (emailMatch) email = emailMatch[1].trim();

      // Extract phone
      const phoneMatch = pHtml.match(/(?:Phone|Tel)[^0-9+]*([0-9 +()-]{8,})/i);
      if (phoneMatch) phone = phoneMatch[1].trim();

      // Extract image
      const imgMatch = pHtml.match(/<img[^>]+class="[^"]*member[^"]*"[^>]+src="([^"]+)"/i)
                    || pHtml.match(/<img[^>]+src="([^"]+member[^"]+)"/i);
      if (imgMatch) {
        const src = imgMatch[1];
        imageUrl = src.startsWith('http') ? src : `https://www.aph.gov.au${src}`;
      }
    } catch (err) {
      console.warn(`[au-bios] ⚠ ${mem.full_name}: ${err.message}`);
    }

    // Build a stable ID from name + state
    const idKey = `${(mem.last_name || '').toLowerCase().replace(/[^a-z]/g, '')}_${(mem.state || '').toLowerCase().replace(/[^a-z]/g, '')}`;

    records.push({
      id:          `au_${idKey}`,
      source:      'australia',
      full_name:   safeStr(mem.full_name),
      first_name:  safeStr(mem.first_name),
      last_name:   safeStr(mem.last_name),
      electorate:  safeStr(mem.electorate),
      state:       safeStr(mem.state),
      party:       safeStr(mem.party),
      email,
      phone,
      image_url:   imageUrl,
      biography:   bio,
      profile_url: profileUrl,
    });

    done++;
    if (done % 30 === 0) console.log(`[au-bios] ${done}/${members.length} done`);
    await sleep(500); // polite delay for HTML scraping
  }

  const result = saveRecords('australia', records);
  console.log(`[au-bios] ✓ ${result.count} records → ${result.filepath}`);
  return result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchAllMemberBios() {
  console.log('[member-bios] Starting bio fetch for all sources...');
  const results = {};

  try {
    results.canada = await fetchCanadaBios();
  } catch (err) {
    console.error('[member-bios] CA failed:', err.message);
    results.canada = { count: 0, error: err.message };
  }

  try {
    results.usa = await fetchUSBios();
  } catch (err) {
    console.error('[member-bios] US failed:', err.message);
    results.usa = { count: 0, error: err.message };
  }

  try {
    results.uk = await fetchUKBios();
  } catch (err) {
    console.error('[member-bios] UK failed:', err.message);
    results.uk = { count: 0, error: err.message };
  }

  try {
    results.australia = await fetchAUBios();
  } catch (err) {
    console.error('[member-bios] AU failed:', err.message);
    results.australia = { count: 0, error: err.message };
  }

  const total = Object.values(results).reduce((s, r) => s + (r.count || 0), 0);
  console.log(`[member-bios] Complete — ${total} total bio records written`);
  return results;
}

module.exports = { fetchAllMemberBios, fetchCanadaBios, fetchUSBios, fetchUKBios, fetchAUBios };

// Direct execution
if (require.main === module) {
  fetchAllMemberBios()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
