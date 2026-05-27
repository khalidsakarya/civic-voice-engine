'use strict';
/**
 * tmp_us_il_pritzker_q2_patch.js
 *
 * Adds Q2 capital gains sales detail to subnational_leader_transparency/US-IL.
 * Data from the 2025 Illinois SEI (year 2025, covering calendar year 2024),
 * filed 2025-04-30 with the Illinois Secretary of State.
 *
 * Illinois SEI Q2 lists entity names and sale dates only — no dollar values.
 *
 * Merge only — all other fields untouched.
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL = 'https://apps.ilsos.gov/economicinterest/';

// ─── Q2: Capital gains sales — assets sold during calendar year 2024 ─────────
// Each entry: entity name + sale date. No dollar values per Illinois SEI rules.
//
// Specific-date sales:
//   Alphabet Inc.              sold 2024-12-19
//   Echo Street GoodCo Select LP  sold 2024-06-03, 2024-08-23, 2024-10-31
//   Merrick Ventures LLC       sold 2024-05-31
//
// Year-end batch (30+ entities sold 2024-12-31; 17 names confirmed, remainder
// on file with ILSOS but not individually enumerated in this record):
const SALES = [
  // ── Specific-date disposals ─────────────────────────────────────────────
  { entity: 'Alphabet Inc.',                  date_sold: '2024-12-19' },
  { entity: 'Echo Street GoodCo Select LP',   date_sold: '2024-06-03' },
  { entity: 'Echo Street GoodCo Select LP',   date_sold: '2024-08-23' },
  { entity: 'Echo Street GoodCo Select LP',   date_sold: '2024-10-31' },
  { entity: 'Merrick Ventures LLC',           date_sold: '2024-05-31' },

  // ── Year-end batch (2024-12-31) — 17 of 30+ confirmed ────────────────
  { entity: '3L Capital I AIV B',                    date_sold: '2024-12-31' },
  { entity: 'AG Direct Lending IV',                  date_sold: '2024-12-31' },
  { entity: 'AIC Innovations',                       date_sold: '2024-12-31' },
  { entity: 'Anchorage Illiquid Opportunities V',    date_sold: '2024-12-31' },
  { entity: 'Augmentir',                             date_sold: '2024-12-31' },
  { entity: 'Aurorium Global',                       date_sold: '2024-12-31' },
  { entity: 'BACH APP',                              date_sold: '2024-12-31' },
  { entity: 'BlackRock European Hedge Fund',         date_sold: '2024-12-31' },
  { entity: 'CH Guenther',                           date_sold: '2024-12-31' },
  { entity: 'Camber Capital',                        date_sold: '2024-12-31' },
  { entity: 'CC-Development',                        date_sold: '2024-12-31' },
  { entity: 'Cedar Street',                          date_sold: '2024-12-31' },
  { entity: 'Crestview Partners II',                 date_sold: '2024-12-31' },
  { entity: 'Davidson Kempner VI',                   date_sold: '2024-12-31' },
  { entity: 'Deerfield Partners',                    date_sold: '2024-12-31' },
  { entity: 'Excelerate Holdings',                   date_sold: '2024-12-31' },
  { entity: 'Key Trends 15',                         date_sold: '2024-12-31' },
];

const CAPITAL_GAINS_SALES = {
  period:       'Calendar year 2024',
  source_url:   SOURCE_URL,
  filing_year:  2025,
  fetched_at:   NOW,
  sei_question: 'Q2',
  notes:        'Illinois SEI lists entity names and sale dates only — no dollar values. Year-end batch (2024-12-31) contains 30+ entities; 17 names confirmed above, remainder on file with ILSOS.',
  sales_confirmed: SALES.length,
  batch_dec31_total: '30+',
  sales: SALES,
};

function print() {
  console.log('\n[US-IL Pritzker Q2 Capital Gains Patch]');
  console.log('Source: ILSOS SEI 2025 | Filed: 2025-04-30\n');

  const byDate = {};
  for (const s of SALES) {
    byDate[s.date_sold] = byDate[s.date_sold] || [];
    byDate[s.date_sold].push(s.entity);
  }
  for (const [date, entities] of Object.entries(byDate).sort()) {
    console.log('  ' + date + ' (' + entities.length + ' sale' + (entities.length > 1 ? 's' : '') + '):');
    for (const e of entities) console.log('    - ' + e);
  }
  console.log('\nTotal entries: ' + SALES.length + ' confirmed (2024-12-31 batch is 30+ total)');
}

async function main() {
  console.log('\n[us-il-pritzker-q2] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-il-pritzker-q2] DRY RUN — no writes.');
    console.log('[us-il-pritzker-q2] To apply: node tmp_us_il_pritzker_q2_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-IL').set(
    {
      capital_gains_sales: CAPITAL_GAINS_SALES,
      last_updated:        NOW,
    },
    { merge: true }
  );

  console.log('\n[us-il-pritzker-q2] ✅ subnational_leader_transparency/US-IL updated.');
  console.log('[us-il-pritzker-q2] Done.');
}

main().catch(e => { console.error('[us-il-pritzker-q2] Fatal:', e.message); process.exit(1); });
