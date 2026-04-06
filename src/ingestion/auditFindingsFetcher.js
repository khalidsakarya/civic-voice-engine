/**
 * Audit Findings Fetcher — Civic Voice Engine
 *
 * Fetches real audit findings and reports from official national audit offices,
 * normalising them to a common schema: title, department_audited, date,
 * severity, key_finding_summary, amount_involved, status, report_url.
 *
 * Sources
 * ─────────────────────────────────────────────────────────────────────────────
 * CA  open.canada.ca CKAN  (org: oag-bvg)
 *     The Office of the Auditor General of Canada publishes all tabled reports
 *     to the federal open-data portal. We query the CKAN package_search API
 *     filtered to the oag-bvg organisation, sorted newest-first.
 *     Endpoint: GET https://open.canada.ca/data/api/3/action/package_search
 *       ?fq=organization:oag-bvg&sort=metadata_modified+desc&rows=N
 *
 * US  www.gao.gov/rss/reports.xml  (RSS feed)
 *     The Government Accountability Office provides a public RSS feed of all
 *     newly published reports. Each <item> contains the full report description
 *     (which includes "What GAO Found" and "Why GAO Did This Study" sections),
 *     a link to the report page, and the publication date.
 *
 * UK  www.nao.org.uk  (WordPress REST API)
 *     The National Audit Office website is built on WordPress and exposes the
 *     standard WP REST API. The `report` custom post type returns all NAO
 *     reports as JSON. Embedding `wp:term` provides the department taxonomy so
 *     we can resolve the department name without a second request.
 *     Endpoint: GET https://www.nao.org.uk/wp-json/wp/v2/report
 *       ?per_page=N&orderby=date&order=desc&_embed=wp:term
 *
 * AU  www.anao.gov.au  (HTML scrape of performance audit listing)
 *     The Australian National Audit Office publishes performance audits at a
 *     paginated listing page. We scrape the HTML for report titles, entity
 *     audited, tabling date, and report links.
 *     If the ANAO site is unreachable (a known dev-environment DNS issue),
 *     the fetcher logs a warning and saves zero AU records — the scheduler
 *     continues uninterrupted.
 */

'use strict';
require('dotenv').config();

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../../output/audit_findings');
const TIMEOUT_MS = 30_000;

// Row limits — override via env vars
const CA_ROWS  = parseInt(process.env.AUDIT_CA_ROWS  || '50',  10);
const US_ITEMS = parseInt(process.env.AUDIT_US_ITEMS || '50',  10);
const UK_ITEMS = parseInt(process.env.AUDIT_UK_ITEMS || '50',  10);
const AU_ITEMS = parseInt(process.env.AUDIT_AU_ITEMS || '30',  10);

// ─── Output helper ─────────────────────────────────────────────────────────────

