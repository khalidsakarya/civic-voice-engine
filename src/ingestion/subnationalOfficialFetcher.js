'use strict';
/**
 * subnationalOfficialFetcher.js
 *
 * Fetches verified official data for subnational_jurisdictions from government APIs only.
 * Sources: US Census Bureau, Statistics Canada WDS, ABS (Australia), ONS (UK static).
 *
 * Fields written: capital, area_km2, officialWebsite, population, leader_name,
 *                 leader_party, leader_title, needs_manual_review.
 *
 * Default: DRY RUN. Pass --write to commit.
 * Merge only — no deletes, no creates, no null overwrites.
 */

require('dotenv').config();

const axios  = require('axios');
const { getDb } = require('../firebase/client');

const COLLECTION = 'subnational_jurisdictions';
const BATCH_SIZE = 200;
const WRITE_MODE = process.argv.includes('--write');
const TIMEOUT_MS = 20_000;

// ─── Static reference data ────────────────────────────────────────────────────
// Sources: official government publications.
// Leader names verified against official government websites as of 2025-08.
// All leader fields carry needs_manual_review — they change with elections.
const STATIC = {
  // ── Canada (13 provinces/territories) ────────────────────────────────────────
  'CA-AB': { capital: 'Edmonton',      area_km2: 661848,   officialWebsite: 'https://www.alberta.ca',            leader_name: 'Danielle Smith',   leader_party: 'United Conservative Party', leader_title: 'Premier' },
  'CA-BC': { capital: 'Victoria',      area_km2: 944735,   officialWebsite: 'https://www2.gov.bc.ca',            leader_name: 'David Eby',        leader_party: 'NDP',                       leader_title: 'Premier' },
  'CA-MB': { capital: 'Winnipeg',      area_km2: 647797,   officialWebsite: 'https://www.gov.mb.ca',             leader_name: 'Wab Kinew',        leader_party: 'NDP',                       leader_title: 'Premier' },
  'CA-NB': { capital: 'Fredericton',   area_km2: 72908,    officialWebsite: 'https://www2.gnb.ca',               leader_name: 'Susan Holt',       leader_party: 'Liberal',                   leader_title: 'Premier' },
  'CA-NL': { capital: "St. John's",    area_km2: 405212,   officialWebsite: 'https://www.gov.nl.ca',             leader_name: 'Andrew Furey',     leader_party: 'Liberal',                   leader_title: 'Premier' },
  'CA-NS': { capital: 'Halifax',       area_km2: 55284,    officialWebsite: 'https://novascotia.ca',             leader_name: 'Tim Houston',      leader_party: 'Progressive Conservative',  leader_title: 'Premier' },
  'CA-NT': { capital: 'Yellowknife',   area_km2: 1346106,  officialWebsite: 'https://www.gov.nt.ca',             leader_name: 'R.J. Simpson',     leader_party: 'Independent',               leader_title: 'Premier' },
  'CA-NU': { capital: 'Iqaluit',       area_km2: 2093190,  officialWebsite: 'https://www.gov.nu.ca',             leader_name: 'P.J. Akeeagok',    leader_party: 'Independent',               leader_title: 'Premier' },
  'CA-ON': { capital: 'Toronto',       area_km2: 1076395,  officialWebsite: 'https://www.ontario.ca',            leader_name: 'Doug Ford',        leader_party: 'Progressive Conservative',  leader_title: 'Premier' },
  'CA-PE': { capital: 'Charlottetown', area_km2: 5660,     officialWebsite: 'https://www.princeedwardisland.ca', leader_name: 'Dennis King',      leader_party: 'Progressive Conservative',  leader_title: 'Premier' },
  'CA-QC': { capital: 'Quebec City',   area_km2: 1542056,  officialWebsite: 'https://www.quebec.ca/en',          leader_name: 'François Legault', leader_party: 'Coalition Avenir Québec',   leader_title: 'Premier' },
  'CA-SK': { capital: 'Regina',        area_km2: 651036,   officialWebsite: 'https://www.saskatchewan.ca',       leader_name: 'Scott Moe',        leader_party: 'Saskatchewan Party',        leader_title: 'Premier' },
  'CA-YT': { capital: 'Whitehorse',    area_km2: 482443,   officialWebsite: 'https://yukon.ca',                  leader_name: 'Ranj Pillai',      leader_party: 'Liberal',                   leader_title: 'Premier' },

  // ── US states + DC (no leader names — too many post-2024 election changes) ──
  'US-AL': { capital: 'Montgomery',      area_km2: 135767,  officialWebsite: 'https://www.alabama.gov' },
  'US-AK': { capital: 'Juneau',          area_km2: 1723337, officialWebsite: 'https://www.alaska.gov' },
  'US-AZ': { capital: 'Phoenix',         area_km2: 295234,  officialWebsite: 'https://az.gov' },
  'US-AR': { capital: 'Little Rock',     area_km2: 137732,  officialWebsite: 'https://www.arkansas.gov' },
  'US-CA': { capital: 'Sacramento',      area_km2: 423967,  officialWebsite: 'https://www.ca.gov' },
  'US-CO': { capital: 'Denver',          area_km2: 269601,  officialWebsite: 'https://www.colorado.gov' },
  'US-CT': { capital: 'Hartford',        area_km2: 14357,   officialWebsite: 'https://portal.ct.gov' },
  'US-DE': { capital: 'Dover',           area_km2: 6446,    officialWebsite: 'https://www.delaware.gov' },
  'US-DC': { capital: 'Washington D.C.', area_km2: 177,     officialWebsite: 'https://dc.gov' },
  'US-FL': { capital: 'Tallahassee',     area_km2: 170312,  officialWebsite: 'https://www.myflorida.com' },
  'US-GA': { capital: 'Atlanta',         area_km2: 153910,  officialWebsite: 'https://georgia.gov' },
  'US-HI': { capital: 'Honolulu',        area_km2: 28313,   officialWebsite: 'https://www.ehawaii.gov' },
  'US-ID': { capital: 'Boise',           area_km2: 216443,  officialWebsite: 'https://www.idaho.gov' },
  'US-IL': { capital: 'Springfield',     area_km2: 149995,  officialWebsite: 'https://www2.illinois.gov' },
  'US-IN': { capital: 'Indianapolis',    area_km2: 94326,   officialWebsite: 'https://www.in.gov' },
  'US-IA': { capital: 'Des Moines',      area_km2: 145746,  officialWebsite: 'https://www.iowa.gov' },
  'US-KS': { capital: 'Topeka',          area_km2: 213100,  officialWebsite: 'https://www.kansas.gov' },
  'US-KY': { capital: 'Frankfort',       area_km2: 104656,  officialWebsite: 'https://www.kentucky.gov' },
  'US-LA': { capital: 'Baton Rouge',     area_km2: 134382,  officialWebsite: 'https://www.louisiana.gov' },
  'US-ME': { capital: 'Augusta',         area_km2: 91633,   officialWebsite: 'https://www.maine.gov' },
  'US-MD': { capital: 'Annapolis',       area_km2: 32131,   officialWebsite: 'https://www.maryland.gov' },
  'US-MA': { capital: 'Boston',          area_km2: 27336,   officialWebsite: 'https://www.mass.gov' },
  'US-MI': { capital: 'Lansing',         area_km2: 250487,  officialWebsite: 'https://www.michigan.gov' },
  'US-MN': { capital: 'Saint Paul',      area_km2: 225163,  officialWebsite: 'https://mn.gov' },
  'US-MS': { capital: 'Jackson',         area_km2: 125438,  officialWebsite: 'https://www.ms.gov' },
  'US-MO': { capital: 'Jefferson City',  area_km2: 180540,  officialWebsite: 'https://www.mo.gov' },
  'US-MT': { capital: 'Helena',          area_km2: 380831,  officialWebsite: 'https://www.mt.gov' },
  'US-NE': { capital: 'Lincoln',         area_km2: 200330,  officialWebsite: 'https://www.nebraska.gov' },
  'US-NV': { capital: 'Carson City',     area_km2: 286380,  officialWebsite: 'https://www.nv.gov' },
  'US-NH': { capital: 'Concord',         area_km2: 24214,   officialWebsite: 'https://www.nh.gov' },
  'US-NJ': { capital: 'Trenton',         area_km2: 22591,   officialWebsite: 'https://www.nj.gov' },
  'US-NM': { capital: 'Santa Fe',        area_km2: 314917,  officialWebsite: 'https://www.newmexico.gov' },
  'US-NY': { capital: 'Albany',          area_km2: 141297,  officialWebsite: 'https://www.ny.gov' },
  'US-NC': { capital: 'Raleigh',         area_km2: 139391,  officialWebsite: 'https://www.nc.gov' },
  'US-ND': { capital: 'Bismarck',        area_km2: 183108,  officialWebsite: 'https://www.nd.gov' },
  'US-OH': { capital: 'Columbus',        area_km2: 116098,  officialWebsite: 'https://ohio.gov' },
  'US-OK': { capital: 'Oklahoma City',   area_km2: 181037,  officialWebsite: 'https://www.ok.gov' },
  'US-OR': { capital: 'Salem',           area_km2: 254806,  officialWebsite: 'https://www.oregon.gov' },
  'US-PA': { capital: 'Harrisburg',      area_km2: 119280,  officialWebsite: 'https://www.pa.gov' },
  'US-RI': { capital: 'Providence',      area_km2: 4001,    officialWebsite: 'https://www.ri.gov' },
  'US-SC': { capital: 'Columbia',        area_km2: 82933,   officialWebsite: 'https://www.sc.gov' },
  'US-SD': { capital: 'Pierre',          area_km2: 199729,  officialWebsite: 'https://www.sd.gov' },
  'US-TN': { capital: 'Nashville',       area_km2: 109153,  officialWebsite: 'https://www.tn.gov' },
  'US-TX': { capital: 'Austin',          area_km2: 695662,  officialWebsite: 'https://www.texas.gov' },
  'US-UT': { capital: 'Salt Lake City',  area_km2: 219882,  officialWebsite: 'https://utah.gov' },
  'US-VT': { capital: 'Montpelier',      area_km2: 24906,   officialWebsite: 'https://www.vermont.gov' },
  'US-VA': { capital: 'Richmond',        area_km2: 110787,  officialWebsite: 'https://www.virginia.gov' },
  'US-WA': { capital: 'Olympia',         area_km2: 184661,  officialWebsite: 'https://www.wa.gov' },
  'US-WV': { capital: 'Charleston',      area_km2: 62756,   officialWebsite: 'https://www.wv.gov' },
  'US-WI': { capital: 'Madison',         area_km2: 169635,  officialWebsite: 'https://www.wisconsin.gov' },
  'US-WY': { capital: 'Cheyenne',        area_km2: 253335,  officialWebsite: 'https://www.wyo.gov' },

  // ── Australia (8 states/territories) ─────────────────────────────────────────
  'AU-NSW': { capital: 'Sydney',    area_km2: 800641,  officialWebsite: 'https://www.nsw.gov.au',  leader_name: 'Chris Minns',       leader_party: 'Australian Labor Party',     leader_title: 'Premier' },
  'AU-VIC': { capital: 'Melbourne', area_km2: 237659,  officialWebsite: 'https://www.vic.gov.au',  leader_name: 'Jacinta Allan',     leader_party: 'Australian Labor Party',     leader_title: 'Premier' },
  'AU-QLD': { capital: 'Brisbane',  area_km2: 1852642, officialWebsite: 'https://www.qld.gov.au',  leader_name: 'David Crisafulli',  leader_party: 'Liberal National Party',     leader_title: 'Premier' },
  'AU-SA':  { capital: 'Adelaide',  area_km2: 1044353, officialWebsite: 'https://www.sa.gov.au',   leader_name: 'Peter Malinauskas', leader_party: 'Australian Labor Party',     leader_title: 'Premier' },
  'AU-WA':  { capital: 'Perth',     area_km2: 2646089, officialWebsite: 'https://www.wa.gov.au',   leader_name: 'Roger Cook',        leader_party: 'Australian Labor Party',     leader_title: 'Premier' },
  'AU-TAS': { capital: 'Hobart',    area_km2: 68401,   officialWebsite: 'https://www.tas.gov.au',  leader_name: 'Jeremy Rockliff',   leader_party: 'Liberal Party of Australia', leader_title: 'Premier' },
  'AU-NT':  { capital: 'Darwin',    area_km2: 1419630, officialWebsite: 'https://www.nt.gov.au',   leader_name: 'Eva Lawler',        leader_party: 'Australian Labor Party',     leader_title: 'Chief Minister' },
  'AU-ACT': { capital: 'Canberra',  area_km2: 2358,    officialWebsite: 'https://www.act.gov.au',  leader_name: 'Andrew Barr',       leader_party: 'Australian Labor Party',     leader_title: 'Chief Minister' },

  // ── UK devolved nations ───────────────────────────────────────────────────────
  'UK-SCT': { capital: 'Edinburgh', area_km2: 77933,  officialWebsite: 'https://www.gov.scot',           leader_name: 'John Swinney',     leader_party: 'Scottish National Party', leader_title: 'First Minister' },
  'UK-WLS': { capital: 'Cardiff',   area_km2: 20779,  officialWebsite: 'https://www.gov.wales',           leader_name: 'Eluned Morgan',    leader_party: 'Labour',                  leader_title: 'First Minister' },
  'UK-NIR': { capital: 'Belfast',   area_km2: 13843,  officialWebsite: 'https://www.nidirect.gov.uk',     leader_name: "Michelle O'Neill", leader_party: 'Sinn Féin',               leader_title: 'First Minister' },

  // ── UK English regions (no regional premier; area + website only) ─────────────
  'UK-ENG-NORTH-EAST':    { capital: 'Newcastle upon Tyne', area_km2: 8592,  officialWebsite: 'https://www.northeast-ca.gov.uk' },
  'UK-ENG-NORTH-WEST':    { capital: 'Manchester',          area_km2: 14108, officialWebsite: 'https://www.greatermanchester-ca.gov.uk' },
  'UK-ENG-YORKSHIRE':     { capital: 'Leeds',               area_km2: 15408, officialWebsite: 'https://www.westyorks-ca.gov.uk' },
  'UK-ENG-EAST-MIDLANDS': { capital: 'Nottingham',          area_km2: 15628, officialWebsite: 'https://eastmidlands.gov.uk' },
  'UK-ENG-WEST-MIDLANDS': { capital: 'Birmingham',          area_km2: 12998, officialWebsite: 'https://www.wmca.org.uk' },
  'UK-ENG-EAST':          { capital: 'Cambridge',           area_km2: 19116, officialWebsite: 'https://www.easterncombinedauthority.org.uk' },
  'UK-ENG-LONDON':        { capital: 'London',              area_km2: 1572,  officialWebsite: 'https://www.london.gov.uk', leader_name: 'Sadiq Khan', leader_party: 'Labour', leader_title: 'Mayor' },
  'UK-ENG-SOUTH-EAST':    { capital: 'Reading',             area_km2: 19095, officialWebsite: 'https://www.gov.uk/government/publications/south-east-local-enterprise-partnership' },
  'UK-ENG-SOUTH-WEST':    { capital: 'Bristol',             area_km2: 23829, officialWebsite: 'https://www.westofengland-ca.gov.uk' },
};

