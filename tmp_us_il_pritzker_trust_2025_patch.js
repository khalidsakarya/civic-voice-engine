'use strict';
/**
 * tmp_us_il_pritzker_trust_2025_patch.js
 *
 * Replaces blind_trust.holdings in subnational_leader_transparency/US-IL with
 * the confirmed 2025 SEI list (year 2025, filed 2025-04-30).
 *
 * Prior holdings list was derived from the 2022 BGA investigation (2019–2022
 * SEI filings). This patch supersedes it with the actual 2025 SEI disclosure.
 *
 * Source: Illinois Secretary of State SEI, year 2025
 *   https://apps.ilsos.gov/economicinterest/
 *   Illinois SEI lists entity names only — no dollar values per state law.
 *
 * Merge only — salary, income, declared_assets, Q2 fields untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL = 'https://apps.ilsos.gov/economicinterest/';
const SEI_NOTE   = 'Illinois SEI lists entity names only — no dollar values disclosed per state law.';

// ─── 2025 SEI confirmed public stock holdings ─────────────────────────────────
const PUBLIC_STOCK_HOLDINGS = [
  { entity: 'Apple Inc.',                    type: 'public_stock' },
  { entity: 'Amazon.com Inc.',               type: 'public_stock' },
  { entity: 'Alphabet Inc.',                 type: 'public_stock' },
  { entity: 'Berkshire Hathaway Inc.',       type: 'public_stock' },
  { entity: "McDonald's Corporation",        type: 'public_stock' },
  { entity: 'FedEx Corporation',             type: 'public_stock' },
  { entity: 'Meta Platforms Inc.',           type: 'public_stock' },
  { entity: 'The Walt Disney Company',       type: 'public_stock' },
  { entity: 'Kinder Morgan Inc.',            type: 'public_stock' },
  { entity: 'Procter & Gamble Co.',          type: 'public_stock' },
];

// ─── Blind trust — full 2025 replacement ─────────────────────────────────────
// Replaces the prior BGA-derived (2019–2022) holdings list entirely.
// holdings_sold is omitted — superseded by the actual 2025 SEI snapshot.
const BLIND_TRUST = {
  trustee:      'Northern Trust Company',
  established:  '2019-01',
  source_url:   SOURCE_URL,
  fetched_at:   NOW,
  holdings_as_of: '2025',
  notes: SEI_NOTE + ' Public stock holdings (10) confirmed from 2025 SEI. ' +
         '300+ private equity/LLC holdings also disclosed; entity names are ' +
         'on file with the Illinois Secretary of State but not individually ' +
         'enumerated here due to volume.',
  public_stock_holdings: PUBLIC_STOCK_HOLDINGS,
  private_equity_holdings: {
    count_approx: '300+',
    notes: '300+ private equity and LLC interests disclosed in the 2025 SEI. ' +
           'Entity names on file with ILSOS (year 2025, name Pritzker).',
  },
};

function print() {
  console.log('\n[US-IL Pritzker Blind Trust 2025 Patch]');
  console.log('Replaces BGA 2019–2022 derived list with confirmed 2025 SEI holdings.\n');
  console.log('public_stock_holdings (' + PUBLIC_STOCK_HOLDINGS.length + '):');
  for (const h of PUBLIC_STOCK_HOLDINGS) console.log('  - ' + h.entity);
  console.log('\nprivate_equity_holdings: ' + BLIND_TRUST.private_equity_holdings.count_approx + ' entities (not individually enumerated)');
  console.log('holdings_as_of: ' + BLIND_TRUST.holdings_as_of);
  console.log('holdings_sold: removed (superseded by 2025 snapshot)');
}

async function main() {
  console.log('\n[us-il-pritzker-trust-2025] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-il-pritzker-trust-2025] DRY RUN — no writes.');
    console.log('[us-il-pritzker-trust-2025] To apply: node tmp_us_il_pritzker_trust_2025_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-IL').set(
    {
      blind_trust:  BLIND_TRUST,
      last_updated: NOW,
    },
    { merge: true }
  );

  console.log('\n[us-il-pritzker-trust-2025] ✅ subnational_leader_transparency/US-IL updated.');
  console.log('[us-il-pritzker-trust-2025] Done.');
}

main().catch(e => { console.error('[us-il-pritzker-trust-2025] Fatal:', e.message); process.exit(1); });
