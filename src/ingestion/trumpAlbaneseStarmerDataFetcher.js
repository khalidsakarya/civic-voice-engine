'use strict';

/**
 * Fetches member_expenses, member_lobbying, and member_disclosures for
 * Donald Trump, Anthony Albanese, and Keir Starmer from official sources.
 *
 * Working endpoints:
 *   Trump expenses:    api.usaspending.gov  (EOP agency 1100, FY budget + object class)
 *   Trump lobbying:    lda.senate.gov API   (Senate lobbying disclosure database)
 *   Trump disclosures: oge.gov reference    (EFTS search domain offline)
 *
 *   Albanese expenses:    finance.gov.au reference  (Cloudflare-blocked)
 *   Albanese lobbying:    transparency.gov.au ref   (JS SPA, not scrapable)
 *   Albanese disclosures: aph.gov.au PDF reference  (3.8 MB PDF, confirmed accessible)
 *
 *   Starmer expenses:    ipsa.org.uk reference      (API rebuilt, endpoints offline)
 *   Starmer lobbying:    gov.uk search API          (PM office transparency publications)
 *   Starmer disclosures: members-api.parliament.uk  (registered interests, full data)
 */

require('dotenv').config();
const axios = require('axios');
const { getDb } = require('../firebase/client');

// ─── Constants ────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const TRUMP_NAME    = 'Donald Trump';
const TRUMP_SLUG    = 'donald-trump';
const TRUMP_JUR     = 'US';

const ALBANESE_NAME = 'Anthony Albanese';
const ALBANESE_SLUG = 'anthony-albanese';
const ALBANESE_JUR  = 'AU';

const STARMER_NAME  = 'Keir Starmer';
const STARMER_SLUG  = 'keir-starmer';
const STARMER_JUR   = 'UK';
const STARMER_MP_ID = 4514;

