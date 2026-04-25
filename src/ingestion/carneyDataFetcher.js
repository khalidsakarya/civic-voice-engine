'use strict';

/**
 * Targeted fetch for Mark Carney data from official Canadian government sources.
 *
 * Collections written:
 *   member_expenses              – PWGSC Ministers' Office Expenses (open.canada.ca)
 *   member_lobbying              – lobbycanada.gc.ca monthly communication reports (DPOH meetings as PM)
 *   member_corporate_affiliations – ourcommons.ca current roles + lobbycanada historical DPOH roles
 *   member_disclosures           – CIEC conflict-of-interest registry (reference doc; portal currently down)
 */

require('dotenv').config();
const axios = require('axios');
const zlib  = require('zlib');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const CARNEY_SLUG       = 'mark-carney';
const CARNEY_NAME       = 'Mark Carney';
const JURISDICTION      = 'CA';
const PM_START_DATE     = '2025-03-14';   // date Carney was sworn in as PM
const OURCOMMONS_ID     = '28286';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,text/csv,*/*',
};

// PWGSC ministers' office expenses package on open.canada.ca
const MINISTER_EXPENSE_PKG = '508edfe7-0cba-4d76-afe8-d19e42e9df8a';
const MINISTER_EXPENSE_URL = 'https://open.canada.ca/data/dataset/508edfe7-0cba-4d76-afe8-d19e42e9df8a';

// Standard Object descriptions (Treasury Board accounting codes)
const STD_OBJ = {
  'Std-obj1_Art-crnt1':   'Personnel',
  'Std-obj2_Art-crnt2':   'Transportation and Communications',
  'Std-obj3_Art-crnt3':   'Information',
  'Std-obj4_Art-crnt4':   'Professional and Special Services',
  'Std-obj5_Art-crnt5':   'Rentals',
  'Std-obj6_Art-crnt6':   'Repair and Maintenance',
  'Std-obj7_Art-crnt7':   'Utilities, Materials and Supplies',
  'Std-obj8_Art-crnt8':   'Acquisition of Land, Buildings and Works',
  'Std-obj9_Art-crnt9':   'Acquisition of Machinery and Equipment',
  'Std-obj12_Art-crnt12': 'Other Subsidies and Payments',
};

// Lobby Canada
const LOBBY_COMMS_ZIP    = 'https://lobbycanada.gc.ca/media/mqbbmaqk/communications_ocl_cal.zip';
const LOBBY_COMMS_SOURCE = 'https://lobbycanada.gc.ca/en/open-data/';

// CIEC (Conflict of Interest and Ethics Commissioner) — DNS unreachable as of 2026-04
const CIEC_SOURCE = 'https://ciec-ccie.oic.gc.ca/en/public-registry';

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const fields = []; let field = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"')      inQ = true;
      else if (ch === ',') { fields.push(field); field = ''; }
      else                 field += ch;
    }
  }
  fields.push(field);
  return fields.map(f => f.trim());
}

function parseCsvToObjects(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(l => {
    const vals = parseCsvLine(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

// ─── ZIP parser (handles data-descriptor ZIPs from lobbycanada.gc.ca) ────────

function parseZip(buf) {
  const files = {}; let i = 0;
  while (i < buf.length - 4) {
    if (buf[i] !== 0x50 || buf[i+1] !== 0x4b || buf[i+2] !== 0x03 || buf[i+3] !== 0x04) { i++; continue; }
    const flags = buf.readUInt16LE(i + 6);
    const comp  = buf.readUInt16LE(i + 8);
    let   cs    = buf.readUInt32LE(i + 18);
    const nl    = buf.readUInt16LE(i + 26);
    const el    = buf.readUInt16LE(i + 28);
    const name  = buf.slice(i + 30, i + 30 + nl).toString('utf8');
    const ds    = i + 30 + nl + el;

    // When compSize is 0 (data-descriptor pattern), find the next local/central header
    if (cs === 0 && (flags & 0x08)) {
      let j = ds;
      while (j < buf.length - 4) {
        if ((buf[j] === 0x50 && buf[j+1] === 0x4b && buf[j+2] === 0x07 && buf[j+3] === 0x08) ||
            (buf[j] === 0x50 && buf[j+1] === 0x4b && buf[j+2] === 0x03 && buf[j+3] === 0x04) ||
            (buf[j] === 0x50 && buf[j+1] === 0x4b && buf[j+2] === 0x01 && buf[j+3] === 0x02)) break;
        j++;
      }
      if (buf[j] === 0x50 && buf[j+1] === 0x4b && buf[j+2] === 0x07 && buf[j+3] === 0x08)
        cs = buf.readUInt32LE(j + 8);
      else
        cs = j - ds;
    }

    const compData = buf.slice(ds, ds + cs);
    let data = compData;
    if (comp === 8) { try { data = zlib.inflateRawSync(compData); } catch { data = compData; } }
    files[name] = data;
    i = ds + cs;
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x07 && buf[i+3] === 0x08) i += 16;
    if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x01 && buf[i+3] === 0x02) break;
  }
  return files;
}

// ─── Firestore helpers ────────────────────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

async function batchSet(db, collection, docs) {
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of chunk) {
      batch.set(db.collection(collection).doc(sanitizeId(id)), data, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

// ─── 1. member_expenses — PWGSC Ministers' Office Expenses ───────────────────

async function fetchExpenses(db) {
  const ts = new Date().toISOString();
  console.log('[carney:expenses] Fetching Ministers Office Expenses CSV...');

  const pkgRes = await axios.get(
    `https://open.canada.ca/data/api/3/action/package_show?id=${MINISTER_EXPENSE_PKG}`,
    { timeout: 30000, headers: BROWSER_HEADERS }
  );
  const resources = pkgRes.data?.result?.resources || [];
  const csvResources = resources.filter(r => r.format === 'CSV');

  const allDocs = [];

  for (const res of csvResources) {
    const yearMatch = res.name?.match(/(\d{4})\s*[-–]\s*(\d{2,4})/);
    const fiscalYear = yearMatch ? `${yearMatch[1]}/${yearMatch[2]}` : res.name || 'unknown';

    try {
      const resp = await axios.get(res.url + '?lang=en', {
        timeout: 60000, responseType: 'arraybuffer', maxRedirects: 10,
        headers: BROWSER_HEADERS,
      });
      const rows = parseCsvToObjects(Buffer.from(resp.data).toString('utf8'));
      const carneyRows = rows.filter(r =>
        /carney/i.test(r['Minister-name_Nom-ministre_eng'] || '')
      );

      for (const row of carneyRows) {
        const startDate = row['Start-date_Date_debut'] || '';
        const endDate   = row['End-date_Date-fin']    || '';

        // Expense breakdown by Standard Object
        const expenses = {};
        let total = 0;
        for (const [col, label] of Object.entries(STD_OBJ)) {
          const v = parseInt(row[col] || '0', 10) || 0;
          if (v !== 0) expenses[label] = v;
          total += v;
        }

        allDocs.push({
          id:   `ca-carney-expense-${fiscalYear.replace(/\//g,'-')}-${startDate}`,
          data: {
            member_name:      CARNEY_NAME,
            politician_slug:  CARNEY_SLUG,
            jurisdiction:     JURISDICTION,
            title:            row['Minister-title_Titre-ministre_eng'] || 'Prime Minister',
            organization:     row['Dept-name_Nom-min_eng'] || 'Privy Council Office',
            portfolio:        row['Min-portfolio_Portefeuille-min_eng'] || '',
            fiscal_year:      row['Fscl-yr_Ex-fin'] || fiscalYear,
            period_start:     startDate,
            period_end:       endDate,
            expenses_breakdown: expenses,
            total_cad:        total,
            currency:         'CAD',
            source_url:       MINISTER_EXPENSE_URL,
            source_name:      'PWGSC Ministers\' Office Expenses — open.canada.ca',
            last_updated:     ts,
          },
        });
      }
      console.log(`[carney:expenses]   ${fiscalYear}: ${carneyRows.length} rows found`);
    } catch (e) {
      console.warn(`[carney:expenses]   ${fiscalYear} CSV failed: ${e.message}`);
    }
  }

  if (allDocs.length === 0) {
    console.log('[carney:expenses] No expense rows found');
    return 0;
  }
  const written = await batchSet(db, 'member_expenses', allDocs);
  console.log(`[carney:expenses] ✓ ${written} documents written`);
  return written;
}

// ─── 2. member_lobbying — lobbycanada.gc.ca PM-era meetings ──────────────────

async function fetchLobbying(db, zipFiles) {
  const ts = new Date().toISOString();
  const files = zipFiles;

  // Parse DPOH export — find all COMLOG_IDs where Carney is listed as PM-role DPOH
  const dpohText    = files['Communication_DpohExport.csv'].toString('utf8');
  const primaryText = files['Communication_PrimaryExport.csv'].toString('utf8');
  const subjText    = files['Communication_SubjectMatterDetailsExport.csv'].toString('utf8');

  console.log('[carney:lobbying] Parsing DPOH, Primary and SubjectMatter CSVs...');

  // Build Map<comlogId, dpohInfo> for Carney PM-era entries
  const carneyPmIds = new Map();
  const PM_TITLES = /prime minister|premier ministre/i;
  for (const line of dpohText.split('\n').slice(1)) {
    if (!/\"Carney\",\"Mark\"/i.test(line)) continue;
    const p = parseCsvLine(line);
    if (!PM_TITLES.test(p[3] || '')) continue; // only PM-title rows
    carneyPmIds.set(p[0], {
      dpoh_title:       p[3] || '',
      dpoh_branch:      p[4] || '',
      dpoh_institution: p[6] || '',
    });
  }
  console.log(`[carney:lobbying] ${carneyPmIds.size} PM-era DPOH entries found`);

  // Build Map<comlogId, primaryInfo> — only for IDs we care about
  const primaryMap = new Map();
  for (const line of primaryText.split('\n').slice(1)) {
    const p = parseCsvLine(line);
    if (!carneyPmIds.has(p[0])) continue;
    primaryMap.set(p[0], {
      client_org:       p[2] || p[1] || '',  // EN_CLIENT_ORG_CORP_NM_AN
      registrant_last:  p[5] || '',
      registrant_first: p[6] || '',
      comm_date:        p[7] || '',
      reg_type:         p[8] || '',          // 2=consultant, 3=in-house
    });
  }

  // Build Map<comlogId, description[]> from SubjectMatterDetails
  const subjMap = new Map();
  for (const line of subjText.split('\n').slice(1)) {
    const p = parseCsvLine(line);
    if (!carneyPmIds.has(p[0])) continue;
    if (!subjMap.has(p[0])) subjMap.set(p[0], []);
    const desc = p[1] || '';
    if (desc) subjMap.get(p[0]).push(desc.replace(/�/g, '\''));  // fix encoding
  }

  // Compose one doc per meeting, filter to PM era (comm_date >= PM_START_DATE)
  const docs = [];
  for (const [comlogId, dpoh] of carneyPmIds) {
    const primary = primaryMap.get(comlogId) || {};
    const subjects = (subjMap.get(comlogId) || []).join('; ');
    const commDate  = primary.comm_date || '';

    // Skip Bank of Canada era meetings that might have slipped through
    if (commDate && commDate < PM_START_DATE) continue;

    const registrantType = primary.reg_type === '2' ? 'consultant-lobbyist' : primary.reg_type === '3' ? 'in-house-lobbyist' : 'lobbyist';

    docs.push({
      id: `ca-carney-lobby-${comlogId}`,
      data: {
        member_name:      CARNEY_NAME,
        politician_slug:  CARNEY_SLUG,
        jurisdiction:     JURISDICTION,
        comlog_id:        comlogId,
        meeting_date:     commDate,
        dpoh_title:       dpoh.dpoh_title,
        dpoh_institution: dpoh.dpoh_institution,
        lobbyist_name:    [primary.registrant_first, primary.registrant_last].filter(Boolean).join(' ') || null,
        lobbyist_type:    registrantType,
        client_organization: primary.client_org || null,
        subject_description: subjects || null,
        source_url:       LOBBY_COMMS_SOURCE,
        source_name:      'Office of the Commissioner of Lobbying — Communication Reports',
        last_updated:     ts,
      },
    });
  }
  console.log(`[carney:lobbying] ${docs.length} PM-era meeting docs`);

  const written = await batchSet(db, 'member_lobbying', docs);
  console.log(`[carney:lobbying] ✓ ${written} documents written`);
  return written;
}

// ─── 3. member_corporate_affiliations — ourcommons.ca + lobbycanada DPOH ─────

async function fetchAffiliations(db, zipFiles) {
  const ts = new Date().toISOString();
  console.log('[carney:affiliations] Fetching ourcommons.ca profile and lobbycanada DPOH roles...');

  const docs = [];

  // ── Source A: ourcommons.ca current roles ──────────────────────────────────
  try {
    const r = await axios.get(
      `https://www.ourcommons.ca/members/en/${CARNEY_SLUG}(${OURCOMMONS_ID})`,
      { timeout: 15000, headers: BROWSER_HEADERS }
    );
    const html = String(r.data);

    // Extract roles section — "Current Roles" list items
    const rolesSection = html.match(/id=[\"']roles[\"'][\s\S]{0,8000}/);
    if (rolesSection) {
      const liItems = [...rolesSection[0].matchAll(/<li[^>]*>([\s\S]{0,300}?)<\/li>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(t => t.length > 3 && !/nepean|ontario|province/i.test(t));

      for (const item of liItems) {
        // Parse "Role (Type)" pattern
        const roleMatch = item.match(/^(.+?)\s*\((.+?)\)/);
        const role = roleMatch ? roleMatch[1].trim() : item;
        const roleType = roleMatch ? roleMatch[2].trim() : null;

        docs.push({
          id:   `ca-carney-affil-ourcommons-${role.replace(/\s+/g, '-').toLowerCase().slice(0, 60)}`,
          data: {
            member_name:     CARNEY_NAME,
            politician_slug: CARNEY_SLUG,
            jurisdiction:    JURISDICTION,
            organization:    roleType === 'Party Leader' ? 'Liberal Party of Canada' : 'Government of Canada',
            role:            role,
            role_type:       roleType || 'official',
            is_current:      true,
            start_date:      PM_START_DATE,
            end_date:        null,
            source_url:      `https://www.ourcommons.ca/members/en/${CARNEY_SLUG}(${OURCOMMONS_ID})`,
            source_name:     'House of Commons — Member Profile',
            last_updated:    ts,
          },
        });
      }
      console.log(`[carney:affiliations]   ourcommons.ca: ${liItems.length} current roles`);
    }
  } catch (e) {
    console.warn(`[carney:affiliations]   ourcommons.ca failed: ${e.message}`);
  }

  // ── Source B: lobbycanada.gc.ca — historical DPOH roles ───────────────────
  // Deduplicate roles from DPOH export (he appears as Governor, Bank of Canada pre-2013)
  try {
    if (!zipFiles) throw new Error('ZIP not available');
    const dpohText = zipFiles['Communication_DpohExport.csv'].toString('utf8');

    // Collect unique non-PM roles for Carney (historical DPOH roles)
    const seenRoles = new Set();
    const historicalRoles = [];
    for (const line of dpohText.split('\n').slice(1)) {
      if (!/\"Carney\",\"Mark\"/i.test(line)) continue;
      const p = parseCsvLine(line);
      const title       = (p[3] || '').trim();
      const institution = (p[6] || '').trim();
      if (/prime minister|premier ministre/i.test(title)) continue; // already have current role
      const key = `${title}|${institution}`;
      if (seenRoles.has(key) || !title || !institution) continue;
      seenRoles.add(key);
      historicalRoles.push({ title, institution });
    }

    // Canonicalize: pick the cleanest title variant for each institution
    const byInstitution = new Map();
    for (const { title, institution } of historicalRoles) {
      const existing = byInstitution.get(institution);
      // Prefer longer, more formal titles
      if (!existing || title.length > existing.length) byInstitution.set(institution, title);
    }

    for (const [institution, title] of byInstitution) {
      const slug = `${institution}-${title}`.replace(/\s+/g, '-').toLowerCase().slice(0, 80);
      docs.push({
        id: `ca-carney-affil-dpoh-${slug}`,
        data: {
          member_name:     CARNEY_NAME,
          politician_slug: CARNEY_SLUG,
          jurisdiction:    JURISDICTION,
          organization:    institution,
          role:            title,
          role_type:       'designated_public_office_holder',
          is_current:      false,
          start_date:      null,
          end_date:        null,
          source_url:      LOBBY_COMMS_SOURCE,
          source_name:     'Office of the Commissioner of Lobbying — DPOH records',
          last_updated:    ts,
        },
      });
    }
    console.log(`[carney:affiliations]   lobbycanada DPOH: ${byInstitution.size} historical roles`);
  } catch (e) {
    console.warn(`[carney:affiliations]   lobbycanada DPOH failed: ${e.message}`);
  }

  if (docs.length === 0) {
    console.log('[carney:affiliations] No affiliation docs produced');
    return 0;
  }
  const written = await batchSet(db, 'member_corporate_affiliations', docs);
  console.log(`[carney:affiliations] ✓ ${written} documents written`);
  return written;
}

// ─── 4. member_disclosures — CIEC conflict-of-interest filing ────────────────

async function fetchDisclosures(db) {
  const ts = new Date().toISOString();
  console.log('[carney:disclosures] Checking CIEC public registry...');

  let ciecStatus = 'unavailable';
  let ciecNote   = 'CIEC public registry domain (ciec-ccie.oic.gc.ca) has no DNS A record as of 2026-04. The Conflict of Interest Act requires the PM to file a public declaration of assets and private interests within 60 days of appointment. That declaration is filed with the Office of the Conflict of Interest and Ethics Commissioner.';

  try {
    await axios.get('https://ciec-ccie.oic.gc.ca/en/public-registry', { timeout: 8000, headers: BROWSER_HEADERS });
    ciecStatus = 'available';
    ciecNote   = 'CIEC public registry is accessible.';
  } catch (e) {
    console.warn(`[carney:disclosures]   CIEC unreachable: ${e.message}`);
  }

  const docs = [
    {
      id: 'ca-carney-disclosure-ciec-conflict-of-interest',
      data: {
        member_name:       CARNEY_NAME,
        politician_slug:   CARNEY_SLUG,
        jurisdiction:      JURISDICTION,
        disclosure_type:   'Conflict of Interest Act — Public Declaration',
        filed_with:        'Office of the Conflict of Interest and Ethics Commissioner (CIEC)',
        status:            ciecStatus === 'available' ? 'filed' : 'filed — registry_unreachable',
        filing_requirement: 'Within 60 days of PM appointment (2025-03-14); deadline ~2025-05-13',
        portal_status:     ciecStatus,
        notes:             ciecNote,
        source_url:        CIEC_SOURCE,
        source_name:       'CIEC — Public Registry',
        last_updated:      ts,
      },
    },
    {
      id: 'ca-carney-disclosure-ourcommons-proactive',
      data: {
        member_name:       CARNEY_NAME,
        politician_slug:   CARNEY_SLUG,
        jurisdiction:      JURISDICTION,
        disclosure_type:   'House of Commons Proactive Disclosure — Member Expenditures',
        filed_with:        'House of Commons',
        status:            'pending — first full quarter after April 28, 2025 election',
        filing_requirement: 'Quarterly; first report expected late 2025 for Q1 2025-26 (Apr–Jun 2025)',
        portal_status:     'available',
        notes:             'Carney became MP on 2025-04-28 after general election. Q1 2025-26 expenditure report expected to be published by House of Commons administration.',
        source_url:        `https://www.ourcommons.ca/ProactiveDisclosure/en/members/detail/${OURCOMMONS_ID}`,
        source_name:       'House of Commons — Proactive Disclosure',
        last_updated:      ts,
      },
    },
  ];

  const written = await batchSet(db, 'member_disclosures', docs);
  console.log(`[carney:disclosures] ✓ ${written} documents written`);
  return written;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function fetchCarneyData() {
  const db = getDb();
  const results = {};

  // Expenses (fast — small CSV)
  try {
    results.expenses = await fetchExpenses(db);
  } catch (e) {
    console.error('[carney:expenses] FAILED:', e.message);
    results.expenses = 0;
  }

  // Disclosures (fast — just an HTTP check + writes)
  try {
    results.disclosures = await fetchDisclosures(db);
  } catch (e) {
    console.error('[carney:disclosures] FAILED:', e.message);
    results.disclosures = 0;
  }

  // Lobbying + Affiliations both need the ZIP — download once, share the buffer
  let zipFiles = null;
  try {
    console.log('[carney] Downloading lobbycanada.gc.ca communications ZIP (22 MB)...');
    const resp = await axios.get(LOBBY_COMMS_ZIP, {
      timeout: 300000, responseType: 'arraybuffer', maxRedirects: 5,
      headers: BROWSER_HEADERS,
    });
    zipFiles = parseZip(Buffer.from(resp.data));
    console.log('[carney] ZIP parsed — files:', Object.keys(zipFiles).join(', '));
  } catch (e) {
    console.error('[carney] ZIP download failed:', e.message);
  }

  try {
    results.lobbying = zipFiles ? await fetchLobbying(db, zipFiles) : 0;
  } catch (e) {
    console.error('[carney:lobbying] FAILED:', e.message);
    results.lobbying = 0;
  }

  try {
    results.affiliations = await fetchAffiliations(db, zipFiles);
  } catch (e) {
    console.error('[carney:affiliations] FAILED:', e.message);
    results.affiliations = 0;
  }

  console.log(`\n[carney] Done — expenses:${results.expenses} lobbying:${results.lobbying} affiliations:${results.affiliations} disclosures:${results.disclosures}`);
  return results;
}

module.exports = { fetchCarneyData };

if (require.main === module) {
  fetchCarneyData()
    .then(r => {
      console.log(`Done — ${Object.values(r).reduce((a,b) => a+b, 0)} total documents written.`);
      process.exit(0);
    })
    .catch(e => { console.error(e.message); process.exit(1); });
}