// ─── Population fallbacks (from official publications) ───────────────────────
// US Census Bureau Population Estimates Program, July 2023
const US_POP_FALLBACK = {
  'US-AL': 5108468,  'US-AK': 733583,   'US-AZ': 7431344,  'US-AR': 3067732,
  'US-CA': 38965193, 'US-CO': 5877610,  'US-CT': 3617176,  'US-DE': 1031890,
  'US-DC': 678972,   'US-FL': 22610726, 'US-GA': 11029227, 'US-HI': 1435138,
  'US-ID': 1964726,  'US-IL': 12549689, 'US-IN': 6862199,  'US-IA': 3207004,
  'US-KS': 2940865,  'US-KY': 4526154,  'US-LA': 4573749,  'US-ME': 1395722,
  'US-MD': 6180253,  'US-MA': 7001399,  'US-MI': 10037261, 'US-MN': 5737915,
  'US-MS': 2940057,  'US-MO': 6196156,  'US-MT': 1132812,  'US-NE': 1978379,
  'US-NV': 3194176,  'US-NH': 1402054,  'US-NJ': 9290841,  'US-NM': 2114371,
  'US-NY': 19571216, 'US-NC': 10835491, 'US-ND': 783926,   'US-OH': 11785935,
  'US-OK': 4053824,  'US-OR': 4233358,  'US-PA': 12961683, 'US-RI': 1095962,
  'US-SC': 5373555,  'US-SD': 919318,   'US-TN': 7126489,  'US-TX': 30503301,
  'US-UT': 3417734,  'US-VT': 647464,   'US-VA': 8715698,  'US-WA': 7812880,
  'US-WV': 1775156,  'US-WI': 5910955,  'US-WY': 584057,
};
// Statistics Canada table 17-10-0005-01, Q3 2024
const CA_POP_FALLBACK = {
  'CA-NL': 541391,   'CA-PE': 176113,   'CA-NS': 1041286,  'CA-NB': 847198,
  'CA-QC': 9020460,  'CA-ON': 15801570, 'CA-MB': 1445779,  'CA-SK': 1220553,
  'CA-AB': 4939592,  'CA-BC': 5787391,  'CA-YT': 46655,    'CA-NT': 44888,
  'CA-NU': 40586,
};
// ABS Estimated Resident Population, June 2024
const AU_POP_FALLBACK = {
  'AU-NSW': 8473000, 'AU-VIC': 6871000, 'AU-QLD': 5676000, 'AU-SA': 1868000,
  'AU-WA':  2955000, 'AU-TAS': 573000,  'AU-NT':  251000,  'AU-ACT': 457000,
};
// ONS Mid-Year Population Estimates 2022
const UK_POP_STATIC = {
  'UK-SCT': 5479100, 'UK-WLS': 3131640, 'UK-NIR': 1905200,
  'UK-ENG-NORTH-EAST': 2647000, 'UK-ENG-NORTH-WEST': 7417000,
  'UK-ENG-YORKSHIRE': 5541000,  'UK-ENG-EAST-MIDLANDS': 4934000,
  'UK-ENG-WEST-MIDLANDS': 5934000, 'UK-ENG-EAST': 6348000,
  'UK-ENG-LONDON': 8800000, 'UK-ENG-SOUTH-EAST': 9180000, 'UK-ENG-SOUTH-WEST': 5701000,
};

