'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/supreme_court');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function saveOutput(type, jur, records) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${type}_${jur}_${ts()}.json`);
  fs.writeFileSync(file, JSON.stringify({ records }, null, 2));
  console.log(`[court:${jur}:${type}] Saved ${records.length} records → ${path.basename(file)}`);
}

function stripTags(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/&#\d+;/g, c => { try { return String.fromCharCode(parseInt(c.slice(2,-1))); } catch(_){return c;} })
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  // "6 February 2012" / "February 6, 2012" / "December 18, 2017"
  const m = str.match(/(\d{1,2})\s+(\w+)\s+(\d{4})|(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const months = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
                   july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
  if (m[1]) {
    const mon = months[m[2].toLowerCase()]; if (!mon) return null;
    return `${m[3]}-${mon}-${m[1].padStart(2,'0')}`;
  } else {
    const mon = months[m[4].toLowerCase()]; if (!mon) return null;
    return `${m[6]}-${mon}-${m[5].padStart(2,'0')}`;
  }
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ─── Canada — Supreme Court of Canada ─────────────────────────────────────────
// Justices: scc-csc.ca bio pages
// Cases: decisions.scc-csc.ca RSS feed

const SCC_JUSTICES = [
  { slug: 'richard-wagner',         name: 'Richard Wagner',         title: 'Chief Justice of Canada',              appointed_by: 'Stephen Harper (as Justice); Justin Trudeau (as Chief Justice)' },
  { slug: 'andromache-karakatsanis', name: 'Andromache Karakatsanis', title: 'Puisne Justice',                       appointed_by: 'Stephen Harper' },
  { slug: 'suzanne-cote',            name: 'Suzanne Côté',            title: 'Puisne Justice',                       appointed_by: 'Stephen Harper' },
  { slug: 'malcolm-rowe',            name: 'Malcolm Rowe',            title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
  { slug: 'sheilah-l-martin',        name: 'Sheilah Martin',          title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
  { slug: 'nicholas-kasirer',        name: 'Nicholas Kasirer',        title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
  { slug: 'mahmud-jamal',            name: 'Mahmud Jamal',            title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
  { slug: 'michelle-obonsawin',      name: 'Michelle O\'Bonsawin',    title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
  { slug: 'mary-t-moreau',           name: 'Mary T. Moreau',          title: 'Puisne Justice',                       appointed_by: 'Justin Trudeau' },
];

async function fetchCAJustices() {
  console.log('[court:CA:justices] Fetching 9 SCC bio pages...');
  const results = await Promise.allSettled(
    SCC_JUSTICES.map(j =>
      axios.get(`https://www.scc-csc.ca/about-apropos/judges-juges/list-liste/${j.slug}/`,
        { headers: BROWSER_HEADERS, timeout: 20000 })
        .then(r => ({ ...j, html: r.data }))
        .catch(() => ({ ...j, html: null }))
    )
  );

  const records = results.map(r => {
    const { slug, name, title, appointed_by, html } = r.value || r.reason || {};
    if (!html) return null;

    const text = stripTags(html);
    const idx  = text.indexOf(name.split(' ').pop());
    const bio  = idx >= 0 ? text.slice(idx, idx + 1200) : text.slice(0, 1200);

    // Extract original appointment date as Justice
    let date_appointed = null;
    const justiceMatch = bio.match(/Judge of the Supreme Court of Canada since ([A-Za-z]+ \d{1,2}, \d{4})/i)
                      || bio.match(/appointed (?:as a )?Justice on ([A-Za-z]+ \d{1,2}, \d{4}|\d{1,2} [A-Za-z]+ \d{4})/i)
                      || bio.match(/since ([A-Za-z]+ \d{1,2}, \d{4})/i);
    if (justiceMatch) date_appointed = parseDate(justiceMatch[1]);

    // First 400 chars of bio as background
    const background = bio.slice(0, 600).replace(/^[^A-Z]+/, '').trim();

    return {
      id:            `CA-SCC-${slug}`,
      jurisdiction:  'CA',
      court:         'Supreme Court of Canada',
      name,
      title,
      date_appointed,
      appointed_by,
      background:    background || null,
      source_url:    `https://www.scc-csc.ca/about-apropos/judges-juges/list-liste/${slug}/`,
    };
  }).filter(Boolean);

  console.log(`[court:CA:justices] ${records.length} justices`);
  saveOutput('justices', 'CA', records);
  return records;
}

