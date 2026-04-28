'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const axios = require('axios');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER  = 'weekly';
const COLLECTION_NAME = 'department_heads';

const OUTPUT_DIR = path.resolve(__dirname, '../../output/department_heads');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// HHS blocks Chrome UA but accepts Safari; use Safari for that endpoint.
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeStr(v) { return (v == null) ? null : String(v).trim() || null; }

function slug(s) {
  return String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function saveRecords(jurisdiction, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUTPUT_DIR, `department_heads_${jurisdiction}_${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ jurisdiction, fetchedAt: new Date().toISOString(), records }, null, 2));
  console.log(`[dept-heads:${jurisdiction}] Saved ${records.length} records → ${path.basename(file)}`);
  return records.length;
}

// Native https.get wrapper — axios times out against the GC AEM servers
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)', Accept: 'text/html' },
      timeout: 45000,
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ─── Department name inference ────────────────────────────────────────────────

function inferDept(title, jurisdiction) {
  if (!title) return null;
  const t = title;

  if (jurisdiction === 'US') {
    const m = t.match(/^Secretary of (?:the )?(.+)$/i);
    if (m) return `Department of ${m[1].trim()}`;
    if (/Attorney General/i.test(t))               return 'Department of Justice';
    if (/Trade Representative/i.test(t))            return 'Office of the US Trade Representative';
    if (/Director of National Intelligence/i.test(t)) return 'Office of the Director of National Intelligence';
    if (/Central Intelligence|CIA/i.test(t))        return 'Central Intelligence Agency';
    if (/Management and Budget|OMB/i.test(t))       return 'Office of Management and Budget';
    if (/United Nations|UN Ambassador/i.test(t))    return 'US Mission to the United Nations';
    if (/Council of Economic/i.test(t))             return 'Council of Economic Advisers';
    if (/Environmental Protection|EPA/i.test(t))    return 'Environmental Protection Agency';
    if (/Small Business Administration/i.test(t))   return 'Small Business Administration';
    return null;
  }

  if (jurisdiction === 'UK') {
    let m = t.match(/Secretary of State for (.+)/i);
    if (m) return `Department for ${m[1].trim()}`;
    if (/Chancellor of the Exchequer/i.test(t))     return 'HM Treasury';
    if (/Chief Secretary.*Treasury/i.test(t))       return 'HM Treasury';
    if (/Prime Minister|First Lord of the Treasury|Civil Service|Minister for the Union/i.test(t)) return 'Cabinet Office';
    if (/Attorney General/i.test(t))                return "Attorney General's Office";
    if (/Advocate General/i.test(t))                return 'Office of the Advocate General for Scotland';
    if (/Lord Chancellor/i.test(t))                 return 'Ministry of Justice';
    m = t.match(/Minister of State.*?for (.+)/i);
    if (m) return `Department for ${m[1].trim()}`;
    m = t.match(/Minister for (.+)/i);
    if (m) return `Department for ${m[1].trim()}`;
    m = t.match(/Parliamentary.*?Secretary.*?for (.+)/i);
    if (m) return `Department for ${m[1].trim()}`;
    return null;
  }

  if (jurisdiction === 'CA') {
    if (/President of the Treasury Board/i.test(t))     return 'Treasury Board Secretariat';
    if (/Minister of National Defence/i.test(t))        return 'National Defence';
    if (/Attorney General/i.test(t))                    return 'Department of Justice';
    if (/Secretary of State\s*\(([^)]+)\)/i.test(t)) {
      const sm = t.match(/Secretary of State\s*\(([^)]+)\)/i);
      return sm ? sm[1].trim() : null;
    }
    const m = t.match(/Minister of (.+?)(?:\s+and\s+|\s*,\s*|$)/i);
    if (m) return m[1].trim();
    const m2 = t.match(/Minister for (.+?)(?:\s+and\s+|\s*,\s*|$)/i);
    if (m2) return m2[1].trim();
    return null;
  }

  if (jurisdiction === 'AU') {
    if (/Treasurer(?!\s+of)/i.test(t))              return 'Treasury';
    if (/Attorney-General/i.test(t))                return "Attorney-General's Department";
    if (/Prime Minister/i.test(t))                  return 'Department of the Prime Minister and Cabinet';
    if (/Cabinet Secretary/i.test(t))               return 'Cabinet Office';
    if (/Deputy Prime Minister/i.test(t))           return 'Department of Defence';
    const m = t.match(/(?:Minister|Assistant Minister) for (.+?)(?:\s*,|\s*$)/i);
    if (m) return m[1].trim();
    const m2 = t.match(/(?:Minister|Assistant Minister) of (.+?)(?:\s*,|\s*$)/i);
    if (m2) return m2[1].trim();
    return null;
  }

  return null;
}

// ─── Canada — canada.ca/en/government/ministers.html ─────────────────────────
// Uses native https.get because axios consistently times out against canada.ca's
// AEM CDN on this network; the native client completes in ~3s.
//
// Pattern:
//   <dt><a href="/en/government/ministers/NAME.html">The Honourable NAME</a></dt>
//   <dd>TITLE</dd>

async function fetchCanadaDeptHeads() {
  const _ts = new Date().toISOString();
  const records = [];

  try {
    console.log('[dept-heads:CA] Fetching canada.ca ministers page...');
    const html = await httpsGet('https://www.canada.ca/en/government/ministers.html');

    // Match both "The Honourable" (ministers) and "The Right Honourable" (PM/Deputy PM).
    const re = /<dt>\s*<a href="([^"]+)">(The (?:Right )?Honourable[^<]+)<\/a>\s*<\/dt>\s*<dd>\s*([\s\S]*?)\s*<\/dd>/g;
    let m;
    while ((m = re.exec(html))) {
      const href  = m[1];
      const name  = stripHtml(m[2]);
      const title = stripHtml(m[3]);
      if (!name || !title) continue;

      // Tier: full ministers vs secretaries of state vs parliamentary secretaries
      let tier = 'minister';
      if (/^Secretary of State/i.test(title))           tier = 'secretary_of_state';
      else if (/^Parliamentary Secretary/i.test(title)) tier = 'parliamentary_secretary';

      records.push({
        id:             `ca-${slug(name.replace(/The (?:Right )?Honourable\s+/i, ''))}`,
        jurisdiction:   'CA',
        name:           safeStr(name),
        title:          safeStr(title),
        department:     inferDept(title, 'CA'),
        // Post-election Carney cabinet sworn in approximately 2025-05-13;
        // individual pages do not publish appointment dates.
        date_appointed: '2025-05-13',
        party:          'Liberal Party of Canada',
        source_url:     href.startsWith('http') ? href : `https://www.canada.ca${href}`,
        tier,
      });
    }

    console.log(`[dept-heads:CA] Extracted ${records.length} ministers`);
  } catch (err) {
    console.warn(`[dept-heads:CA] Skipped — ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://www.canada.ca/en/government/ministers.html', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return saveRecords('CA', records);
  }

  const count = saveRecords('CA', records);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'CA', data_pull_timestamp: _ts, source_endpoint: 'https://www.canada.ca/en/government/ministers.html', record_count: count, import_status: count > 0 ? 'success' : 'partial', scheduler_tier: SCHEDULER_TIER });
  return count;
}

// ─── US — per-department official websites ────────────────────────────────────
//
// Each entry describes how to extract the current secretary/head name directly
// from that department's own website. defense.gov blocks all automated requests;
// that position falls back to whitehouse.gov.
//
// dol.gov serves a bot-detection challenge for bare UA requests. Passing a
// minimal Accept / Accept-Language header set bypasses it (any UA works).
//
// Optional `extraHeaders` field is merged into the request headers alongside UA.
//
// Mapping from stored `title` field to dept key (for validation merging):
//   Secretary of Homeland Security                  → dhs
//   Secretary of State                              → state
//   Secretary of the Treasury                       → treasury
//   Attorney General / Acting AG                    → justice
//   Secretary of Health and Human Svcs             → hhs
//   Secretary of Education                          → education
//   Secretary of Energy                             → energy
//   Administrator of the EPA                       → epa
//   Secretary of Labor / Acting Secretary of Labor → labor

const DEPT_DIRECT_SOURCES = [
  {
    key:   'dhs',
    dept:  'Department of Homeland Security',
    title: 'Secretary of Homeland Security',
    url:   'https://www.dhs.gov/leadership',
    ua:    CHROME_UA,
    parse(html) {
      // <li>Secretary, <a href="/markwayne-mullin">Markwayne Mullin</a>
      const m = html.match(/Secretary,\s*<a[^>]+>([^<]+)<\/a>/i);
      return m?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'state',
    dept:  'Department of State',
    title: 'Secretary of State',
    url:   'https://www.state.gov/secretary/',
    ua:    CHROME_UA,
    parse(html) {
      // Secretary's page has alt="Marco Rubio" on the portrait image
      const m = html.match(/alt="([A-Z][a-z]+(?:\s[A-Z][a-z.]+)+)"/);
      return m?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'treasury',
    dept:  'Department of the Treasury',
    title: 'Secretary of the Treasury',
    url:   'https://home.treasury.gov/about/general-information/officials',
    ua:    CHROME_UA,
    parse(html) {
      // Officials list has two links for the Secretary: text="Secretary" then text="Scott Bessent".
      // Skip the generic title entry; take the first link whose text is a person name.
      const re = /\/officials\/[a-z-]+"[^>]*>([^<]+)<\/a>/gi;
      let m;
      while ((m = re.exec(html))) {
        const name = m[1].trim();
        if (/^[A-Z][a-z]/.test(name) && !/^(?:Secretary|Deputy|Acting|Under|Assistant)\b/.test(name)) {
          return name;
        }
      }
      return null;
    },
  },
  {
    key:   'justice',
    dept:  'Department of Justice',
    title: 'Attorney General',
    url:   'https://www.justice.gov/ag',
    ua:    CHROME_UA,
    parse(html) {
      // No /i flag: [A-Z] must be strict uppercase so we don't capture lowercase words.
      // Page contains "Attorney General Todd Blanche" in body text.
      const m = html.match(/(?:Acting )?Attorney General\s+([A-Z][a-z]+\s+[A-Z][a-z.]+)/);
      return m?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'hhs',
    dept:  'Department of Health and Human Services',
    title: 'Secretary of Health and Human Services',
    url:   'https://www.hhs.gov/about/leadership/index.html',
    ua:    SAFARI_UA,  // hhs.gov returns 403 for Chrome UA; Safari passes through
    parse(html) {
      // usa-card__heading h3s list the Secretary first (then deputies/staff).
      // Use [\s\S]*? so nested anchor tags inside the h3 don't break the match.
      const re = /<h3[^>]*class="[^"]*usa-card__heading[^"]*"[^>]*>([\s\S]*?)<\/h3>/gi;
      let m;
      while ((m = re.exec(html))) {
        const name = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (name && name !== 'Vacant' && /[A-Z][a-z]/.test(name)) return name;
      }
      return null;
    },
  },
  {
    key:   'education',
    dept:  'Department of Education',
    title: 'Secretary of Education',
    url:   'https://www.ed.gov/about/news',
    ua:    CHROME_UA,
    parse(html) {
      // News article hrefs contain the secretary's name as a slug, e.g.:
      //   /press-release/us-secretary-of-education-linda-mcmahon-visits-...
      // Extract the slug and convert to title-case, handling Mc/Mac prefixes.
      const slugM = html.match(/us-secretary-of-education-([a-z]+)-([a-z]+)-/);
      if (slugM) {
        const fromSlug = s => {
          // Title-case, then fix Mc/Mac prefix (applied after capitalisation)
          const t = s.charAt(0).toUpperCase() + s.slice(1);
          return t.replace(/^Mc([a-z])/, (_, c) => 'Mc' + c.toUpperCase())
                  .replace(/^Mac([a-z])/, (_, c) => 'Mac' + c.toUpperCase());
        };
        return [slugM[1], slugM[2]].map(fromSlug).join(' ');
      }
      // Fallback: find "U.S. Secretary of Education NAME" in text. [A-Za-z] handles
      // surnames with internal caps (McMahon). Stops before a third capitalized word.
      const textM = html.match(/U\.S\.\s+Secretary of Education\s+([A-Z][a-z]+\s+[A-Z][A-Za-z]+)/);
      return textM?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'energy',
    dept:  'Department of Energy',
    title: 'Secretary of Energy',
    url:   'https://www.energy.gov/our-leadership-offices',
    ua:    CHROME_UA,
    parse(html) {
      // Megamenu headshot: alt="Chris Wright" class="megamenu-block__headshot"
      const m = html.match(/alt="([^"]+)"\s*class="megamenu-block__headshot"/i);
      return m?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'epa',
    dept:  'Environmental Protection Agency',
    title: 'EPA Administrator',
    url:   'https://www.epa.gov/aboutepa/epa-administrator',
    ua:    CHROME_UA,
    parse(html) {
      // Administrator page has h2 = "Lee Zeldin" immediately after the h1
      const m = html.match(/<h2[^>]*>([^<]+)<\/h2>/);
      return m?.[1]?.trim() ?? null;
    },
  },
  {
    key:   'labor',
    dept:  'Department of Labor',
    title: 'Secretary of Labor',
    url:   'https://www.dol.gov/agencies/osec',
    ua:    'python-requests/2.31.0',
    // dol.gov bot-detection bypassed by including Accept + Accept-Language headers.
    extraHeaders: {
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    parse(html) {
      // h1: "Acting Secretary of Labor Keith E. Sonderling"
      //  or "Secretary of Labor NAME" when a permanent secretary is in place.
      const h1m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (!h1m) return null;
      const text = h1m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const m = text.match(/(?:Acting\s+)?Secretary of Labor\s+(.+)/i);
      return m?.[1]?.trim() ?? null;
    },
  },
  // defense.gov blocks all automated requests — Pete Hegseth sourced from WH fallback.
];

// Title substrings that map a stored record to a dept-direct source key.
// Used to override the WH-scraped name with the dept-site name.
const TITLE_TO_DEPT_KEY = {
  'Secretary of Homeland Security':           'dhs',
  'Secretary of State':                       'state',
  'Secretary of the Treasury':                'treasury',
  'Attorney General':                         'justice',
  'Acting Attorney General':                  'justice',
  'Secretary of Health and Human Services':   'hhs',
  'Secretary of Education':                   'education',
  'Secretary of Energy':                      'energy',
  'Administrator of the Environmental':       'epa',  // prefix match
  'Secretary of Labor':                       'labor',
  'Acting Secretary of Labor':                'labor',
};

function titleToDeptKey(title) {
  if (!title) return null;
  for (const [pattern, key] of Object.entries(TITLE_TO_DEPT_KEY)) {
    if (title.startsWith(pattern) || title === pattern) return key;
  }
  return null;
}

const WH_CABINET_URL = 'https://www.whitehouse.gov/administration/cabinet/';
const WH_SKIP = new Set(['About', 'Media', 'Initiatives', 'Contact Us', 'News', 'Videos', 'Issues', 'The Administration']);

// Scrape whitehouse.gov/administration/cabinet — used for Defense + supplemental positions
async function fetchWHCabinet() {
  const { data: html } = await axios.get(WH_CABINET_URL, {
    timeout: 30000,
    headers: { 'User-Agent': CHROME_UA },
  });

  const members = [];
  const secRe = /<h2[^>]*class="[^"]*wp-block-heading[^"]*"[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*class="[^"]*wp-block-heading|<\/main|<footer)/g;
  let m;
  while ((m = secRe.exec(html))) {
    const name = stripHtml(m[1]);
    if (!name || WH_SKIP.has(name)) continue;
    const sectionHtml = m[2];
    const h3m = sectionHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (!h3m) continue;
    let title = stripHtml(h3m[1]);
    if (!title) continue;

    // Detect acting designation: WH sometimes keeps the permanent title in h3
    // while the bio text says "designated as the Acting [title]". Prefix if so.
    if (!title.startsWith('Acting')) {
      const bioText = stripHtml(sectionHtml);
      if (new RegExp('\\bActing\\s+' + escapeRegex(title), 'i').test(bioText)) {
        title = 'Acting ' + title;
      }
    }

    members.push({ name, title });
  }
  return members;
}

// Fetch secretary names from each department's own website in parallel.
async function fetchDeptSources() {
  const results = new Map();

  await Promise.allSettled(DEPT_DIRECT_SOURCES.map(async cfg => {
    try {
      const { data: html } = await axios.get(cfg.url, {
        timeout: 25000,
        headers: { 'User-Agent': cfg.ua, ...(cfg.extraHeaders || {}) },
        maxRedirects: 5,
      });
      const name = cfg.parse(html);
      if (name) {
        results.set(cfg.key, { name, url: cfg.url });
        console.log(`[dept-heads:US:${cfg.key}] ${name}`);
      } else {
        console.warn(`[dept-heads:US:${cfg.key}] Parser returned null`);
      }
    } catch (err) {
      console.warn(`[dept-heads:US:${cfg.key}] ${err.response?.status ?? err.code} — ${err.message?.slice(0, 60)}`);
    }
  }));

  return results;
}

async function fetchUSDeptHeads() {
  const _ts = new Date().toISOString();
  const records = [];

  try {
    console.log('[dept-heads:US] Fetching department websites + whitehouse.gov supplement...');

    // Run dept-direct fetches and WH scrape in parallel
    const [deptResults, whMembers] = await Promise.all([
      fetchDeptSources(),
      fetchWHCabinet(),
    ]);

    console.log(`[dept-heads:US] Dept-direct: ${deptResults.size}/9 succeeded | WH supplement: ${whMembers.length} members`);

    // Build merged record set: dept-site name overrides WH name where available
    for (const wh of whMembers) {
      const deptKey = titleToDeptKey(wh.title);
      const deptData = deptKey ? deptResults.get(deptKey) : null;

      const name      = deptData ? deptData.name     : wh.name;
      const sourceUrl = deptData ? deptData.url       : WH_CABINET_URL;
      const source    = deptData ? 'department_website' : 'whitehouse_gov';

      records.push({
        id:             `us-${slug(name)}`,
        jurisdiction:   'US',
        name:           safeStr(name),
        title:          safeStr(wh.title),
        department:     inferDept(wh.title, 'US'),
        date_appointed: '2025-01-20',
        party:          'Republican Party',
        source_url:     sourceUrl,
        source,
        tier:           'cabinet',
      });
    }

    console.log(`[dept-heads:US] Built ${records.length} cabinet records`);
  } catch (err) {
    console.warn(`[dept-heads:US] Skipped — ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: WH_CABINET_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return saveRecords('US', records);
  }

  const count = saveRecords('US', records);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: 'dept-direct+whitehouse.gov', record_count: count, import_status: count > 0 ? 'success' : 'partial', scheduler_tier: SCHEDULER_TIER });
  return count;
}