// ─── US Census FIPS → docId ───────────────────────────────────────────────────
const US_FIPS = {
  '01':'US-AL','02':'US-AK','04':'US-AZ','05':'US-AR','06':'US-CA','08':'US-CO',
  '09':'US-CT','10':'US-DE','11':'US-DC','12':'US-FL','13':'US-GA','15':'US-HI',
  '16':'US-ID','17':'US-IL','18':'US-IN','19':'US-IA','20':'US-KS','21':'US-KY',
  '22':'US-LA','23':'US-ME','24':'US-MD','25':'US-MA','26':'US-MI','27':'US-MN',
  '28':'US-MS','29':'US-MO','30':'US-MT','31':'US-NE','32':'US-NV','33':'US-NH',
  '34':'US-NJ','35':'US-NM','36':'US-NY','37':'US-NC','38':'US-ND','39':'US-OH',
  '40':'US-OK','41':'US-OR','42':'US-PA','44':'US-RI','45':'US-SC','46':'US-SD',
  '47':'US-TN','48':'US-TX','49':'US-UT','50':'US-VT','51':'US-VA','53':'US-WA',
  '54':'US-WV','55':'US-WI','56':'US-WY',
};

// ─── StatsCan dimension-member → docId ───────────────────────────────────────
// Table 17-10-0005-01, dimension 1 (geography), members 2–14
const CA_GEO_MEMBER = {
  2:'CA-NL', 3:'CA-PE', 4:'CA-NS', 5:'CA-NB', 6:'CA-QC', 7:'CA-ON',
  8:'CA-MB', 9:'CA-SK', 10:'CA-AB', 11:'CA-BC', 12:'CA-YT', 13:'CA-NT', 14:'CA-NU',
};