function saveRecords(sourceName, records, meta = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${sourceName}_${timestamp}.json`;
  const filepath  = path.join(OUTPUT_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify({
    generatedAt:  new Date().toISOString(),
    source:       sourceName,
    totalRecords: records.length,
    ...meta,
    records,
  }, null, 2));

  console.log(`[audit-findings:${sourceName}] Saved ${records.length} records → ${filename}`);
  return { filepath, count: records.length };
}

// ─── Normalisation helpers ─────────────────────────────────────────────────────

const safeStr = v => (v != null ? String(v).trim().replace(/\s+/g, ' ').slice(0, 1000) || null : null);
const slug    = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const stripHtml = s => (s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0*39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

// ─── Severity inference ────────────────────────────────────────────────────────
//
//  Keyword-match against title + description text.
//  HIGH:   material weakness, fraud, systemic failure, critical risk, serious concern
//  MEDIUM: significant, non-compliance, failed to, inadequate, insufficient
//  LOW:    could improve, recommend, opportunity, minor, administrative
//  null:   not enough signal

const HIGH_RE   = /significant\s+deficien|material\s+(?:weakness|error)|fraud|misappropriat|systemic\s+fail|critical\s+(?:weakness|risk|fail)|serious\s+concern|major\s+breakdown|gross\s+(?:mismanagement|waste)/i;
const MEDIUM_RE = /significant\s+(?:concern|risk|gap|issue)|non-?compliance|failed?\s+to\s+(?:meet|achieve|comply|implement|report)|inadequate|insufficient|did\s+not\s+(?:meet|achieve|comply|report|establish)|weaknesses?\s+(?:in|were|exist)/i;
const LOW_RE    = /could\s+(?:be\s+(?:improved|strengthened|enhanced)|improve|strengthen)|recommend(?:ation)?s?\s+to\s+improve|minor\s+issue|administrative|opportunity\s+to\s+(?:improve|strengthen)|generally\s+(?:met|achieved|complied)/i;

function inferSeverity(title, description) {
  const t = ((title || '') + ' ' + (description || '')).slice(0, 3000);
  if (HIGH_RE.test(t))   return 'high';
  if (MEDIUM_RE.test(t)) return 'medium';
  if (LOW_RE.test(t))    return 'low';
  return null;
}

// ─── Status inference ──────────────────────────────────────────────────────────

const RESOLVED_RE = /(?:fully\s+)?(?:implemented|resolved|addressed|completed|closed|satisfied)/i;

function inferStatus(description) {
  if (RESOLVED_RE.test(description || '')) return 'resolved';
  return 'open';
}

// ─── Amount extraction ─────────────────────────────────────────────────────────
//
//  Returns the first detected currency amount as a plain number in base units
//  (e.g. "$1.9 trillion" → 1900000000000, "£500 million" → 500000000).
//  Returns null if no amount is found.

const AMOUNT_PATTERNS = [
  { re: /[\$£AU\$C\$]?\s*([\d,]+(?:\.\d+)?)\s*trillion/i,  mult: 1e12 },
  { re: /[\$£AU\$C\$]?\s*([\d,]+(?:\.\d+)?)\s*billion/i,   mult: 1e9  },
  { re: /[\$£AU\$C\$]?\s*([\d,]+(?:\.\d+)?)\s*million/i,   mult: 1e6  },
  { re: /[\$£AU\$C\$]?\s*([\d,]+(?:\.\d+)?)\s*thousand/i,  mult: 1e3  },
];

function extractAmount(text) {
  for (const { re, mult } of AMOUNT_PATTERNS) {
    const m = (text || '').match(re);
    if (m) {
      const num = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(num)) return Math.round(num * mult);
    }
  }
  return null;
}

// ─── Department extraction from title ─────────────────────────────────────────
//
//  Tries several common audit title patterns:
//    "Audit of National Defence"              → "National Defence"
//    "National Defence: Audit of Readiness"   → "National Defence"
//    "2026–OAG–Child and Family Resources"    → "Child and Family Resources"
//    "VIA Rail Canada: Special Examination"   → "VIA Rail Canada"
//    "Treasury Is Meeting Borrowing Needs…"   → falls back to null

function extractDepartmentFromTitle(title) {
  if (!title) return null;

  // "Audit of X" / "Review of X" → X
  const auditOf = title.match(/(?:audit|examination|review|investigation)\s+of\s+(.+?)(?:\s*[:\–—\-]|$)/i);
  if (auditOf) return auditOf[1].replace(/\s+\d{4}$/, '').trim();

  // "X: Audit/Report/…" → X (before first colon/dash longer than 10 chars)
  const beforeColon = title.match(/^(.{10,80}?)\s*[:–—]/);
  if (beforeColon) {
    const candidate = beforeColon[1].trim();
    // Skip "YYYY–Report of the Auditor General of Canada–…" CA pattern
    if (!/auditor\s+general|report\s+of/i.test(candidate)) return candidate;
  }

  // CA pattern: "YYYY–Report of the Auditor General of Canada–TOPIC"
  const caPattern = title.match(/auditor\s+general\s+of\s+canada[–—-]+(.+)/i);
  if (caPattern) return caPattern[1].replace(/\s*–.*$/, '').trim();

  // "Department/Agency of X" at start
  const deptStart = title.match(/^((?:Department|Ministry|Agency|Office|Bureau|Board|Commission|Authority)\s+of\s+\S+(?:\s+\S+){0,4})/i);
  if (deptStart) return deptStart[1].trim();

  return null;
}

// ─── RSS parser (lightweight, no extra dependencies) ──────────────────────────
//
//  Parses RSS 2.0 XML. Handles CDATA sections.

function parseRss(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const getTag = tag => {
      const re = new RegExp(`<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      const tm = re.exec(block);
      return tm ? tm[1].trim() : null;
    };
    // <link> in RSS may be bare text between tags or inside an anchor
    const rawLink = getTag('link') || '';
    items.push({
      title:       getTag('title'),
      link:        rawLink.startsWith('http') ? rawLink : null,
      description: getTag('description'),
      pubDate:     getTag('pubDate'),
      guid:        getTag('guid'),
      category:    getTag('category'),
    });
  }
  return items;
}