async function fetchCACases() {
  console.log('[court:CA:cases] Fetching SCC RSS decisions (2023+)...');
  const r = await axios.get('https://decisions.scc-csc.ca/scc-csc/scc-csc/en/rss.do',
    { headers: BROWSER_HEADERS, timeout: 20000 });

  const xml = r.data;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  const records = items.map(m => {
    const raw     = m[1];
    const rawTitle  = raw.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/\s+/g,' ').trim() || '';
    const link      = raw.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const descRaw   = raw.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').trim() || '';
    const descText  = stripTags(descRaw).trim();

    const citationMatch = rawTitle.match(/- (\d{4} SCC \d+)/);
    const dateInTitle   = rawTitle.match(/- (\d{4}-\d{2}-\d{2})\s*$/);
    const citation      = citationMatch?.[1] || null;

    const caseName = rawTitle
      .replace(/ - \d{4} SCC \d+.*/, '')
      .replace(/ - \d{4}-\d{2}-\d{2}.*/, '')
      .trim();

    let date = dateInTitle?.[1] || null;
    if (!date) {
      const descDate = descText.match(/(\d{4}-\d{2}-\d{2})/);
      if (descDate) date = descDate[1];
    }

    // Filter to 2023+
    if (date && date < '2023-01-01') return null;

    const summary = descText.replace(/^New document published.*?\.|^Document updated.*?\./i, '').trim() || null;
    if (!caseName) return null;
    const idSlug = caseName.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);

    return {
      id:           `CA-SCC-${idSlug}-${date || 'unknown'}`,
      jurisdiction: 'CA',
      court:        'Supreme Court of Canada',
      title:        caseName,
      citation,
      date:         date || null,
      status:       citation ? 'decided' : 'ongoing',
      summary:      summary || null,
      source_url:   link || 'https://decisions.scc-csc.ca/scc-csc/scc-csc/en/nav.do',
    };
  }).filter(Boolean);

  // Deduplicate by title+date
  const seen = new Set();
  const deduped = records.filter(r => {
    const k = r.title + r.date;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  // Also fetch hearing list for upcoming cases
  let upcoming = [];
  try {
    const hearingsPage = await axios.get('https://www.scc-csc.ca/case-dossier/cms-sgd/near-proche-eng.aspx',
      { headers: BROWSER_HEADERS, timeout: 15000 });
    const hText = stripTags(hearingsPage.data);
    // Extract upcoming hearing entries: lines with year+case name pattern
    const lines = hText.split('\n').map(l => l.trim()).filter(l => l.length > 20);
    for (const line of lines) {
      const dateM = line.match(/(\d{4}-\d{2}-\d{2}|\w+ \d{1,2},? \d{4})/);
      const date  = dateM ? parseDate(dateM[1]) : null;
      if (!date || date < '2023-01-01') continue;
      const title = line.replace(dateM?.[0] || '', '').replace(/\s+/g,' ').trim().slice(0, 120);
      if (!title || title.length < 5) continue;
      const idSlug = title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);
      upcoming.push({
        id:           `CA-SCC-upcoming-${idSlug}`,
        jurisdiction: 'CA',
        court:        'Supreme Court of Canada',
        title,
        citation:     null,
        date,
        status:       'upcoming',
        summary:      null,
        source_url:   'https://www.scc-csc.ca/case-dossier/cms-sgd/near-proche-eng.aspx',
      });
    }
    // Deduplicate upcoming against decided
    const decidedTitles = new Set(deduped.map(d => d.title));
    upcoming = upcoming.filter(u => !decidedTitles.has(u.title)).slice(0, 10);
    console.log(`[court:CA:cases] ${upcoming.length} upcoming hearings found`);
  } catch (e) {
    console.warn(`[court:CA:cases] Upcoming hearings fetch failed: ${e.message}`);
  }

  const all = [...deduped, ...upcoming];
  console.log(`[court:CA:cases] ${all.length} cases (${deduped.length} decided/ongoing, ${upcoming.length} upcoming)`);
  saveOutput('cases', 'CA', all);
  return all;
}