// ─── UK — gov.uk/government/ministers ────────────────────────────────────────
// 170+ ministers including cabinet, ministers of state, and parliamentary
// under-secretaries. Each is a gem-c-image-card with:
//   gem-c-image-card__title  → profile link + name
//   gem-c-image-card__description → comma-separated role links

const UK_MINISTERS_URL = 'https://www.gov.uk/government/ministers';

// Honorifics to strip for ID generation
const UK_HONORS_RE = /\b(The Rt Hon|Rt Hon|Sir|Dame|Lord|Baroness|Viscount|Earl|MP|MSP|MS|AM|MLA|QC|KC|CBE|OBE|MBE|KCB|KBE|GBE|DCB|GCMG|PC)\b\.?/g;

function inferUKTier(title) {
  if (!title) return 'minister';
  const t = title.toLowerCase();
  if (/prime minister|chancellor of the exchequer|secretary of state|lord chancellor|attorney general|lord president|leader of the house/.test(t)) return 'cabinet';
  if (/minister of state/.test(t)) return 'minister_of_state';
  if (/parliamentary under.secretary|parliamentary secretary/.test(t)) return 'parliamentary_under_secretary';
  if (/whip|lord commissioner|treasurer of.*majesty|comptroller/.test(t)) return 'whip';
  return 'minister';
}

