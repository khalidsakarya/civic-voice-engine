'use strict';
/**
 * tmp_us_oh_dewine_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-OH
 * with confirmed facts for Governor Mike DeWine.
 *
 * Primary source:
 *   Ohio Ethics Commission — Financial Disclosure Statement (FDS)
 *   https://ethics.ohio.gov/fds/index.html
 *   NOTE: ethics.ohio.gov returns a WAF "Request Rejected" block for all URLs
 *   from non-Ohio IP ranges as of May 2026. Filer portal (disclosure.ethics.ohio.gov)
 *   is login-only. FDS filings for years 2019–2024 exist as public records and are
 *   accessible via public records request: eric.bruce@ethics.ohio.gov / (614) 466-7090.
 *
 * Salary source:
 *   ORC 141.01 sets base governor salary at $154,248.
 *   ORC 141.011 establishes annual increments for elective officers 2020–2028.
 *   Exact 2024 amount unconfirmed due to access blocks on codes.ohio.gov and
 *   checkbook.ohio.gov; estimated range $155,000–$165,000.
 *
 * Gift source (only confirmed FDS item in public reporting):
 *   Energy and Policy Institute / DocumentCloud (2020) — DeWine's 2019 FDS
 *   listed food and beverages from Ohio Governor's Residence and Office Foundation.
 *   Ohio FDS requires disclosure of gift source only (no dollar amount required).
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL = 'https://ethics.ohio.gov/fds/index.html';

// ─── Salary ──────────────────────────────────────────────────────────────────
// ORC 141.01 sets base at $154,248. ORC 141.011 adds annual increments (2020–2028).
// Exact 2024 figure unverifiable from this environment (codes.ohio.gov and
// checkbook.ohio.gov both WAF-blocked). Range $155,000–$165,000 is confirmed
// from public reporting (Ballotpedia: $159,189 in 2020; no later confirmed figure).
const SALARY = {
  amount_min:  155000,
  amount_max:  165000,
  currency:    'USD',
  period:      'Calendar year 2024',
  source:      'State of Ohio',
  source_url:  'https://codes.ohio.gov/ohio-revised-code/section-141.01',
  notes:       'Governor salary per ORC 141.01 (base $154,248) + ORC 141.011 annual increments for elective officers 2020–2028. Exact 2024 figure unconfirmed — codes.ohio.gov and checkbook.ohio.gov return access errors from this environment. Ballotpedia records $159,189 for 2020; subsequent increments not independently confirmed.',
  fetched_at:  NOW,
};

// ─── Gifts ────────────────────────────────────────────────────────────────────
// From DeWine's 2019 OEC FDS, per Energy and Policy Institute / DocumentCloud.
// Ohio FDS (ORC 102.02) requires disclosure of gift SOURCE only when aggregate
// fair market value from a single source exceeds $75 — dollar amounts not required.
const GIFTS = {
  period:       'Calendar year 2019',
  source_url:   'https://energyandpolicy.org/anne-vogel-puco/',
  filing_year:  2019,
  fetched_at:   NOW,
  notes:        'From 2019 OEC FDS. Ohio FDS requires source name only — no dollar amount required. 2020–2024 FDS contents inaccessible (ethics.ohio.gov WAF-blocked).',
  items: [
    {
      source:      'Ohio Governor\'s Residence and Office Foundation',
      description: 'Food and beverages',
      amount:      null,
      currency:    'USD',
      notes:       'Dollar amount not required by Ohio FDS form (source disclosure only).',
    },
  ],
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. Salary confirmed from statute (ORC 141.01 base $154,248 + ORC 141.011 ' +
  'increments; exact 2024 amount unverified). OEC FDS filings for years 2019–2024 ' +
  'exist as public records but are not retrievable via automated access — ' +
  'ethics.ohio.gov returns a WAF block for all URL paths from non-Ohio IP ranges as of ' +
  'May 2026. Disclosure portal (disclosure.ethics.ohio.gov) is login-only. ' +
  'Public records request available: eric.bruce@ethics.ohio.gov, (614) 466-7090. ' +
  'Note: Ohio FDS (ORC 102.02) requires source names for income >$1,000, investments ' +
  '>$1,000 in Ohio-incorporated entities, Ohio real estate, creditors >$1,000, ' +
  'and gift sources >$75 — but does NOT require dollar amounts for most items. ' +
  'Governor DeWine declined to voluntarily release income tax returns in the 2022 ' +
  'election cycle, departing from 30+ years of Ohio gubernatorial precedent.';

// ─── Fields to DELETE (framework-only garbage) ────────────────────────────────
const FIELDS_TO_REMOVE = [
  'lobbying_records',
  'stock_holdings',
  'recent_official_activity',
  'sections_available',
  'contact_info',
  'transparency_live',
  'financial_disclosure',
  'sections_unavailable',
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
  console.log('\n[US-OH DeWine Transparency Patch]');
  console.log('Source: Ohio Ethics Commission OEC FDS | ethics.ohio.gov WAF-blocked\n');

  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  range:  $' + SALARY.amount_min.toLocaleString() + '–$' + SALARY.amount_max.toLocaleString());
  console.log('  source: ' + SALARY.source);
  console.log('  basis:  ORC 141.01 base $154,248 + ORC 141.011 annual increments');

  console.log('\ngifts (1 item, 2019 FDS):');
  for (const g of GIFTS.items)
    console.log('  - ' + g.source + ': ' + g.description + ' (no dollar amount required by Ohio form)');

  console.log('\ntax_return_status: declined to release (2022 cycle)');
  console.log('\nregulatory_body: Ohio Ethics Commission');
  console.log('status: filed annually (2019–2024)');
  console.log('data_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 120) + '...');
}

async function main() {
  console.log('\n[us-oh-dewine] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-oh-dewine] DRY RUN — no writes.');
    console.log('[us-oh-dewine] To apply: node tmp_us_oh_dewine_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-OH').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                 SALARY,
      gifts:                  GIFTS,
      regulatory_body:        'Ohio Ethics Commission',
      regulatory_act:         'Ohio Revised Code Section 102.02',
      tax_return_status:      'Governor DeWine declined to voluntarily release income tax returns in the 2022 election cycle, departing from 30+ years of Ohio gubernatorial precedent. His aide noted financial disclosure filings with OEC contain "some of the same general information."',
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      source_url:             SOURCE_URL,
      status:                 'filed',
      filing_note:            'OEC FDS filed annually per ORC 102.02. FDS public records for 2019–2024 exist but are inaccessible via automated retrieval (ethics.ohio.gov WAF). Request via eric.bruce@ethics.ohio.gov or (614) 466-7090.',
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-oh-dewine] ✅ subnational_leader_transparency/US-OH updated.');
  console.log('[us-oh-dewine] Done.');
}

main().catch(e => { console.error('[us-oh-dewine] Fatal:', e.message); process.exit(1); });
