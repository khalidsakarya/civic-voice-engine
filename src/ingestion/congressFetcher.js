'use strict';

/**
 * Fetches all current US Congress members and writes them to the Firestore
 * collection "congress_members".
 *
 * House  (435): clerk.house.gov/xml/lists/MemberData.xml — official clerk XML;
 *               GovTrack representatives API used for website / full address.
 * Senate (100): GovTrack senators API — senate.gov/general/contact_information/
 *               senators_cfm.xml returns 403 from automated clients.
 *
 * Doc IDs:  us-house-{bioguideID}  /  us-senate-{bioguideID}
 * Fields:   name, state, district, party, bioguide_id, office_address,
 *           phone, website, contact_form, date_sworn, date_elected (House only)
 *
 * Run:  node src/ingestion/congressFetcher.js
 */

require('dotenv').config();
const axios          = require('axios');
const https          = require('https');
const { getDb }         = require('../firebase/client');
const { writeAuditLog } = require('../firebase/auditLog');

const COLLECTION     = 'congress_members';
const SCHEDULER_TIER = 'weekly';
const BROWSER_UA     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PARTY_FULL = { R: 'Republican', D: 'Democrat', I: 'Independent', L: 'Libertarian' };

// Building code → full name (used when constructing office_address from clerk XML)
const HOUSE_BUILDINGS = {
  CHOB: 'Cannon House Office Building',
  LHOB: 'Longworth House Office Building',
  RHOB: 'Rayburn House Office Building',
  OHOB: "O'Neill House Office Building",
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,text/xml,*/*' },
      timeout: 30000,
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

async function govtrackGet(path) {
  const url = `https://www.govtrack.us/api/v2/${path}`;
  const r   = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
    responseType: 'json',
    maxRedirects: 3,
  });
  return r.data;
}

// ─── Date helper ─────────────────────────────────────────────────────────────

function yyyymmddToISO(s) {
  if (!s || s.length !== 8) return s || null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// ─── House XML parser ─────────────────────────────────────────────────────────

function parseHouseXML(xml) {
  const members = [];
  for (const [, block] of xml.matchAll(/<member>([\s\S]*?)<\/member>/g)) {
    const info = block.match(/<member-info>([\s\S]*?)<\/member-info>/)?.[1];
    if (!info) continue;

    const get  = tag => info.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1]?.trim() || null;
    const attr = (tag, a) => info.match(new RegExp(`<${tag}[^>]* ${a}="([^"]*)"`))
                              ?.[1]?.trim() || null;

    const bioguide_id = get('bioguideID');
    if (!bioguide_id) continue;

    const building = get('office-building');
    const room     = get('office-room');
    const buildingName = HOUSE_BUILDINGS[building] || building;
    const office_address = building && room
      ? `${room} ${buildingName}, Washington DC 20515`
      : null;

    const dateElectedRaw = attr('elected-date', 'date');
    const dateSwornRaw   = attr('sworn-date',   'date');
    const rawDistrict    = get('district');

    members.push({
      chamber:         'house',
      jurisdiction:    'US',
      bioguide_id,
      name: {
        first:    get('firstname'),
        last:     get('lastname'),
        middle:   get('middlename') || null,
        suffix:   get('suffix')    || null,
        official: get('official-name'),
      },
      state:           attr('state', 'postal-code'),
      state_name:      info.match(/<state-fullname>([^<]+)<\/state-fullname>/)?.[1]?.trim() || null,
      district:        rawDistrict === 'At Large' ? '0' : rawDistrict,
      district_label:  rawDistrict,
      party:           get('party'),
      party_full:      PARTY_FULL[get('party')] || get('party'),
      office_address,
      office_building: building,
      office_room:     room,
      phone:           get('phone'),
      // House members use web forms; no direct email address
      email:           null,
      website:         null,   // enriched from GovTrack below
      contact_form:    null,
      date_elected:    yyyymmddToISO(dateElectedRaw),
      date_sworn:      yyyymmddToISO(dateSwornRaw),
      congress:        119,
      source:          'clerk.house.gov',
    });
  }
  return members;
}

// ─── Firestore batch writer ───────────────────────────────────────────────────

async function batchSet(db, records) {
  let written = 0;
  for (let i = 0; i < records.length; i += 499) {
    const chunk = records.slice(i, i + 499);
    const batch = db.batch();
    for (const { docId, data } of chunk) {
      batch.set(db.collection(COLLECTION).doc(docId), data, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`[congress] Batch committed: ${written}/${records.length}`);
  }
  return written;
}

// ─── Main fetcher ─────────────────────────────────────────────────────────────

async function fetchAllCongress() {
  const db = getDb();
  const ts = new Date().toISOString();
  console.log(`\n[congress] Fetching all US Congress members — ${ts}\n`);

  // ── 1. House clerk XML ─────────────────────────────────────────────────────
  console.log('[congress:house] Fetching clerk.house.gov XML...');
  const houseXml   = await httpsGet('https://clerk.house.gov/xml/lists/MemberData.xml');
  const houseByXML = parseHouseXML(houseXml);
  console.log(`[congress:house] Parsed ${houseByXML.length} members from clerk XML`);

  // ── 2. GovTrack representatives — for website, contact_form, full address ──
  console.log('[congress:house] Fetching GovTrack representatives API...');
  const gtRepData = await govtrackGet('role?current=true&role_type=representative&limit=500&format=json');
  const gtRepMap  = new Map(); // bioguide_id → {website, address, contact_form}
  for (const obj of gtRepData.objects || []) {
    const bg = obj.person?.bioguideid;
    if (bg) gtRepMap.set(bg, {
      website:      obj.website      || null,
      contact_form: obj.extra?.contact_form || null,
      gt_address:   obj.extra?.address || null,
    });
  }
  console.log(`[congress:house] GovTrack: ${gtRepMap.size} representatives mapped`);

  // Enrich House records with GovTrack website / address
  const houseRecords = houseByXML.map(m => {
    const gt = gtRepMap.get(m.bioguide_id) || {};
    return {
      ...m,
      website:      gt.website      || null,
      contact_form: gt.contact_form || null,
      // Prefer GovTrack full address if available (has ZIP+4), else keep clerk-derived
      office_address: gt.gt_address || m.office_address,
    };
  });

  // ── 3. GovTrack senators ───────────────────────────────────────────────────
  // senate.gov/general/contact_information/senators_cfm.xml returns 403 from
  // automated clients (Akamai CDN blocks). GovTrack provides the same dataset.
  console.log('[congress:senate] Fetching GovTrack senators API...');
  const gtSenData  = await govtrackGet('role?current=true&role_type=senator&limit=150&format=json');
  const senRecords = [];

  for (const obj of gtSenData.objects || []) {
    const person = obj.person || {};
    const bioguide_id = person.bioguideid;
    if (!bioguide_id) continue;

    const partyCode = obj.party === 'Republican' ? 'R'
                    : obj.party === 'Democrat'    ? 'D'
                    : obj.party === 'Independent' ? 'I' : obj.party;

    senRecords.push({
      chamber:        'senate',
      jurisdiction:   'US',
      bioguide_id,
      name: {
        first:    person.firstname,
        last:     person.lastname,
        middle:   person.middlename || null,
        suffix:   person.namemod   || null,
        official: `${person.firstname}${person.middlename ? ' ' + person.middlename : ''} ${person.lastname}${person.namemod ? ' ' + person.namemod : ''}`.trim(),
      },
      state:          obj.state,
      state_name:     obj.description?.match(/Senator for ([^']+)/i)?.[1]?.trim() || null,
      district:       null,
      district_label: null,
      party:          partyCode,
      party_full:     obj.party || null,
      senator_class:  obj.senator_class  || null,
      senator_rank:   obj.senator_rank   || null,
      office_address: obj.extra?.address || null,
      phone:          obj.phone          || null,
      email:          null,
      website:        obj.website        || null,
      contact_form:   obj.extra?.contact_form || null,
      date_elected:   null,
      date_sworn:     obj.startdate      || null,
      term_end:       obj.enddate        || null,
      congress:       119,
      source:         'govtrack.us',
    });
  }
  console.log(`[congress:senate] Fetched ${senRecords.length} senators`);

  // ── 4. Write to Firestore ─────────────────────────────────────────────────
  const ts2 = new Date().toISOString();
  const allRecords = [
    ...houseRecords.map(m => ({
      docId: `us-house-${m.bioguide_id}`,
      data:  { ...m, last_updated: ts2 },
    })),
    ...senRecords.map(m => ({
      docId: `us-senate-${m.bioguide_id}`,
      data:  { ...m, last_updated: ts2 },
    })),
  ];

  console.log(`\n[congress] Writing ${allRecords.length} records to "${COLLECTION}"...`);
  const written = await batchSet(db, allRecords);

  await writeAuditLog({
    collection_name:     COLLECTION,
    jurisdiction:        'US',
    data_pull_timestamp: ts,
    source_endpoint:     'clerk.house.gov + govtrack.us',
    record_count:        written,
    import_status:       written === allRecords.length ? 'success' : 'partial',
    scheduler_tier:      SCHEDULER_TIER,
  });

  console.log(`\n[congress] Done — ${written} members written to "${COLLECTION}"`);
  console.log(`  House:  ${houseRecords.length}`);
  console.log(`  Senate: ${senRecords.length}`);
  return { house: houseRecords.length, senate: senRecords.length, total: written };
}

module.exports = { fetchAllCongress };

if (require.main === module) {
  fetchAllCongress()
    .then(r => { console.log('\n[congress] Result:', JSON.stringify(r)); process.exit(0); })
    .catch(err => { console.error('[congress] Fatal:', err.message); process.exit(1); });
}