async function fetchUKDeptHeads() {
  const _ts = new Date().toISOString();
  const records = [];

  try {
    console.log('[dept-heads:UK] Fetching gov.uk ministers page...');
    const { data: html } = await axios.get(UK_MINISTERS_URL, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
    });

    // Match title link (name) then description paragraph (roles)
    const re = /gem-c-image-card__title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?gem-c-image-card__description"><p>([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(html))) {
      const profilePath = m[1];
      const name        = stripHtml(m[2]);
      const rolesRaw    = m[3];
      if (!name) continue;

      // Roles are comma-separated anchor tags — extract text of each
      const allTitles = rolesRaw
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .split(/\s*,\s*/)
        .map(t => t.trim())
        .filter(Boolean);

      const primaryTitle = allTitles[0] || null;
      const profileUrl   = profilePath.startsWith('http') ? profilePath : `https://www.gov.uk${profilePath}`;

      // Build a clean ID by stripping honorifics and post-nominals
      const nameForId = name.replace(UK_HONORS_RE, ' ').replace(/\s+/g, ' ').trim();

      records.push({
        id:             `uk-${slug(nameForId)}`,
        jurisdiction:   'UK',
        name:           safeStr(name),
        title:          safeStr(primaryTitle),
        all_titles:     allTitles,
        department:     inferDept(primaryTitle || '', 'UK'),
        // Starmer government formed 5 July 2024; individual appointment
        // dates are not published on the listing page.
        date_appointed: '2024-07-05',
        party:          'Labour Party',
        source_url:     profileUrl,
        tier:           inferUKTier(primaryTitle || ''),
      });
    }

    console.log(`[dept-heads:UK] Extracted ${records.length} ministers`);
  } catch (err) {
    console.warn(`[dept-heads:UK] Skipped — ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: UK_MINISTERS_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return saveRecords('UK', records);
  }

  const count = saveRecords('UK', records);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'UK', data_pull_timestamp: _ts, source_endpoint: UK_MINISTERS_URL, record_count: count, import_status: count > 0 ? 'success' : 'partial', scheduler_tier: SCHEDULER_TIER });
  return count;
}

// ─── Australia — directory.gov.au ────────────────────────────────────────────
// Three tier pages: cabinet, outer ministry, assistant ministers.
// Pattern per entry (inside <article class="portfolio-role child-roles clearfix">):
//   <h3><a href="...">TITLE</a></h3>
//   <p class="role-title"><a href="/people/...">NAME</a></p>

const AU_TIERS = [
  { url: 'https://www.directory.gov.au/commonwealth-parliament/cabinet',             tier: 'cabinet' },
  { url: 'https://www.directory.gov.au/commonwealth-parliament/outer-ministry',      tier: 'outer_ministry' },
  { url: 'https://www.directory.gov.au/commonwealth-parliament/assistant-ministers', tier: 'assistant_minister' },
];

// Honorifics to strip when building AU IDs
const AU_HONORS_RE = /^(The Hon\.?|The Rt Hon\.?|Senator the Hon\.?|Senator|Mr\.|Ms\.|Dr\.|Prof\.|The Honourable)\s*/i;

async function fetchAUDeptHeads() {
  const _ts = new Date().toISOString();
  const records = [];

  try {
    console.log('[dept-heads:AU] Fetching directory.gov.au minister tiers...');

    for (const { url, tier } of AU_TIERS) {
      try {
        const { data: html } = await axios.get(url, {
          timeout: 20000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
        });

        const articleRe = /<article class="portfolio-role child-roles clearfix">([\s\S]*?)<\/article>/g;
        let a;
        while ((a = articleRe.exec(html))) {
          const block  = a[1];
          const titleM = block.match(/<h3>([\s\S]*?)<\/h3>/);
          const nameM  = block.match(/class="[^"]*role-title[^"]*"[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
          if (!titleM || !nameM) continue;

          const title   = stripHtml(titleM[1]);
          const rawName = nameM[1].trim();
          if (!title || !rawName) continue;

          const cleanForId = rawName
            .replace(AU_HONORS_RE, '')
            .replace(/ (MP|Senator)$/, '')
            .trim();

          records.push({
            id:             `au-${slug(cleanForId)}`,
            jurisdiction:   'AU',
            name:           safeStr(rawName),
            title:          safeStr(title),
            department:     inferDept(title, 'AU'),
            // Albanese second-term cabinet sworn in approximately 2025-05-25
            // (post-May 3 2025 election); directory pages do not list dates.
            date_appointed: '2025-05-25',
            party:          'Australian Labor Party',
            source_url:     url,
            tier,
          });
        }

        console.log(`[dept-heads:AU] ${tier}: fetched`);
      } catch (err) {
        console.warn(`[dept-heads:AU] ${tier} skipped — ${err.message}`);
      }
    }

    console.log(`[dept-heads:AU] Total: ${records.length} ministers`);
  } catch (err) {
    console.warn(`[dept-heads:AU] Skipped — ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: AU_TIERS[0]?.url || 'https://www.directory.gov.au/ministers', record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return saveRecords('AU', records);
  }

  const count = saveRecords('AU', records);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'AU', data_pull_timestamp: _ts, source_endpoint: AU_TIERS[0]?.url || 'https://www.directory.gov.au/ministers', record_count: count, import_status: count > 0 ? 'success' : 'partial', scheduler_tier: SCHEDULER_TIER });
  return count;
}