const EOP_TOPTIER   = '1100';   // USASpending toptier code for Executive Office of the President
const STARMER_START = '2024-07-05';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeId(id) {
  return String(id).replace(/\//g, '-').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 500);
}

async function batchSet(db, collection, docs, mergeFlag = false) {
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const chunk = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of chunk) {
      batch.set(db.collection(collection).doc(sanitizeId(id)), data, { merge: mergeFlag });
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

async function clearSlug(db, collection, slug) {
  const snap = await db.collection(collection).where('politician_slug', '==', slug).get();
  if (snap.empty) return 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  console.log(`[data] Cleared ${snap.size} existing ${slug} docs from ${collection}`);
  return snap.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUMP
// ─────────────────────────────────────────────────────────────────────────────

// ── Trump expenses: USASpending EOP budget ────────────────────────────────────

async function fetchTrumpExpenses() {
  console.log('[trump:expenses] Fetching USASpending EOP (agency 1100)...');
  const ts  = new Date().toISOString();
  const FY  = 2025;
  const docs = [];

  // 1. EOP top-level budgetary resources
  const budgetR = await axios.get(
    `https://api.usaspending.gov/api/v2/agency/${EOP_TOPTIER}/budgetary_resources/?fiscal_year=${FY}`,
    { timeout: 20000, headers: BROWSER_HEADERS },
  );
  const byYear = budgetR.data?.agency_data_by_year ?? [];
  const fy25   = byYear.find(y => y.fiscal_year === FY) ?? byYear[0] ?? {};

  docs.push({
    id: `us-trump-expense-eop-budget-fy${FY}`,
    data: {
      member_name:     TRUMP_NAME,
      politician_slug: TRUMP_SLUG,
      jurisdiction:    TRUMP_JUR,
      category:        'agency_budget',
      fiscal_year:     String(FY),
      description:     'Executive Office of the President — FY2025 budgetary resources',
      budget_authority: fy25.agency_budgetary_resources ?? null,
      total_obligated:  fy25.agency_total_obligated ?? null,
      total_outlayed:   fy25.agency_total_outlayed ?? null,
      currency:        'USD',
      source_url:      'https://api.usaspending.gov/api/v2/agency/1100/budgetary_resources/',
      source_name:     'USASpending.gov — Executive Office of the President',
      last_updated:    ts,
    },
  });

  // 2. Object class (spending category) breakdown
  const objR = await axios.get(
    `https://api.usaspending.gov/api/v2/agency/${EOP_TOPTIER}/object_class/?fiscal_year=${FY}&limit=50`,
    { timeout: 20000, headers: BROWSER_HEADERS },
  );
  for (const item of objR.data?.results ?? []) {
    docs.push({
      id: `us-trump-expense-eop-objclass-${sanitizeId(item.name ?? item.id)}-fy${FY}`,
      data: {
        member_name:     TRUMP_NAME,
        politician_slug: TRUMP_SLUG,
        jurisdiction:    TRUMP_JUR,
        category:        'spending_category',
        fiscal_year:     String(FY),
        expense_type:    item.name ?? null,
        object_class:    item.object_class ?? null,
        amount:          item.obligated_amount ?? null,
        currency:        'USD',
        description:     `EOP FY${FY} ${item.name ?? ''} obligations`,
        source_url:      'https://api.usaspending.gov/api/v2/agency/1100/object_class/',
        source_name:     'USASpending.gov — Executive Office of the President',
        last_updated:    ts,
      },
    });
  }

  console.log(`[trump:expenses] ✓ ${docs.length} docs`);
  return docs;
}

// ── Trump lobbying: LDA Senate filing database ────────────────────────────────

async function fetchTrumpLobbying() {
  console.log('[trump:lobbying] Fetching LDA Senate filings (EOP contacts, 2025)...');
  const ts   = new Date().toISOString();
  const docs = [];

  // Paginate the most recent 200 filings where EOP is a government entity
  let url = 'https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=50';
  let pages = 0;

  while (url && pages < 4) {
    const r = await axios.get(url, { timeout: 20000, headers: BROWSER_HEADERS });
    for (const f of r.data?.results ?? []) {
      const activities = f.lobbying_activities ?? [];
      const issues     = [...new Set(activities.map(a => a.general_issue_code_display).filter(Boolean))];
      const govEntities = [...new Set(
        activities.flatMap(a => (a.government_entities ?? []).map(e => e.name ?? e)).filter(Boolean),
      )];
      const descriptions = activities.map(a => a.description).filter(Boolean).join('; ').slice(0, 500);

      docs.push({
        id: `us-trump-lobbying-lda-${sanitizeId(f.filing_uuid)}`,
        data: {
          member_name:       TRUMP_NAME,
          politician_slug:   TRUMP_SLUG,
          jurisdiction:      TRUMP_JUR,
          title:             `${f.registrant?.name ?? ''} on behalf of ${f.client?.name ?? ''}`,
          date:              f.dt_posted ? f.dt_posted.slice(0, 10) : '',
          filing_year:       f.filing_year,
          filing_period:     f.filing_period_display ?? f.filing_period,
          registrant:        f.registrant?.name ?? null,
          client:            f.client?.name ?? null,
          issues:            issues,
          government_entities: govEntities,
          description:       descriptions,
          income:            f.income != null ? Number(f.income) : null,
          expenses:          f.expenses != null ? Number(f.expenses) : null,
          currency:          'USD',
          source_url:        f.filing_document_url ?? `https://lda.senate.gov/filings/${f.filing_uuid}/`,
          source_name:       'Senate Lobbying Disclosure Act Database — lda.senate.gov',
          last_updated:      ts,
        },
      });
    }
    url   = r.data?.next ?? null;
    pages += 1;
    if (url) await new Promise(res => setTimeout(res, 100));
  }

  console.log(`[trump:lobbying] ✓ ${docs.length} docs`);
  return docs;
}

// ── Trump disclosures: OGE reference ─────────────────────────────────────────
// The OGE EFTS full-text search domain (efts.usoge.gov) has no DNS record.
// The main oge.gov site is accessible; the Lotus Notes search form requires
// session cookies. We store a structured reference with the public search URL.

async function fetchTrumpDisclosures() {
  console.log('[trump:disclosures] Storing OGE reference docs...');
  const ts = new Date().toISOString();
  return [
    {
      id: 'us-trump-disclosure-oge-278-2025',
      data: {
        member_name:     TRUMP_NAME,
        politician_slug: TRUMP_SLUG,
        jurisdiction:    TRUMP_JUR,
        title:           'Annual Public Financial Disclosure Report (OGE Form 278e)',
        category:        'financial_disclosure',
        filing_type:     'OGE Form 278e',
        filing_year:     '2025',
        description:     'President Trump is required to file an annual public financial disclosure (OGE Form 278e) with the Office of Government Ethics covering assets, income, liabilities, and positions. The OGE EFTS full-text search service (efts.usoge.gov) has no active DNS record as of 2026. Disclosures are available via the OGE Individual Disclosures search collection.',
        source_url:      'https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?OpenForm',
        source_name:     'U.S. Office of Government Ethics — oge.gov',
        status:          'reference',
        last_updated:    ts,
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// ALBANESE
// ─────────────────────────────────────────────────────────────────────────────

// ── Albanese expenses: finance.gov.au reference ───────────────────────────────

async function fetchAlbaneseExpenses() {
  console.log('[albanese:expenses] Storing finance.gov.au reference...');
  const ts = new Date().toISOString();
  return [
    {
      id: 'au-albanese-expense-finance-ref',
      data: {
        member_name:     ALBANESE_NAME,
        politician_slug: ALBANESE_SLUG,
        jurisdiction:    ALBANESE_JUR,
        title:           'Ministerial Expenses — Department of Finance proactive disclosure',
        category:        'ministerial_expenses',
        description:     'The Australian Department of Finance publishes quarterly proactive disclosure of ministerial expenses including travel, accommodation, and office costs. The finance.gov.au website returns Cloudflare bot-challenge responses to automated requests. Expenses are published as PDF reports every six months.',
        source_url:      'https://www.finance.gov.au/government/managing-commonwealth-resources/accountability-resources/ministerial-expenses',
        source_name:     'Department of Finance — finance.gov.au',
        status:          'reference',
        last_updated:    ts,
      },
    },
  ];
}

// ── Albanese lobbying: transparency.gov.au reference ─────────────────────────

async function fetchAlbaneseLobbying() {
  console.log('[albanese:lobbying] Storing transparency.gov.au reference...');
  const ts = new Date().toISOString();
  return [
    {
      id: 'au-albanese-lobbying-transparency-ref',
      data: {
        member_name:     ALBANESE_NAME,
        politician_slug: ALBANESE_SLUG,
        jurisdiction:    ALBANESE_JUR,
        title:           'Lobbying Contact Register — Department of the Prime Minister and Cabinet',
        category:        'lobbying_register',
        description:     'The Australian Government Lobbying Register is maintained by the Department of the Prime Minister and Cabinet at transparency.gov.au. The site is a JavaScript single-page application that cannot be scraped without a browser runtime. Third-party lobbyists who meet with government representatives (including PM office staff) must be registered.',
        source_url:      'https://www.transparency.gov.au/',
        source_name:     'Australian Government Lobbying Register — transparency.gov.au',
        status:          'reference',
        last_updated:    ts,
      },
    },
  ];
}

// ── Albanese disclosures: APH Register of Members' Interests ──────────────────

async function fetchAlbaneseDisclosures() {
  console.log('[albanese:disclosures] Fetching APH members register listing...');
  const ts = new Date().toISOString();
  const docs = [];

  // APH Members Register lists all current interests PDFs
  const listR = await axios.get(
    'https://www.aph.gov.au/Senators_and_Members/Members/Register',
    { timeout: 20000, headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] } },
  );

  // Find Albanese's PDF link
  const albPdfMatch = listR.data.match(/href="([^"]*Albanese[^"]*\.pdf[^"]*)"/i);
  const albPdfPath  = albPdfMatch?.[1] ?? '/-/media/03_Senators_and_Members/32_Members/Register/48p/AB/Albanese_48P.pdf';
  const albPdfUrl   = albPdfPath.startsWith('http') ? albPdfPath : `https://www.aph.gov.au${albPdfPath}`;

  docs.push({
    id: 'au-albanese-disclosure-aph-register-pdf',
    data: {
      member_name:     ALBANESE_NAME,
      politician_slug: ALBANESE_SLUG,
      jurisdiction:    ALBANESE_JUR,
      title:           'Register of Members\' Interests — Anthony Albanese (48th Parliament)',
      category:        'financial_disclosure',
      filing_type:     'Register of Members\' Interests',
      parliament:      '48th',
      description:     'The Register of Members\' Interests is maintained by the House of Representatives and lists all declared interests of Members of Parliament including assets, liabilities, income, gifts, travel, and company directorships. The PDF is publicly available and confirmed accessible (3.8 MB).',
      source_url:      albPdfUrl,
      source_name:     'Australian Parliament House — Register of Members\' Interests',
      status:          'active',
      last_updated:    ts,
    },
  });

  // Also store the register index URL
  docs.push({
    id: 'au-albanese-disclosure-aph-register-index',
    data: {
      member_name:     ALBANESE_NAME,
      politician_slug: ALBANESE_SLUG,
      jurisdiction:    ALBANESE_JUR,
      title:           'Register of Members\' Interests — Index Page',
      category:        'financial_disclosure',
      description:     'Index page listing all current Members\' Register of Interests PDFs for the 48th Parliament.',
      source_url:      'https://www.aph.gov.au/Senators_and_Members/Members/Register',
      source_name:     'Australian Parliament House — Register of Members\' Interests',
      status:          'active',
      last_updated:    ts,
    },
  });

  console.log(`[albanese:disclosures] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// STARMER
// ─────────────────────────────────────────────────────────────────────────────

// ── Starmer expenses: IPSA reference ─────────────────────────────────────────

async function fetchStarmerExpenses() {
  console.log('[starmer:expenses] Storing IPSA reference...');
  const ts = new Date().toISOString();
  return [
    {
      id: 'uk-starmer-expense-ipsa-ref',
      data: {
        member_name:     STARMER_NAME,
        politician_slug: STARMER_SLUG,
        jurisdiction:    STARMER_JUR,
        title:           'MP Staffing and Business Costs — IPSA',
        category:        'mp_expenses',
        description:     'The Independent Parliamentary Standards Authority (IPSA) publishes all MP staffing and business costs on a quarterly basis. IPSA recently rebuilt their website and all prior API endpoints (e.g. /api/expense?memberId=) return 404. Data is published at theipsa.org.uk/mp-staffing-business-costs/',
        source_url:      'https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/',
        source_name:     'Independent Parliamentary Standards Authority — theipsa.org.uk',
        status:          'reference',
        last_updated:    ts,
      },
    },
  ];
}

// ── Starmer lobbying: gov.uk PM transparency publications ─────────────────────

async function fetchStarmerLobbying() {
  console.log('[starmer:lobbying] Fetching gov.uk PM office transparency publications...');
  const ts   = new Date().toISOString();
  const docs = [];

  // Paginate PM office items, keep those that look like ministerial transparency records
  // (meetings, gifts, hospitality). The gov.uk filter_document_type=transparency_data
  // returns 0 results; instead we filter by keyword + path in code.
  const TRANSPARENCY_KEYWORDS = /meeting|gift|hospitality|interest|donation|visit|appointment/i;
  let start = 0;
  let hitCutoff = false;

  while (!hitCutoff && docs.length < 200) {
    const r = await axios.get('https://www.gov.uk/api/search.json', {
      timeout: 20000,
      headers: BROWSER_HEADERS,
      params: {
        filter_organisations: 'prime-ministers-office-10-downing-street',
        count: 50,
        start,
        order: '-public_timestamp',
      },
    });

    const results = r.data?.results ?? [];
    if (results.length === 0) break;

    for (const item of results) {
      const date = (item.public_timestamp ?? '').slice(0, 10);
      if (date && date < STARMER_START) { hitCutoff = true; break; }

      const docType = item.document_type ?? '';
      const link    = item.link ?? '';
      const title   = item.title ?? '';

      // Keep news, speeches, and anything matching transparency keywords
      if (!TRANSPARENCY_KEYWORDS.test(title) && !TRANSPARENCY_KEYWORDS.test(docType)
          && !/\/news\/|\/speeches\//.test(link)) continue;

      docs.push({
        id:   `uk-starmer-lobbying-govuk-${sanitizeId(link)}`,
        data: {
          member_name:     STARMER_NAME,
          politician_slug: STARMER_SLUG,
          jurisdiction:    STARMER_JUR,
          title,
          date,
          category:        'ministerial_activity',
          description:     item.description ?? '',
          document_type:   docType,
          source_url:      link.startsWith('http') ? link : `https://www.gov.uk${link}`,
          source_name:     "Prime Minister's Office — gov.uk",
          last_updated:    ts,
        },
      });
    }

    if (results.length < 50) break;
    start += 50;
    await new Promise(res => setTimeout(res, 60));
  }

  console.log(`[starmer:lobbying] ✓ ${docs.length} docs`);
  return docs;
}

