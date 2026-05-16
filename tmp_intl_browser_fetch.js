'use strict';
/**
 * tmp_intl_browser_fetch.js
 *
 * Uses headless Chrome (puppeteer-core) to fetch official government pages
 * for 7 subnational jurisdictions whose sites block normal HTTP fetch:
 *   CA-NS, CA-YT, CA-NU, AU-ACT, AU-NT, AU-SA, UK-SCT
 *
 * Verifies: leader_name, leader_party (only if explicit), leader_since (only if explicit).
 * Merge only. No deletes. No new docs. No null/empty overwrites.
 * Removes field from needs_manual_review only if that field was verified.
 * Official government sources only.
 */

require('dotenv').config();
const puppeteer = require('puppeteer-core');
const { getDb } = require('./src/firebase/client');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const COLLECTION  = 'subnational_jurisdictions';
const WRITE_MODE  = process.argv.includes('--write');
const NAV_TIMEOUT = 35_000;
const WAIT_MS     = 4_000;

// ─── Targets ─────────────────────────────────────────────────────────────────
const TARGETS = [
  {
    id: 'CA-NS',
    title: 'Premier',
    urls: [
      'https://novascotia.ca/premier/',
      'https://www.novascotia.ca/exec_council/',
      'https://beta.novascotia.ca/government/premier',
    ],
  },
  {
    id: 'CA-YT',
    title: 'Premier',
    urls: [
      'https://yukon.ca/en/government/premier',
      'https://yukon.ca/government/premier',
      'https://www.gov.yk.ca/premier/',
      'https://www.yukon.ca/en/government/premier',
    ],
  },
  {
    id: 'CA-NU',
    title: 'Premier',
    urls: [
      'https://www.gov.nu.ca/executive-and-intergovernmental-affairs/premier',
      'https://www.gov.nu.ca/premier',
      'https://www.gov.nu.ca/en/home',
      'https://gov.nu.ca/premier',
    ],
  },
  {
    id: 'AU-ACT',
    title: 'Chief Minister',
    urls: [
      'https://www.parliament.act.gov.au/members',
      'https://www.parliament.act.gov.au/members/current-members',
      'https://www.act.gov.au/government/chief-minister',
      'https://www.act.gov.au/community/about-canberra/act-government',
    ],
  },
  {
    id: 'AU-NT',
    title: 'Chief Minister',
    urls: [
      'https://parliament.nt.gov.au/about/parliamentary-departments/members',
      'https://parliament.nt.gov.au/members',
      'https://www.nt.gov.au/about/government/northern-territory-government',
      'https://www.nt.gov.au/cabinet',
    ],
  },
  {
    id: 'AU-SA',
    title: 'Premier',
    urls: [
      'https://www.premier.sa.gov.au/',
      'https://www.sa.gov.au/topics/government-and-law/government-bodies/premier-and-cabinet',
      'https://www.premcab.sa.gov.au/',
    ],
  },
  {
    id: 'UK-SCT',
    title: 'First Minister',
    urls: [
      'https://www.gov.scot/about/scotland-s-government/first-minister/',
      'https://www.gov.scot/about/scotland-s-government/cabinet-and-ministers/',
      'https://firstminister.gov.scot/',
    ],
  },
];

// ─── Extraction helpers ───────────────────────────────────────────────────────

const NAV_WORDS = new Set([
  'Photo','Menu','MENU','Home','News','About','Contact','Press','Media',
  'Priorities','Leadership','Premier','Minister','First','Lady','Flag',
  'Status','Staff','Office','State','Administration','Skip','Content',
  'Search','Sign','Toggle','Navigation','Footer','Header','Main','Site',
  'Welcome','Chief','Deputy',
  // Organisation name suffixes — reject non-person names
  'Services','Directorate','Department','Agency','Commission','Authority',
  'Council','Board','Institute','Corporation','Trust','Foundation',
  'Centre','Center','Division','Bureau','Branch','Unit','Program','Programme',
]);

const HEADLINE_VERBS = new Set([
  'Announces','Delivers','Directs','Signs','Hosts','Joins','Speaks',
  'Opens','Calls','Urges','Leads','Takes','Makes','Shares','Launches',
  'Returns','Meets','Visits','Issues','Releases','Declares','Proclaims',
  'Appoints','Nominates','Proposes','Vetoes','Presents','Celebrates',
  'Honors','Supports','Opposes','Pardons','Orders','Files','Receives',
  'Accepts','Attends','Addresses','Creates','Establishes','Reviews',
  'Welcomes','Promotes','Approves','Rejects','Expands','Highlights',
  'Extends','Grants','Cuts','Invites','Warns','Backs','Pushes',
  'Seeks','Sends','Sets','Helps','Asks','Congratulates','Commits',
  'Tables','Introduces','Marks','Recognizes','Calls','Outlines',
]);

