'use strict';
/**
 * tmp_us_ga_kemp_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-GA
 * with confirmed facts for Governor Brian Kemp.
 *
 * Primary source:
 *   Georgia Government Transparency and Campaign Finance Commission (GTCFC)
 *   (now: Georgia State Ethics Commission)
 *   https://ethics.ga.gov/personal-financial-disclosure-report/
 *   Personal Financial Disclosure Statements filed under OCGA § 21-5-50.
 *
 *   NOTE: media.ethics.ga.gov search portal is currently DOWN ("The Personal Financial
 *   Search site is currently unavailable as the agency addresses changes needed to
 *   implement H.B. 199."). EFile system (2022–2025) is login-only. Three PDF IDs
 *   retrieved (F200600008637099, F20060000867451, F200600008639424) but unreadable
 *   from this environment (binary; pdftoppm not installed).
 *
 * Georgia disclosure law — OCGA § 21-5-50:
 *   Election-year candidates AND sitting public officers file a comprehensive PFDS
 *   disclosing income, assets, liabilities, business interests, real estate, and
 *   fiduciary positions with specific dollar values.
 *   Non-election-year sitting officers (OCGA § 21-5-50(a)) file an annual statement
 *   by July 1 identifying: honoraria from official duties, fiduciary positions, and
 *   names/addresses/principal activities of business entities/investments — but are
 *   NOT required to disclose dollar values for most items.
 *
 * Most recent comprehensive filing: 2022 (election year; Kemp ran for re-election).
 * Confirmed from AJC (March 18, 2022) and Axios Atlanta (October 21, 2022).
 * Non-election-year filings 2023, 2024, 2025 filed annually per OCGA § 21-5-50(a)
 * but portal inaccessible; specific values unverifiable.
 *
 * Salary source:
 *   Georgia governor statutory salary confirmed at $175,000/year per public record
 *   and multiple corroborating sources (Finbold, Axios).
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL      = 'https://ethics.ga.gov/personal-financial-disclosure-report/';
const SOURCE_URL_AJC  = 'https://www.ajc.com/politics/politics-blog/kemps-net-worth-grew-by-more-than-3m-since-he-took-office/NRKH5VWHLJFXVGEDCD3WTWXBPE/';
const SOURCE_URL_AXIOS = 'https://www.axios.com/local/atlanta/2022/10/21/the-making-of-brian-kemp';

// ─── Salary ──────────────────────────────────────────────────────────────────
// Georgia governor statutory salary. Publicly reported; does not change annually.
const SALARY = {
  amount:     175000,
  currency:   'USD',
  period:     'Calendar year 2024',
  source:     'State of Georgia',
  source_url: 'https://ethics.ga.gov/personal-financial-disclosure-report/',
  notes:      'Georgia governor statutory salary $175,000/year. Confirmed from public reporting (Axios Atlanta, Finbold). OCGA § 45-7-4 sets governor salary.',
  fetched_at: NOW,
};

// ─── Net worth summary ────────────────────────────────────────────────────────
// From 2022 comprehensive PFDS (election year, filed March 18, 2022).
// Most recent filing with full asset/liability values.
const NET_WORTH = {
  period:      'Election year 2022 (most recent comprehensive filing)',
  source_url:  SOURCE_URL_AJC,
  filing_year: 2022,
  fetched_at:  NOW,
  total_assets_approx:      8800000,
  total_liabilities_approx: 180000,
  net_worth_approx:         8600000,
  net_worth_2018:           5200000,
  currency:    'USD',
  notes:       'From 2022 PFDS (election year, filed March 18 2022). Net worth grew ~$3.4M since 2018 filing ($5.2M). Election-year comprehensive filings required under OCGA § 21-5-50 — non-election-year filings (2023, 2024, 2025) disclose entity names only, no dollar values.',
};

// ─── Real estate ─────────────────────────────────────────────────────────────
// From 2022 PFDS. Real estate total over $4.6M. Athens primary residence $675,000.
// Multiple rental properties disclosed; individual non-Athens values not itemized
// in public news reporting.
const REAL_ESTATE = {
  period:      'Election year 2022',
  source_url:  SOURCE_URL_AJC,
  filing_year: 2022,
  fetched_at:  NOW,
  total_approx: 4600000,
  currency:    'USD',
  notes:       'Real estate total over $4.6M from 2022 PFDS. Nearly half of ~dozen business entities are rental property LLCs, including two residential complexes near University of Georgia in Athens. Liabilities: ~$180,000 in real estate mortgages (down from ~$4M in 2017).',
  properties: [
    {
      description: 'Primary residence, Athens, Georgia',
      value:       675000,
      currency:    'USD',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
  ],
};

// ─── Business interests ───────────────────────────────────────────────────────
// Named entities from 2022 PFDS (confirmed from AJC/Axios). ~dozen total.
// Non-election-year filings (2023–2025) require entity names only; no dollar values.
// Georgia PFDS requires: name, address, principal activity of each entity.
// Divested: First Madison Bank & Trust 8% stake (sold 2019 when bank acquired);
//            Hart AgStrong stake (divested ~2022; generated ~$730,000 income 2019–2021).
const BUSINESS_INTERESTS = {
  period:      'Election year 2022 (most recent with entity values)',
  source_url:  SOURCE_URL_AJC,
  filing_year: 2022,
  fetched_at:  NOW,
  notes:       'From 2022 PFDS. Georgia PFDS requires entity name, address, and principal activity. ~dozen entities disclosed. Nearly half are rental property LLCs. Non-election-year filings (2023–2025) disclose entity names only — portal (media.ethics.ga.gov) currently unavailable (H.B. 199). Previously divested: First Madison Bank & Trust 8% stake (sold 2019) and Hart AgStrong (divested ~2022; ~$730,000 income 2019–2021).',
  entities: [
    {
      name:        'Orderite, Inc.',
      description: 'Business entity disclosed on PFDS.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'S.C. Partners, LLC',
      description: 'Business entity disclosed on PFDS.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'Suncrest Stone, Inc.',
      description: 'Commercial stone supply yard, Hoschton, Georgia. ~$420,000 stake (2022 PFDS).',
      value:       420000,
      currency:    'USD',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'Row crop farm entity, Colombia',
      description: 'Corn and soybean row crop farm. Exact entity name from PFDS not confirmed in news reporting.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Directional drilling company',
      description: 'Co-owned with Charles Harper; lays utilities. Exact entity name from PFDS not confirmed in news reporting.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Rental property LLCs (multiple)',
      description: 'Nearly half of ~dozen disclosed entities are rental property LLCs, including two residential complexes near UGA in Athens.',
      count_approx: '~5–6',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
  ],
  divested: [
    {
      name:        'First Madison Bank & Trust',
      description: '8% ownership stake. Sold 2019 when bank was acquired. Kemp profited from sale.',
      sold_year:   2019,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Hart AgStrong',
      description: 'Agricultural input/supply company. Divested ~2022. Kemp earned ~$730,000 in income 2019–2021 from this entity, offsetting earlier losses. Disclosed on PFDS with no current value (campaign stated he no longer owns it as of 2022 filing).',
      income_2019_2021_approx: 730000,
      currency:    'USD',
      divested_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
  ],
};

// ─── Cash / liquid assets ─────────────────────────────────────────────────────
const CASH = {
  period:      'Election year 2022',
  source_url:  SOURCE_URL_AJC,
  filing_year: 2022,
  fetched_at:  NOW,
  amount:      270000,
  currency:    'USD',
  notes:       'Cash holdings from 2022 PFDS.',
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. Most recent comprehensive filing is 2022 PFDS (election year, filed March 18, ' +
  '2022, covering period ending 2021). Confirmed: net worth ~$8.6M, assets ~$8.8M, ' +
  'real estate >$4.6M (Athens primary residence $675,000), liabilities ~$180,000, ' +
  'business interests ~dozen entities including Orderite Inc., S.C. Partners LLC, ' +
  'Suncrest Stone Inc. (~$420,000), row crop farm, directional drilling company, ' +
  'multiple rental property LLCs. ' +
  'Non-election-year annual filings (2023, 2024, 2025) filed per OCGA § 21-5-50(a) by ' +
  'July 1 of each year — but these filings disclose entity names and principal activities ' +
  'only, with no dollar values required. ' +
  'Georgia State Ethics Commission search portal (media.ethics.ga.gov) currently ' +
  'unavailable due to H.B. 199 implementation. EFile system (2022–2025) is login-only. ' +
  'Three PFDS PDFs retrieved (pdfIDs F200600008637099, F20060000867451, F200600008639424) ' +
  'but unreadable from automated environment (binary; PDF renderer unavailable). ' +
  'Governor salary $175,000/year confirmed from public record.';

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
  console.log('\n[US-GA Kemp Transparency Patch]');
  console.log('Source: Georgia GTCFC PFDS | 2022 election-year filing confirmed | portal DOWN (H.B. 199)\n');

  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  amount:  $' + SALARY.amount.toLocaleString());
  console.log('  source:  ' + SALARY.source);
  console.log('  period:  ' + SALARY.period);

  console.log('\nnet_worth (2022 PFDS, most recent comprehensive):');
  console.log('  total_assets:      ~$' + (NET_WORTH.total_assets_approx / 1e6).toFixed(1) + 'M');
  console.log('  total_liabilities: ~$' + NET_WORTH.total_liabilities_approx.toLocaleString());
  console.log('  net_worth:         ~$' + (NET_WORTH.net_worth_approx / 1e6).toFixed(1) + 'M');
  console.log('  net_worth_2018:    ~$' + (NET_WORTH.net_worth_2018 / 1e6).toFixed(1) + 'M (growth: +$3.4M)');

  console.log('\nreal_estate (' + REAL_ESTATE.properties.length + ' named property, total >$4.6M):');
  for (const p of REAL_ESTATE.properties)
    console.log('  - ' + p.description + ': $' + p.value.toLocaleString() + ' (FY' + p.filing_year + ')');
  console.log('  + multiple rental property LLCs (totaling >$4.6M combined)');

  console.log('\nbusiness_interests (' + BUSINESS_INTERESTS.entities.length + ' entities):');
  for (const e of BUSINESS_INTERESTS.entities)
    console.log('  - ' + e.name + (e.value ? ' ($' + e.value.toLocaleString() + ')' : '') + ' (FY' + e.filing_year + ')');
  console.log('  divested (' + BUSINESS_INTERESTS.divested.length + '): ' +
    BUSINESS_INTERESTS.divested.map(d => d.name).join(', '));

  console.log('\ncash: $' + CASH.amount.toLocaleString() + ' (2022 PFDS)');

  console.log('\nPDF IDs retrieved (unreadable — binary, portal DOWN):');
  console.log('  F200600008637099, F20060000867451, F200600008639424');

  console.log('\nAccess gaps:');
  console.log('  - ethics.ga.gov search portal DOWN (H.B. 199)');
  console.log('  - Non-election filings (2023, 2024, 2025): entity names only, no dollar values');
  console.log('  - EFile system (2022-2025): login-only');

  console.log('\ndata_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 120) + '...');
  console.log('\nregulatory_body: Georgia State Ethics Commission');
  console.log('regulatory_act:  OCGA § 21-5-50');
  console.log('status: filed | filing_year: 2022 (comprehensive) / 2023–2025 (names only)');
}

async function main() {
  console.log('\n[us-ga-kemp] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-ga-kemp] DRY RUN — no writes.');
    console.log('[us-ga-kemp] To apply: node tmp_us_ga_kemp_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-GA').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                 SALARY,
      net_worth:              NET_WORTH,
      real_estate:            REAL_ESTATE,
      business_interests:     BUSINESS_INTERESTS,
      cash:                   CASH,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      source_url:             SOURCE_URL,
      regulatory_body:        'Georgia State Ethics Commission',
      regulatory_act:         'Georgia OCGA § 21-5-50',
      status:                 'filed',
      filing_year:            2022,
      filing_note:            'Most recent comprehensive PFDS: 2022 (election year, filed March 18 2022). Non-election-year annual filings (2023–2025) per OCGA § 21-5-50(a) disclose entity names/activities only — no dollar values. Portal unavailable (H.B. 199).',
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-ga-kemp] ✅ subnational_leader_transparency/US-GA updated.');
  console.log('[us-ga-kemp] Done.');
}

main().catch(e => { console.error('[us-ga-kemp] Fatal:', e.message); process.exit(1); });