// ── Starmer disclosures: UK Parliament registered interests ───────────────────

async function fetchStarmerDisclosures() {
  console.log(`[starmer:disclosures] Fetching UK Parliament interests for MP ${STARMER_MP_ID}...`);
  const ts   = new Date().toISOString();
  const docs = [];

  const r = await axios.get(
    `https://members-api.parliament.uk/api/Members/${STARMER_MP_ID}/RegisteredInterests`,
    { timeout: 20000, headers: BROWSER_HEADERS },
  );

  for (const category of r.data?.value ?? []) {
    for (const interest of category.interests ?? []) {
      const text = (interest.interest ?? '').replace(/\r\n/g, '\n').trim();
      const dateAdded = interest.createdWhen?.slice(0, 10) ?? '';

      docs.push({
        id:   `uk-starmer-disclosure-interest-${interest.id}`,
        data: {
          member_name:     STARMER_NAME,
          politician_slug: STARMER_SLUG,
          jurisdiction:    STARMER_JUR,
          title:           `${category.name}: ${text.split('\n')[0].slice(0, 100)}`,
          date:            dateAdded,
          category:        'registered_interest',
          interest_category: category.name,
          description:     text,
          is_correction:   interest.isCorrection ?? false,
          source_url:      `https://members-api.parliament.uk/api/Members/${STARMER_MP_ID}/RegisteredInterests`,
          source_name:     'UK Parliament — Register of Members\' Financial Interests',
          last_updated:    ts,
        },
      });
    }
  }

  console.log(`[starmer:disclosures] ✓ ${docs.length} docs`);
  return docs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function fetchLeaderData() {
  const db = getDb();

  // Fetch all sources in parallel per-leader (different hosts, no conflict)
  console.log('[leaders:data] Fetching all sources...');
  const [
    trumpExp, trumpLob, trumpDisc,
    albExp,   albLob,   albDisc,
    starExp,  starLob,  starDisc,
  ] = await Promise.allSettled([
    fetchTrumpExpenses(),
    fetchTrumpLobbying(),
    fetchTrumpDisclosures(),
    fetchAlbaneseExpenses(),
    fetchAlbaneseLobbying(),
    fetchAlbaneseDisclosures(),
    fetchStarmerExpenses(),
    fetchStarmerLobbying(),
    fetchStarmerDisclosures(),
  ]).then(results => results.map((r, i) => {
    if (r.status === 'rejected') {
      const labels = ['trump:exp','trump:lob','trump:disc','alb:exp','alb:lob','alb:disc','star:exp','star:lob','star:disc'];
      console.error(`[leaders:data] ${labels[i]} failed:`, r.reason?.message);
      return [];
    }
    return r.value;
  }));

  const summary = {
    expenses: {
      trump:    trumpExp.length,
      albanese: albExp.length,
      starmer:  starExp.length,
    },
    lobbying: {
      trump:    trumpLob.length,
      albanese: albLob.length,
      starmer:  starLob.length,
    },
    disclosures: {
      trump:    trumpDisc.length,
      albanese: albDisc.length,
      starmer:  starDisc.length,
    },
  };
  console.log('\n[leaders:data] Totals:', JSON.stringify(summary, null, 2));

  // Clear and write each collection per politician
  let totalWritten = 0;

  for (const [slug, expDocs, lobDocs, discDocs] of [
    [TRUMP_SLUG,    trumpExp,  trumpLob,  trumpDisc],
    [ALBANESE_SLUG, albExp,    albLob,    albDisc],
    [STARMER_SLUG,  starExp,   starLob,   starDisc],
  ]) {
    await clearSlug(db, 'member_expenses',    slug);
    await clearSlug(db, 'member_lobbying',    slug);
    await clearSlug(db, 'member_disclosures', slug);

    totalWritten += await batchSet(db, 'member_expenses',    expDocs);
    totalWritten += await batchSet(db, 'member_lobbying',    lobDocs);
    totalWritten += await batchSet(db, 'member_disclosures', discDocs);
  }

  console.log(`\n[leaders:data] ✓ ${totalWritten} total documents written`);
  return totalWritten;
}

module.exports = { fetchLeaderData };

if (require.main === module) {
  fetchLeaderData()
    .then(n => { console.log(`Done — ${n} documents written.`); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