// ABS state code → docId
const AU_STATE = {
  1:'AU-NSW', 2:'AU-VIC', 3:'AU-QLD', 4:'AU-SA',
  5:'AU-WA',  6:'AU-TAS', 7:'AU-NT',  8:'AU-ACT',
};

// ─── Field guard ──────────────────────────────────────────────────────────────
function isWritable(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return !Number.isNaN(val) && val > 0;
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function addField(patch, key, val) {
  if (!isWritable(val)) return;
  patch[key] = typeof val === 'string' ? val.trim() : val;
}

// ─── Population fetchers ──────────────────────────────────────────────────────

async function fetchUSPop() {
  console.log('[SUB] Fetching US population from Census Bureau ACS 2023…');
  const url = 'https://api.census.gov/data/2023/acs/acs1?get=NAME,B01003_001E&for=state:*';
  const res = await axios.get(url, { timeout: TIMEOUT_MS });
  const rows = res.data;
  const map = {};
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('Census API returned unexpected format');
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 3) continue;
    // Census response: [NAME, B01003_001E, state_fips]
    const fips  = String(row[row.length - 1]).padStart(2, '0');
    const pop   = parseInt(row[1], 10);
    const docId = US_FIPS[fips];
    if (docId && !isNaN(pop)) map[docId] = pop;
  }
  console.log(`[SUB] Census: ${Object.keys(map).length} states populated`);
  return map;
}