// ─── CA: Office of the Auditor General (CKAN open.canada.ca) ─────────────────
//
//  The OAG publishes all tabled reports as packages on open.canada.ca under
//  the organisation slug "oag-bvg". Package metadata fields used:
//    title          — report title (may include year prefix and em-dashes)
//    notes          — description / abstract of the audit
//    metadata_modified — date the package was updated (proxy for report date)
//    resources[].url  — link to the report page or PDF on canada.ca

const CKAN_CA_BASE = 'https://open.canada.ca/data/api/3/action';
const CA_OAG_ORG   = 'oag-bvg';

async function fetchCanadaAuditFindings() {
  console.log(`[audit-findings:CA] Querying open.canada.ca CKAN (org: ${CA_OAG_ORG}, rows: ${CA_ROWS})…`);

  const resp = await axios.get(`${CKAN_CA_BASE}/package_search`, {
    params: {
      fq:   `organization:${CA_OAG_ORG}`,
      sort: 'metadata_modified desc',
      rows: CA_ROWS,
    },
    headers: { Accept: 'application/json' },
    timeout: TIMEOUT_MS,
  });

  const packages = resp.data?.result?.results || [];
  const total    = resp.data?.result?.count;
  console.log(`[audit-findings:CA] ${packages.length} packages (total available: ${total})`);

  const records = packages.map(pkg => {
    const title   = safeStr(pkg.title);
    const notes   = safeStr(pkg.notes);
    const date    = safeStr((pkg.metadata_modified || '').slice(0, 10)) || null;

    // Best URL: first resource with a canada.ca or oag-bvg.gc.ca link
    const resources = pkg.resources || [];
    const reportRes = resources.find(r => /canada\.ca|oag-bvg\.gc\.ca/.test(r.url || '')) || resources[0];
    const reportUrl = safeStr(reportRes?.url) || `https://open.canada.ca/data/en/dataset/${pkg.id}`;

    const department = extractDepartmentFromTitle(title);
    const summary    = notes ? notes.slice(0, 600) : null;
    const amount     = extractAmount(notes);
    const severity   = inferSeverity(title, notes);
    const status     = inferStatus(notes);

    return {
      id:                  `ca-oag-${pkg.id}`,
      source_id:           safeStr(pkg.id),
      title,
      department_audited:  department,
      date,
      severity,
      key_finding_summary: summary,
      amount_involved:     amount,
      amount_currency:     amount !== null ? 'CAD' : null,
      status,
      report_url:          reportUrl,
      jurisdiction:        'CA',
      audit_office:        'Office of the Auditor General of Canada',
      source_url:          `${CKAN_CA_BASE}/package_search?fq=organization:${CA_OAG_ORG}`,
    };
  });

  return saveRecords('ca_oag_reports', records, {
    ckanOrg:        CA_OAG_ORG,
    totalAvailable: total,
    rowsFetched:    packages.length,
    sourceApi:      `${CKAN_CA_BASE}/package_search`,
  });
}

