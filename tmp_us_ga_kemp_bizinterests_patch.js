'use strict';
/**
 * tmp_us_ga_kemp_bizinterests_patch.js
 *
 * Adds business_interests (6 entities + 2 divested) and data_note
 * to subnational_leader_transparency/US-GA for Governor Brian Kemp.
 *
 * Source: 2022 PFDS (Georgia GTCFC, election year, filed March 18, 2022).
 * Entity names confirmed from AJC (March 2022) and Axios Atlanta (October 2022).
 * Georgia PFDS requires: entity name, address, principal activity.
 * Dollar values (where present) voluntarily reported or confirmed from news.
 *
 * data_note: ethics.ga.gov portal down per H.B. 199 (2023 Act).
 *
 * Merge only. All other fields untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL_AJC   = 'https://www.ajc.com/politics/politics-blog/kemps-net-worth-grew-by-more-than-3m-since-he-took-office/NRKH5VWHLJFXVGEDCD3WTWXBPE/';
const SOURCE_URL_AXIOS = 'https://www.axios.com/local/atlanta/2022/10/21/the-making-of-brian-kemp';

// ─── Business interests ───────────────────────────────────────────────────────
const BUSINESS_INTERESTS = {
  period:      'Election year 2022 (most recent with entity values)',
  source_url:  SOURCE_URL_AJC,
  filing_year: 2022,
  fetched_at:  NOW,
  notes:       'From 2022 PFDS (filed March 18 2022). Georgia PFDS requires entity name, address, and principal activity per OCGA § 21-5-50. ~dozen entities total. Non-election-year annual filings (2023–2025) disclose entity names only — portal (media.ethics.ga.gov) currently unavailable (H.B. 199).',
  entities: [
    {
      name:        'Orderite, Inc.',
      description: 'Business entity disclosed on 2022 PFDS.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'S.C. Partners, LLC',
      description: 'Business entity disclosed on 2022 PFDS.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'Suncrest Stone, Inc.',
      description: 'Commercial stone supply yard, Hoschton, Georgia.',
      value:       420000,
      currency:    'USD',
      filing_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
    {
      name:        'Row crop farm entity, Colombia',
      description: 'Corn and soybean row crop farm in Colombia. Exact entity name not confirmed in public reporting.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Directional drilling company',
      description: 'Co-owned with Charles Harper; lays utilities. Exact entity name not confirmed in public reporting.',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Rental property LLCs (multiple)',
      description: 'Nearly half of ~dozen disclosed entities are rental property LLCs, including two residential complexes near University of Georgia in Athens.',
      count_approx: '~5–6',
      filing_year: 2022,
      source_url:  SOURCE_URL_AXIOS,
    },
  ],
  divested: [
    {
      name:        'First Madison Bank & Trust',
      description: '8% ownership stake. Sold 2019 when bank was acquired. Kemp profited from the sale.',
      sold_year:   2019,
      source_url:  SOURCE_URL_AXIOS,
    },
    {
      name:        'Hart AgStrong',
      description: 'Agricultural input/supply company. Divested ~2022. Generated ~$730,000 income 2019–2021 from this entity, offsetting earlier losses of $175,000 (2017–2018). 2022 PFDS listed with no current value; campaign confirmed Kemp no longer owned it at time of filing.',
      income_2019_2021_approx: 730000,
      currency:    'USD',
      divested_year: 2022,
      source_url:  SOURCE_URL_AJC,
    },
  ],
};

// ─── Data note ────────────────────────────────────────────────────────────────
const DATA_NOTE =
  'AJC and Axios Atlanta reporting (2022) confirmed ~dozen business entities on the ' +
  '2022 PFDS. Georgia OCGA § 21-5-50 requires disclosure of entity names, addresses, ' +
  'and principal activities — but does NOT require disclosure of income or asset values ' +
  'for most items in non-election years. The Georgia State Ethics Commission search ' +
  'portal (media.ethics.ga.gov) is currently unavailable as the agency addresses changes ' +
  'needed to implement H.B. 199 (2023 Georgia Act). Annual non-election-year filings ' +
  '(2023, 2024, 2025) are on file but inaccessible. EFile system (2022–2025) is login-only. ' +
  'Three PFDS PDF IDs retrieved (F200600008637099, F20060000867451, F200600008639424) ' +
  'but unreadable from automated environment.';

function print() {
  console.log('\n[US-GA Kemp Business Interests Patch]');
  console.log('Adds business_interests (6 entities, 2 divested) and data_note\n');

  console.log('business_interests (' + BUSINESS_INTERESTS.entities.length + ' entities):');
  for (const e of BUSINESS_INTERESTS.entities) {
    const val = e.value ? ' ($' + e.value.toLocaleString() + ')' : '';
    console.log('  - ' + e.name + val + ' (FY' + e.filing_year + ')');
  }

  console.log('\ndivested (' + BUSINESS_INTERESTS.divested.length + '):');
  for (const d of BUSINESS_INTERESTS.divested) {
    const inc = d.income_2019_2021_approx
      ? ' (~$' + (d.income_2019_2021_approx / 1e6).toFixed(1) + 'M income 2019–2021)'
      : '';
    console.log('  - ' + d.name + inc + ' (sold/divested ' + (d.sold_year || d.divested_year) + ')');
  }

  console.log('\ndata_note: ' + DATA_NOTE.substring(0, 110) + '...');
}

async function main() {
  console.log('\n[us-ga-kemp-biz] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-ga-kemp-biz] DRY RUN — no writes.');
    console.log('[us-ga-kemp-biz] To apply: node tmp_us_ga_kemp_bizinterests_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-GA').set(
    {
      business_interests: BUSINESS_INTERESTS,
      data_note:          DATA_NOTE,
      last_updated:       NOW,
    },
    { merge: true }
  );

  console.log('\n[us-ga-kemp-biz] ✅ subnational_leader_transparency/US-GA updated.');
  console.log('[us-ga-kemp-biz] Done.');
}

main().catch(e => { console.error('[us-ga-kemp-biz] Fatal:', e.message); process.exit(1); });
