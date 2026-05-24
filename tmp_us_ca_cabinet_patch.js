'use strict';
/**
 * tmp_us_ca_cabinet_patch.js
 *
 * Merges cabinet array into subnational_jurisdictions/US-CA.
 * No new collections. Merge only. Same schema as CA-ON.
 *
 * Source: gov.ca.gov/cabinet/ (fetched 2026-05-24)
 *   Governor: Gavin Newsom (D)
 *   18 cabinet members — secretaries heading state agencies and directors of
 *   senior offices within the Governor's administration.
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

// Source: gov.ca.gov/cabinet/ — fetched 2026-05-24
const CABINET = [
  // Agency Secretaries (heads of super-agencies — equivalent to senior ministers)
  { name: 'Tomiquia Moss',          title: 'Secretary, California Business, Consumer Services and Housing Agency',     role: 'cabinet_secretary' },
  { name: 'Jeffrey Macomber',       title: 'Secretary, California Department of Corrections and Rehabilitation',       role: 'cabinet_secretary' },
  { name: 'Yana Garcia',            title: 'Secretary, California Environmental Protection Agency',                    role: 'cabinet_secretary' },
  { name: 'Karen Ross',             title: 'Secretary, California Department of Food and Agriculture',                 role: 'cabinet_secretary' },
  { name: 'Nick Maduros',           title: 'Secretary, California Government Operations Agency',                       role: 'cabinet_secretary' },
  { name: 'Christina Snider-Ashtari', title: 'Secretary, California Governor\'s Office of Tribal Affairs',            role: 'cabinet_secretary' },
  { name: 'Kim Johnson',            title: 'Secretary, California Health and Human Services Agency',                   role: 'cabinet_secretary' },
  { name: 'Stewart Knox',           title: 'Secretary, California Labor and Workforce Development Agency',             role: 'cabinet_secretary' },
  { name: 'Wade Crowfoot',          title: 'Secretary, California Natural Resources Agency',                           role: 'cabinet_secretary' },
  { name: 'Toks Omishakin',         title: 'Secretary, California State Transportation Agency (CalSTA)',               role: 'cabinet_secretary' },
  { name: 'Lindsey Sin',            title: 'Secretary, California Department of Veterans Affairs (CalVet)',            role: 'cabinet_secretary' },

  // Agency/Office Directors and senior cabinet-level appointees
  { name: 'Joe Stephenshaw',        title: 'Director, California Department of Finance',                              role: 'agency_director' },
  { name: 'Dee Dee Myers',          title: 'Director, California Governor\'s Office of Business and Economic Development (GO-Biz)', role: 'agency_director' },
  { name: 'Nancy Ward',             title: 'Director, California Governor\'s Office of Emergency Services (Cal OES)',  role: 'agency_director' },
  { name: 'Samuel Assefa',          title: 'Director, California Governor\'s Office of Planning and Research (OPR)',   role: 'agency_director' },
  { name: 'Brooks Allen',           title: 'Executive Director, California State Board of Education',                  role: 'agency_director' },
  { name: 'Matthew Beevers',        title: 'Adjutant General, California Military Department',                         role: 'agency_director' },
  { name: 'Josh Fryday',            title: 'Chief Service Officer, California Volunteers',                             role: 'agency_director' },
];

async function main() {
  console.log(`\n[us-ca-cabinet] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}\n`);

  const secretaries = CABINET.filter(m => m.role === 'cabinet_secretary').length;
  const directors   = CABINET.filter(m => m.role === 'agency_director').length;

  console.log('[subnational_jurisdictions/US-CA]');
  console.log(`  cabinet: ${CABINET.length} members (${secretaries} cabinet secretaries + ${directors} agency directors)`);
  console.log('');
  for (const m of CABINET) {
    console.log(`  [${m.role}] ${m.name}`);
    console.log(`           ${m.title}`);
  }

  if (!WRITE_MODE) {
    console.log('\n[us-ca-cabinet] DRY RUN — no writes.');
    console.log('[us-ca-cabinet] To apply: node tmp_us_ca_cabinet_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_jurisdictions').doc('US-CA').set(
    { cabinet: CABINET, last_updated: NOW },
    { merge: true }
  );
  console.log('\n[us-ca-cabinet] ✅ subnational_jurisdictions/US-CA — cabinet written');
  console.log('[us-ca-cabinet] Done.');
}

main().catch(e => { console.error('[us-ca-cabinet] Fatal:', e.message); process.exit(1); });