// ─── US: Government Accountability Office (RSS feed) ─────────────────────────
//
//  www.gao.gov/rss/reports.xml is the official public RSS feed for GAO reports.
//  Each <item> contains the full report abstract which typically includes:
//    "What GAO Found" section — key findings
//    "Why GAO Did This Study" section — scope and agency context
//  The <title> usually names the agency or issue area.
//  <guid> holds the relative product URL (e.g. /products/gao-26-107529).

const GAO_RSS_URL = 'https://www.gao.gov/rss/reports.xml';
const GAO_BASE    = 'https://www.gao.gov';

async function fetchUSAuditFindings() {
  console.log(`[audit-findings:US] Fetching GAO RSS feed (up to ${US_ITEMS} items)…`);

  const resp = await axios.get(GAO_RSS_URL, {
    headers: { Accept: 'application/rss+xml, text/xml, */*' },
    timeout: TIMEOUT_MS,
  });

  const items = parseRss(resp.data || '').slice(0, US_ITEMS);
  console.log(`[audit-findings:US] Parsed ${items.length} items from RSS feed`);

  const records = items.map((item, i) => {
    const title = safeStr(item.title);
    const desc  = stripHtml(item.description);

    // Extract the "What GAO Found" paragraph — it follows that header in the description
    let summary = null;
    const foundIdx = desc.indexOf('What GAO Found');
    if (foundIdx !== -1) {
      // Take text after the header up to the next section or 500 chars
      const afterHeader = desc.slice(foundIdx + 'What GAO Found'.length).trim();
      const nextSection = afterHeader.search(/Why GAO Did This Study|GAO Recommends|Background|What GAO Found/i);
      summary = (nextSection > 0 ? afterHeader.slice(0, nextSection) : afterHeader).slice(0, 600).trim();
    } else {
      summary = desc.slice(0, 600) || null;
    }

    // Report URL: prefer <link>, fall back to constructing from <guid>
    const guid = safeStr(item.guid);
    const link = item.link || (guid && !guid.startsWith('http') ? `${GAO_BASE}${guid}` : guid);

    // Report number from guid or link: gao-26-107529
    const reportNumMatch = (guid || link || '').match(/gao-[\d]+-[\d]+/i);
    const reportNum = reportNumMatch ? reportNumMatch[0].toUpperCase() : null;

    // Parse date
    const pubDate = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : null;

    const department = extractDepartmentFromTitle(title);
    const amount     = extractAmount(desc);
    const severity   = inferSeverity(title, desc);
    const status     = inferStatus(desc);

    const idBase = reportNum ? slug(reportNum) : `us-gao-item-${i}`;

    return {
      id:                  `us-gao-${idBase}`,
      source_id:           reportNum,
      title,
      department_audited:  department,
      date:                pubDate,
      severity,
      key_finding_summary: summary,
      amount_involved:     amount,
      amount_currency:     amount !== null ? 'USD' : null,
      status,
      report_url:          safeStr(link),
      jurisdiction:        'US',
      audit_office:        'Government Accountability Office',
      source_url:          GAO_RSS_URL,
    };
  });

  return saveRecords('us_gao_reports', records, {
    feedUrl:     GAO_RSS_URL,
    itemsFetched: records.length,
  });
}

// ─── UK: National Audit Office (WordPress REST API) ───────────────────────────
//
//  The NAO website exposes the WP REST API. The custom post type `report`
//  covers all published NAO reports. Embedding `wp:term` resolves the
//  `department` taxonomy to human-readable department names without extra
//  requests. The `excerpt.rendered` field is a clean one-paragraph summary.
//
//  WP REST supports pagination via `page` and `per_page` params.