// ─── United States — Supreme Court of the United States ───────────────────────
// Justices + Cases: api.oyez.org (free, no auth required)

async function fetchUSJustices() {
  console.log('[court:US:justices] Fetching SCOTUS justices from Oyez...');
  const r = await axios.get('https://api.oyez.org/justices',
    { params: { per_page: 0 }, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });

  const all = r.data || [];
  // Filter to currently serving (date_end = 0 or null on most-recent SCOTUS role)
  const current = all.filter(j => {
    const scotusRole = (j.roles || []).find(role =>
      role.type === 'scotus_justice' && (!role.date_end || role.date_end === 0)
    );
    return !!scotusRole;
  });

  // Fetch individual profiles for description
  const profiles = await Promise.allSettled(
    current.map(j =>
      axios.get(j.href, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 })
        .then(r2 => r2.data)
        .catch(() => j)
    )
  );

  const records = profiles.map((p, i) => {
    const profile  = p.status === 'fulfilled' ? p.value : current[i];
    const scotusRole = (profile.roles || []).find(role =>
      role.type === 'scotus_justice' && (!role.date_end || role.date_end === 0)
    ) || (profile.roles || [])[0];

    const dateAppointed = scotusRole?.date_start
      ? new Date(scotusRole.date_start * 1000).toISOString().slice(0, 10)
      : null;
    const appointedBy = scotusRole?.appointing_president
      || (profile.name === 'Ketanji Brown Jackson' ? 'Joe Biden' : null);

    const background = [
      profile.description,
      profile.educations?.map(e => `Educated at ${e.school?.name || e.school}`).join('; '),
    ].filter(Boolean).join(' ').slice(0, 600) || null;

    return {
      id:            `US-SCOTUS-${profile.ID || i}`,
      jurisdiction:  'US',
      court:         'Supreme Court of the United States',
      name:          profile.name,
      title:         scotusRole?.role_title || 'Justice of the Supreme Court',
      date_appointed: dateAppointed,
      appointed_by:  appointedBy,
      background,
      source_url:    `https://www.oyez.org/justices/${profile.href?.split('/').pop() || ''}`,
    };
  });

  console.log(`[court:US:justices] ${records.length} justices`);
  saveOutput('justices', 'US', records);
  return records;
}