// ─── Key positions for CA / UK / AU cabinet validation ───────────────────────
//
// Each entry's titleRe is tested against the primary title field returned by the
// official listing page for that jurisdiction. Patterns include (?:Acting\s+)? so
// they match both permanent and acting designees. For compound AU titles such as
// "Deputy Prime Minister, Minister for Defence", patterns use \b (not $) so they
// match a prefix of the full title string.
//
// These arrays are exported and consumed by validateCabinet.js.

const CA_KEY_POSITIONS = [
  { key: 'prime_minister',   titleRe: /^(?:Acting\s+)?Prime Minister$/i },
  { key: 'finance',          titleRe: /^(?:Acting\s+)?(?:Deputy Prime Minister and\s+)?Minister of Finance\b/i },
  { key: 'foreign_affairs',  titleRe: /^(?:Acting\s+)?Minister of Foreign Affairs\b/i },
  { key: 'national_defence', titleRe: /^(?:Acting\s+)?Minister of National Defence\b/i },
  { key: 'justice',          titleRe: /^(?:Acting\s+)?Minister of Justice\b/i },
  { key: 'treasury_board',   titleRe: /^(?:Acting\s+)?President of the Treasury Board\b/i },
  { key: 'public_safety',    titleRe: /^(?:Acting\s+)?Minister of Public Safety\b/i },
  { key: 'transport',        titleRe: /^(?:Acting\s+)?Minister of Transport\b/i },
  { key: 'health',           titleRe: /^(?:Acting\s+)?Minister of Health\b/i },
  { key: 'immigration',      titleRe: /^(?:Acting\s+)?Minister of Immigration\b/i },
];