const NAO_API_BASE = 'https://www.nao.org.uk/wp-json/wp/v2';
const NAO_PAGE_SIZE = Math.min(UK_ITEMS, 100); // WP max is 100

async function fetchUKAuditFindings() {
  console.log(`[audit-findings:UK] Querying NAO WordPress REST API (up to ${UK_ITEMS} reports)…`);

  let allPosts = [];
  let page = 1;

  while (allPosts.length < UK_ITEMS) {
    const take = Math.min(NAO_PAGE_SIZE, UK_ITEMS - allPosts.length);
    const resp = await axios.get(`${NAO_API_BASE}/report`, {
      params: {
        per_page:  take,
        orderby:   'date',
        order:     'desc',
        page,
        _embed:    'wp:term',
      },
      headers: { Accept: 'application/json' },
      timeout: TIMEOUT_MS,
    });

    const posts = resp.data || [];
    if (!posts.length) break;
    allPosts.push(...posts);

    // WP REST sets X-WP-TotalPages header; if we've reached it, stop
    const totalPages = parseInt(resp.headers?.['x-wp-totalpages'] || '1', 10);
    if (page >= totalPages || allPosts.length >= UK_ITEMS) break;
    page++;
  }

  console.log(`[audit-findings:UK] Fetched ${allPosts.length} reports`);

  const records = allPosts.map(post => {
    const title   = stripHtml(post.title?.rendered);
    const excerpt = stripHtml(post.excerpt?.rendered);
    const date    = (post.date || '').slice(0, 10) || null;
    const link    = safeStr(post.link);

    // Department from embedded wp:term taxonomy groups
    const embedded   = post._embedded?.['wp:term'] || [];
    const depts      = embedded
      .flat()
      .filter(t => t.taxonomy === 'department')
      .map(t => stripHtml(t.name))
      .filter(Boolean);
    const department = depts.length > 0 ? depts.join('; ') : extractDepartmentFromTitle(title);

    // Report type (value-for-money, investigation, etc.)
    const types = embedded
      .flat()
      .filter(t => t.taxonomy === 'report_type')
      .map(t => stripHtml(t.name));

    const amount   = extractAmount(excerpt);
    const severity = inferSeverity(title, excerpt);
    const status   = inferStatus(excerpt);

    return {
      id:                  `uk-nao-${post.id}`,
      source_id:           String(post.id),
      title:               safeStr(title),
      department_audited:  safeStr(department) || null,
      report_type:         types.length > 0 ? types.join('; ') : null,
      date,
      severity,
      key_finding_summary: excerpt ? excerpt.slice(0, 600) : null,
      amount_involved:     amount,
      amount_currency:     amount !== null ? 'GBP' : null,
      status,
      report_url:          link,
      jurisdiction:        'UK',
      audit_office:        'National Audit Office',
      source_url:          `${NAO_API_BASE}/report`,
    };
  });

  return saveRecords('uk_nao_reports', records, {
    reportsFetched: records.length,
    sourceApi:      `${NAO_API_BASE}/report`,
  });
}

// ─── AU: Australian National Audit Office (HTML scrape) ───────────────────────
//
//  The ANAO publishes all performance audits at a listing page on anao.gov.au.
//  The page is Drupal-based and lists each audit with: title (linked), entity
//  audited, tabling date, and audit number.
//
//  If the ANAO site is unreachable from the current environment (a known DNS
//  issue on Windows dev environments — same as efts.senate.gov), the fetcher
//  catches the error and returns zero records so the scheduler continues.

const ANAO_URL  = 'https://www.anao.gov.au/work/performance-audit';
const ANAO_BASE = 'https://www.anao.gov.au';

const ANAO_DATA_NOTE =
  'The ANAO website (anao.gov.au) is the authoritative source for Australian ' +
  'National Audit Office performance audits. This record was generated from the ' +
  'ANAO performance audit listing page. Full report details are at the linked URL.';