async function fetchUSCases() {
  // Fetch terms 2022, 2023, 2024 — covers Oct 2022 through present (2023+ decisions)
  const TERMS = ['2022', '2023', '2024'];
  const allCaseList = [];
  const seenDockets = new Set();

  for (const term of TERMS) {
    console.log(`[court:US:cases] Fetching SCOTUS term ${term} from Oyez...`);
    try {
      const r = await axios.get('https://api.oyez.org/cases',
        { params: { filter: `term:${term}`, page: 0, per_page: 100 },
          headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 25000 });
      for (const c of (r.data || [])) {
        const key = c.docket_number?.trim() || c.ID;
        if (!seenDockets.has(key)) { seenDockets.add(key); allCaseList.push(c); }
      }
      console.log(`[court:US:cases] Term ${term}: ${r.data?.length || 0} cases`);
    } catch (e) {
      console.warn(`[court:US:cases] Term ${term} fetch failed: ${e.message}`);
    }
  }

  console.log(`[court:US:cases] ${allCaseList.length} total cases across terms, fetching details (up to 60)...`);

  // Prioritise recent + undecided cases; fetch up to 60 details
  const toFetch = allCaseList.slice(0, 60);

  const details = await Promise.allSettled(
    toFetch.map(c =>
      axios.get(c.href, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 })
        .then(r2 => r2.data)
        .catch(() => c)
    )
  );

  const records = details.map((d, i) => {
    const cas = d.status === 'fulfilled' ? d.value : toFetch[i];
    const decision = (cas.decisions || [])[0];

    const timeline    = cas.timeline || [];
    const grantedEvent = timeline.find(t => t.event === 'Granted');
    const arguedEvent  = timeline.find(t => t.event === 'Argued');
    const decidedEvent = timeline.find(t => t.event === 'Decided');

    const dateGranted = grantedEvent?.dates?.[0]
      ? new Date(grantedEvent.dates[0] * 1000).toISOString().slice(0, 10) : null;
    const dateArgued  = arguedEvent?.dates?.[0]
      ? new Date(arguedEvent.dates[0] * 1000).toISOString().slice(0, 10) : null;
    const dateDecided = decidedEvent?.dates?.[0]
      ? new Date(decidedEvent.dates[0] * 1000).toISOString().slice(0, 10) : null;

    // Normalised status: decided / ongoing / upcoming
    const status = dateDecided ? 'decided'
                 : dateArgued  ? 'ongoing'   // argued but awaiting opinion
                 :               'upcoming';  // cert granted, not yet argued

    const summary = [
      cas.facts_of_the_case ? `Facts: ${stripTags(cas.facts_of_the_case).slice(0, 300)}` : null,
      cas.question          ? `Question: ${stripTags(cas.question).slice(0, 200)}` : null,
      cas.conclusion        ? `Held: ${stripTags(cas.conclusion).slice(0, 200)}`  : null,
    ].filter(Boolean).join(' ').slice(0, 600) || null;

    const citation = cas.citation
      ? `${cas.citation.volume} U.S. ${cas.citation.page || '__'} (${cas.citation.year})`
      : null;

    return {
      id:            `US-SCOTUS-${cas.ID || cas.docket_number?.replace(/\s+/g,'') || i}`,
      jurisdiction:  'US',
      court:         'Supreme Court of the United States',
      title:         cas.name || `${cas.first_party} v. ${cas.second_party}`,
      docket:        (cas.docket_number || '').trim() || null,
      term:          cas.term || null,
      citation,
      date:          dateDecided || dateArgued || dateGranted,
      date_argued:   dateArgued,
      date_decided:  dateDecided,
      status,
      decision:      decision?.description?.slice(0, 300) || null,
      summary,
      source_url:    `https://www.oyez.org/cases/${cas.term}/${cas.docket_number?.trim()}`,
    };
  }).filter(r => r.date >= '2023-01-01' || !r.date); // keep 2023+ and undated upcoming

  console.log(`[court:US:cases] ${records.length} cases (filtered 2023+)`);
  saveOutput('cases', 'US', records);
  return records;
}

// ─── United Kingdom — UK Supreme Court ────────────────────────────────────────
// Justices: supremecourt.uk/justices/<slug>
// Cases: case links extracted from supremecourt.uk/cases, individual page parse

