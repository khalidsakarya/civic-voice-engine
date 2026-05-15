'use strict';
/**
 * tmp_governor_browser_fetch.js
 *
 * Uses headless Chrome (puppeteer-core) to fetch official state governor pages
 * for the 10 US states whose sites block normal HTTP fetch.
 *
 * Verifies: leader_name, leader_party (only if explicitly on page),
 *           leader_since (only if explicitly on page), officialWebsite.
 *
 * Merge only. No deletes. No new docs. No null/empty overwrites.
 * Removes field from needs_manual_review only if that field was verified.
 *
 * Sources: official state governor/government websites only.
 */

require('dotenv').config();
const puppeteer = require('puppeteer-core');
const { getDb } = require('./src/firebase/client');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const COLLECTION  = 'subnational_jurisdictions';
const WRITE_MODE  = process.argv.includes('--write');
const NAV_TIMEOUT = 35_000;
const WAIT_MS     = 4_000; // let JS render

// ─── Target states ────────────────────────────────────────────────────────────
// Primary URL first; fallback second. Stop at first success.
const TARGETS = [
  { id: 'US-AZ', urls: ['https://azgovernor.gov/', 'https://az.gov/agency/office-governor'] },
  { id: 'US-CO', urls: ['https://www.colorado.gov/governor', 'https://www.colorado.gov/pacific/governor/gov-jared-polis'] },
  { id: 'US-FL', urls: ['https://www.flgov.com/', 'https://flgov.com/governor/'] },
  { id: 'US-KS', urls: ['https://www.governor.ks.gov/', 'https://governor.kansas.gov/'] },
  { id: 'US-MA', urls: ['https://www.mass.gov/governor', 'https://www.mass.gov/orgs/office-of-the-governor'] },
  { id: 'US-MI', urls: ['https://www.michigan.gov/whitmer', 'https://www.michigan.gov/gov'] },
  { id: 'US-NH', urls: ['https://governor.nh.gov/', 'https://www.nh.gov/governor/'] },
  { id: 'US-OH', urls: ['https://governor.ohio.gov/', 'https://ohio.gov/government/governor'] },
  { id: 'US-TN', urls: ['https://www.tn.gov/governor/', 'https://www.tn.gov/governor.html'] },
  { id: 'US-VT', urls: ['https://governor.vermont.gov/', 'https://www.vermont.gov/governor'] },
];

// ─── Extraction patterns ──────────────────────────────────────────────────────

// Known navigation/UI words that must not appear in a governor name
const NAV_WORDS = new Set([
  'Photo','Menu','MENU','Home','News','About','Contact','Press','Media',
  'Priorities','Leadership','Lieutenant','Governor','First','Lady','Flag',
  'Status','Staff','Office','State','Administration','Skip','Content',
  'Search','Sign','Toggle','Navigation','Footer','Header','Main','Site',
  'Welcome',
]);

// Common action verbs/nouns that appear in news headlines — reject name candidates
// containing ANY of these words (not just the last word)
const HEADLINE_VERBS = new Set([
  'Announces','Announces','Delivers','Directs','Signs','Hosts','Joins','Speaks',
  'Opens','Calls','Urges','Leads','Takes','Makes','Shares','Launches','Returns',
  'Meets','Visits','Issues','Releases','Declares','Proclaims','Appoints',
  'Nominates','Proposes','Vetoes','Presents','Celebrates','Honors','Supports',
  'Opposes','Pardons','Orders','Files','Receives','Accepts','Attends','Addresses',
  'Creates','Establishes','Reviews','Welcomes','Promotes','Approves','Rejects',
  'Expands','Highlights','Extends','Grants','Cuts','Invites','Urges','Warns',
  'Backs','Pushes','Seeks','Sends','Sets','Helps','Asks',
]);

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function isValidName(name) {
  const baseWords = name.replace(/,.*/, '').trim().split(/\s+/);
  if (baseWords.length < 2) return false;
  if (baseWords.some(w => NAV_WORDS.has(w))) return false;
  // Reject if ANY word looks like a news headline verb (not just the last)
  if (baseWords.some(w => HEADLINE_VERBS.has(w))) return false;
  return true;
}

