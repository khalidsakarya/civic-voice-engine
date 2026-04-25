'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const axios = require('axios');
const { writeAuditLog } = require('../firebase/auditLog');

const SCHEDULER_TIER  = 'weekly';
const COLLECTION_NAME = 'department_heads';

const OUTPUT_DIR = path.resolve(__dirname, '../../output/department_heads');

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

    const re = /<dt>\s*<a href="([^"]+)">(The Honourable[^<]+)<\/a>\s*<\/dt>\s*<dd>\s*([\s\S]*?)\s*<\/dd>/g;
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
        id:             `ca-${slug(name.replace('The Honourable ', ''))}`,
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

// ─── US — whitehouse.gov/administration/cabinet ───────────────────────────────
// Pattern (Gutenberg blocks):
//   <h2 class="wp-block-heading"><strong>NAME</strong></h2>
//   ...
//   <h3 class="wp-block-heading"><strong>TITLE</strong></h3>

const WH_CABINET_URL = 'https://www.whitehouse.gov/administration/cabinet/';

// Non-member h2 strings at the end of the page
const WH_SKIP = new Set(['About', 'Media', 'Initiatives', 'Contact Us', 'News', 'Videos', 'Issues', 'The Administration']);

async function fetchUSDeptHeads() {
  const _ts = new Date().toISOString();
  const records = [];

  try {
    console.log('[dept-heads:US] Fetching whitehouse.gov cabinet page...');
    const { data: html } = await axios.get(WH_CABINET_URL, {
      timeout: 30000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
    });

    // Each section: h2 (name) followed by h3 (title) before the next h2
    const secRe = /<h2[^>]*class="[^"]*wp-block-heading[^"]*"[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*class="[^"]*wp-block-heading|<\/main|<footer)/g;
    let m;
    while ((m = secRe.exec(html))) {
      const name = stripHtml(m[1]);
      if (!name || WH_SKIP.has(name)) continue;

      const h3m = m[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      if (!h3m) continue;
      const title = stripHtml(h3m[1]);
      if (!title) continue;

      records.push({
        id:             `us-${slug(name)}`,
        jurisdiction:   'US',
        name:           safeStr(name),
        title:          safeStr(title),
        department:     inferDept(title, 'US'),
        // Trump second-term inauguration; some secretaries confirmed weeks later
        // but Jan 20 is used as the nominal appointment date.
        date_appointed: '2025-01-20',
        party:          'Republican Party',
        source_url:     WH_CABINET_URL,
        tier:           'cabinet',
      });
    }

    console.log(`[dept-heads:US] Extracted ${records.length} cabinet members`);
  } catch (err) {
    console.warn(`[dept-heads:US] Skipped — ${err.message}`);
    await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: WH_CABINET_URL, record_count: 0, import_status: 'failed', error_message: err.message, scheduler_tier: SCHEDULER_TIER });
    return saveRecords('US', records);
  }

  const count = saveRecords('US', records);
  await writeAuditLog({ collection_name: COLLECTION_NAME, jurisdiction: 'US', data_pull_timestamp: _ts, source_endpoint: WH_CABINET_URL, record_count: count, import_status: count > 0 ? 'success' : 'partial', scheduler_tier: SCHEDULER_TIER });
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
};