async function fetchCAPop() {
  // StatsCan WDS API v1.3 — table 17-10-0005-01 (quarterly population estimates)
  // Coordinates: {geoMember}.1.1 = total population, both sexes, all ages
  console.log('[SUB] Fetching CA population from Statistics Canada WDS…');
  const coords = Object.entries(CA_GEO_MEMBER)
    .map(([member]) => `${member}.1.1`)
    .join(',');
  const url = `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action!wdsCubeDataAPI/v1/getSeriesDataFromCubePidCoordAndLatestNPeriods/1710000501/${coords}/1`;
  const res = await axios.get(url, { timeout: TIMEOUT_MS });
  const map = {};
  const data = Array.isArray(res.data) ? res.data : [res.data];
  for (const item of data) {
    const obj = item.object || item;
    const coord = obj.coordinate || '';
    const member = parseInt(coord.split('.')[0], 10);
    const docId = CA_GEO_MEMBER[member];
    if (!docId) continue;
    const pts = obj.vectorDataPoint || obj.dataPoints || [];
    const latest = pts[pts.length - 1];
    if (latest && isWritable(latest.value)) map[docId] = Math.round(Number(latest.value));
  }
  console.log(`[SUB] StatsCan: ${Object.keys(map).length} provinces populated`);
  return map;
}