// pageTitle: the <title> element text from the page
function extractName(text, pageTitle) {
  const lines = text.split(/[\n\r]+/);

  // Strategy 0: extract from page title — most reliable for many sites
  // Handles: "Governor Kelly Ayotte | ..." and "... | Office of Governor Phil Scott"
  // and "Governor Ron DeSantis | Executive Office of the Governor"
  if (pageTitle) {
    const titleParts = pageTitle.split(/\s*[|\-–]\s*/);
    for (const part of titleParts) {
      const t = part.trim();
      // "Governor FirstName LastName" in a title segment
      const m = t.match(/^(?:Governor|Mayor)\s+((?:[A-Z][a-z][a-zA-Z'\-\.]*\s*){1,4}(?:,\s*M\.?D\.?)?)$/);
      if (m) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        if (isValidName(name)) return name;
      }
      // "Welcome | Governor Kelly Ayotte" — segment IS "Governor Kelly Ayotte"
      // Already handled above. Also try reverse: segment may be just the name.
    }
    // "Welcome | Governor Kelly Ayotte" — full title match
    const fullTitleM = pageTitle.match(/(?:Governor|Mayor)\s+((?:[A-Z][a-z][a-zA-Z'\-\.]*\s*){1,4}(?:,\s*M\.?D\.?)?)/);
    if (fullTitleM) {
      const name = fullTitleM[1].trim().replace(/\s+/g, ' ');
      if (isValidName(name)) return name;
    }
  }

  // Strategy 1: all-caps name immediately before "GOVERNOR OF [STATE]" line
  // Handles FL: "RON DESANTIS\n46ᵀᴴ GOVERNOR OF FLORIDA"
  for (let i = 0; i < lines.length - 1; i++) {
    const curr = lines[i].trim();
    const next = lines[i + 1].trim();
    if (/GOVERNOR\s+OF\s+[A-Z]+/.test(next) && /^[A-Z]{2,}\s+[A-Z]{2,}/.test(curr)) {
      const name = toTitleCase(curr);
      if (isValidName(name)) return name;
    }
  }

  // Strategy 2: "Governor FirstName [M.?] LastName[, M.D.]" on one line in body
  // Require lowercase after the first capital to exclude all-caps nav words.
  // Also require the match covers nearly the full line — rejects news headlines
  // like "Governor Kelly Directs Flags at Half-Staff" where the name is a fragment.
  const titlePattern = /^(?:Governor|Mayor)\s+((?:[A-Z][a-z][a-zA-Z'\-\.]*\s*){1,3}(?:,\s*M\.?D\.?)?)(?:\s|$)/;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(titlePattern);
    if (!m) continue;
    // Reject if the matched portion covers less than ~90% of the line
    // (i.e., the name is embedded mid-headline)
    if (m[0].trim().length < t.length - 5) continue;
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name;
  }

  // Strategy 3: "FirstName [M.?] LastName, Governor" on one line
  const reversePattern = /^((?:[A-Z][a-z][a-zA-Z'\-\.]*\s*){1,3}),?\s+Governor(?:\s|$)/;
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(reversePattern);
    if (!m) continue;
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name;
  }

  return null;
}

function extractSince(text) {
  const patterns = [
    // "sworn in / inaugurated / took office on [Month Day, Year]"
    /(?:sworn\s+in|inaugurated|took\s+office)\s+(?:as\s+\w+\s+)?(?:on\s+)?([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(?:sworn\s+in|inaugurated|took\s+office)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{4})/i,
    // "became the Nth Governor of [State] on [Month Day, Year]" — VT style
    /became\s+the\s+\w+\s+Governor\s+of\s+\w+\s+on\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function parseISO(dateStr) {
  if (!dateStr) return null;
  const full = dateStr.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (full) {
    const months = { January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
                     July:'07',August:'08',September:'09',October:'10',November:'11',December:'12' };
    const m = months[full[1]];
    if (m) return `${full[3]}-${m}-${String(full[2]).padStart(2,'0')}`;
  }
  return null;
}

// ─── Browser fetch ────────────────────────────────────────────────────────────

async function fetchPageText(browser, urls) {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  });
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  let text = null;
  let usedUrl = null;
  let pageTitle = null;
  for (const url of urls) {
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
      if (!res || res.status() >= 400) {
        console.log(`  [${url}] HTTP ${res?.status() ?? 'ERR'} — skipping`);
        continue;
      }
      await new Promise(r => setTimeout(r, WAIT_MS));
      text = await page.evaluate(() => document.body?.innerText || '');
      pageTitle = await page.title();
      usedUrl = url;
      break;
    } catch (e) {
      console.log(`  [${url}] ${e.message.slice(0, 80)}`);
    }
  }
  await page.close();
  return { text, usedUrl, pageTitle };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[GOV-BROWSER] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'} — ${TARGETS.length} states\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const db = getDb();

  const ids = TARGETS.map(t => t.id);
  const snap = await db.collection(COLLECTION).where('__name__', 'in', ids).get();
  const current = {};
  snap.forEach(doc => { current[doc.id] = doc.data(); });

  const results = [];

  for (const { id, urls } of TARGETS) {
    console.log(`\n[${id}] Fetching…`);
    const { text, usedUrl, pageTitle } = await fetchPageText(browser, urls);

    if (!text || text.trim().length < 100) {
      console.log(`  → blocked / empty — skipping`);
      results.push({ id, blocked: true, verified: {}, usedUrl });
      continue;
    }

    console.log(`  → got ${text.length} chars from ${usedUrl}`);
    if (pageTitle) console.log(`  → title: "${pageTitle}"`);

    const doc = current[id] || {};
    const verified = {};

    // leader_name
    const name = extractName(text, pageTitle);
    if (name && name.split(' ').length >= 2) {
      const stored = doc.leader_name || '';
      if (name !== stored) {
        console.log(`  name: "${stored}" → "${name}"`);
      } else {
        console.log(`  name: "${name}" ✓ (matches stored)`);
      }
      verified.leader_name = name;
    } else {
      console.log(`  name: not extracted from page text`);
    }

    // leader_since
    const sinceRaw = extractSince(text);
    const sinceISO = parseISO(sinceRaw);
    if (sinceISO) {
      const stored = doc.leader_since || '';
      if (sinceISO !== stored) {
        console.log(`  since: "${stored}" → "${sinceISO}" (from "${sinceRaw}")`);
      } else {
        console.log(`  since: ${sinceISO} ✓ (matches stored)`);
      }
      verified.leader_since = sinceISO;
    } else {
      console.log(`  since: not found on page`);
    }

    // leader_party — government sites almost never state party; log if found
    const partyMatch = text.match(/\b(Republican|Democrat(?:ic)?|Independent|DFL)\b/);
    if (partyMatch) {
      console.log(`  party: "${partyMatch[1]}" found on page (rare — official sites seldom state party)`);
      const partyContext = text.match(/(?:party|affiliation)[:\s]+([^\n]{1,40})/i);
      if (partyContext) verified.leader_party = partyContext[1].trim();
    } else {
      console.log(`  party: not stated on page`);
    }

    results.push({ id, blocked: false, verified, usedUrl });
  }

  await browser.close();

  // ─── Build patches ──────────────────────────────────────────────────────────

  const patches = {};
  for (const { id, blocked, verified } of results) {
    if (blocked || !Object.keys(verified).length) continue;

    const doc = current[id] || {};
    const patch = {};

    for (const [field, val] of Object.entries(verified)) {
      if (val && val !== doc[field]) patch[field] = val;
    }

    // Remove verified fields from needs_manual_review
    const verifiedFields = Object.keys(verified);
    const nmr = Array.isArray(doc.needs_manual_review) ? doc.needs_manual_review : [];
    const newNmr = nmr.filter(f => !verifiedFields.includes(f));
    if (newNmr.length !== nmr.length) patch.needs_manual_review = newNmr;

    if (Object.keys(patch).length) patches[id] = patch;
  }

  // ─── Report ─────────────────────────────────────────────────────────────────

  console.log('\n[GOV-BROWSER] ─── Summary ───────────────────────────────────────');
  for (const { id, blocked, verified, usedUrl } of results) {
    if (blocked) {
      console.log(`  ${id}  BLOCKED — all URLs inaccessible`);
    } else if (!Object.keys(verified).length) {
      console.log(`  ${id}  LOADED (${usedUrl}) but no fields extracted`);
    } else {
      const changes = patches[id] ? Object.keys(patches[id]).filter(k => k !== 'needs_manual_review') : [];
      const confirms = Object.keys(verified).filter(f => !changes.includes(f));
      console.log(`  ${id}  ✓ ${usedUrl}`);
      if (changes.length)   console.log(`         UPDATED: ${changes.map(f => `${f}="${patches[id][f]}"`).join(', ')}`);
      if (confirms.length)  console.log(`         CONFIRMED (no change): ${confirms.map(f => `${f}="${verified[f]}"`).join(', ')}`);
    }
  }

  if (!WRITE_MODE) {
    console.log('\n[GOV-BROWSER] DRY RUN — no writes.');
    console.log('[GOV-BROWSER] To apply: node tmp_governor_browser_fetch.js --write');
    return;
  }

  if (!Object.keys(patches).length) {
    console.log('\n[GOV-BROWSER] Nothing to write — all verified data matched stored values.');
    return;
  }

  const batch = db.batch();
  for (const [docId, patch] of Object.entries(patches)) {
    batch.set(db.collection(COLLECTION).doc(docId), patch, { merge: true });
  }
  await batch.commit();
  console.log(`\n[GOV-BROWSER] ✅ Wrote ${Object.keys(patches).length} doc(s).`);
}

main().catch(e => { console.error('[GOV-BROWSER] Fatal:', e.message); process.exit(1); });
