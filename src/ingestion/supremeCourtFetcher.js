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
  console.log('[court:CA:cases] Fetching SCC RSS decisions...');
  const r = await axios.get('https://decisions.scc-csc.ca/scc-csc/scc-csc/en/rss.do',
    { headers: BROWSER_HEADERS, timeout: 20000 });

  const xml = r.data;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30);

  const records = items.map(m => {
    const raw     = m[1];
    const rawTitle  = raw.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/\s+/g,' ').trim() || '';
    const link      = raw.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const descRaw   = raw.match(/<description>([\s\S]*?)<\/description>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').trim() || '';
    const descText  = stripTags(descRaw).trim();

    // Title format: "Case Name - YYYY SCC N - YYYY-MM-DD"
    // or            "Case Name - YYYY-MM-DD"
    const citationMatch = rawTitle.match(/- (\d{4} SCC \d+)/);
    const dateInTitle   = rawTitle.match(/- (\d{4}-\d{2}-\d{2})\s*$/);
    const citation      = citationMatch?.[1] || null;

    // Case name = everything before the citation or date suffix
    const caseName = rawTitle
      .replace(/ - \d{4} SCC \d+.*/, '')
      .replace(/ - \d{4}-\d{2}-\d{2}.*/, '')
      .trim();

    // Date: from title suffix or from description "published on YYYY-MM-DD"
    let date = dateInTitle?.[1] || null;
    if (!date) {
      const descDate = descText.match(/(\d{4}-\d{2}-\d{2})/);
      if (descDate) date = descDate[1];
    }

    // Summary from description
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
      status:       citation ? 'Decided' : 'Pending',
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

  console.log(`[court:CA:cases] ${deduped.length} cases`);
  saveOutput('cases', 'CA', deduped);
  return deduped;
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
  console.log('[court:US:cases] Fetching SCOTUS cases from Oyez (term 2024)...');
  const r = await axios.get('https://api.oyez.org/cases',
    { params: { filter: 'term:2024', page: 0, per_page: 25 },
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });

  const caseList = r.data || [];
  console.log(`[court:US:cases] ${caseList.length} cases in term 2024, fetching details...`);

  // Fetch individual case details in parallel (capped to 20)
  const details = await Promise.allSettled(
    caseList.slice(0, 20).map(c =>
      axios.get(c.href, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 })
        .then(r2 => r2.data)
        .catch(() => c)
    )
  );

  const records = details.map((d, i) => {
    const cas = d.status === 'fulfilled' ? d.value : caseList[i];
    const decision = (cas.decisions || [])[0];

    const timeline = cas.timeline || [];
    const grantedEvent  = timeline.find(t => t.event === 'Granted');
    const decidedEvent  = timeline.find(t => t.event === 'Decided');

    const dateArgued  = timeline.find(t => t.event === 'Argued');
    const dateGranted = grantedEvent?.dates?.[0]
      ? new Date(grantedEvent.dates[0] * 1000).toISOString().slice(0, 10) : null;
    const dateDecided = decidedEvent?.dates?.[0]
      ? new Date(decidedEvent.dates[0] * 1000).toISOString().slice(0, 10) : null;

    // Status
    const status = dateDecided ? 'Decided'
                 : dateArgued  ? 'Argued — awaiting decision'
                 :               'Pending';

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
      citation,
      date:          dateDecided || dateGranted,
      status,
      decision:      decision?.description?.slice(0, 300) || null,
      summary,
      source_url:    `https://www.oyez.org/cases/${cas.term}/${cas.docket_number?.trim()}`,
    };
  });

  console.log(`[court:US:cases] ${records.length} cases`);
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
  console.log('[court:UK:cases] Fetching UKSC cases list...');

  // Extract case IDs from the cases page HTML
  const listPage = await axios.get('https://www.supremecourt.uk/cases',
    { headers: BROWSER_HEADERS, timeout: 20000 });
  const caseLinks = [...new Set(
    [...listPage.data.matchAll(/href="(\/cases\/uksc-\d{4}-\d+[^"]*?)"/g)]
      .map(m => m[1])
      .filter(u => !u.includes('-a') && !u.includes('-b'))   // skip sub-hearings
  )];
  console.log(`[court:UK:cases] Found ${caseLinks.length} unique case links in HTML`);

  // Fetch each case page
  const casePages = await Promise.allSettled(
    caseLinks.slice(0, 20).map(url =>
      axios.get(`https://www.supremecourt.uk${url}`,
        { headers: BROWSER_HEADERS, timeout: 20000 })
        .then(r => ({ url, html: r.data }))
        .catch(() => ({ url, html: null }))
    )
  );

  const records = casePages.map(p => {
    const { url, html } = p.value || {};
    if (!html) return null;

    const main = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] || html);
    const text = stripTags(main);

    // Case ID from URL
    const caseId = url.replace('/cases/', '').toUpperCase();

    // Title = first <h1>
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) return null;

    // Extract structured fields
    const extract = (label) => {
      const re = new RegExp(`${label}[:\\s]+([^\\n]+?)(?=\\s{2,}|Case ID|Parties|Issue|Facts|Date|$)`, 'i');
      return text.match(re)?.[1]?.trim() || null;
    };

    const dateIssued = extract('Date of issue') || extract('Date issued');
    const issue      = text.match(/Issue\s+(.{30,400}?)(?=Facts|Date|Case ID|Parties|Change|$)/s)?.[1]?.trim().slice(0, 400) || null;
    const facts      = text.match(/Facts\s+(.{30,500}?)(?=Issue|Date|Case ID|Parties|Change|$)/s)?.[1]?.trim().slice(0, 400) || null;

    // Parties
    const parties = text.match(/(?:Appellant|Respondent)\(s\)\s+([^\n]{5,120})/gi)
      ?.map(s => s.trim()).join(' / ').slice(0, 200) || null;

    // Status: "Hearing listed" → upcoming; if issue/facts available → pending; decided if date in past
    const hasHearing = html.includes('Hearing listed') || html.includes('hearing is listed');
    const dateStr    = dateIssued ? parseDate(dateIssued) : null;
    const status     = hasHearing ? 'Hearing listed'
                     : dateStr && dateStr < new Date().toISOString().slice(0,10) ? 'Decided'
                     : 'Pending';

    return {
      id:            `UK-UKSC-${caseId}`,
      jurisdiction:  'UK',
      court:         'UK Supreme Court',
      title,
      case_id:       caseId,
      parties,
      issue,
      summary:       facts || issue || null,
      date:          dateStr,
      status,
      source_url:    `https://www.supremecourt.uk${url}`,
    };
  }).filter(Boolean);

  console.log(`[court:UK:cases] ${records.length} cases`);
  saveOutput('cases', 'UK', records);
  return records;
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
  console.log('[court:AU:cases] Fetching HCA decisions from AustLII (2024 + 2025)...');

  // Get year indexes for 2024 and 2025
  const yearResults = await Promise.allSettled(
    ['2024', '2025'].map(yr =>
      axios.get(`https://www.austlii.edu.au/cgi-bin/viewtoc/au/cases/cth/HCA/${yr}/`,
        { headers: BROWSER_HEADERS, timeout: 25000 })
        .then(r => ({ yr, html: r.data }))
        .catch(e => { console.warn(`[court:AU:cases] AustLII ${yr} failed: ${e.message}`); return { yr, html: '' }; })
    )
  );

  // Extract case links and titles
  const caseEntries = [];
  for (const res of yearResults) {
    if (res.status !== 'fulfilled') continue;
    const { yr, html } = res.value;
    const matches = [...(html || '').matchAll(
      /href="(\/cgi-bin\/viewdoc\/au\/cases\/cth\/HCA\/\d+\/\d+\.html)"[^>]*>([^<]+)<\/a>/g
    )];
    for (const m of matches) {
      caseEntries.push({ path: m[1], label: m[2].trim(), yr });
    }
  }
  console.log(`[court:AU:cases] ${caseEntries.length} case entries found, fetching first 20...`);

  // Fetch case pages (most recent first — AustLII lists in chronological order, so reverse)
  const toFetch = caseEntries.slice(-20).reverse();
  const pages   = await Promise.allSettled(
    toFetch.map(entry =>
      axios.get(`https://www.austlii.edu.au${entry.path}`,
        { headers: BROWSER_HEADERS, timeout: 25000 })
        .then(r => ({ ...entry, html: r.data }))
        .catch(() => ({ ...entry, html: null }))
    )
  );

  const records = pages.map(p => {
    const { path, label, html } = p.value || {};
    if (!html) return null;

    // Content div
    const content = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || html;
    const text    = stripTags(content);

    // Title + citation from label: "Harvey v Minister [...] [2024] HCA 1 (7 February 2024)"
    const labelMatch = label.match(/^(.+?)\s+\[(\d{4})\]\s+HCA\s+(\d+)\s+\(([^)]+)\)$/);
    const title     = labelMatch?.[1]?.replace(/&amp;/g,'&').trim() || label;
    const citation  = labelMatch ? `[${labelMatch[2]}] HCA ${labelMatch[3]}` : null;
    const dateStr   = labelMatch?.[4] ? parseDate(labelMatch[4]) : null;
    const caseNum   = citation?.replace(/[\[\]\s]/g, '_') || path.replace(/[^a-zA-Z0-9]+/g,'_');

    // Decision from ORDER section
    const order = text.match(/ORDER\s+(.{20,400}?)(?=REASONS|JUDGMENT|HIGH COURT|$)/s)?.[1]?.trim().slice(0, 300)
                || text.match(/(?:Appeal|Application) (?:allowed|dismissed)[^.]*\./i)?.[0]
                || null;

    // Justices (CORAM) from text
    const coram = text.match(/(?:GAGELER|GORDON|EDELMAN|STEWARD|GLEESON|JAGOT|BEECH-JONES)[^J]*(?:JJ|CJ)/i)?.[0]?.trim() || null;

    // Summary from first substantive paragraph after the header
    const summary = text.slice(0, 600)
      .replace(/^.*?(?=[\dA-Z][a-z].*v\s)/,'').trim().slice(0, 400) || null;

    return {
      id:            `AU-HCA-${caseNum}`,
      jurisdiction:  'AU',
      court:         'High Court of Australia',
      title,
      citation,
      date:          dateStr,
      status:        'Decided',
      decision:      order,
      justices:      coram,
      summary:       order || summary,
      source_url:    `https://www.austlii.edu.au${path}`,
    };
  }).filter(Boolean);

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
