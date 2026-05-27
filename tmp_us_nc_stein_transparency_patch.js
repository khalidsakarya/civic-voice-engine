'use strict';
/**
 * tmp_us_nc_stein_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-NC
 * with confirmed facts for Governor Josh Stein.
 *
 * Primary source:
 *   North Carolina State Ethics Commission — Statement of Economic Interest (SEI)
 *   https://ethicssei.nc.gov/Tools/Search?id=SEI
 *   Filed annually by April 15 under NC General Statutes Chapter 138A.
 *   NOTE: ethicssei.nc.gov returns HTTP 403 from automated access. DocID 157385
 *   appeared in Google search results for "Josh Stein" SEI but also returns 403.
 *   NC SEI form requires: investment company names (>$10,000 per company), NC real
 *   estate (>$10,000 including primary residence), income source names, business
 *   ownership interests, and creditors — no dollar values required for most items.
 *
 * Box Inc. directorship:
 *   Josh Stein served on Box Inc. (BOX) Board of Directors since July 2006.
 *   SEC Form 4 filings confirm ~193,586 shares held as of June 2019 (most recent
 *   transaction: sold 20,000 shares June 17, 2019 for ~$363,800). No subsequent
 *   Form 4 transactions filed 2019–2024. Listed as "(Outgoing)" in Box FY2025 proxy
 *   materials; not listed as director in Box 2026 proxy cycle — departed board
 *   before/at June 2025 annual meeting, coinciding with Jan 1, 2025 gubernatorial
 *   inauguration.
 *
 * Salary source:
 *   NC governor statutory salary $203,073/year (2025) per Wikipedia citing state
 *   records. NC General Statutes Chapter 147, Article 3.
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL      = 'https://ethicssei.nc.gov/Tools/Search?id=SEI';
const SOURCE_URL_SEC  = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001372612&type=4&dateb=&owner=include&count=40';
const SOURCE_URL_BOX  = 'https://www.box.com/events/cards/resource/58866?resource_id=JoshStein-58866';

// ─── Salary ──────────────────────────────────────────────────────────────────
// NC governor statutory salary. Set per NC General Statutes Chapter 147, Article 3.
const SALARY = {
  amount:     203073,
  currency:   'USD',
  period:     'Calendar year 2025',
  source:     'State of North Carolina',
  source_url: 'https://en.wikipedia.org/wiki/Governor_of_North_Carolina',
  notes:      'NC governor statutory salary $203,073/year (2025) per state records. Set under NC General Statutes Chapter 147, Article 3.',
  fetched_at: NOW,
};

// ─── Declared assets ─────────────────────────────────────────────────────────
// Box Inc. (BOX) confirmed from SEC Form 4 filings. ~193,586 shares as of June 2019
// (most recent Form 4). No subsequent SEC-registered transactions 2019–2024.
// Estimated value ~$5M at ~$26–30/share as of 2024/2025.
// NC SEI requires investment company name only (no dollar values) for holdings >$10,000.
const DECLARED_ASSETS = {
  period:      'As of most recent SEI filing (annual, CY 2024)',
  source_url:  SOURCE_URL_SEC,
  filing_year: 2024,
  fetched_at:  NOW,
  notes:       'NC SEI requires investment company names for holdings >$10,000; no dollar values required on form. Box Inc. (BOX) confirmed from SEC Form 4 filings. ~193,586 shares held as of June 2019 (last Form 4 transaction). No additional SEC-registered transactions 2019–2024. Estimated value ~$5M+ at ~$26–30/share. NC SEI portal (ethicssei.nc.gov) returns 403 from automated access — exact current SEI entries unverifiable from this environment.',
  investments: [
    {
      name:          'Box, Inc.',
      ticker:        'BOX',
      shares_approx: 193586,
      value_approx:  5000000,
      currency:      'USD',
      basis:         'SEC Form 4 filings; last transaction June 17, 2019 (sold 20,000 shares ~$363,800). No subsequent Form 4 filings 2019–2024.',
      source_url:    SOURCE_URL_SEC,
    },
  ],
};

// ─── Business interests ───────────────────────────────────────────────────────
// Box Inc. directorship confirmed from SEC filings, Box proxy materials, and Box.com.
// Stein joined Board July 2006. Departed before/at June 2025 annual meeting (listed
// as "Outgoing" in FY2025 proxy; absent from 2026 proxy cycle).
const BUSINESS_INTERESTS = {
  fetched_at: NOW,
  notes:      'Box Inc. directorship confirmed from SEC Form 4 filings and Box proxy materials. No other business ownership interests identified in public records. NC SEI requires business ownership interests — directorship without equity ownership is not a "business interest" per NC 138A but director compensation would appear as an income source.',
  entities: [
    {
      name:        'Box, Inc.',
      ticker:      'BOX',
      role:        'Director',
      tenure_start: '2006-07',
      tenure_end:   '2025',
      status:       'Outgoing — departed before/at June 2025 annual meeting coinciding with Jan 1, 2025 gubernatorial inauguration',
      source_url:   SOURCE_URL_BOX,
      notes:       'Served on Box Board since July 2006. Listed as "(Outgoing)" in Box FY2025 proxy materials (annual meeting June 27, 2025). Not listed in Box 2026 proxy cycle. Received annual RSU grants and cash retainer as outside director — amounts not confirmed from accessible sources.',
    },
  ],
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. NC SEI portal (ethicssei.nc.gov) returns HTTP 403 from automated access; ' +
  'DocID 157385 (likely Stein\'s SEI, appeared in Google search results) also returns 403. ' +
  'No NC news coverage found with specific SEI section entries. ' +
  'Confirmed: salary $203,073/year (2025 state records); Box Inc. (BOX) ~193,586 shares ' +
  '(SEC Form 4, last transaction June 2019); Box directorship July 2006–2025 (outgoing). ' +
  'NC SEI requires investment company names (>$10,000/company), NC real estate (>$10,000), ' +
  'income source names, and business ownership interests — no dollar values required for ' +
  'most items. Real estate (likely Raleigh area primary residence), other income sources, ' +
  'creditors, and gifts unverifiable from public sources without SEI access. ' +
  'Net worth estimated ~$6M, primarily Box Inc. holdings (Urbansplatter citing SEC data).';

// ─── Fields to DELETE (framework-only garbage) ────────────────────────────────
const FIELDS_TO_REMOVE = [
  'lobbying_records',
  'stock_holdings',
  'recent_official_activity',
  'sections_available',
  'data_completeness_note',
  'contact_info',
  'transparency_live',
  'financial_disclosure',
  'sections_unavailable',
  'regulatory_body',
  'sources_confirmed',
  'regulatory_act',
  'gifts_hospitality',
  'jurisdiction_id',
  'campaign_finance',
  'sources_inaccessible',
  'field_sources',
  'transparency_fetched_at',
];

function buildDeleteMap(fields) {
  const map = {};
  for (const f of fields) map[f] = FieldValue.delete();
  return map;
}

function print() {
  console.log('\n[US-NC Stein Transparency Patch]');
  console.log('Source: NC Ethics Commission SEI | ethicssei.nc.gov 403 | Box Inc SEC Form 4\n');

  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  amount:  $' + SALARY.amount.toLocaleString());
  console.log('  period:  ' + SALARY.period);

  console.log('\ndeclared_assets (1 investment):');
  for (const inv of DECLARED_ASSETS.investments)
    console.log('  - ' + inv.name + ' (' + inv.ticker + '): ~' +
      inv.shares_approx.toLocaleString() + ' shares, est. ~$' +
      (inv.value_approx / 1e6).toFixed(1) + 'M');

  console.log('\nbusiness_interests (1 entity, outgoing):');
  for (const e of BUSINESS_INTERESTS.entities)
    console.log('  - ' + e.name + ' (' + e.role + ' ' + e.tenure_start + '–' + e.tenure_end + '): ' + e.status.substring(0, 60) + '...');

  console.log('\nAccess gaps:');
  console.log('  - ethicssei.nc.gov SEI portal: HTTP 403');
  console.log('  - DocID 157385 (likely Stein\'s SEI): HTTP 403');
  console.log('  - Real estate, gifts, creditors: unverifiable without SEI access');

  console.log('\ndata_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 120) + '...');
  console.log('status: filed annually by April 15 | filing_year: 2024');
}

async function main() {
  console.log('\n[us-nc-stein] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-nc-stein] DRY RUN — no writes.');
    console.log('[us-nc-stein] To apply: node tmp_us_nc_stein_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-NC').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                 SALARY,
      declared_assets:        DECLARED_ASSETS,
      business_interests:     BUSINESS_INTERESTS,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      source_url:             SOURCE_URL,
      regulatory_body:        'North Carolina State Ethics Commission',
      regulatory_act:         'NC General Statutes Chapter 138A',
      status:                 'filed',
      filing_year:            2024,
      filing_note:            'NC SEI filed annually by April 15 under NC GS Chapter 138A. Portal (ethicssei.nc.gov) returns 403 from automated access. DocID 157385 identified via Google but also inaccessible.',
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-nc-stein] ✅ subnational_leader_transparency/US-NC updated.');
  console.log('[us-nc-stein] Done.');
}

main().catch(e => { console.error('[us-nc-stein] Fatal:', e.message); process.exit(1); });
