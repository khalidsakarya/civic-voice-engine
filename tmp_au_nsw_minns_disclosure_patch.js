'use strict';
/**
 * tmp_au_nsw_minns_disclosure_patch.js
 *
 * Replaces corrupted declared_assets and stock_holdings in
 * subnational_leader_transparency/AU-NSW with clean data extracted from the
 * NSW Parliament Register of Disclosures by Members of the Legislative Assembly.
 *
 * Data source:
 *   2023-24 Register (as at 30 June 2024), Volume 1
 *   https://www.parliament.nsw.gov.au/tp/files/189560/Register%20of%20Disclosures%20by%20Members%20of%20the%20Legislative%20Assembly%20as%20at%2030%20June%202024%20-%20Volume%201.pdf
 *   Pages 128–134 — confirmed as Minns via wife's name "Lara Crakanthorp" (page 134)
 *
 * Why 2023-24 not 2024-25:
 *   The 2024-25 Volume 1 PDF pages covering Minns (~pp 60–159) are image-scanned
 *   with no text layer — text extraction returns 0 items for all those pages.
 *   The 2023-24 register has digitally typed forms for the same member, fully readable.
 *
 * Also updates gifts_hospitality (Part 3 data recovered from same pages).
 * Merge only. DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();
const SOURCE_URL = 'https://www.parliament.nsw.gov.au/tp/files/189560/Register%20of%20Disclosures%20by%20Members%20of%20the%20Legislative%20Assembly%20as%20at%2030%20June%202024%20-%20Volume%201.pdf';
const PERIOD     = '1 July 2023 to 30 June 2024';

// ─── Declared assets (Parts 1, 5, 7) ────────────────────────────────────────
const DECLARED_ASSETS = {
  period: PERIOD,
  source_url: SOURCE_URL,
  fetched_at: NOW,

  real_property: [
    // Part 1 — Member's registered interest
    { address: 'Hamilton South NSW', interest: '½ owner' },
    { address: 'Darlinghurst NSW', interest: '½ owner', notes: 'Mortgage held with Commonwealth Bank / St George' },
  ],

  // Part 5 — Corporate interests
  corporate_interests: [
    {
      entity: 'Carson & Yvette P/L',
      role: 'Director',
      description: 'Company owns a warehouse at Laurio Place, Mayfield West NSW, which it leases out.',
      income_note: 'No income received from Carson & Yvette P/L during the ordinary return period.',
    },
  ],

  // Part 7 — Debts
  debts: [
    'Credit cards: St George Bank, Commonwealth Bank',
    'Mortgage on Darlinghurst property',
  ],

  // Part 10 — Voluntarily disclosed (wife's properties)
  voluntarily_disclosed: {
    note: 'Not required to disclose; voluntarily disclosed by Member.',
    wife_properties: {
      name: 'Lara Crakanthorp (wife)',
      properties: [
        { address: 'Hamilton South NSW', interest: '½ owner' },
        { address: 'Darlinghurst NSW', interest: '½ owner' },
        { address: 'Ground floor, 87 Darby St, Cooks Hill NSW', interest: '¼ owner' },
        { address: '2/87 Darby St, Cooks Hill NSW', interest: 'owner' },
        { address: '30 Broadmeadow Road, Broadmeadow NSW', interest: 'owner' },
      ],
    },
    parents_in_law_properties: {
      location_note: 'Multiple commercial and residential properties within Newcastle State Electorate suburbs: Carrington, Broadmeadow, Wickham, Mayfield West, Mayfield North, Newcastle West, and Merewether Heights.',
    },
  },

  extraction_notes: 'Data from 2023-24 register (digitally typed, fully readable). The 2024-25 register Volume 1 pages for this member are image-scanned with no text layer.',
};

// ─── Stock holdings (Part 2 + Part 5 shares) ────────────────────────────────
// No share investments disclosed. Only directorship in Carson & Yvette P/L
// (a private company; already captured in declared_assets.corporate_interests).
const STOCK_HOLDINGS = {
  period: PERIOD,
  source_url: SOURCE_URL,
  fetched_at: NOW,
  shares: [],
  notes: 'No share investments disclosed in 2023-24 ordinary return. Sole corporate interest is a directorship in Carson & Yvette P/L (private company, see declared_assets).',
};

// ─── Gifts and hospitality (Part 3) ─────────────────────────────────────────
const GIFTS_HOSPITALITY = {
  period: PERIOD,
  source_url: SOURCE_URL,
  fetched_at: NOW,
  gifts: [
    {
      description: "Tickets to Women's State of Origin 2024 at McDonald Jones Stadium, Newcastle",
      donor: 'NRL',
      donor_address: 'Central Driver Avenue, Moore Park NSW',
    },
    {
      description: 'Tickets to Newcastle Jets match at McDonald Jones Stadium, Newcastle',
      donor: 'Newcastle Jets FC',
      donor_address: '13 Park Road, Speers Point NSW 2284',
    },
    {
      description: 'Newcastle Airshow Tickets (complimentary)',
      donor: 'Williamtown RAAF Base / Fort Scratchley',
    },
    {
      description: 'Complimentary Membership of the Qantas Chairman\'s Lounge',
      donor: 'Qantas Airways',
      donor_address: '10 Bourke Road, Mascot NSW',
    },
  ],
};

function print() {
  console.log('\n[AU-NSW Minns Disclosure Patch]');
  console.log('\ndeclared_assets:');
  console.log('  real_property:', DECLARED_ASSETS.real_property.length, 'entries');
  for (const p of DECLARED_ASSETS.real_property) {
    console.log(`    - ${p.address} (${p.interest})`);
  }
  console.log('  corporate_interests:', DECLARED_ASSETS.corporate_interests.length, 'entries');
  for (const c of DECLARED_ASSETS.corporate_interests) {
    console.log(`    - ${c.entity} (${c.role})`);
  }
  console.log('  debts:', DECLARED_ASSETS.debts.length, 'entries');

  console.log('\nstock_holdings:');
  console.log(' ', STOCK_HOLDINGS.notes);

  console.log('\ngifts_hospitality:');
  for (const g of GIFTS_HOSPITALITY.gifts) {
    console.log(`  - ${g.description}`);
  }
}

async function main() {
  console.log(`\n[au-nsw-minns] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}`);
  print();

  if (!WRITE_MODE) {
    console.log('\n[au-nsw-minns] DRY RUN — no writes.');
    console.log('[au-nsw-minns] To apply: node tmp_au_nsw_minns_disclosure_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('AU-NSW').set(
    {
      declared_assets:   DECLARED_ASSETS,
      stock_holdings:    STOCK_HOLDINGS,
      gifts_hospitality: GIFTS_HOSPITALITY,
      last_updated:      NOW,
    },
    { merge: true }
  );
  console.log('\n[au-nsw-minns] ✅ subnational_leader_transparency/AU-NSW updated.');
  console.log('[au-nsw-minns] Done.');
}

main().catch(e => { console.error('[au-nsw-minns] Fatal:', e.message); process.exit(1); });
