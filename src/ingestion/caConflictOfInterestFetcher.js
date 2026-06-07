'use strict';
/**
 * Canadian MP Conflict of Interest Fetcher
 *
 * Fetches all 343 current House of Commons members from ourcommons.ca and
 * attempts to extract conflict-of-interest disclosure fields (outside employment,
 * board memberships, business interests, assets declared).
 *
 * Data source truth:
 *   MP list  — ourcommons.ca/members/en/search (current parliament, HTML tiles)
 *   COI data — prciec-rpccie.parl.gc.ca (CIEC Public Registry)
 *
 * Limitation:
 *   The CIEC Public Registry is a SharePoint site that renders entirely via
 *   JavaScript. Its REST API requires authentication (HTTP 401). Static HTTP
 *   fetches return only the shell page. Disclosure detail fields are therefore
 *   recorded as null with data_note explaining the limitation.
 *
 * Saves to Firestore: member_corporate_affiliations (CA records)
 */

require('dotenv').config();

const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const { getDb } = require('../firebase/client');

const COLLECTION  = 'member_corporate_affiliations';
const OUTPUT_DIR  = path.resolve(__dirname, '../../output/corporate_affiliations');
const BATCH_SIZE  = 200;
const TIMEOUT_MS  = 20_000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
  'Accept-Language': 'en-CA,en;q=0.9',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtml(s) {
  return (s || '')
    .replace(/&#x2014;/g, '—').replace(/&#x2013;/g, '–')
    .replace(/&#xE9;/g,  'é').replace(/&#xE8;/g, 'è')
    .replace(/&#xE0;/g,  'à').replace(/&#xEA;/g, 'ê')
    .replace(/&#xEB;/g,  'ë').replace(/&#xEF;/g, 'ï')
    .replace(/&#xF4;/g,  'ô').replace(/&#xFB;/g, 'û')
    .replace(/&#xF9;/g,  'ù').replace(/&#xE7;/g, 'ç')
    .replace(/&#xE6;/g,  'æ').replace(/&#xC9;/g, 'É')
    .replace(/&amp;/g,   '&').replace(/&lt;/g,   '<')
    .replace(/&gt;/g,    '>').replace(/&nbsp;/g,  ' ')
    .replace(/&#\d+;/g,  c => { try { return String.fromCharCode(parseInt(c.slice(2,-1))); } catch(_){return c;} })
    .trim();
}

function saveOutput(records) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `CA_coi_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[CA:COI] Saved ${records.length} records → ${path.basename(file)}`);
}

// ─── Step 1: Scrape current MP list from ourcommons.ca ──────────────────────

async function fetchCurrentMPs() {
  console.log('[CA:COI] Fetching current MP list from ourcommons.ca...');
  const r = await axios.get('https://www.ourcommons.ca/members/en/search', {
    headers: BROWSER_HEADERS, timeout: TIMEOUT_MS,
  });

  // Parse tiles: <div class="ce-mip-mp-tile-container" id="mp-tile-person-id-{ID}">
  // Each tile has:
  //   <div class="ce-mip-mp-name">Name</div>
  //   <div class="ce-mip-mp-party" style="...">Party</div>
  //   <div class="ce-mip-mp-constituency">Constituency</div>
  //   <div class="ce-mip-mp-province">Province</div>
  //   <a aria-label="Name Party Constituency Province" href="/members/en/slug(ID)">
  const tileRe = /id="mp-tile-person-id-(\d+)"[\s\S]*?(?=id="mp-tile-person-id-|\s*<\/div>\s*<\/div>\s*<\/div>\s*(?:<!--|\s*$))/g;
  const nameRe    = /class="ce-mip-mp-name">([^<]+)<\/div>/;
  const partyRe   = /class="ce-mip-mp-party"[^>]*>([^<]+)<\/div>/;
  const consRe    = /class="ce-mip-mp-constituency">([^<]+)<\/div>/;
  const provRe    = /class="ce-mip-mp-province">([^<]+)<\/div>/;
  const slugRe    = /href="(\/members\/en\/([^"(]+)\((\d+)\))"/;
  const photoRe   = /class="ce-mip-mp-picture[^"]*"\s+src="([^"]+)"/;

  const html = r.data;

  // Use aria-label to get the 343 unique current MPs reliably
  const ariaMatches = [...html.matchAll(
    /aria-label="([^"]+)"\s+href="\/members\/en\/([^"(]+)\((\d+)\)"/gi
  )];

  const seen = new Set();
  const mps  = [];

  for (const [, label, slug, id] of ariaMatches) {
    if (seen.has(id)) continue;
    seen.add(id);

    // aria-label format: "FirstName LastName PartyName Constituency... Province"
    // Extract structured data by grabbing the tile block for this member ID
    const tileStart = html.indexOf(`id="mp-tile-person-id-${id}"`);
    const tileEnd   = tileStart > 0 ? html.indexOf('ce-mip-mp-tile-container', tileStart + 10) : -1;
    const tileHtml  = tileStart > 0 ? html.slice(tileStart, tileEnd > 0 ? tileEnd : tileStart + 2000) : '';

    const nameMatch   = tileHtml.match(nameRe);
    const partyMatch  = tileHtml.match(partyRe);
    const consMatch   = tileHtml.match(consRe);
    const provMatch   = tileHtml.match(provRe);
    const photoMatch  = tileHtml.match(photoRe);

    const name         = decodeHtml(nameMatch?.[1] || '');
    const party        = decodeHtml(partyMatch?.[1] || '');
    const constituency = decodeHtml(consMatch?.[1] || '');
    const province     = decodeHtml(provMatch?.[1] || '');
    const photo_url    = photoMatch ? `https://www.ourcommons.ca${photoMatch[1]}` : null;

    if (!name) continue;

    mps.push({ id, slug, name, party, constituency, province, photo_url });
  }

  console.log(`[CA:COI] ${mps.length} current MPs parsed`);
  return mps;
}

// ─── Step 2: Attempt CIEC registry fetch ────────────────────────────────────
// The CIEC public registry (prciec-rpccie.parl.gc.ca) is a SharePoint site
// that renders entirely via JavaScript. Its REST API returns HTTP 401.
// We log the attempt but cannot extract disclosure data programmatically.

async function attemptCIECFetch(mp) {
  // Individual MP pages on CIEC use the full registry search page;
  // there is no per-member static URL accessible without JavaScript.
  // The registry home is the best reference URL we can provide.
  return {
    ciec_registry_url: 'https://prciec-rpccie.parl.gc.ca/EN/PublicRegistries/Pages/PublicRegistryCode.aspx',
    outside_employment: null,
    board_memberships:  null,
    business_interests: null,
    assets_declared:    null,
    data_note: 'CIEC Public Registry is JavaScript-rendered (SharePoint). REST API requires authentication. Disclosure details require browser access or await CIEC API fix.',
    ciec_data_status: 'js_required',
  };
}

// ─── Step 3: Build records ───────────────────────────────────────────────────

async function buildRecords(mps) {
  const now = new Date().toISOString();
  return mps.map(mp => {
    const ciec = {
      ciec_registry_url: 'https://prciec-rpccie.parl.gc.ca/EN/PublicRegistries/Pages/PublicRegistryCode.aspx',
      outside_employment: null,
      board_memberships:  null,
      business_interests: null,
      assets_declared:    null,
      data_note: 'CIEC Public Registry is JavaScript-rendered (SharePoint). REST API requires authentication. Disclosure details require browser access.',
      ciec_data_status: 'js_required',
    };

    return {
      id:             `CA-COI-${mp.id}`,
      jurisdiction:   'CA',
      member_name:    mp.name,
      party:          mp.party,
      constituency:   mp.constituency,
      province:       mp.province,
      member_id:      mp.id,
      ourcommons_url: `https://www.ourcommons.ca${`/members/en/${mp.slug}(${mp.id})`}`,
      photo_url:      mp.photo_url,
      source:         'ourcommons_member_search + ciec_public_registry',
      ...ciec,
      fetched_at:     now,
    };
  });
}

// ─── Step 4: Upsert to Firestore ─────────────────────────────────────────────

async function upsertToFirestore(records) {
  const db = getDb();
  let upserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const rec of chunk) {
      const ref = db.collection(COLLECTION).doc(rec.id);
      batch.set(ref, rec, { merge: true });
    }

    await batch.commit();
    upserted += chunk.length;
    console.log(`[CA:COI] Upserted ${upserted}/${records.length}…`);
  }

  console.log(`[CA:COI] Done — ${upserted} MPs saved to Firestore collection "${COLLECTION}"`);
  return upserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[CA:COI] Starting Canadian MP conflict-of-interest fetch…');

  const mps     = await fetchCurrentMPs();
  if (!mps.length) throw new Error('No MPs parsed — check ourcommons.ca page structure');

  const records = await buildRecords(mps);
  saveOutput(records);
  await upsertToFirestore(records);

  console.log('[CA:COI] Complete.');
  return records.length;
}

if (require.main === module) {
  main()
    .then(n => { console.log(`[CA:COI] ${n} records written.`); process.exit(0); })
    .catch(e => { console.error('[CA:COI] Fatal:', e.message); process.exit(1); });
}

module.exports = { fetchCaConflictOfInterest: main };
