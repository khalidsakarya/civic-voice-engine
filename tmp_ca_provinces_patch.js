'use strict';
/**
 * tmp_ca_provinces_patch.js
 *
 * Merges cabinet, legislature_seats, and contact_info into existing subnational
 * documents for 12 Canadian provinces/territories. No new collections. Merge only.
 * Follows same schema as tmp_ca_on_jurisdiction_patch.js.
 *
 * Sources: official government websites, fetched 2026-05-23
 *
 * ⚠ Leader changes not yet reflected in DB leader_name/party fields:
 *   CA-QC — François Legault resigned 2026-01-14; Christine Fréchette (CAQ) PM since 2026-04-15
 *   CA-YT — Ranj Pillai (Liberal) replaced by Currie Dixon (Yukon Party) after 2025 election
 *   CA-NU — P.J. Akeeagok replaced by John Main after 2025 election
 *   CA-NL — Andrew Furey (Liberal) replaced by Tony Wakeham (PC) after Oct 2025 election
 *   CA-PE — Dennis King (PC) resigned 2025; Rob Lantz (PC) PM since 2026-02-09
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

// ─── CA-BC (British Columbia) ──────────────────────────────────────────────
// Cabinet:     gov.bc.ca/cabinet-ministers (as of 2026-01-28, post July 2025 shuffle)
// Legislature: leg.bc.ca — 2024 general election, Oct 19 2024
// Contact:     gov.bc.ca/office-of-the-premier

const CA_BC_CABINET = [
  { name: 'David Eby',               title: 'Premier',                                                                         role: 'premier' },
  { name: 'Niki Sharma',             title: 'Attorney General and Deputy Premier',                                             role: 'minister' },
  { name: 'Lana Popham',             title: 'Minister of Agriculture and Food',                                                role: 'minister' },
  { name: 'Brittny Anderson',        title: 'Minister of State for Local Governments and Rural Communities',                   role: 'minister_of_state' },
  { name: 'Jodie Wickens',           title: 'Minister of Children and Family Development',                                    role: 'minister' },
  { name: 'Diana Gibson',            title: 'Minister of Citizens\' Services',                                                role: 'minister' },
  { name: 'Lisa Beare',              title: 'Minister of Education and Child Care',                                           role: 'minister' },
  { name: 'Kelly Greene',            title: 'Minister of Emergency Management and Climate Readiness',                         role: 'minister' },
  { name: 'Adrian Dix',              title: 'Minister of Energy and Climate Solutions; Minister responsible for Francophone Affairs', role: 'minister' },
  { name: 'Tamara Davidson',         title: 'Minister of Environment and Parks',                                              role: 'minister' },
  { name: 'Brenda Bailey',           title: 'Minister of Finance',                                                            role: 'minister' },
  { name: 'Ravi Parmar',             title: 'Minister of Forests',                                                            role: 'minister' },
  { name: 'Josie Osborne',           title: 'Minister of Health',                                                             role: 'minister' },
  { name: 'Christine Boyle',         title: 'Minister of Housing and Municipal Affairs',                                      role: 'minister' },
  { name: 'Spencer Chandra Herbert', title: 'Minister of Indigenous Relations and Reconciliation',                            role: 'minister' },
  { name: 'Bowinn Ma',               title: 'Minister of Infrastructure',                                                     role: 'minister' },
  { name: 'Ravi Kahlon',             title: 'Minister of Jobs and Economic Growth',                                           role: 'minister' },
  { name: 'Rick Glumac',             title: 'Minister of State for Artificial Intelligence and New Technologies',             role: 'minister_of_state' },
  { name: 'Jennifer Whiteside',      title: 'Minister of Labour',                                                             role: 'minister' },
  { name: 'Jagrup Brar',             title: 'Minister of Mining and Critical Minerals',                                       role: 'minister' },
  { name: 'Jessie Sunner',           title: 'Minister of Post-Secondary Education and Future Skills',                        role: 'minister' },
  { name: 'Nina Krieger',            title: 'Minister of Public Safety and Solicitor General',                               role: 'minister' },
  { name: 'Terry Yung',              title: 'Minister of State for Community Safety and Integrated Services',                 role: 'minister_of_state' },
  { name: 'Sheila Malcolmson',       title: 'Minister of Social Development and Poverty Reduction',                          role: 'minister' },
  { name: 'Anne Kang',               title: 'Minister of Tourism, Arts, Culture and Sport',                                  role: 'minister' },
  { name: 'Mike Farnworth',          title: 'Minister of Transportation and Transit',                                         role: 'minister' },
  { name: 'Randene Neill',           title: 'Minister of Water, Land and Resource Stewardship',                              role: 'minister' },
  { name: 'Grace Lore',              title: 'Minister without Portfolio',                                                     role: 'minister' },
];

const CA_BC_LEGISLATURE = {
  total: 93, vacant: 0,
  source_url: 'https://www.leg.bc.ca/members/current-party-standings',
  fetched_at: NOW,
  parties: [
    { name: 'BC New Democratic Party', short: 'NDP',          seats: 47, governing: true  },
    { name: 'BC Conservative Party',   short: 'Conservative', seats: 44, governing: false },
    { name: 'BC Green Party',          short: 'Green',        seats:  2, governing: false },
  ],
};

const CA_BC_CONTACT = {
  source_url: 'https://www2.gov.bc.ca/gov/content/governments/organizational-structure/office-of-the-premier',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'PO Box 9041 Stn Prov Govt, Victoria BC V8W 9E1', phone: '250-387-1715' },
  ],
  premier_office: {
    email:   'premier@gov.bc.ca',
    phone:   '250-387-1715',
    mailing: 'Office of the Premier, PO Box 9041 Stn Prov Govt, Victoria BC V8W 9E1',
    source:  'https://www2.gov.bc.ca/gov/content/governments/organizational-structure/office-of-the-premier',
  },
};

// ─── CA-AB (Alberta) ──────────────────────────────────────────────────────
// Cabinet:     alberta.ca/premier-cabinet (as of 2026-05-21 cabinet reshuffle)
// Legislature: 2023 general election, May 29 2023
// Contact:     alberta.ca/premier

const CA_AB_CABINET = [
  { name: 'Danielle Smith',      title: 'Premier; Minister of Intergovernmental and International Relations',           role: 'premier' },
  { name: 'Mike Ellis',          title: 'Deputy Premier; Minister of Public Safety and Emergency Services',             role: 'minister' },
  { name: 'Jason Nixon',         title: 'President of Treasury Board and Minister of Finance',                          role: 'minister' },
  { name: 'RJ Sigurdson',        title: 'Minister of Affordability and Utilities',                                      role: 'minister' },
  { name: 'Mickey Amery',        title: 'Minister of Justice and Deputy House Leader',                                  role: 'minister' },
  { name: 'Andrew Boitchenko',   title: 'Minister of Tourism and Sport',                                               role: 'minister' },
  { name: 'Devin Dreeshen',      title: 'Minister of Transportation and Economic Corridors',                            role: 'minister' },
  { name: 'Tanya Fir',           title: 'Minister of Arts, Culture and Status of Women',                               role: 'minister' },
  { name: 'Nate Glubish',        title: 'Minister of Technology and Innovation',                                        role: 'minister' },
  { name: 'Grant Hunter',        title: 'Minister of Environment and Protected Areas',                                  role: 'minister' },
  { name: 'Brian Jean',          title: 'Minister of Energy and Minerals',                                              role: 'minister' },
  { name: 'Adriana LaGrange',    title: 'Minister of Hospital and Surgical Health Services',                           role: 'minister' },
  { name: 'Justin Wright',       title: 'Minister of Primary and Preventative Health Services',                        role: 'minister' },
  { name: 'Todd Loewen',         title: 'Minister of Forestry and Parks',                                              role: 'minister' },
  { name: 'Martin Long',         title: 'Minister of Infrastructure',                                                   role: 'minister' },
  { name: 'Myles McDougall',     title: 'Minister of Advanced Education',                                              role: 'minister' },
  { name: 'Dale Nally',          title: 'Minister of Service Alberta and Red Tape Reduction',                          role: 'minister' },
  { name: 'Demetrios Nicolaides', title: 'Minister of Education and Childcare',                                        role: 'minister' },
  { name: 'Nathan Neudorf',      title: 'Minister of Assisted Living and Social Services',                              role: 'minister' },
  { name: 'Rajan Sawhney',       title: 'Minister of Indigenous Relations',                                             role: 'minister' },
  { name: 'Joseph Schow',        title: 'Minister of Jobs, Economy, Trade and Immigration',                            role: 'minister' },
  { name: 'Tara Sawyer',         title: 'Minister of Agriculture and Irrigation',                                      role: 'minister' },
  { name: 'Searle Turton',       title: 'Minister of Children and Family Services',                                    role: 'minister' },
  { name: 'Dan Williams',        title: 'Minister of Municipal Affairs',                                                role: 'minister' },
  { name: 'Rick Wilson',         title: 'Minister of Mental Health and Addiction',                                     role: 'minister' },
];

const CA_AB_LEGISLATURE = {
  total: 87, vacant: 0,
  source_url: 'https://www.assembly.ab.ca/members/members-of-the-legislative-assembly',
  fetched_at: NOW,
  parties: [
    { name: 'United Conservative Party', short: 'UCP', seats: 49, governing: true  },
    { name: 'New Democratic Party',       short: 'NDP', seats: 38, governing: false },
  ],
};

const CA_AB_CONTACT = {
  source_url: 'https://www.alberta.ca/premier',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: '9th Fl., Federal Building, 9820 107 St NW, Edmonton AB T5K 2B6', phone: '780-427-2711' },
  ],
  premier_office: {
    email:   'premier@gov.ab.ca',
    phone:   '780-427-2711',
    mailing: 'Office of the Premier, 9th Fl., Federal Building, 9820 107 St NW, Edmonton AB T5K 2B6',
    source:  'https://www.alberta.ca/premier',
  },
};

// ─── CA-SK (Saskatchewan) ──────────────────────────────────────────────────
// Cabinet:     saskatchewan.ca/government/government-structure/cabinet (Dec 2025 reshuffle)
// Legislature: 2024 general election, Oct 28 2024
// Contact:     saskatchewan.ca/premier-scott-moe

const CA_SK_CABINET = [
  { name: 'Scott Moe',         title: 'Premier; President of the Executive Council; Minister of Intergovernmental Affairs', role: 'premier' },
  { name: 'Jim Reiter',        title: 'Deputy Premier; Minister of Finance',                                                role: 'minister' },
  { name: 'David Marit',       title: 'Minister of Agriculture and Related Crown Corporations',                             role: 'minister' },
  { name: 'Jeremy Harrison',   title: 'Minister of Crown Investments Corporation and Commercial Entities',                  role: 'minister' },
  { name: 'Lori Carr',         title: 'Minister of Mental Health, Addictions, Seniors and Rural Health',                   role: 'minister' },
  { name: 'Everett Hindley',   title: 'Minister of Education',                                                              role: 'minister' },
  { name: 'Jeremy Cockrill',   title: 'Minister of Health',                                                                 role: 'minister' },
  { name: 'Tim McLeod',        title: 'Minister of Justice and Attorney General',                                           role: 'minister' },
  { name: 'Terry Jenson',      title: 'Minister of Social Services',                                                        role: 'minister' },
  { name: 'Ken Cheveldayoff',  title: 'Minister of Advanced Education and Labour Relations',                                role: 'minister' },
  { name: 'Warren Kaeding',    title: 'Minister of Trade and Export Development; Minister responsible for SLGA',            role: 'minister' },
  { name: 'Alana Ross',        title: 'Minister of Parks, Culture and Sport',                                               role: 'minister' },
  { name: 'Eric Schmalz',      title: 'Minister of Government Relations and Immigration',                                   role: 'minister' },
  { name: 'Chris Beaudry',     title: 'Minister of Energy and Resources',                                                   role: 'minister' },
  { name: 'Kim Gartner',       title: 'Minister of Highways',                                                               role: 'minister' },
  { name: 'Darlene Rowden',    title: 'Minister of Environment',                                                            role: 'minister' },
  { name: 'Michael Weger',     title: 'Minister of Community Safety',                                                       role: 'minister' },
  { name: 'Sean Wilson',       title: 'Minister of SaskBuilds and Procurement',                                             role: 'minister' },
];

const CA_SK_LEGISLATURE = {
  total: 61, vacant: 0,
  source_url: 'https://www.legassembly.sk.ca/mlas/current-mlas/',
  fetched_at: NOW,
  parties: [
    { name: 'Saskatchewan Party', short: 'Sask Party', seats: 34, governing: true  },
    { name: 'New Democratic Party', short: 'NDP',       seats: 27, governing: false },
  ],
};

const CA_SK_CONTACT = {
  source_url: 'https://www.saskatchewan.ca/government/government-structure/premier-scott-moe',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'Room 226, Legislative Building, 2405 Legislative Dr, Regina SK S4S 0B3', phone: '306-787-9433' },
  ],
  premier_office: {
    email:   'premier@gov.sk.ca',
    phone:   '306-787-9433',
    mailing: 'Office of the Premier, Room 226, Legislative Building, 2405 Legislative Dr, Regina SK S4S 0B3',
    source:  'https://www.saskatchewan.ca/government/government-structure/premier-scott-moe',
  },
};

// ─── CA-MB (Manitoba) ─────────────────────────────────────────────────────
// Cabinet:     gov.mb.ca/minister (as of Nov 2024 refresh)
// Legislature: 2023 general election, Oct 3 2023
// Contact:     gov.mb.ca/minister/premier

const CA_MB_CABINET = [
  { name: 'Wab Kinew',          title: 'Premier; Minister of Intergovernmental Affairs and International Relations; Minister responsible for Indigenous Reconciliation', role: 'premier' },
  { name: 'Uzoma Asagwara',     title: 'Deputy Premier; Minister of Health, Seniors and Long-Term Care',                                                                 role: 'minister' },
  { name: 'Ron Kostyshyn',      title: 'Minister of Agriculture',                                                                                                         role: 'minister' },
  { name: 'Matt Wiebe',         title: 'Minister of Justice and Attorney General; Keeper of the Great Seal; Minister responsible for Manitoba Public Insurance',          role: 'minister' },
  { name: 'Nahanni Fontaine',   title: 'Minister of Families; Minister responsible for Accessibility; Minister responsible for Gender Equity',                            role: 'minister' },
  { name: 'Bernadette Smith',   title: 'Minister of Housing, Addictions and Homelessness; Minister responsible for Mental Health',                                        role: 'minister' },
  { name: 'Tracy Schmidt',      title: 'Minister of Education and Early Childhood Learning',                                                                              role: 'minister' },
  { name: 'Ian Bushie',         title: 'Minister of Natural Resources and Indigenous Futures',                                                                            role: 'minister' },
  { name: 'Malaya Marcelino',   title: 'Minister of Labour and Immigration; Minister responsible for Workers Compensation Board',                                         role: 'minister' },
  { name: 'Jamie Moses',        title: 'Minister of Business, Mining, Trade and Job Creation',                                                                            role: 'minister' },
  { name: 'Lisa Naylor',        title: 'Minister of Transportation and Infrastructure',                                                                                   role: 'minister' },
  { name: 'Adrien Sala',        title: 'Minister of Finance; Minister responsible for Public Utilities Board, Manitoba Hydro and Manitoba Public Service',                role: 'minister' },
  { name: 'Renée Cable',        title: 'Minister of Advanced Education and Training',                                                                                     role: 'minister' },
  { name: 'Mike Moyes',         title: 'Minister of Environment and Climate Change; Minister responsible for Efficiency Manitoba',                                        role: 'minister' },
  { name: 'Glen Simard',        title: 'Minister of Municipal and Northern Relations; Minister responsible for Francophone Affairs and Manitoba Liquor and Lotteries',    role: 'minister' },
  { name: 'Mintu Sandhu',       title: 'Minister of Public Service Delivery',                                                                                            role: 'minister' },
  { name: 'Nellie Kennedy',     title: 'Minister of Sport, Culture, Heritage and Tourism',                                                                               role: 'minister' },
  { name: 'Mike Moroz',         title: 'Minister of Innovation and New Technology',                                                                                      role: 'minister' },
];

const CA_MB_LEGISLATURE = {
  total: 57, vacant: 0,
  source_url: 'https://www.gov.mb.ca/legislature/members/mla_list_sortname.html',
  fetched_at: NOW,
  parties: [
    { name: 'New Democratic Party',      short: 'NDP',     seats: 34, governing: true  },
    { name: 'Progressive Conservative',  short: 'PC',      seats: 22, governing: false },
    { name: 'Liberal',                   short: 'Liberal', seats:  1, governing: false },
  ],
};

const CA_MB_CONTACT = {
  source_url: 'https://www.gov.mb.ca/minister/premier/index.html',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'Room 204, Legislative Building, 450 Broadway, Winnipeg MB R3C 0V8', phone: '204-945-3714' },
  ],
  premier_office: {
    email:   'premier@leg.gov.mb.ca',
    phone:   '204-945-3714',
    mailing: 'Office of the Premier, Room 204, Legislative Building, 450 Broadway, Winnipeg MB R3C 0V8',
    source:  'https://www.gov.mb.ca/minister/premier/index.html',
  },
};

// ─── CA-QC (Quebec) ────────────────────────────────────────────────────────
// Cabinet:     Fréchette ministry, sworn 2026-04-21 (Wikipedia/CBC, 2026-05-23)
//   ⚠ François Legault resigned 2026-01-14; Christine Fréchette PM since 2026-04-15
// Legislature: 2022 general election (Oct 3 2022) — approximate; by-elections may shift totals
// Contact:     quebec.ca/en/premier

const CA_QC_CABINET = [
  { name: 'Christine Fréchette',        title: 'Premier of Quebec',                                                                                         role: 'premier' },
  { name: 'Ian Lafrenière',             title: 'Deputy Premier; Minister of Internal Security; Minister responsible for First Nations Relations',            role: 'minister' },
  { name: 'Eric Girard',                title: 'Minister of Finance; Minister of Infrastructure',                                                            role: 'minister' },
  { name: 'Bernard Drainville',         title: 'Minister of Economy, Innovation and Energy; Maritime Strategy',                                              role: 'minister' },
  { name: 'Sonia LeBel',               title: 'Minister of Education; Deputy House Leader',                                                                  role: 'minister' },
  { name: 'Mathieu Lacombe',            title: 'Minister of Culture and Communications',                                                                     role: 'minister' },
  { name: 'Martine Biron',              title: 'Minister of Higher Education; Minister responsible for Status of Women',                                     role: 'minister' },
  { name: 'Jean-François Roberge',      title: 'Minister responsible for French Language, Francophonie and Democratic Institutions',                         role: 'minister' },
  { name: 'Sonia Bélanger',            title: 'Minister of Health; Minister responsible for Seniors and Caregivers',                                        role: 'minister' },
  { name: 'Lionel Carmant',             title: 'Minister of Social Services; Minister responsible for Homelessness',                                        role: 'minister' },
  { name: 'Catherine Blouin',           title: 'Minister of Families',                                                                                      role: 'minister' },
  { name: 'Chantal Rouleau',            title: 'Minister of Social Solidarity; Minister responsible for Montreal Region',                                   role: 'minister' },
  { name: 'Pascale Déry',              title: 'Minister of Environment and Fight Against Climate Change; Wildlife and Parks',                                role: 'minister' },
  { name: 'Kateri Champagne Jourdain', title: 'Minister of Natural Resources and Forests',                                                                  role: 'minister' },
  { name: 'Simon Jolin-Barrette',       title: 'Minister of Justice; Constitutional Affairs',                                                               role: 'minister' },
  { name: 'François Bonnardel',        title: 'Government House Leader; Minister of Immigration',                                                           role: 'minister' },
  { name: 'Jean Boulet',                title: 'Minister of Labour; Minister responsible for Canadian Relations',                                            role: 'minister' },
  { name: 'Samuel Poulin',              title: 'Minister of Municipal Affairs',                                                                              role: 'minister' },
  { name: 'Donald Martel',              title: 'Minister of Agriculture, Fisheries and Food',                                                               role: 'minister' },
  { name: 'Benoit Charette',            title: 'Minister of Transport and Sustainable Mobility',                                                             role: 'minister' },
  { name: 'Amélie Dionne',             title: 'Minister of Tourism',                                                                                        role: 'minister' },
  { name: 'Christopher Skeete',         title: 'Minister of International Relations; Minister responsible for English-speaking Relations',                   role: 'minister' },
  { name: 'Daniel Bernard',             title: 'Delegate Minister for Regional Economic Development',                                                        role: 'associate_minister' },
  { name: 'Mathieu Lévesque',          title: 'Delegate Minister responsible for the Regions',                                                             role: 'associate_minister' },
];

const CA_QC_LEGISLATURE = {
  total: 125, vacant: 0,
  source_url: 'https://www.assnat.qc.ca/en/membres/index.html',
  fetched_at: NOW,
  // From 2022 general election; by-elections since may have shifted totals
  parties: [
    { name: 'Coalition Avenir Québec', short: 'CAQ',     seats: 90, governing: true  },
    { name: 'Parti Libéral du Québec', short: 'Liberal', seats: 21, governing: false },
    { name: 'Québec Solidaire',        short: 'QS',      seats: 11, governing: false },
    { name: 'Parti Québécois',         short: 'PQ',      seats:  3, governing: false },
  ],
};

const CA_QC_CONTACT = {
  source_url: 'https://www.quebec.ca/en/premier',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: '835, boul. René-Lévesque Est, 3e étage, Québec QC G1A 1B4', phone: '418-643-5321' },
  ],
  premier_office: {
    email:   'premier@premier.gouv.qc.ca',
    phone:   '418-643-5321',
    mailing: 'Cabinet de la Première ministre, 835, boul. René-Lévesque Est, 3e étage, Québec QC G1A 1B4',
    source:  'https://www.quebec.ca/en/premier',
  },
};

// ─── CA-NB (New Brunswick) ─────────────────────────────────────────────────
// Cabinet:     gnb.ca/members-executive-council (fetched 2026-05-23)
// Legislature: 2024 general election, Oct 21 2024
// Contact:     gnb.ca/office-of-the-premier

const CA_NB_CABINET = [
  { name: 'Susan Holt',            title: 'Premier; President of the Executive Council; Minister responsible for Official Languages',                           role: 'premier' },
  { name: 'René Legacy',          title: 'Deputy Premier; Minister of Finance and Treasury Board',                                                             role: 'minister' },
  { name: 'Lyne Chantal Boudreau', title: 'Minister responsible for Seniors; Minister responsible for Women and Gender Equity',                                role: 'minister' },
  { name: 'Chuck Chiasson',        title: 'Minister of Transportation and Infrastructure',                                                                      role: 'minister' },
  { name: 'Keith Chiasson',        title: 'Minister of Indigenous Affairs',                                                                                     role: 'minister' },
  { name: 'Jean-Claude D\'Amours', title: 'Minister of Intergovernmental Affairs; Minister responsible for Immigration and Military Affairs; acting Minister of Post-Secondary Education, Training and Labour', role: 'minister' },
  { name: 'John Dornan',           title: 'Minister of Health',                                                                                                 role: 'minister' },
  { name: 'Pat Finnigan',          title: 'Minister of Agriculture, Aquaculture and Fisheries',                                                                  role: 'minister' },
  { name: 'Robert Gauvin',         title: 'Minister of Public Safety; Minister responsible for la Francophonie',                                                role: 'minister' },
  { name: 'John Herron',           title: 'Minister of Natural Resources',                                                                                      role: 'minister' },
  { name: 'David Hickey',          title: 'Minister responsible for the New Brunswick Housing Corporation',                                                     role: 'minister' },
  { name: 'Claire Johnson',        title: 'Minister of Education and Early Childhood Development',                                                              role: 'minister' },
  { name: 'Aaron Kennedy',         title: 'Minister of Local Government and Service New Brunswick',                                                             role: 'minister' },
  { name: 'Gilles LePage',         title: 'Minister of Environment and Climate Change',                                                                         role: 'minister' },
  { name: 'Rob McKee',             title: 'Minister of Justice and Attorney General',                                                                           role: 'minister' },
  { name: 'Cindy Miles',           title: 'Minister of Social Development',                                                                                     role: 'minister' },
  { name: 'Luke Randall',          title: 'Minister responsible for Economic Development and Small Business',                                                   role: 'minister' },
  { name: 'Isabelle Thériault',   title: 'Minister of Tourism, Heritage and Culture',                                                                          role: 'minister' },
  { name: 'Alyson Townsend',       title: 'Minister of Post-Secondary Education, Training and Labour',                                                         role: 'minister' },
];

const CA_NB_LEGISLATURE = {
  total: 49, vacant: 0,
  source_url: 'https://www.legnb.ca/en/members/current',
  fetched_at: NOW,
  parties: [
    { name: 'New Brunswick Liberal Association', short: 'Liberal', seats: 31, governing: true  },
    { name: 'Progressive Conservative Party',    short: 'PC',      seats: 16, governing: false },
    { name: 'Green Party of New Brunswick',      short: 'Green',   seats:  2, governing: false },
  ],
};

const CA_NB_CONTACT = {
  source_url: 'https://www.gnb.ca/en/org/office-of-the-premier.html',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'P.O. Box 6000, Fredericton NB E3B 5H1', phone: '506-453-2144' },
  ],
  premier_office: {
    email:   'premier@gnb.ca',
    phone:   '506-453-2144',
    mailing: 'Office of the Premier, P.O. Box 6000, Fredericton NB E3B 5H1',
    source:  'https://www.gnb.ca/en/org/office-of-the-premier.html',
  },
};

// ─── CA-NS (Nova Scotia) ──────────────────────────────────────────────────
// Cabinet:     nslegislature.ca/members/cabinet (Oct 2025 reshuffle, 20 members)
// Legislature: 2024 general election, Nov 26 2024
// Contact:     novascotia.ca/premier

const CA_NS_CABINET = [
  { name: 'Tim Houston',        title: 'Premier; President of Executive Council; Minister of Energy; Minister of Intergovernmental Affairs and Trade', role: 'premier' },
  { name: 'Barbara Adams',      title: 'Deputy Premier; Minister of Seniors and Long-Term Care; Minister of Opportunities and Social Development; Minister responsible for Military Relations', role: 'minister' },
  { name: 'John Lohr',          title: 'Minister of Finance and Treasury Board; Minister of Labour Relations',                                           role: 'minister' },
  { name: 'Timothy Halman',     title: 'Minister of Environment and Climate Change; Service Efficiency',                                                  role: 'minister' },
  { name: 'Kim Masland',        title: 'Minister of Natural Resources; Minister of Emergency Management',                                                 role: 'minister' },
  { name: 'Colton LeBlanc',     title: 'Minister of Growth and Development; Minister responsible for Acadian Affairs and Francophonie',                   role: 'minister' },
  { name: 'Brian Comer',        title: 'Minister of Addictions and Mental Health',                                                                        role: 'minister' },
  { name: 'Michelle Thompson',  title: 'Minister of Health and Wellness',                                                                                 role: 'minister' },
  { name: 'Jill Balser',        title: 'Minister of Cyber Security and Digital Solutions; Minister of Service Nova Scotia',                               role: 'minister' },
  { name: 'Greg Morrow',        title: 'Minister of Agriculture',                                                                                         role: 'minister' },
  { name: 'Kent Smith',         title: 'Minister of Fisheries and Aquaculture',                                                                           role: 'minister' },
  { name: 'Twila Grosse',       title: 'Minister of African Nova Scotian Affairs; Public Service Commission',                                             role: 'minister' },
  { name: 'Brendan Maguire',    title: 'Minister of Advanced Education; Minister of Education and Early Childhood Development',                            role: 'minister' },
  { name: 'Dave Ritcey',        title: 'Minister of Communities, Culture, Tourism and Heritage; Gaelic Affairs',                                          role: 'minister' },
  { name: 'Fred Tilley',        title: 'Minister of Public Works',                                                                                        role: 'minister' },
  { name: 'Nolan Young',        title: 'Minister of Labour, Skills and Immigration',                                                                      role: 'minister' },
  { name: 'Scott Armstrong',    title: 'Attorney General; Minister of Justice and Equity and Anti-Racism',                                                role: 'minister' },
  { name: 'Leah Martin',        title: 'Minister of Communications; Minister responsible for L\'nu Affairs and Youth',                                   role: 'minister' },
  { name: 'John White',         title: 'Minister of Housing',                                                                                             role: 'minister' },
  { name: 'John A. MacDonald',  title: 'Minister of Municipal Affairs',                                                                                   role: 'minister' },
];

const CA_NS_LEGISLATURE = {
  total: 55, vacant: 0,
  source_url: 'https://nslegislature.ca/members/current-members',
  fetched_at: NOW,
  parties: [
    { name: 'Progressive Conservative Association of Nova Scotia', short: 'PC',          seats: 43, governing: true  },
    { name: 'Nova Scotia New Democratic Party',                    short: 'NDP',         seats:  9, governing: false },
    { name: 'Nova Scotia Liberal Party',                           short: 'Liberal',     seats:  2, governing: false },
    { name: 'Independent',                                         short: 'Independent', seats:  1, governing: false },
  ],
};

const CA_NS_CONTACT = {
  source_url: 'https://novascotia.ca/premier/',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: '1700 Granville St, Halifax NS B3J 1X5', phone: '902-424-6600' },
  ],
  premier_office: {
    email:   'premier@novascotia.ca',
    phone:   '902-424-6600',
    mailing: 'Office of the Premier, 1700 Granville St, Halifax NS B3J 1X5',
    source:  'https://novascotia.ca/premier/',
  },
};

// ─── CA-PE (Prince Edward Island) ─────────────────────────────────────────
// Cabinet:     princeedwardisland.ca/meet-the-cabinet (fetched 2026-05-23)
//   ⚠ Dennis King (PC) resigned 2025; Rob Lantz (PC) PM since 2026-02-09 (34th Premier)
//     Bloyce Thompson served as interim premier Dec 2025 – Feb 2026
// Legislature: 2023 general election (Apr 3 2023): PC 22, Liberal 3, Green 2 = 27
//   PC caucus is approx 20 as of Feb 2026 per Lantz; seat totals not updated for by-elections
// Contact:     princeedwardisland.ca/premier

const CA_PE_CABINET = [
  { name: 'Rob Lantz',         title: 'Premier and President of Executive Council',                                           role: 'premier' },
  { name: 'Bloyce Thompson',   title: 'Minister of Agriculture; Minister of Justice and Public Safety and Attorney General',  role: 'minister' },
  { name: 'Darlene Compton',   title: 'Minister of Land and Environment',                                                     role: 'minister' },
  { name: 'Robin Croucher',    title: 'Minister of Education and Early Years',                                                role: 'minister' },
  { name: 'Jenn Redmond',      title: 'Minister of Economic Development, Trade and Artificial Intelligence',                  role: 'minister' },
  { name: 'Jill Burridge',     title: 'Minister of Finance and Affordability',                                               role: 'minister' },
  { name: 'Zack Bell',         title: 'Minister of Workforce and Advanced Learning',                                          role: 'minister' },
  { name: 'Cory Deagle',       title: 'Acting Minister of Health and Wellness',                                              role: 'minister' },
  { name: 'Barb Ramsay',       title: 'Minister of Social Development and Seniors',                                          role: 'minister' },
  { name: 'Ernie Hudson',      title: 'Minister of Fisheries, Rural Development and Tourism; Minister of Transportation, Infrastructure and Energy', role: 'minister' },
  { name: 'Kent Dollar',       title: 'Minister of Housing and Communities',                                                  role: 'minister' },
];

const CA_PE_LEGISLATURE = {
  total: 27, vacant: 0,
  source_url: 'https://www.assembly.pe.ca/assembly/members',
  fetched_at: NOW,
  // 2023 election results; PC caucus approx 20 as of Feb 2026 (2 former PC MLAs may be independent)
  parties: [
    { name: 'Progressive Conservative Party of PEI', short: 'PC',      seats: 22, governing: true  },
    { name: 'Liberal Party of PEI',                  short: 'Liberal', seats:  3, governing: false },
    { name: 'Green Party of PEI',                    short: 'Green',   seats:  2, governing: false },
  ],
};

const CA_PE_CONTACT = {
  source_url: 'https://www.princeedwardisland.ca/en/information/executive-council-office',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'PO Box 2000, Charlottetown PE C1A 7N8', phone: '902-368-4400' },
  ],
  premier_office: {
    email:   'premier@gov.pe.ca',
    phone:   '902-368-4400',
    mailing: 'Office of the Premier, PO Box 2000, Charlottetown PE C1A 7N8',
    source:  'https://www.princeedwardisland.ca/en/information/executive-council-office',
  },
};

// ─── CA-NL (Newfoundland and Labrador) ─────────────────────────────────────
// Cabinet:     gov.nl.ca premier announcement 2025-10-29 (13 ministers confirmed)
//   ⚠ Andrew Furey (Liberal) replaced by Tony Wakeham (PC) after Oct 14 2025 election
// Legislature: 2025 general election, Oct 14 2025
// Contact:     gov.nl.ca/exec

const CA_NL_CABINET = [
  { name: 'Tony Wakeham',          title: 'Premier; President of Executive Council; Minister of Intergovernmental Affairs',                              role: 'premier' },
  { name: 'Barry Petten',          title: 'Deputy Premier; Minister of Transportation and Infrastructure; Minister of Public Procurement',               role: 'minister' },
  { name: 'Craig Pardy',           title: 'Minister of Finance; President of Treasury Board; Minister of Seniors; Minister responsible for NL Liquor Corporation', role: 'minister' },
  { name: 'Lela Evans',            title: 'Minister of Health and Community Services; Mental Health and Addictions; Labrador Affairs; Indigenous Relations and Reconciliation', role: 'minister' },
  { name: 'Chris Tibbs',           title: 'Minister of Municipal and Community Affairs; Registrar General; Community Engagement; Environment, Conservation and Climate Change', role: 'minister' },
  { name: 'Andrea Barbour',        title: 'Minister of Tourism, Culture and Arts; Sport, Recreation and Parks; Minister responsible for PictureNL',      role: 'minister' },
  { name: 'Mike Goosney',          title: 'Minister of Government Services; Chief Information Officer; Labour; Minister responsible for WorkplaceNL',    role: 'minister' },
  { name: 'Joedy Wall',            title: 'Minister of Social Supports and Well-Being; Housing; Poverty Reduction; Minister responsible for Persons with Disabilities', role: 'minister' },
  { name: 'Pleaman Forsey',        title: 'Minister of Forestry, Agriculture and Lands; Crown Lands',                                                   role: 'minister' },
  { name: 'Loyola O\'Driscoll',   title: 'Minister of Fisheries and Aquaculture',                                                                       role: 'minister' },
  { name: 'Lloyd Parrott',         title: 'Minister of Energy and Mines; Government House Leader',                                                       role: 'minister' },
  { name: 'Lin Paddock',           title: 'Minister of Jobs, Growth, Rural Development, Immigration and Francophone Affairs',                            role: 'minister' },
  { name: 'Helen Conway-Ottenheimer', title: 'Minister of Justice and Women and Gender Equality',                                                        role: 'minister' },
];

const CA_NL_LEGISLATURE = {
  total: 40, vacant: 0,
  source_url: 'https://www.assembly.nl.ca/Members',
  fetched_at: NOW,
  parties: [
    { name: 'Progressive Conservative Party of Newfoundland and Labrador', short: 'PC',          seats: 21, governing: true  },
    { name: 'Newfoundland and Labrador Liberal Party',                      short: 'Liberal',     seats: 15, governing: false },
    { name: 'New Democratic Party',                                         short: 'NDP',         seats:  2, governing: false },
    { name: 'Independent',                                                  short: 'Independent', seats:  2, governing: false },
  ],
};

const CA_NL_CONTACT = {
  source_url: 'https://www.gov.nl.ca/exec/',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'PO Box 8700, St. John\'s NL A1B 4J6', phone: '709-729-3570' },
  ],
  premier_office: {
    email:   'premier@gov.nl.ca',
    phone:   '709-729-3570',
    mailing: 'Office of the Premier, PO Box 8700, St. John\'s NL A1B 4J6',
    source:  'https://www.gov.nl.ca/exec/',
  },
};

// ─── CA-YT (Yukon) ────────────────────────────────────────────────────────
// Cabinet:     yukon.ca/en/your-government/office-premier/meet-premiers-team (fetched 2026-05-23)
//   ⚠ Ranj Pillai (Liberal) replaced by Currie Dixon (Yukon Party) after 2025 election
// Legislature: 2025 general election (21 seats, expanded from 19)
// Contact:     yukon.ca/en/your-government/office-premier

const CA_YT_CABINET = [
  { name: 'Currie Dixon',    title: 'Premier; Minister of the Executive Council Office; Minister of Finance',                                                  role: 'premier' },
  { name: 'Cory Bellmore',   title: 'Minister of Community Services; Minister responsible for Yukon Lottery Commission',                                       role: 'minister' },
  { name: 'Linda Benoit',    title: 'Minister of Highways and Public Works',                                                                                    role: 'minister' },
  { name: 'Brad Cathers',    title: 'Minister of Health and Social Services',                                                                                   role: 'minister' },
  { name: 'Jen Gehmair',     title: 'Minister of Economic Development; Tourism and Culture; Public Service Commission; Minister responsible for Yukon Liquor Corporation', role: 'minister' },
  { name: 'Wade Istchenko',  title: 'Minister of Environment',                                                                                                  role: 'minister' },
  { name: 'Scott Kent',      title: 'Minister of Education; Minister responsible for Yukon Housing Corporation',                                                role: 'minister' },
  { name: 'Ted Laking',      title: 'Minister of Energy, Mines and Resources; Minister responsible for Yukon Development Corporation and Yukon Energy Corporation', role: 'minister' },
  { name: 'Laura Lang',      title: 'Minister of Justice; Minister responsible for French Language Services Directorate; Women and Gender Equity Directorate; Workers\' Safety and Compensation Board', role: 'minister' },
];

const CA_YT_LEGISLATURE = {
  total: 21, vacant: 0,
  source_url: 'https://www.yukonassembly.ca/mlas',
  fetched_at: NOW,
  parties: [
    { name: 'Yukon Party',  short: 'Yukon Party', seats: 14, governing: true  },
    { name: 'New Democratic Party', short: 'NDP', seats:  6, governing: false },
    { name: 'Liberal',      short: 'Liberal',      seats:  1, governing: false },
  ],
};

const CA_YT_CONTACT = {
  source_url: 'https://yukon.ca/en/your-government/office-premier',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: '2071 Second Ave, Whitehorse YT Y1A 2C6', phone: '867-393-7100' },
  ],
  premier_office: {
    email:   'premier@gov.yk.ca',
    phone:   '867-393-7100',
    mailing: 'Office of the Premier, 2071 Second Ave, Whitehorse YT Y1A 2C6',
    source:  'https://yukon.ca/en/your-government/office-premier',
  },
};

// ─── CA-NT (Northwest Territories) ─────────────────────────────────────────
// Cabinet:     gov.nt.ca/premier (consensus government; 19 elected MLAs select 7 cabinet members)
// Legislature: 2023 general election, Nov 14 2023 (19 seats, all independent — consensus model)
// Contact:     gov.nt.ca/en/department/premier

const CA_NT_CABINET = [
  { name: 'R.J. Simpson',       title: 'Premier; Minister of Executive and Indigenous Affairs; Minister of Justice; Minister responsible for Housing (interim)', role: 'premier' },
  { name: 'Caitlin Cleveland',  title: 'Minister',  role: 'minister' },
  { name: 'Lucy Kuptana',       title: 'Minister',  role: 'minister' },
  { name: 'Jay Macdonald',      title: 'Minister',  role: 'minister' },
  { name: 'Vince McKay',        title: 'Minister',  role: 'minister' },
  { name: 'Lesa Semmler',       title: 'Minister; Minister responsible for the Status of Women',  role: 'minister' },
  { name: 'Caroline Wawzonek',  title: 'Minister',  role: 'minister' },
];

const CA_NT_LEGISLATURE = {
  total: 19, vacant: 0,
  source_url: 'https://www.ntlegislativeassembly.ca/meet-members',
  fetched_at: NOW,
  // Consensus government — all 19 MLAs are independent; no party breakdown
  parties: [],
  notes: 'Consensus government. All MLAs are independent. Seven cabinet members elected by and from the Legislative Assembly.',
};

const CA_NT_CONTACT = {
  source_url: 'https://www.gov.nt.ca/en/department/premier',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'PO Box 1320, Yellowknife NT X1A 2L9', phone: '867-767-9145' },
  ],
  premier_office: {
    email:   'premier@gov.nt.ca',
    phone:   '867-767-9145',
    mailing: 'Office of the Premier, PO Box 1320, Yellowknife NT X1A 2L9',
    source:  'https://www.gov.nt.ca/en/department/premier',
  },
};

// ─── CA-NU (Nunavut) ──────────────────────────────────────────────────────
// Cabinet:     premier.gov.nu.ca/en/premiers-cabinet/cabinet-ministers (fetched 2026-05-23)
//   ⚠ P.J. Akeeagok replaced by John Main after 2025 election (Akeeagok now Education minister)
// Legislature: 2025 general election (22 seats — consensus government, no parties)
// Contact:     premier.gov.nu.ca/en/home

const CA_NU_CABINET = [
  { name: 'John Main',                   title: 'Premier; Minister of Executive and Intergovernmental Affairs; Finance; Indigenous Affairs; Minister responsible for Immigration, Seniors, Utility Rates Review Council, Nunavut Liquor and Cannabis Commission', role: 'premier' },
  { name: 'George Hickes',               title: 'Deputy Premier; Minister of Justice; Transportation and Infrastructure; Minister responsible for Labour and Human Rights Tribunal',                role: 'minister' },
  { name: 'David Akeeagok',              title: 'Government House Leader; Minister of Education; Minister responsible for Nunavut Arctic College',                                                  role: 'minister' },
  { name: 'Janet Pitsiulaaq Brewster',   title: 'Minister of Health; Minister responsible for Suicide Prevention',                                                                                   role: 'minister' },
  { name: 'Dr. Gwen Healey Akearok',    title: 'Minister of Family Services; Minister responsible for Qulliq Energy Corporation; Status of Women; Homelessness and Poverty Reduction',             role: 'minister' },
  { name: 'Brian Koonoo',               title: 'Minister of Culture and Heritage; Environment; Languages; Minister responsible for Energy',                                                         role: 'minister' },
  { name: 'Cecile Nelvana Lyall',       title: 'Minister responsible for the Nunavut Housing Corporation',                                                                                          role: 'minister' },
  { name: 'Craig Simailak',             title: 'Minister of Community Services; Minister responsible for Nunavut Business Credit Corporation; Development Corporation; Mines and Trade',            role: 'minister' },
  { name: 'Annie Tattuinee',            title: 'Minister of Human Resources; Minister responsible for Workers\' Safety and Compensation Commission',                                               role: 'minister' },
];

const CA_NU_LEGISLATURE = {
  total: 22, vacant: 0,
  source_url: 'https://www.assembly.nu.ca/members/mla',
  fetched_at: NOW,
  // Consensus government — all 22 MLAs are independent; no party breakdown
  parties: [],
  notes: 'Consensus government. All MLAs are independent. Nine cabinet members elected by and from the Legislative Assembly.',
};

const CA_NU_CONTACT = {
  source_url: 'https://www.premier.gov.nu.ca/en/home',
  fetched_at: NOW,
  offices: [
    { type: 'premier', address: 'PO Box 2410, Iqaluit NU X0A 0H0', phone: '867-975-5000' },
  ],
  premier_office: {
    email:   'premier@gov.nu.ca',
    phone:   '867-975-5000',
    mailing: 'Office of the Premier, PO Box 2410, Iqaluit NU X0A 0H0',
    source:  'https://www.premier.gov.nu.ca/en/home',
  },
};

// ─── Province registry ─────────────────────────────────────────────────────

const PROVINCES = [
  { id: 'CA-BC', cabinet: CA_BC_CABINET, legislature_seats: CA_BC_LEGISLATURE, contact_info: CA_BC_CONTACT },
  { id: 'CA-AB', cabinet: CA_AB_CABINET, legislature_seats: CA_AB_LEGISLATURE, contact_info: CA_AB_CONTACT },
  { id: 'CA-SK', cabinet: CA_SK_CABINET, legislature_seats: CA_SK_LEGISLATURE, contact_info: CA_SK_CONTACT },
  { id: 'CA-MB', cabinet: CA_MB_CABINET, legislature_seats: CA_MB_LEGISLATURE, contact_info: CA_MB_CONTACT },
  { id: 'CA-QC', cabinet: CA_QC_CABINET, legislature_seats: CA_QC_LEGISLATURE, contact_info: CA_QC_CONTACT },
  { id: 'CA-NB', cabinet: CA_NB_CABINET, legislature_seats: CA_NB_LEGISLATURE, contact_info: CA_NB_CONTACT },
  { id: 'CA-NS', cabinet: CA_NS_CABINET, legislature_seats: CA_NS_LEGISLATURE, contact_info: CA_NS_CONTACT },
  { id: 'CA-PE', cabinet: CA_PE_CABINET, legislature_seats: CA_PE_LEGISLATURE, contact_info: CA_PE_CONTACT },
  { id: 'CA-NL', cabinet: CA_NL_CABINET, legislature_seats: CA_NL_LEGISLATURE, contact_info: CA_NL_CONTACT },
  { id: 'CA-YT', cabinet: CA_YT_CABINET, legislature_seats: CA_YT_LEGISLATURE, contact_info: CA_YT_CONTACT },
  { id: 'CA-NT', cabinet: CA_NT_CABINET, legislature_seats: CA_NT_LEGISLATURE, contact_info: CA_NT_CONTACT },
  { id: 'CA-NU', cabinet: CA_NU_CABINET, legislature_seats: CA_NU_LEGISLATURE, contact_info: CA_NU_CONTACT },
];

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n[ca-provinces-patch] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'}\n`);

  for (const p of PROVINCES) {
    const premiers      = p.cabinet.filter(m => m.role === 'premier').length;
    const fullMins      = p.cabinet.filter(m => m.role === 'minister').length;
    const assocMins     = p.cabinet.filter(m => m.role === 'associate_minister').length;
    const stateMins     = p.cabinet.filter(m => m.role === 'minister_of_state').length;

    const partySummary  = p.legislature_seats.parties.length > 0
      ? p.legislature_seats.parties.map(pt => `${pt.short} ${pt.seats}${pt.governing ? '*' : ''}`).join(' | ')
      : '(consensus — no party breakdown)';

    console.log(`[${p.id}] cabinet=${p.cabinet.length} (${premiers} premier + ${fullMins} ministers${assocMins ? ' + ' + assocMins + ' associate' : ''}${stateMins ? ' + ' + stateMins + ' ministers_of_state' : ''})`);
    console.log(`        legislature=${p.legislature_seats.total} seats  ${partySummary}`);
    console.log(`        contact_info: ${p.contact_info.offices.length} office(s)  premier_email=${p.contact_info.premier_office.email || '—'}`);
  }

  if (!WRITE_MODE) {
    console.log('\n[ca-provinces-patch] DRY RUN — no writes.');
    console.log('[ca-provinces-patch] To apply: node tmp_ca_provinces_patch.js --write');
    return;
  }

  const db = getDb();

  for (const p of PROVINCES) {
    await db.collection('subnational_jurisdictions').doc(p.id).set(
      { cabinet: p.cabinet, legislature_seats: p.legislature_seats, last_updated: NOW },
      { merge: true }
    );
    console.log(`[ca-provinces-patch] ✅ subnational_jurisdictions/${p.id} — cabinet + legislature_seats written`);

    await db.collection('subnational_leader_transparency').doc(p.id).set(
      { contact_info: p.contact_info, last_updated: NOW },
      { merge: true }
    );
    console.log(`[ca-provinces-patch] ✅ subnational_leader_transparency/${p.id} — contact_info written`);
  }

  console.log('\n[ca-provinces-patch] Done — 12 provinces patched.');
}

main().catch(e => { console.error('[ca-provinces-patch] Fatal:', e.message); process.exit(1); });