const UK_KEY_POSITIONS = [
  { key: 'prime_minister',    titleRe: /^Prime Minister$/i },
  { key: 'deputy_pm',         titleRe: /^Deputy Prime Minister\b/i },
  { key: 'chancellor',        titleRe: /^Chancellor of the Exchequer$/i },
  { key: 'home_secretary',    titleRe: /^(?:Acting\s+)?Secretary of State for the Home Department$/i },
  // Foreign title truncates at comma: "Secretary of State for Foreign, Commonwealth..."
  { key: 'foreign_secretary', titleRe: /^(?:Acting\s+)?Secretary of State for Foreign\b/i },
  { key: 'health',            titleRe: /^(?:Acting\s+)?Secretary of State for Health\b/i },
  { key: 'education',         titleRe: /^(?:Acting\s+)?Secretary of State for Education\b/i },
  { key: 'defence',           titleRe: /^(?:Acting\s+)?Secretary of State for Defence\b/i },
  { key: 'attorney_general',  titleRe: /^(?:Acting\s+)?Attorney General$/i },
  { key: 'work_pensions',     titleRe: /^(?:Acting\s+)?Secretary of State for Work and Pensions$/i },
];

const AU_KEY_POSITIONS = [
  { key: 'prime_minister',   titleRe: /^(?:Acting\s+)?Prime Minister\b/i },
  // "Deputy Prime Minister, Minister for Defence" — match by prefix
  { key: 'deputy_pm',        titleRe: /^Deputy Prime Minister\b/i },
  { key: 'treasurer',        titleRe: /^(?:Acting\s+)?Treasurer\b/i },
  { key: 'attorney_general', titleRe: /^(?:Acting\s+)?Attorney-General\b/i },
  { key: 'foreign_affairs',  titleRe: /^(?:Acting\s+)?Minister for Foreign Affairs\b/i },
  // "Minister for Home Affairs, Immigration and Citizenship..." — match by prefix
  { key: 'home_affairs',     titleRe: /^(?:Acting\s+)?Minister for Home Affairs\b/i },
  // "Minister for Finance, Women, the Public Service..." — match by prefix
  { key: 'finance',          titleRe: /^(?:Acting\s+)?Minister for Finance\b/i },
  { key: 'education',        titleRe: /^(?:Acting\s+)?Minister for Education\b/i },
  // "Minister for Health and Ageing..." — match by prefix
  { key: 'health',           titleRe: /^(?:Acting\s+)?Minister for Health\b/i },
  { key: 'employment',       titleRe: /^(?:Acting\s+)?Minister for Employment\b/i },
];