const UKSC_JUSTICES = [
  { slug: 'lord-reed',        name: 'Lord Reed',         title: 'President of the Supreme Court',         appointed_by: 'David Cameron' },
  { slug: 'lord-hodge',       name: 'Lord Hodge',        title: 'Deputy President of the Supreme Court',  appointed_by: 'David Cameron' },
  { slug: 'lord-lloyd-jones', name: 'Lord Lloyd-Jones',  title: 'Justice of the Supreme Court',           appointed_by: 'Theresa May' },
  { slug: 'lord-briggs',      name: 'Lord Briggs',       title: 'Justice of the Supreme Court',           appointed_by: 'Theresa May' },
  { slug: 'lord-sales',       name: 'Lord Sales',        title: 'Justice of the Supreme Court',           appointed_by: 'Theresa May' },
  { slug: 'lord-hamblen',     name: 'Lord Hamblen',      title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lord-leggatt',     name: 'Lord Leggatt',      title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lord-burrows',     name: 'Lord Burrows',      title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lord-stephens',    name: 'Lord Stephens',     title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lady-rose',        name: 'Lady Rose',         title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lord-richards',    name: 'Lord Richards',     title: 'Justice of the Supreme Court',           appointed_by: 'Boris Johnson' },
  { slug: 'lady-simler',      name: 'Lady Simler',       title: 'Justice of the Supreme Court',           appointed_by: 'Rishi Sunak' },
];

async function fetchUKJustices() {
  console.log(`[court:UK:justices] Fetching ${UKSC_JUSTICES.length} UKSC justice pages...`);
  const pages = await Promise.allSettled(
    UKSC_JUSTICES.map(j =>
      axios.get(`https://www.supremecourt.uk/justices/${j.slug}`,
        { headers: BROWSER_HEADERS, timeout: 20000 })
        .then(r => ({ ...j, html: r.data }))
        .catch(() => ({ ...j, html: null }))
    )
  );

  const records = pages.map(p => {
    const { slug, name, title, appointed_by, html } = p.value || p.reason || {};
    if (!html) return null;

    const text  = stripTags(html);
    const nameToken = name.replace(/^(Lord|Lady)\s+/, '');
    const idx   = text.indexOf(nameToken);
    const bio   = idx >= 0 ? text.slice(idx, idx + 1000) : text.slice(0, 1000);

    // Extract original appointment date as a Justice
    let date_appointed = null;
    const apptMatch = bio.match(/appointed as a Justice on (\d{1,2} \w+ \d{4})/i)
                   || bio.match(/originally appointed(?:\s+as a Justice)? on (\d{1,2} \w+ \d{4})/i)
                   || bio.match(/appointment as (?:a Justice|Justice of) [^o]*on (\d{1,2} \w+ \d{4})/i)
                   || bio.match(/as a Justice from (\d{1,2} \w+ \d{4})/i);
    if (apptMatch) date_appointed = parseDate(apptMatch[1]);

    const background = bio.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 600) || null;

    return {
      id:            `UK-UKSC-${slug}`,
      jurisdiction:  'UK',
      court:         'UK Supreme Court',
      name,
      title,
      date_appointed,
      appointed_by,
      background,
      source_url:    `https://www.supremecourt.uk/justices/${slug}`,
    };
  }).filter(Boolean);

  console.log(`[court:UK:justices] ${records.length} justices`);
  saveOutput('justices', 'UK', records);
  return records;
}