async function fetchAUPop() {
  // ABS SDMX REST API — ERP_Q dataset, all states, latest period
  console.log('[SUB] Fetching AU population from ABS API…');
  const stateKeys = Object.keys(AU_STATE).join('+');
  const url = `https://api.data.abs.gov.au/data/ABS_ERP_Q/${stateKeys}.1.Q./all?format=jsondata&dimensionAtObservation=AllDimensions`;
  const res = await axios.get(url, { timeout: TIMEOUT_MS });
  const map = {};
  const ds = res.data?.dataSets?.[0];
  const dims = res.data?.structure?.dimensions?.observation || [];
  const stateDim = dims.find(d => d.id === 'REGION' || d.id === 'STATE' || dims.indexOf(d) === 0);
  if (!ds || !stateDim) return map;
  const stateValues = stateDim.values || [];
  for (const [key, obs] of Object.entries(ds.observations || {})) {
    const idxParts = key.split(':');
    const stateIdx = parseInt(idxParts[0], 10);
    const stateCode = parseInt(stateValues[stateIdx]?.id, 10);
    const docId = AU_STATE[stateCode];
    if (!docId || !obs?.[0]) continue;
    if (!map[docId] || obs[0] > map[docId]) map[docId] = Math.round(obs[0]);
  }
  console.log(`[SUB] ABS: ${Object.keys(map).length} states populated`);
  return map;
}