async function fetchAUAuditFindings() {
  console.log(`[audit-findings:AU] Fetching ANAO performance audit listing from ${ANAO_URL}…`);

  const resp = await axios.get(ANAO_URL, {
    headers: {
      'User-Agent': 'CivicVoiceBot/1.0 (civic data aggregator; +https://civicvoice.app)',
      Accept:       'text/html,application/xhtml+xml',
    },
    timeout: TIMEOUT_MS,
  });

  const html = resp.data || '';
  if (typeof html !== 'string' || html.length < 1000) {
    throw new Error(`[audit-findings:AU] Response too short (${html.length} bytes) — page unavailable`);
  }
  console.log(`[audit-findings:AU] Received ${html.length} bytes — parsing audit listing…`);

  // The ANAO listing page uses article or view-row containers for each audit.
  // We look for two key patterns:
  //   1. <h3> or <h2> tags with linked titles inside each row
  //   2. "Entity" and "Tabling date" metadata adjacent to each title

  const records = [];

  // Pattern 1: Drupal views-row containers
  // <div class="views-row">...<a href="/work/performance-audit/...">Title</a>...entity...date...
  const rowRe = /<div[^>]+class="[^"]*views-row[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*views-row|$)/g;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null && records.length < AU_ITEMS) {
    const block = rowMatch[1];

    // Extract linked title
    const linkMatch = block.match(/href="(\/work\/performance-audit\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;
    const relPath = linkMatch[1];
    const rawTitle = stripHtml(linkMatch[2]);
    if (!rawTitle || rawTitle.length < 5) continue;

    // Entity audited — look for common label patterns
    const entityMatch = block.match(/(?:entity|auditee|audited)[\s\S]{0,100}?(?:<\/[^>]+>|:\s*)([\w\s&;,]+?)(?:<|,\s*(?:\d{4}|audit))/i);
    const entity = entityMatch ? stripHtml(entityMatch[1]).trim() : null;

    // Date — look for "tabling date", "published", or bare date patterns
    const dateMatch = block.match(/(?:tabling\s+date|published|date)[^<]*?(\d{1,2}\s+\w+\s+\d{4}|\d{4}-\d{2}-\d{2})/i)
                   || block.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
    let date = null;
    if (dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!isNaN(parsed)) date = parsed.toISOString().slice(0, 10);
    }

    // Audit number — e.g. "Audit 2024-25/01"
    const auditNumMatch = block.match(/(?:audit|report)\s+(?:no\.?\s*)?(\d{4}[-\/]\d{2,4}\/\d+)/i)
                       || block.match(/(\d{4}[-\/]\d{2,4}\/\d+)/);
    const auditNum = auditNumMatch ? auditNumMatch[1] : null;

    const auditText = rawTitle + ' ' + (entity || '');
    const severity  = inferSeverity(rawTitle, null);

    records.push({
      id:                  `au-anao-${slug(rawTitle)}`,
      source_id:           auditNum,
      title:               safeStr(rawTitle),
      department_audited:  safeStr(entity) || extractDepartmentFromTitle(rawTitle),
      audit_number:        auditNum,
      date,
      severity,
      key_finding_summary: null,         // summary only available inside the report page (PDF)
      amount_involved:     null,
      amount_currency:     null,
      status:              'open',       // ANAO lists current-parliament audits; treat as open
      report_url:          relPath.startsWith('http') ? relPath : `${ANAO_BASE}${relPath}`,
      jurisdiction:        'AU',
      audit_office:        'Australian National Audit Office',
      source_url:          ANAO_URL,
      data_note:           ANAO_DATA_NOTE,
    });
  }

  // Fallback: if Drupal views-row pattern didn't match, try generic <article> elements
  if (records.length === 0) {
    const articleRe = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let artMatch;
    while ((artMatch = articleRe.exec(html)) !== null && records.length < AU_ITEMS) {
      const block = artMatch[1];
      const aMatch = block.match(/href="(\/work\/performance-audit\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!aMatch) continue;
      const rawTitle = stripHtml(aMatch[2]);
      if (!rawTitle || rawTitle.length < 5) continue;

      const dateMatch = block.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
      let date = null;
      if (dateMatch) {
        const parsed = new Date(dateMatch[1]);
        if (!isNaN(parsed)) date = parsed.toISOString().slice(0, 10);
      }

      records.push({
        id:                  `au-anao-${slug(rawTitle)}`,
        source_id:           null,
        title:               safeStr(rawTitle),
        department_audited:  extractDepartmentFromTitle(rawTitle),
        date,
        severity:            inferSeverity(rawTitle, null),
        key_finding_summary: null,
        amount_involved:     null,
        amount_currency:     null,
        status:              'open',
        report_url:          `${ANAO_BASE}${aMatch[1]}`,
        jurisdiction:        'AU',
        audit_office:        'Australian National Audit Office',
        source_url:          ANAO_URL,
        data_note:           ANAO_DATA_NOTE,
      });
    }
  }

  if (records.length === 0) {
    throw new Error(
      '[audit-findings:AU] No audit rows parsed — page structure may have changed. ' +
      'Inspect ' + ANAO_URL
    );
  }

  console.log(`[audit-findings:AU] Parsed ${records.length} audit entries`);

  return saveRecords('au_anao_reports', records, {
    sourceUrl:    ANAO_URL,
    parseMethod:  'html-scrape',
    itemsFetched: records.length,
  });
}

