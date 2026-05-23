'use strict';
/**
 * tmp_ca_on_jurisdiction_patch.js
 *
 * Merges cabinet, legislature_seats, and contact_info fields into
 * existing Ontario subnational documents. No new collections. Merge only.
 *
 * Sources:
 *   cabinet          — ontario.ca/page/meet-premiers-team (fetched 2026-05-23)
 *   legislature_seats — ola.org/en/members/current (fetched 2026-05-23)
 *   contact_info     — ola.org/en/members/all/doug-ford + ontario.ca/page/premier (fetched 2026-05-23)
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

// ─── 1. Cabinet ───────────────────────────────────────────────────────────────
// Source: ontario.ca/page/meet-premiers-team (2026-05-23)
// 28 full ministers (Premier listed separately in subnational_jurisdictions leader fields)
// 8 associate ministers included with role: 'associate_minister'

const CABINET = [
  // Premier
  { name: 'Doug Ford',               title: 'Premier of Ontario, Minister of Intergovernmental Affairs', role: 'premier' },

  // Full cabinet ministers
  { name: 'Sylvia Jones',            title: 'Deputy Premier, Minister of Health',                                                                              role: 'minister' },
  { name: 'Peter Bethlenfalvy',      title: 'Minister of Finance',                                                                                             role: 'minister' },
  { name: 'Paul Calandra',           title: 'Minister of Education',                                                                                           role: 'minister' },
  { name: 'Raymond Cho',             title: 'Minister for Seniors and Accessibility',                                                                           role: 'minister' },
  { name: 'Stan Cho',                title: 'Minister of Tourism, Culture and Gaming',                                                                          role: 'minister' },
  { name: 'Stephen Crawford',        title: 'Minister of Public and Business Service Delivery and Procurement',                                                 role: 'minister' },
  { name: 'Doug Downey',             title: 'Attorney General',                                                                                                 role: 'minister' },
  { name: 'Jill Dunlop',             title: 'Minister of Emergency Preparedness and Response',                                                                  role: 'minister' },
  { name: 'Vic Fedeli',              title: 'Minister of Economic Development, Job Creation and Trade',                                                         role: 'minister' },
  { name: 'Rob Flack',               title: 'Minister of Municipal Affairs and Housing',                                                                        role: 'minister' },
  { name: 'Mike Harris',             title: 'Minister of Natural Resources',                                                                                    role: 'minister' },
  { name: 'Trevor Jones',            title: 'Minister of Agriculture, Food and Agribusiness',                                                                   role: 'minister' },
  { name: 'Michael Kerzner',         title: 'Solicitor General',                                                                                               role: 'minister' },
  { name: 'Andrea Khanjin',          title: 'Minister of Red Tape Reduction',                                                                                  role: 'minister' },
  { name: 'Natalia Kusendova-Bashta', title: 'Minister of Long-Term Care',                                                                                     role: 'minister' },
  { name: 'Stephen Lecce',           title: 'Minister of Energy and Mines',                                                                                    role: 'minister' },
  { name: 'Neil Lumsden',            title: 'Minister of Sport',                                                                                               role: 'minister' },
  { name: 'Todd McCarthy',           title: 'Minister of the Environment, Conservation and Parks',                                                              role: 'minister' },
  { name: 'Graham McGregor',         title: 'Minister of Citizenship and Multiculturalism',                                                                     role: 'minister' },
  { name: 'Caroline Mulroney',       title: 'Minister of Francophone Affairs, President of the Treasury Board',                                                 role: 'minister' },
  { name: 'Michael Parsa',           title: 'Minister of Children, Community and Social Services',                                                              role: 'minister' },
  { name: 'David Piccini',           title: 'Minister of Labour, Immigration, Training and Skills Development',                                                 role: 'minister' },
  { name: 'George Pirie',            title: 'Minister of Northern Economic Development and Growth',                                                              role: 'minister' },
  { name: 'Nolan Quinn',             title: 'Minister of Colleges, Universities, Research Excellence and Security',                                              role: 'minister' },
  { name: 'Greg Rickford',           title: 'Minister of Indigenous Affairs and First Nations Economic Reconciliation, Minister Responsible for Ring of Fire Economic and Community Partnerships', role: 'minister' },
  { name: 'Prabmeet Sarkaria',       title: 'Minister of Transportation',                                                                                       role: 'minister' },
  { name: 'Kinga Surma',             title: 'Minister of Infrastructure',                                                                                       role: 'minister' },
  { name: 'Lisa Thompson',           title: 'Minister of Rural Affairs',                                                                                        role: 'minister' },

  // Associate ministers (portfolios not published on meet-premiers-team page)
  { name: 'Zee Hamid',               title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Kevin Holland',           title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Sam Oosterhoff',          title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Graydon Smith',           title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Nina Tangri',             title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Vijay Thanigasalam',      title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Michael Tibollo',         title: 'Associate Minister',  role: 'associate_minister' },
  { name: 'Charmaine Williams',      title: 'Associate Minister',  role: 'associate_minister' },
];

// ─── 2. Legislature seats ─────────────────────────────────────────────────────
// Source: ola.org/en/members/current (fetched 2026-05-23)

const LEGISLATURE_SEATS = {
  total: 124,
  vacant: 1,
  source_url:    'https://www.ola.org/en/members/current',
  fetched_at:    NOW,
  parties: [
    { name: 'Progressive Conservative Party of Ontario', short: 'PC',          seats: 79, governing: true  },
    { name: 'New Democratic Party of Ontario',           short: 'NDP',         seats: 26, governing: false },
    { name: 'Ontario Liberal Party',                     short: 'Liberal',      seats: 14, governing: false },
    { name: 'Green Party of Ontario',                    short: 'Green',        seats:  2, governing: false },
    { name: 'Independent',                               short: 'Independent',  seats:  2, governing: false },
  ],
};

// ─── 3. Contact info (subnational_leader_transparency/CA-ON) ─────────────────
// Sources:
//   offices      — ola.org/en/members/all/doug-ford (fetched 2026-05-23)
//   premier_office — ontario.ca/page/premier (fetched 2026-05-23)

const CONTACT_INFO = {
  source_url:  'https://www.ola.org/en/members/all/doug-ford',
  fetched_at:  NOW,
  offices: [
    {
      type:    'constituency',
      address: 'Unit 110, 964 Albion Rd., Etobicoke, ON M9V 1A7',
      phone:   '416-745-2859',
      fax:     '416-745-4601',
      email:   'doug.fordco@pc.ola.org',
      note:    'No general MPP email — constituency email only',
    },
    {
      type:    'legislative',
      address: 'Room 281, Main Legislative Building, Queen\'s Park, Toronto, ON M7A 1A5',
      phone:   '416-325-7635',
      fax:     '416-325-9895',
    },
    {
      type:    'ministry',
      name:    'Ministry of Intergovernmental Affairs',
      address: 'Room 223, Main Legislative Building, Queen\'s Park, 111 Wellesley St., Toronto, ON M7A 1A4',
      phone:   '416-325-1941',
    },
  ],
  premier_office: {
    email:   'premier@ontario.ca',
    phone:   '416-325-1941',
    tty:     '1-800-387-5559',
    mailing: 'Premier of Ontario, Legislative Building, Queen\'s Park, Toronto ON M7A 1A1',
    source:  'https://www.ontario.ca/page/premier',
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[ca-on-patch] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}\n`);

  // ── Report ─────────────────────────────────────────────────────────────────

  const fullMinisters = CABINET.filter(m => m.role === 'minister').length;
  const assocMinisters = CABINET.filter(m => m.role === 'associate_minister').length;

  console.log('[subnational_jurisdictions/CA-ON]');
  console.log(`  cabinet: ${CABINET.length} entries (1 premier + ${fullMinisters} ministers + ${assocMinisters} associate ministers)`);
  console.log(`  legislature_seats: ${LEGISLATURE_SEATS.total} total seats, ${LEGISLATURE_SEATS.parties.length} parties`);
  for (const p of LEGISLATURE_SEATS.parties) {
    console.log(`    ${p.short.padEnd(12)} ${p.seats} seats${p.governing ? ' (governing)' : ''}`);
  }
  console.log(`    Vacant         ${LEGISLATURE_SEATS.vacant}`);

  console.log('\n[subnational_leader_transparency/CA-ON]');
  console.log(`  contact_info: ${CONTACT_INFO.offices.length} offices`);
  for (const o of CONTACT_INFO.offices) {
    console.log(`    [${o.type}] ${o.address}`);
    if (o.phone) console.log(`      phone: ${o.phone}  fax: ${o.fax || '—'}`);
    if (o.email) console.log(`      email: ${o.email}`);
  }
  console.log(`  premier_office: email ${CONTACT_INFO.premier_office.email}  phone ${CONTACT_INFO.premier_office.phone}`);

  if (!WRITE_MODE) {
    console.log('\n[ca-on-patch] DRY RUN — no writes.');
    console.log('[ca-on-patch] To apply: node tmp_ca_on_jurisdiction_patch.js --write');
    return;
  }

  const db = getDb();

  // ── Write 1: subnational_jurisdictions/CA-ON ───────────────────────────────
  await db.collection('subnational_jurisdictions').doc('CA-ON').set(
    {
      cabinet:           CABINET,
      legislature_seats: LEGISLATURE_SEATS,
      last_updated:      NOW,
    },
    { merge: true }
  );
  console.log('\n[ca-on-patch] ✅ subnational_jurisdictions/CA-ON — cabinet + legislature_seats written');

  // ── Write 2: subnational_leader_transparency/CA-ON ────────────────────────
  await db.collection('subnational_leader_transparency').doc('CA-ON').set(
    {
      contact_info: CONTACT_INFO,
      last_updated: NOW,
    },
    { merge: true }
  );
  console.log('[ca-on-patch] ✅ subnational_leader_transparency/CA-ON — contact_info written');

  console.log('\n[ca-on-patch] Done.');
}

main().catch(e => { console.error('[ca-on-patch] Fatal:', e.message); process.exit(1); });