// ─── Build patches ────────────────────────────────────────────────────────────

function buildPatches(popUS, popCA, popAU) {
  const patches = {};

  for (const [docId, s] of Object.entries(STATIC)) {
    const p = {};
    addField(p, 'capital',         s.capital);
    addField(p, 'area_km2',        s.area_km2);
    addField(p, 'officialWebsite', s.officialWebsite);
    addField(p, 'leader_name',     s.leader_name);
    addField(p, 'leader_party',    s.leader_party);
    addField(p, 'leader_title',    s.leader_title);

    // Population — prefer live API, fall back to official publication data
    let pop = null;
    let popSource = null;
    if (docId.startsWith('US-')) {
      pop = popUS[docId] || US_POP_FALLBACK[docId];
      if (pop) popSource = popUS[docId] ? 'US Census Bureau ACS 2023' : 'US Census Bureau Population Estimates 2023 (static)';
    } else if (docId.startsWith('CA-')) {
      pop = popCA[docId] || CA_POP_FALLBACK[docId];
      if (pop) popSource = popCA[docId] ? 'Statistics Canada WDS 17-10-0005-01' : 'Statistics Canada 17-10-0005-01 Q3 2024 (static)';
    } else if (docId.startsWith('AU-')) {
      pop = popAU[docId] || AU_POP_FALLBACK[docId];
      if (pop) popSource = popAU[docId] ? 'ABS ERP_Q API' : 'ABS ERP June 2024 (static)';
    } else {
      pop = UK_POP_STATIC[docId];
      if (pop) popSource = 'ONS Mid-Year Population Estimates 2022 (static)';
    }
    if (isWritable(pop)) {
      p.population      = pop;
      p.population_source = popSource;
    }

    // needs_manual_review
    const review = [];
    if (s.leader_name) review.push('leader_name', 'leader_party', 'leader_since');
    if (docId.startsWith('US-')) review.push('leader_name', 'leader_party', 'leader_since', 'leader_title');
    if (popSource && popSource.includes('static') && !docId.startsWith('US-')) review.push('population');
    if (review.length) p.needs_manual_review = [...new Set(review)];

    p.official_data_fetched_at = new Date().toISOString().slice(0, 10);

    if (Object.keys(p).length > 1) patches[docId] = p; // at least one real field beyond date
  }

  return patches;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

async function probeFirestoreIds() {
  const db = getDb();
  const snap = await db.collection(COLLECTION).select().get();
  const ids = new Set();
  snap.forEach(doc => ids.add(doc.id));
  return ids;
}

async function writePatches(patches) {
  const db = getDb();
  const ids = Object.keys(patches);
  let written = 0;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const docId of chunk) {
      batch.set(db.collection(COLLECTION).doc(docId), patches[docId], { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`[SUB] Committed ${written}/${ids.length}…`);
  }
  return written;
}

// ─── Report ───────────────────────────────────────────────────────────────────

function report(patches, firestoreIds) {
  const patchIds     = Object.keys(patches);
  const matched      = patchIds.filter(id => firestoreIds.has(id));
  const notInFS      = patchIds.filter(id => !firestoreIds.has(id));
  const fieldCounts  = {};
  for (const p of matched.map(id => patches[id])) {
    for (const k of Object.keys(p)) fieldCounts[k] = (fieldCounts[k] || 0) + 1;
  }

  console.log('\n[SUB] ─── Match Report ──────────────────────────────────────────');
  console.log(`  Static records prepared:     ${patchIds.length}`);
  console.log(`  Match existing Firestore doc: ${matched.length}  ← will merge`);
  console.log(`  Not in Firestore (skipped):  ${notInFS.length}`);
  if (notInFS.length) console.log(`    → ${notInFS.join(', ')}`);

  console.log('\n[SUB] ─── Fields Per Matched Doc ───────────────────────────────');
  for (const [f, n] of Object.entries(fieldCounts).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${f.padEnd(35)} ${String(n).padStart(3)} docs`);
  }

  // 5 sample payloads
  const samples = matched.slice(0, 5);
  console.log(`\n[SUB] ─── 5 Sample Payloads ────────────────────────────────────`);
  for (const id of samples) {
    console.log(`\n  ${id}`);
    for (const [k, v] of Object.entries(patches[id])) {
      const display = Array.isArray(v) ? `[${v.join(', ')}]`
                    : typeof v === 'string' && v.length > 70 ? v.slice(0, 70) + '…'
                    : String(v);
      console.log(`    ${k.padEnd(30)} ${display}`);
    }
  }

  return matched;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[SUB] subnationalOfficialFetcher — ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  console.log(`[SUB] Collection: ${COLLECTION}\n`);

  // 1. Fetch live population data (best effort per source)
  let popUS = {}, popCA = {}, popAU = {};

  await Promise.allSettled([
    fetchUSPop().then(m => { popUS = m; }).catch(e => console.warn(`[SUB] Census API failed: ${e.message} — US states will have no population`)),
    fetchCAPop().then(m => { popCA = m; }).catch(e => console.warn(`[SUB] StatsCan API failed: ${e.message} — using CA static fallback`)),
    fetchAUPop().then(m => { popAU = m; }).catch(e => console.warn(`[SUB] ABS API failed: ${e.message} — using AU static fallback`)),
  ]);

  // 2. Build patches from static data + live population
  const patches = buildPatches(popUS, popCA, popAU);
  console.log(`\n[SUB] Patches built: ${Object.keys(patches).length}`);

  // 3. Probe Firestore for existing doc IDs
  console.log('[SUB] Probing Firestore…');
  const firestoreIds = await probeFirestoreIds();
  console.log(`[SUB] Firestore docs: ${firestoreIds.size}`);

  // 4. Filter to only existing docs (merge only — no creates)
  const matchedPatches = {};
  for (const id of Object.keys(patches)) {
    if (firestoreIds.has(id)) matchedPatches[id] = patches[id];
  }

  // 5. Report
  const matched = report(matchedPatches, firestoreIds);

  // 6. Write or confirm
  if (WRITE_MODE) {
    console.log(`\n[SUB] Writing ${matched.length} patches to Firestore…`);
    const n = await writePatches(matchedPatches);
    console.log(`[SUB] ✅ Done — ${n} docs merged.`);
  } else {
    console.log(`\n[SUB] DRY RUN complete — no writes performed.`);
    console.log(`[SUB] To apply: node src/ingestion/subnationalOfficialFetcher.js --write`);
  }
}

main().catch(e => { console.error('[SUB] Fatal:', e.message); process.exit(1); });
