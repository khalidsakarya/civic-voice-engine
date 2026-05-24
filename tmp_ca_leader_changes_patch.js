'use strict';
/**
 * tmp_ca_leader_changes_patch.js
 *
 * Updates leader_name, leader_party, leader_source_url, and last_updated
 * on subnational_jurisdictions documents for 5 provinces with recent premier changes.
 * Merge only — no other fields touched.
 *
 * Changes:
 *   CA-QC — Christine Fréchette (CAQ), PM since 2026-04-15 (Legault resigned 2026-01-14)
 *   CA-YT — Currie Dixon (Yukon Party), since 2025 election (replaced Ranj Pillai)
 *   CA-NU — John Main (Independent/consensus), since 2025 election (replaced P.J. Akeeagok)
 *   CA-NL — Tony Wakeham (Progressive Conservative), since 2025-10-29 (replaced Andrew Furey)
 *   CA-PE — Rob Lantz (Progressive Conservative), since 2026-02-09 (replaced Dennis King → Bloyce Thompson interim)
 *
 * Sources (all fetched 2026-05-23):
 *   CA-QC: quebec.ca/en/premier + CBC "Fréchette ministry" Wikipedia
 *   CA-YT: yukon.ca/en/your-government/office-premier/meet-premiers-team
 *   CA-NU: premier.gov.nu.ca/en/home
 *   CA-NL: gov.nl.ca/exec
 *   CA-PE: princeedwardisland.ca/executive-council-office + CBC 2026-02-09
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const UPDATES = [
  {
    id:                'CA-QC',
    leader_name:       'Christine Fréchette',
    leader_party:      'Coalition Avenir Québec',
    leader_since:      '2026-04-15',
    leader_source_url: 'https://www.quebec.ca/en/premier',
  },
  {
    id:                'CA-YT',
    leader_name:       'Currie Dixon',
    leader_party:      'Yukon Party',
    leader_since:      '2024-12-03',
    leader_source_url: 'https://yukon.ca/en/your-government/office-premier/meet-premiers-team',
  },
  {
    id:                'CA-NU',
    leader_name:       'John Main',
    leader_party:      'Independent',
    leader_since:      '2025-11-17',
    leader_source_url: 'https://www.premier.gov.nu.ca/en/home',
  },
  {
    id:                'CA-NL',
    leader_name:       'Tony Wakeham',
    leader_party:      'Progressive Conservative',
    leader_since:      '2025-10-29',
    leader_source_url: 'https://www.gov.nl.ca/exec/',
  },
  {
    id:                'CA-PE',
    leader_name:       'Rob Lantz',
    leader_party:      'Progressive Conservative',
    leader_since:      '2026-02-09',
    leader_source_url: 'https://www.princeedwardisland.ca/en/information/executive-council-office',
  },
];

async function main() {
  console.log(`\n[ca-leader-changes] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}\n`);

  for (const u of UPDATES) {
    console.log(`[${u.id}]`);
    console.log(`  leader_name:       ${u.leader_name}`);
    console.log(`  leader_party:      ${u.leader_party}`);
    console.log(`  leader_since:      ${u.leader_since}`);
    console.log(`  leader_source_url: ${u.leader_source_url}`);
  }

  if (!WRITE_MODE) {
    console.log('\n[ca-leader-changes] DRY RUN — no writes.');
    console.log('[ca-leader-changes] To apply: node tmp_ca_leader_changes_patch.js --write');
    return;
  }

  const db = getDb();

  for (const u of UPDATES) {
    await db.collection('subnational_jurisdictions').doc(u.id).set(
      {
        leader_name:       u.leader_name,
        leader_party:      u.leader_party,
        leader_since:      u.leader_since,
        leader_source_url: u.leader_source_url,
        last_updated:      NOW,
      },
      { merge: true }
    );
    console.log(`[ca-leader-changes] ✅ subnational_jurisdictions/${u.id} updated`);
  }

  console.log('\n[ca-leader-changes] Done — 5 leader fields updated.');
}

main().catch(e => { console.error('[ca-leader-changes] Fatal:', e.message); process.exit(1); });
