'use strict';
/**
 * tmp_us_pa_shapiro_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-PA
 * with confirmed facts for Governor Josh Shapiro.
 *
 * Primary source:
 *   Pennsylvania State Ethics Commission — Statement of Financial Interests (SFI)
 *   https://www.ethicsrulings.pa.gov/WebLink/DocView.aspx?id=580356&dbid=0&repo=Ethics
 *   NOTE: ethicsrulings.pa.gov has no DNS record as of May 2026 (domain appears
 *   taken down following pa.gov consolidation). 2024 SFI is not currently accessible.
 *   Data below is from the 2023 SFI (filed May 1, 2024, covering calendar year 2023)
 *   confirmed via Finbold/news sources, plus 2024 salary from public salary records.
 *
 * Corroborating sources:
 *   Salary (2024): TribLive / The Center Square — $237,679 after 3.5% raise Jan 2024
 *   Gifts (2023): WHYY May 3, 2024 — Team PA $12,194.62
 *   Real estate / business interests: Finbold citing 2023 SFI — both none declared
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL_2023 = 'https://www.ethicsrulings.pa.gov/WebLink/DocView.aspx?id=580356&dbid=0&repo=Ethics';
const SFI_NOTE        = 'PA SFI discloses income source names only — no dollar amounts for income per state law. No stock/investment disclosure required.';

// ─── Salary ──────────────────────────────────────────────────────────────────
// Statutory governor salary confirmed from public pay records.
// PA SFI reports income source name only, not the dollar amount —
// $237,679 is confirmed from public salary schedule (3.5% COLA effective Jan 2024).
const SALARY = {
  amount:     237679,
  currency:   'USD',
  period:     'Calendar year 2024',
  source:     'Commonwealth of Pennsylvania',
  source_url: 'https://www.pa.gov/agencies/ethics',
  notes:      'Governor statutory salary per 2024 pay schedule ($237,679). Raised from $229,615 (2023) by 3.5% COLA effective January 2024. Raised again to $245,760 for 2025. PA SFI lists income source names only — no dollar amount is stated on the form itself.',
  fetched_at: NOW,
};

// ─── Real estate interests ────────────────────────────────────────────────────
const REAL_ESTATE_INTERESTS = {
  period:      'Calendar year 2023',
  source_url:  SOURCE_URL_2023,
  filing_year: 2023,
  fetched_at:  NOW,
  declared:    false,
  notes:       'No real estate interests declared on 2023 SFI. Governor Shapiro resides at the Pennsylvania Governor\'s Residence (208 N 2nd Street, Harrisburg). 2024 SFI not accessible — ethicsrulings.pa.gov domain is down.',
};

// ─── Business interests ───────────────────────────────────────────────────────
const BUSINESS_INTERESTS = {
  period:      'Calendar year 2023',
  source_url:  SOURCE_URL_2023,
  filing_year: 2023,
  fetched_at:  NOW,
  declared:    false,
  notes:       'No financial interests in any for-profit business declared on 2023 SFI. 2024 SFI not accessible.',
};

// ─── Gifts ────────────────────────────────────────────────────────────────────
// From 2023 SFI (filed May 1, 2024, covering calendar year 2023).
// PA SFI requires disclosure of gifts over $250 aggregate from a single source.
const GIFTS = {
  period:      'Calendar year 2023',
  source_url:  SOURCE_URL_2023,
  filing_year: 2023,
  fetched_at:  NOW,
  notes:       'Gifts from 2023 SFI. 2024 SFI not accessible — ethicsrulings.pa.gov domain is down.',
  items: [
    {
      source:      'Team PA (Pennsylvania Growth Partnership)',
      amount:      12194.62,
      currency:    'USD',
      description: 'Transportation, lodging, and hospitality for governor to attend various events in official capacity, including Phillies games and other sporting events, for the benefit of the Commonwealth to promote Pennsylvania and its economic interests.',
      source_url:  'https://whyy.org/articles/pennsylvania-governor-josh-shapiro-team-pennsylvania-phillies-penn-state-harrisburg-senators/',
    },
  ],
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. 2023 SFI data confirmed (real estate: none, business interests: none, ' +
  'gifts: Team PA $12,194.62). 2024 salary confirmed from public pay schedule ($237,679). ' +
  '2024 SFI (filed May 1, 2025, covering calendar year 2024) is not currently accessible: ' +
  'the Pennsylvania State Ethics Commission\'s document server (ethicsrulings.pa.gov) has ' +
  'no DNS record as of May 2026 following pa.gov consolidation. The SFI search tool on ' +
  'pa.gov/agencies/ethics still references ethicsrulings.pa.gov as its backend. ' +
  'Note: PA SFI is significantly less stringent than federal disclosure — no stock holdings, ' +
  'investment portfolios, or asset values are required to be disclosed under state law.';

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
  console.log('\n[US-PA Shapiro Transparency Patch]');
  console.log('Source: PA Ethics SFI | 2023 SFI confirmed | 2024 SFI access gap\n');

  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  amount:   $' + SALARY.amount.toLocaleString());
  console.log('  source:   ' + SALARY.source);
  console.log('  period:   ' + SALARY.period);

  console.log('\nreal_estate_interests: none declared (2023 SFI)');
  console.log('business_interests:    none declared (2023 SFI)');

  console.log('\ngifts (' + GIFTS.items.length + ' item, 2023 SFI):');
  for (const g of GIFTS.items)
    console.log('  - ' + g.source + ': $' + g.amount.toLocaleString() + ' (' + g.description.substring(0, 60) + '...)');

  console.log('\ndata_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 100) + '...');
  console.log('status: filed | filing_year: 2023 (confirmed) / 2024 (access gap)');
}

async function main() {
  console.log('\n[us-pa-shapiro] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-pa-shapiro] DRY RUN — no writes.');
    console.log('[us-pa-shapiro] To apply: node tmp_us_pa_shapiro_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-PA').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                 SALARY,
      real_estate_interests:  REAL_ESTATE_INTERESTS,
      business_interests:     BUSINESS_INTERESTS,
      gifts:                  GIFTS,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      source_url:             SOURCE_URL_2023,
      status:                 'filed',
      filing_year:            2023,
      filing_year_note:       '2023 SFI confirmed; 2024 SFI inaccessible (ethicsrulings.pa.gov DNS failure)',
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-pa-shapiro] ✅ subnational_leader_transparency/US-PA updated.');
  console.log('[us-pa-shapiro] Done.');
}

main().catch(e => { console.error('[us-pa-shapiro] Fatal:', e.message); process.exit(1); });
