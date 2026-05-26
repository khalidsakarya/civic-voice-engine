'use strict';
/**
 * tmp_us_ak_dunleavy_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-AK
 * with confirmed facts extracted from Governor Dunleavy's APOC Public Official
 * Financial Disclosure, Filing ID 33334, Report Year 2026 (period 01/01/2025–12/31/2025,
 * filed 03/05/2026).
 *
 * Source:
 *   Alaska Public Offices Commission (APOC) POFD
 *   https://aws.state.ak.us/ApocReports/Common/View.aspx?ID=33334&ViewType=POFD
 *   Note: APOC filing view is session-dependent (requires POST search flow via
 *   aws.state.ak.us/ApocReports/Paper/ to obtain WAF cookies before accessing View.aspx).
 *   Filer: Governor Michael J. Dunleavy
 *   Filed: 2026-03-05 | Report Year: 2026 | Period: 2025-01-01 to 2025-12-31
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL  = 'https://aws.state.ak.us/ApocReports/Common/View.aspx?ID=33334&ViewType=POFD';
const FILING_ID   = 33334;
const PERIOD_YEAR = 'Calendar year 2025';
const PERIOD_EOY  = 'As of December 31, 2025';

// ─── Income (5 items) ────────────────────────────────────────────────────────
const INCOME = {
  period:     PERIOD_YEAR,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  sources: [
    {
      owner:       'Filer',
      type:        'Salary',
      source:      'State of Alaska',
      description: 'Governor, full-time annual salary',
      range:       '$100,000 - $200,000',
    },
    {
      owner:  'Filer',
      type:   'Dividend or Interest',
      source: 'Alaska Permanent Fund',
      range:  '$1,000 - $2,000',
    },
    {
      owner:  'Spouse',
      type:   'Dividend or Interest',
      source: 'Alaska Permanent Fund',
      range:  '$1,000 - $2,000',
    },
    {
      owner:  'Filer',
      type:   'Dividend or Interest',
      source: 'Alaska Teacher Retirement',
      range:  '$50,000 - $100,000',
    },
    {
      owner:  'Spouse',
      type:   'Dividend or Interest',
      source: 'Nana Regional Corporation',
      range:  '$2,000 - $5,000',
    },
  ],
};

// ─── Gifts (18 items) ────────────────────────────────────────────────────────
const GIFTS = {
  period:     PERIOD_YEAR,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  items: [
    {
      recipient:   'Spouse',
      donor:       'Dr. Thabet Al Quaissieh, Al Sadeem Observatory, UAE',
      description: 'Tour + Vaonis Smart Telescope ($2,999)',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Sheikh Hamdan bin Zayed Al Nahyan, Abu Dhabi',
      description: 'Falconry hunting trip — helicopter ($5,000), houbara hunting ($700), rabbit ($800), camp ($1,430), food ($140), kandoura ($200), falconers kit ($150)',
      range:       '$5,000 - $10,000',
    },
    {
      recipient:   'Filer',
      donor:       'Mohamed Al Abbar, EMAAR Properties',
      description: 'Burj Khalifa observation deck + boat ride',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Adnan Kazim, Emirates Airline',
      description: 'Framed traditional Khanjar dagger',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Drew Richards, UAE Embassy DC',
      description: 'Dinner',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Mohamed Juma Al Shamisi, Abu Dhabi Ports Group',
      description: 'Traditional Khanjar dagger',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Truman Reed, Texas State Society DC',
      description: 'Black Tie and Boots Inaugural Ball ticket',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Beth Weldon, Mayor of Juneau',
      description: 'Legislative welcome gift bag + floral arrangement ($100)',
      range:       '$1,000 - $2,000',
    },
    {
      recipient:   'Filer',
      donor:       'Howard Lee, SeAH Steel',
      description: 'Foldable tabletop najeonchilgi mother-of-pearl lacquerware',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Alex Epstein, Center for Industrial Progress',
      description: 'Flights ($1,600.17) + lodging ($813.90) for Energy Freedom 2025',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Joe Bundrant, Trident Seafoods CEO',
      description: 'Luxury box suite, Bruins hockey game',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Alice Burns, Reagan Presidential Foundation',
      description: 'Lodging ($1,022.90) + airfare ($2,312.03)',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Prof. Michael Greenstone, University of Chicago',
      description: 'Flights ($2,387.59) + lodging ($1,017.87)',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Ronnie Urbanczyk, personal friend',
      description: 'Headlamp ($113) + hunting light ($299) + thermal camera ($2,999.99) + tripod ($172)',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Tara Gibb, Data Center World',
      description: 'Flights ($1,867.30) + lodging ($356.59)',
      range:       '$2,000 - $5,000',
    },
    {
      recipient:   'Filer',
      donor:       'Sam Fejes, Fejes Guide Service',
      description: 'Guided fall moose hunt (meals, lodging, transportation)',
      range:       '$20,000 - $50,000',
    },
    {
      recipient:   'Filer',
      donor:       'Maria Villegas, Afognak Native Corporation',
      description: 'Land use permit ($250) + elk endorsement fee ($700)',
      range:       '$250 - $1,000',
    },
    {
      recipient:   'Filer',
      donor:       'Carey Turner, Republican Governors Association',
      description: 'Flights ($2,297.70) + lodging ($1,993.12)',
      range:       '$2,000 - $5,000',
    },
  ],
};

// ─── Declared Assets / Interests (9 items) ───────────────────────────────────
const DECLARED_ASSETS = {
  period:     PERIOD_EOY,
  source_url: SOURCE_URL,
  filing_id:  FILING_ID,
  fetched_at: NOW,
  status:     'filed',
  interests: [
    {
      owner:       'Spouse',
      type:        'Business',
      description: 'Nana Regional Corporation',
      address:     '909 W 9th Ave, Anchorage, AK 99501',
      ownership:   'Stockholder',
    },
    {
      owner:       'Spouse',
      type:        'Business',
      description: 'Noorvik Tribe',
      address:     '203 Northwind Drive, Noorvik, AK 99763',
      ownership:   'Stockholder',
    },
    {
      owner:       'Filer and Spouse',
      type:        'Real Property',
      description: '7340 N King Fisher Lane, Wasilla, AK 99654',
      ownership:   'Fee Simple',
    },
    {
      owner:       'Filer',
      type:        'Beneficial',
      description: 'Legend Group',
      ownership:   '100% beneficial ownership',
    },
    {
      owner:       'Filer',
      type:        'Beneficial',
      description: 'Fidelity Group',
      ownership:   '100% beneficial ownership',
    },
    {
      owner:       'Filer',
      type:        'Beneficial',
      description: 'Vanguard Mutual Funds',
      ownership:   '100% beneficial ownership',
    },
    {
      owner:       'Filer',
      type:        'Beneficial',
      description: 'State of Alaska',
      ownership:   '100% beneficial ownership',
    },
    {
      owner:       'Filer',
      type:        'Beneficial',
      description: 'Schwab',
      ownership:   '100% beneficial ownership',
    },
    {
      owner:       'Spouse',
      type:        'Beneficial',
      description: 'Northern Trust',
      ownership:   '100% beneficial ownership',
    },
  ],
  notes: 'Beneficial ownership entries (Legend Group, Fidelity, Vanguard, State of Alaska, Schwab, Northern Trust) reflect investment/retirement account custodians — no individual securities listed.',
};

// ─── Liabilities ─────────────────────────────────────────────────────────────
const LIABILITIES = {
  period:      PERIOD_EOY,
  source_url:  SOURCE_URL,
  filing_id:   FILING_ID,
  fetched_at:  NOW,
  liabilities: [],
  notes:       'No liabilities declared.',
};

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
  console.log('\n[US-AK Dunleavy Transparency Patch]');
  console.log('Source: APOC POFD Filing ID', FILING_ID, '| Report Year 2026 | Period', PERIOD_YEAR);

  console.log('\nFields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nincome (' + INCOME.sources.length + ' items):');
  for (const s of INCOME.sources)
    console.log('  - [' + s.owner + '] ' + s.source + ' (' + s.type + '): ' + s.range);

  console.log('\ngifts (' + GIFTS.items.length + ' items):');
  for (const g of GIFTS.items)
    console.log('  - [' + g.recipient + '] ' + g.donor.split(',')[0] + ': ' + g.range);

  console.log('\ndeclared_assets (' + DECLARED_ASSETS.interests.length + ' interests):');
  for (const a of DECLARED_ASSETS.interests)
    console.log('  - [' + a.owner + '] ' + a.type + ': ' + a.description);

  console.log('\nliabilities: none declared');
  console.log('status: filed | filing_year: 2026');
}

async function main() {
  console.log('\n[us-ak-dunleavy] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-ak-dunleavy] DRY RUN — no writes.');
    console.log('[us-ak-dunleavy] To apply: node tmp_us_ak_dunleavy_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-AK').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      income:          INCOME,
      gifts:           GIFTS,
      declared_assets: DECLARED_ASSETS,
      liabilities:     LIABILITIES,
      source_url:      SOURCE_URL,
      status:          'filed',
      filing_year:     2026,
      last_updated:    NOW,
    },
    { merge: true }
  );

  console.log('\n[us-ak-dunleavy] ✅ subnational_leader_transparency/US-AK updated.');
  console.log('[us-ak-dunleavy] Done.');
}

main().catch(e => { console.error('[us-ak-dunleavy] Fatal:', e.message); process.exit(1); });