// ─── Shared listing-page parsers ──────────────────────────────────────────────
// Used by both the full fetchers (fetchCA/UK/AUDeptHeads) and the key-position
// extractors (fetchDeptSourcesCA/UK/AU). Returning plain objects avoids duplication.

function parseCanadaListing(html) {
  const records = [];
  const re = /<dt>\s*<a href="([^"]+)">(The (?:Right )?Honourable[^<]+)<\/a>\s*<\/dt>\s*<dd>\s*([\s\S]*?)\s*<\/dd>/g;
  let m;
  while ((m = re.exec(html))) {
    const name  = stripHtml(m[2]);
    const title = stripHtml(m[3]);
    if (!name || !title) continue;
    records.push({
      name,
      title,
      url: m[1].startsWith('http') ? m[1] : `https://www.canada.ca${m[1]}`,
    });
  }
  return records;
}

function parseUKListing(html) {
  const records = [];
  const re = /gem-c-image-card__title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?gem-c-image-card__description"><p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const name         = stripHtml(m[2]);
    // Roles are comma-separated anchor tags; the role titles themselves may also contain
    // commas (e.g. "Secretary of State for Foreign, Commonwealth and Development Affairs")
    // which causes split() to truncate them. This is consistent with how stored titles
    // are generated so matching still works across validation runs.
    const primaryTitle = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      .split(/\s*,\s*/)[0].trim();
    if (name && primaryTitle) records.push({
      name,
      title: primaryTitle,
      url: m[1].startsWith('http') ? m[1] : `https://www.gov.uk${m[1]}`,
    });
  }
  return records;
}