function toTitleCase(str) {
  return str.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function cleanName(name) {
  // Strip parliamentary/assembly suffixes (MSP, MP, AM, MLA, etc.)
  return name.replace(/\s+(?:MSP|MP|AM|MLA|MNA|MPP|MHA|QC|KC|OC|PC|OM|OA|CM|CBE|OBE|MBE|PhD|MD|QC)\.?$/, '').trim();
}

function isValidName(name) {
  const baseWords = name.replace(/,.*/, '').trim().split(/\s+/);
  if (baseWords.length < 2) return false;
  if (baseWords.some(w => NAV_WORDS.has(w))) return false;
  if (baseWords.some(w => HEADLINE_VERBS.has(w))) return false;
  return true;
}

// leaderTitle: "Premier", "Chief Minister", or "First Minister"
function extractName(text, pageTitle, leaderTitle) {
  const lines = text.split(/[\n\r]+/);
  const escapedTitle = leaderTitle.replace(/\s+/g, '\\s+');

  // Strategy 0: page title — "Premier Tim Houston | Nova Scotia"
  if (pageTitle) {
    const titleParts = pageTitle.split(/\s*[|\-–]\s*/);
    for (const part of titleParts) {
      const t = part.trim();
      const m = t.match(new RegExp(`^(?:${escapedTitle})\\s+((?:[A-Z][a-zA-Z'\\-\\.]*\\s*){1,5}(?:,\\s*[A-Z\\.]+)?)$`));
      if (m) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        if (isValidName(name)) return name;
      }
    }
    // Full title scan: "First Minister John Swinney"
    const fullM = pageTitle.match(new RegExp(`(?:${escapedTitle})\\s+((?:[A-Z][a-zA-Z'\\-\\.]*\\s*){1,5}(?:,\\s*[A-Z\\.]+)?)`));
    if (fullM) {
      const name = fullM[1].trim().replace(/\s+/g, ' ');
      if (isValidName(name)) return name;
    }
  }

  // Strategy 1: "Current role holder: Name MSP/MP" — gov.scot pattern
  for (const line of lines) {
    const m = line.trim().match(/^Current\s+role\s+holder:\s+(.+?)(?:\s+(?:MSP|MP|AM|MLA|MHA|MNA|MPP))?$/i);
    if (m) {
      const name = cleanName(m[1].trim().replace(/\s+/g, ' '));
      if (isValidName(name)) return name;
    }
  }

  // Strategy 2: "Honourable Name" followed within 3 lines by a role line
  // Requires the "Honourable" honorific explicitly — avoids org-name false positives
  const honorificRx = /^(?:The\s+)?Honourable\s+((?:[A-Z][a-z][a-zA-Z'\-\.]*\s+){1,3}[A-Z][a-z][a-zA-Z'\-\.]*)$/;
  const roleRx = new RegExp(escapedTitle, 'i');
  for (let i = 0; i < lines.length - 3; i++) {
    const curr = lines[i].trim();
    const m = curr.match(honorificRx);
    if (!m) continue;
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
      if (roleRx.test(lines[j])) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        if (isValidName(name)) return name;
      }
    }
  }

  // Strategy 3: "FirstName LastName" immediately before "Premier/Chief Minister of [Place]" line
  // Handles AU-SA: "Peter Malinauskas\n\nPremier of South Australia"
  const ofPlaceRx = new RegExp(`^(?:${escapedTitle})\\s+of\\s+`, 'i');
  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i].trim();
    if (!curr) continue;
    // Find the next non-empty line
    let nextIdx = i + 1;
    while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
    if (nextIdx >= lines.length) continue;
    if (ofPlaceRx.test(lines[nextIdx].trim())) {
      const m = curr.match(/^((?:[A-Z][a-z][a-zA-Z'\-\.]*\s+){1,3}[A-Z][a-z][a-zA-Z'\-\.]*)$/);
      if (m) {
        const name = m[1].trim().replace(/\s+/g, ' ');
        if (isValidName(name)) return name;
      }
    }
  }

  // Strategy 4: "Premier FirstName LastName" in body
  const titlePattern = new RegExp(`^(?:${escapedTitle})\\s+((?:[A-Z][a-z][a-zA-Z'\\-\\.]*\\s*){1,4}(?:,\\s*[A-Z\\.]+)?)(?:\\s|$)`);
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(titlePattern);
    if (!m) continue;
    if (m[0].trim().length < t.length - 5) continue;
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name;
  }

  // Strategy 5: "FirstName LastName, Premier"
  const reversePattern = new RegExp(`^((?:[A-Z][a-z][a-zA-Z'\\-\\.]*\\s*){1,4}),?\\s+(?:${escapedTitle})(?:\\s|$)`);
  for (const line of lines) {
    const t = line.trim();
    const m = t.match(reversePattern);
    if (!m) continue;
    const name = m[1].trim().replace(/\s+/g, ' ');
    if (isValidName(name)) return name;
  }

  // Strategy 6: all-caps name above a role line
  for (let i = 0; i < lines.length - 1; i++) {
    const curr = lines[i].trim();
    const next = lines[i + 1].trim();
    if (roleRx.test(next) && /^[A-Z]{2,}\s+[A-Z]{2,}/.test(curr)) {
      const name = toTitleCase(curr);
      if (isValidName(name)) return name;
    }
  }

  return null;
}