async function fetchUKCases() {
  // UK National Archives Find Case Law — Atom feed for UKSC decisions 2023+
  // https://caselaw.nationalarchives.gov.uk/atom.xml?query=&court=uksc&date_from=2023-01-01&per_page=50&page=N
  console.log('[court:UK:cases] Fetching UKSC decisions via UK National Archives Atom feed (2023+)...');

  const TNA_BASE = 'https://caselaw.nationalarchives.gov.uk';
  const allEntries = [];

  // Fetch up to 5 pages (250 max) to cover all 2023+ cases
  for (let page = 1; page <= 5; page++) {
    try {
      const r = await axios.get(`${TNA_BASE}/atom.xml`, {
        params: { query: '', court: 'uksc', date_from: '2023-01-01', per_page: 50, page },
        headers: { ...BROWSER_HEADERS, Accept: 'application/atom+xml,text/xml,*/*' },
        timeout: 25000,
      });
      const entries = [...r.data.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
      if (!entries.length) break;
      allEntries.push(...entries);
      const oldest = entries[entries.length - 1]?.[1]?.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.slice(0, 10);
      console.log(`[court:UK:cases] Atom page ${page}: ${entries.length} entries (oldest: ${oldest})`);
      // Stop if oldest entry is before 2023
      if (oldest && oldest < '2023-01-01') break;
    } catch (e) {
      console.warn(`[court:UK:cases] Atom page ${page} failed: ${e.message}`);
      break;
    }
  }

  console.log(`[court:UK:cases] ${allEntries.length} raw Atom entries`);

  const seen = new Set();
  const decidedRecords = allEntries.map(m => {
    const raw     = m[1];
    const title   = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<!\[CDATA\[|\]\]>/g, '').trim() || '';
    const updated = raw.match(/<updated>([\s\S]*?)<\/updated>/i)?.[1]?.slice(0, 10) || null;
    const id      = raw.match(/<id>([\s\S]*?)<\/id>/i)?.[1]?.trim() || '';
    const cite    = raw.match(/\[(\d{4})\] UKSC (\d+)/)?.[0] || null;

    if (!title || !updated || updated < '2023-01-01') return null;
    if (seen.has(cite || title)) return null;
    seen.add(cite || title);

    // Build canonical URL from neutral citation e.g. [2025] UKSC 13 → /uksc/2025/13
    const citeMatch = cite?.match(/\[(\d{4})\] UKSC (\d+)/);
    const sourceUrl = citeMatch
      ? `${TNA_BASE}/uksc/${citeMatch[1]}/${citeMatch[2]}`
      : id.startsWith('http') ? id : `${TNA_BASE}/${id}`;

    const idSlug = cite?.replace(/[\[\]\s]/g, '_') || title.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 60);

    return {
      id:           `UK-UKSC-${idSlug}`,
      jurisdiction: 'UK',
      court:        'UK Supreme Court',
      title,
      citation:     cite,
      date:         updated,
      status:       'decided',
      summary:      null,
      source_url:   sourceUrl,
    };
  }).filter(Boolean);

  // Also fetch upcoming UKSC cases from the main /cases page
  let upcomingRecords = [];
  try {
    const mainPage = await axios.get('https://www.supremecourt.uk/cases',
      { headers: BROWSER_HEADERS, timeout: 20000 });
    const caseLinks = [...new Set(
      [...mainPage.data.matchAll(/href="(\/cases\/uksc-\d{4}-\d+[^"#]*?)"/g)]
        .map(m => m[1]).filter(u => !/[-]([ab])(\b|$)/.test(u))
    )];

    const casePages = await Promise.allSettled(
      caseLinks.slice(0, 20).map(url =>
        axios.get(`https://www.supremecourt.uk${url}`, { headers: BROWSER_HEADERS, timeout: 20000 })
          .then(r => ({ url, html: r.data }))
          .catch(() => ({ url, html: null }))
      )
    );

    upcomingRecords = casePages.map(p => {
      const { url, html } = p.value || {};
      if (!html) return null;
      const caseId = url.replace('/cases/', '').toUpperCase();
      const title  = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
      if (!title) return null;

      const text = stripTags(html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || html);
      const isHearing = html.includes('Hearing listed') || html.includes('hearing is listed');
      const status = isHearing ? 'upcoming' : 'ongoing';

      // Don't duplicate if already in decided list
      if (seen.has(title)) return null;

      return {
        id:           `UK-UKSC-${caseId}`,
        jurisdiction: 'UK',
        court:        'UK Supreme Court',
        title,
        citation:     null,
        case_id:      caseId,
        date:         null,
        status,
        summary:      null,
        source_url:   `https://www.supremecourt.uk${url}`,
      };
    }).filter(Boolean);

    console.log(`[court:UK:cases] ${upcomingRecords.length} upcoming/ongoing cases from UKSC site`);
  } catch (e) {
    console.warn(`[court:UK:cases] UKSC /cases page failed: ${e.message}`);
  }

  const all = [...decidedRecords, ...upcomingRecords];
  const decided  = all.filter(r => r.status === 'decided').length;
  const ongoing  = all.filter(r => r.status === 'ongoing').length;
  const upcoming = all.filter(r => r.status === 'upcoming').length;
  console.log(`[court:UK:cases] ${all.length} total — decided:${decided} ongoing:${ongoing} upcoming:${upcoming}`);
  saveOutput('cases', 'UK', all);
  return all;
}

// ─── Australia — High Court of Australia ──────────────────────────────────────
// Justices: Wikipedia composition table (hcourt.gov.au consistently times out)
// Cases: AustLII year index for 2024–2025

async function fetchAUJustices() {
  console.log('[court:AU:justices] Fetching HCA composition from Wikipedia...');
  const r = await axios.get('https://en.wikipedia.org/w/api.php', {
    params: { action: 'parse', page: 'High_Court_of_Australia', prop: 'text', format: 'json', section: 31 },
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    timeout: 20000,
  });

  const html = r.data?.parse?.text?.['*'] || '';
  const text = stripTags(html);

  // Current 7 HCA justices from the composition table
  const AU_JUSTICES_RAW = [
    { name: 'Stephen Gageler',       title: 'Chief Justice of Australia',   slug: 'stephen-gageler',    appointed_by_pm: 'Anthony Albanese (Labor)',  date_appointed_str: '6 November 2023' },
    { name: 'Michelle Gordon',       title: 'Justice of the High Court',    slug: 'michelle-gordon',    appointed_by_pm: 'Tony Abbott (Liberal)',      date_appointed_str: '9 June 2015' },
    { name: 'James Edelman',         title: 'Justice of the High Court',    slug: 'james-edelman',      appointed_by_pm: 'Malcolm Turnbull (Liberal)', date_appointed_str: '30 January 2017' },
    { name: 'Simon Steward',         title: 'Justice of the High Court',    slug: 'simon-steward',      appointed_by_pm: 'Scott Morrison (Liberal)',   date_appointed_str: '1 December 2020' },
    { name: 'Jacqueline Gleeson',    title: 'Justice of the High Court',    slug: 'jacqueline-gleeson', appointed_by_pm: 'Scott Morrison (Liberal)',   date_appointed_str: '1 March 2021' },
    { name: 'Jayne Jagot',           title: 'Justice of the High Court',    slug: 'jayne-jagot',        appointed_by_pm: 'Anthony Albanese (Labor)',   date_appointed_str: '17 October 2022' },
    { name: 'Robert Beech-Jones',    title: 'Justice of the High Court',    slug: 'robert-beech-jones', appointed_by_pm: 'Anthony Albanese (Labor)',   date_appointed_str: '6 November 2023' },
  ];

  // Enrich with backgrounds extracted from Wikipedia text where available
  const records = AU_JUSTICES_RAW.map(j => {
    const idx = text.indexOf(j.name);
    const background = idx >= 0 ? text.slice(idx, idx + 400).trim() : null;

    return {
      id:            `AU-HCA-${j.slug}`,
      jurisdiction:  'AU',
      court:         'High Court of Australia',
      name:          j.name,
      title:         j.title,
      date_appointed: parseDate(j.date_appointed_str),
      appointed_by:  j.appointed_by_pm,
      background:    background || null,
      source_url:    'https://www.hcourt.gov.au/justices/current-justices',
    };
  });

  console.log(`[court:AU:justices] ${records.length} justices`);
  saveOutput('justices', 'AU', records);
  return records;
}

async function fetchAUCases() {
  // classic.austlii.edu.au — probe individual case pages directly, bypassing the TOC
  // (TOC pages 403 under concurrent load; individual pages are stable)
  // HCA cases are sequentially numbered per year: /au/cases/cth/HCA/{year}/{N}.html
  console.log('[court:AU:cases] Fetching HCA decisions from classic.austlii.edu.au (2023-2025, sequential probe)...');

  const CLASSIC_BASE = 'https://classic.austlii.edu.au';
  const DELAY_MS     = 400;

  // Probe ranges: start from high numbers and work down (most recent first)
  // 2025: up to ~55 cases; 2024: ~40; 2023: ~40
  const probeRanges = [
    ...Array.from({ length: 55 }, (_, i) => ({ yr: '2025', num: 55 - i })),
    ...Array.from({ length: 40 }, (_, i) => ({ yr: '2024', num: 40 - i })),
    ...Array.from({ length: 40 }, (_, i) => ({ yr: '2023', num: 40 - i })),
  ];

  // Collect successfully fetched pages sequentially to avoid rate limiting
  const pages = [];
  let consecutiveFail = 0;
  let lastYr = null;
  let ipBlocked = false;

  for (const { yr, num } of probeRanges) {
    if (ipBlocked) break;
    if (yr !== lastYr) { consecutiveFail = 0; lastYr = yr; }
    if (consecutiveFail >= 5) continue; // skip rest of year after 5 consecutive failures

    const path = `/au/cases/cth/HCA/${yr}/${num}.html`;
    try {
      const r = await axios.get(`${CLASSIC_BASE}${path}`,
        { headers: BROWSER_HEADERS, timeout: 25000 });
      pages.push({ path, yr, num, html: r.data });
      consecutiveFail = 0;
      if (pages.length % 10 === 0) console.log(`[court:AU:cases] Fetched ${pages.length} pages so far...`);
    } catch (e) {
      const status = e.response?.status;
      if (status === 403) {
        consecutiveFail++;
        if (consecutiveFail >= 3) {
          console.warn(`[court:AU:cases] IP blocked by classic.austlii.edu.au (403) — aborting AU fetch`);
          ipBlocked = true;
        }
      } else if (status === 404) {
        consecutiveFail++;
      } else {
        console.warn(`[court:AU:cases] ${yr}/${num}: ${e.message.slice(0, 40)}`);
        consecutiveFail++;
      }
    }
    await new Promise(r => setTimeout(r, DELAY_MS));

    if (pages.length >= 45) break; // cap at 45 to control runtime
  }

  console.log(`[court:AU:cases] ${pages.length} pages fetched, parsing...`);

  const records = pages.map(({ path, yr, num, html }) => {
    const text  = stripTags(html);
    const cite  = html.match(/\[(\d{4})\]\s+HCA\s+(\d+)/)?.[0] || `[${yr}] HCA ${num}`;

    // Title: from <title> or from first heading containing "v"
    let title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
              || text.match(/([A-Z][^\n]{5,80}\sv\s[A-Z][^\n]{3,60})/)?.[0]
              || cite;
    // Strip AustLII boilerplate from title
    title = title.replace(/\s*[-|—]\s*AustLII.*$/i, '').replace(/\[(\d{4})\]\s+HCA\s+\d+.*/,'').trim();

    // Date from citation parenthetical or from HTML
    const dateMatch = html.match(/\[(\d{4})\]\s+HCA\s+\d+\s+\(([^)]+)\)/)?.[2]
                   || text.match(/(?:decided|delivered)\s+(\d{1,2}\s+\w+\s+\d{4})/i)?.[1];
    const dateStr = dateMatch ? parseDate(dateMatch) : null;

    const caseNumId = cite.replace(/[\[\]\s]/g, '_');

    // Order / decision outcome
    const order = text.match(/ORDER\s+(.{20,400}?)(?=REASONS|JUDGMENT|HIGH COURT|$)/s)?.[1]?.trim().slice(0, 300)
                || text.match(/(?:Appeal|Application) (?:allowed|dismissed)[^.]*\./i)?.[0]
                || null;
    const coram = text.match(/(?:GAGELER|GORDON|EDELMAN|STEWARD|GLEESON|JAGOT|BEECH.JONES)[^J]*(?:JJ|CJ)/i)?.[0]?.trim() || null;

    return {
      id:           `AU-HCA-${caseNumId}`,
      jurisdiction: 'AU',
      court:        'High Court of Australia',
      title,
      citation:     cite,
      date:         dateStr || `${yr}-01-01`,
      status:       'decided',
      decision:     order,
      justices:     coram,
      summary:      order || null,
      source_url:   `${CLASSIC_BASE}${path}`,
    };
  }).filter(r => r.title && r.title.length > 3);

  console.log(`[court:AU:cases] ${records.length} cases`);
  saveOutput('cases', 'AU', records);
  return records;
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

async function fetchAllSupremeCourtData() {
  console.log('[court] Fetching supreme court data for CA / US / UK / AU...');

  const [caJ, caC, usJ, usC, ukJ, ukC, auJ, auC] = await Promise.allSettled([
    fetchCAJustices(),
    fetchCACases(),
    fetchUSJustices(),
    fetchUSCases(),
    fetchUKJustices(),
    fetchUKCases(),
    fetchAUJustices(),
    fetchAUCases(),
  ]);

  const results = [
    ['CA justices', caJ], ['CA cases', caC],
    ['US justices', usJ], ['US cases', usC],
    ['UK justices', ukJ], ['UK cases', ukC],
    ['AU justices', auJ], ['AU cases', auC],
  ];

  let totalJustices = 0, totalCases = 0;
  for (const [label, res] of results) {
    if (res.status === 'fulfilled') {
      const n = res.value.length;
      if (label.includes('justices')) totalJustices += n;
      else totalCases += n;
    } else {
      console.error(`[court] ${label} FAILED: ${res.reason?.message || res.reason}`);
    }
  }

  console.log(`[court] Done — ${totalJustices} justices, ${totalCases} cases saved.`);
  return { totalJustices, totalCases };
}

module.exports = { fetchAllSupremeCourtData };

if (require.main === module) {
  fetchAllSupremeCourtData()
    .then(({ totalJustices, totalCases }) => {
      console.log(`Fetched ${totalJustices} justices and ${totalCases} cases.`);
      process.exit(0);
    })
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