// ─── Main export ───────────────────────────────────────────────────────────────

const SOURCES = [
  { name: 'CA — OAG (open.canada.ca CKAN)',  fn: fetchCanadaAuditFindings, jurisdiction: 'CA' },
  { name: 'US — GAO (RSS feed)',             fn: fetchUSAuditFindings,     jurisdiction: 'US' },
  { name: 'UK — NAO (WordPress REST API)',   fn: fetchUKAuditFindings,     jurisdiction: 'UK' },
  { name: 'AU — ANAO (HTML scrape)',         fn: fetchAUAuditFindings,     jurisdiction: 'AU' },
];

async function fetchAllAuditFindings() {
  const startedAt = new Date();
  console.log('\n' + '='.repeat(60));
  console.log('[auditFindingsFetcher] Starting audit findings ingestion');
  console.log('='.repeat(60));

  const summary = [];

  for (const source of SOURCES) {
    console.log(`\n[auditFindingsFetcher] ▸ ${source.name}`);
    try {
      const result = await source.fn();
      console.log(`[auditFindingsFetcher]   ✓ ${result.count} records → ${path.basename(result.filepath)}`);
      summary.push({ source: source.name, jurisdiction: source.jurisdiction, status: 'ok', records: result.count });
    } catch (err) {
      // Network/DNS failures in dev environment should not abort the full run
      console.warn(`[auditFindingsFetcher]   ⚠ Skipped: ${err.message}`);
      summary.push({ source: source.name, jurisdiction: source.jurisdiction, status: 'error', error: err.message, records: 0 });
    }
  }

  const durationMs = Date.now() - startedAt;
  const total      = summary.reduce((s, r) => s + r.records, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`[auditFindingsFetcher] Done in ${(durationMs / 1000).toFixed(1)}s — ${total} total records`);
  summary.forEach(r =>
    console.log(`  ${r.status === 'ok' ? '✓' : '⚠'} ${r.source}: ${r.records} records${r.error ? ` (${r.error})` : ''}`)
  );
  console.log('='.repeat(60));

  return summary;
}

module.exports = {
  fetchAllAuditFindings,
  fetchCanadaAuditFindings,
  fetchUSAuditFindings,
  fetchUKAuditFindings,
  fetchAUAuditFindings,
};

// ─── CLI entry-point ───────────────────────────────────────────────────────────

if (require.main === module) {
  fetchAllAuditFindings()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