function extractSince(text) {
  const patterns = [
    /(?:sworn\s+in|inaugurated|took\s+office|became\s+(?:premier|chief\s+minister|first\s+minister))\s+(?:as\s+\w[\w\s]+\s+)?(?:on\s+)?([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    /(?:sworn\s+in|inaugurated|took\s+office)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{4})/i,
    /(?:appointed|elected|officially\s+sworn)\s+(?:on\s+)?([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
    /became\s+the\s+\w+\s+(?:Premier|Chief\s+Minister|First\s+Minister)\s+of\s+\w[\w\s]*on\s+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
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
    const months = {
      January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
      July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
    };
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
      text   = await page.evaluate(() => document.body?.innerText || '');
      pageTitle = await page.title();
      usedUrl   = url;
      break;
    } catch (e) {
      console.log(`  [${url}] ${e.message.slice(0, 100)}`);
    }
  }
  await page.close();
  return { text, usedUrl, pageTitle };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[INTL-BROWSER] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'} — ${TARGETS.length} jurisdictions\n`);

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

  for (const { id, title, urls } of TARGETS) {
    console.log(`\n[${id}] Fetching… (${title})`);
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
    const name = extractName(text, pageTitle, title);
    if (name && name.split(' ').length >= 2) {
      const stored = doc.leader_name || '';
      if (name !== stored) {
        console.log(`  name: "${stored}" → "${name}"`);
      } else {
        console.log(`  name: "${name}" ✓ (matches stored)`);
      }
      verified.leader_name = name;
    } else {
      console.log(`  name: not extracted`);
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

    // leader_party — official government sites rarely state party
    const partyMatch = text.match(/\b(Conservative|Liberal|Labor|Labour|NDP|New\s+Democratic|Green|SNP|Scottish\s+National|Plaid\s+Cymru|Sinn\s+Féin|Independent|Coalition\s+avenir|Progress(?:ive)?)\b/);
    if (partyMatch) {
      console.log(`  party: "${partyMatch[1]}" found on page`);
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

    const verifiedFields = Object.keys(verified);
    const nmr = Array.isArray(doc.needs_manual_review) ? doc.needs_manual_review : [];
    const newNmr = nmr.filter(f => !verifiedFields.includes(f));
    if (newNmr.length !== nmr.length) patch.needs_manual_review = newNmr;

    if (Object.keys(patch).length) patches[id] = patch;
  }

  // ─── Report ─────────────────────────────────────────────────────────────────

  console.log('\n[INTL-BROWSER] ─── Summary ──────────────────────────────────────────');
  for (const { id, blocked, verified, usedUrl } of results) {
    if (blocked) {
      console.log(`  ${id}  BLOCKED — all URLs inaccessible`);
    } else if (!Object.keys(verified).length) {
      console.log(`  ${id}  LOADED (${usedUrl}) but no fields extracted`);
    } else {
      const changes  = patches[id] ? Object.keys(patches[id]).filter(k => k !== 'needs_manual_review') : [];
      const confirms = Object.keys(verified).filter(f => !changes.includes(f));
      console.log(`  ${id}  ✓ ${usedUrl}`);
      if (changes.length)  console.log(`         UPDATED: ${changes.map(f => `${f}="${patches[id][f]}"`).join(', ')}`);
      if (confirms.length) console.log(`         CONFIRMED (no change): ${confirms.map(f => `${f}="${verified[f]}"`).join(', ')}`);
    }
  }

  if (!WRITE_MODE) {
    console.log('\n[INTL-BROWSER] DRY RUN — no writes.');
    console.log('[INTL-BROWSER] To apply: node tmp_intl_browser_fetch.js --write');
    return;
  }

  if (!Object.keys(patches).length) {
    console.log('\n[INTL-BROWSER] Nothing to write — all verified data matched stored values.');
    return;
  }

  const batch = db.batch();
  for (const [docId, patch] of Object.entries(patches)) {
    batch.set(db.collection(COLLECTION).doc(docId), patch, { merge: true });
  }
  await batch.commit();
  console.log(`\n[INTL-BROWSER] ✅ Wrote ${Object.keys(patches).length} doc(s).`);
}

main().catch(e => { console.error('[INTL-BROWSER] Fatal:', e.message); process.exit(1); });