function parseAUListing(html, sourceUrl) {
  const records = [];
  const articleRe = /<article class="portfolio-role child-roles clearfix">([\s\S]*?)<\/article>/g;
  let a;
  while ((a = articleRe.exec(html))) {
    const block  = a[1];
    const titleM = block.match(/<h3>([\s\S]*?)<\/h3>/);
    const nameM  = block.match(/class="[^"]*role-title[^"]*"[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    if (!titleM || !nameM) continue;
    const title = stripHtml(titleM[1]);
    const name  = nameM[1].trim();
    if (title && name) records.push({ name, title, url: sourceUrl || null });
  }
  return records;
}

// ─── Dept-source extractors for CA / UK / AU ─────────────────────────────────
// Each function fetches the authoritative listing page for its jurisdiction and
// returns a Map<key, {name, title, url}> for the key positions defined above.

async function fetchDeptSourcesCA() {
  const html    = await httpsGet('https://www.canada.ca/en/government/ministers.html');
  const all     = parseCanadaListing(html);
  const results = new Map();
  for (const pos of CA_KEY_POSITIONS) {
    const match = all.find(r => pos.titleRe.test(r.title));
    if (match) results.set(pos.key, { name: match.name, title: match.title, url: match.url });
    else        console.warn(`[dept-heads:CA] No listing match for key: ${pos.key}`);
  }
  console.log(`[dept-heads:CA] Key positions extracted: ${results.size}/${CA_KEY_POSITIONS.length}`);
  return results;
}

async function fetchDeptSourcesUK() {
  const { data: html } = await axios.get(UK_MINISTERS_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
  });
  const all     = parseUKListing(html);
  const results = new Map();
  for (const pos of UK_KEY_POSITIONS) {
    const match = all.find(r => pos.titleRe.test(r.title));
    if (match) results.set(pos.key, { name: match.name, title: match.title, url: match.url });
    else        console.warn(`[dept-heads:UK] No listing match for key: ${pos.key}`);
  }
  console.log(`[dept-heads:UK] Key positions extracted: ${results.size}/${UK_KEY_POSITIONS.length}`);
  return results;
}

async function fetchDeptSourcesAU() {
  const all = [];
  for (const { url } of AU_TIERS.slice(0, 2)) {  // cabinet + outer only; assistant ministers not needed
    try {
      const { data: html } = await axios.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
      });
      all.push(...parseAUListing(html, url));
    } catch (err) {
      console.warn(`[dept-heads:AU] fetchDeptSourcesAU: ${url} failed — ${err.message}`);
    }
  }
  const results = new Map();
  for (const pos of AU_KEY_POSITIONS) {
    const match = all.find(r => pos.titleRe.test(r.title));
    if (match) results.set(pos.key, { name: match.name, title: match.title, url: match.url });
    else        console.warn(`[dept-heads:AU] No listing match for key: ${pos.key}`);
  }
  console.log(`[dept-heads:AU] Key positions extracted: ${results.size}/${AU_KEY_POSITIONS.length}`);
  return results;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllDeptHeads() {
  console.log('\n[dept-heads] Starting department heads fetch (CA / US / UK / AU)...');

  const results = await Promise.allSettled([
    fetchCanadaDeptHeads(),
    fetchUSDeptHeads(),
    fetchUKDeptHeads(),
    fetchAUDeptHeads(),
  ]);

  const labels = ['CA', 'US', 'UK', 'AU'];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      console.log(`[dept-heads:${labels[i]}] ✓ ${r.value} records saved`);
    } else {
      console.error(`[dept-heads:${labels[i]}] ✗ ${r.reason?.message}`);
    }
  });

  console.log('[dept-heads] Done.');
}

if (require.main === module) {
  fetchAllDeptHeads()
    .then(() => process.exit(0))
    .catch(err => { console.error('[dept-heads] Fatal:', err.message); process.exit(1); });
}

module.exports = {
  fetchAllDeptHeads,
  fetchCanadaDeptHeads,
  fetchUSDeptHeads,
  fetchUKDeptHeads,
  fetchAUDeptHeads,
  // US dept-direct sources (exported for validateCabinet.js)
  DEPT_DIRECT_SOURCES,
  titleToDeptKey,
  fetchDeptSources,
  // CA / UK / AU key-position sources (exported for validateCabinet.js)
  CA_KEY_POSITIONS,
  UK_KEY_POSITIONS,
  AU_KEY_POSITIONS,
  fetchDeptSourcesCA,
  fetchDeptSourcesUK,
  fetchDeptSourcesAU,
};
