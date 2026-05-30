'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOCS = {
  'US-RI': {
    jurisdiction_id:   'US-RI',
    leader_name:       'Dan McKee',
    title:             'Governor',
    party:             'Democratic',
    took_office:       '2021-03-02',
    transparency_live: true,
    regulatory_body:   'Rhode Island Ethics Commission',
    salary:         { amount: 145754, currency: 'USD', period: 'annual', notes: '$145,754/yr last confirmed official figure.', fetched_at: NOW },
    lobbying:       { status: 'not_publicly_trackable', fetched_at: NOW },
    stock_holdings: { status: 'source_blocked', notes: 'RI ethics portal returning HTTP 403 to automated access.', fetched_at: NOW },
    net_worth:      { status: 'not_disclosed', fetched_at: NOW },
    last_updated:   NOW,
  },
  'US-VT': {
    jurisdiction_id:   'US-VT',
    leader_name:       'Phil Scott',
    title:             'Governor',
    party:             'Republican',
    took_office:       '2017-01-05',
    transparency_live: true,
    regulatory_body:   'Vermont Secretary of State',
    salary:         { amount: 234379, currency: 'USD', period: 'annual', notes: '$234,379/yr confirmed 2025.', fetched_at: NOW },
    lobbying:       { status: 'not_publicly_trackable', fetched_at: NOW },
    stock_holdings: { status: 'requires_manual_portal_review', notes: 'VT SOS financial disclosure portal requires manual navigation.', fetched_at: NOW },
    net_worth:      { status: 'not_disclosed', fetched_at: NOW },
    last_updated:   NOW,
  },
  'US-NH': {
    jurisdiction_id:   'US-NH',
    leader_name:       'Kelly Ayotte',
    title:             'Governor',
    party:             'Republican',
    took_office:       '2025-01-09',
    transparency_live: true,
    regulatory_body:   'New Hampshire Attorney General / Ethics Bureau',
    salary:         { amount: 146172, currency: 'USD', period: 'annual', notes: '$146,172/yr confirmed.', fetched_at: NOW },
    lobbying:       { status: 'not_publicly_trackable', fetched_at: NOW },
    stock_holdings: { status: 'no_official_records_found', notes: 'NH has no public financial disclosure endpoint for governor.', fetched_at: NOW },
    net_worth:      { status: 'not_disclosed', fetched_at: NOW },
    last_updated:   NOW,
  },
  'US-ME': {
    jurisdiction_id:   'US-ME',
    leader_name:       'Janet Mills',
    title:             'Governor',
    party:             'Democratic',
    took_office:       '2019-01-02',
    transparency_live: true,
    regulatory_body:   'Maine Commission on Governmental Ethics and Election Practices',
    salary:         { amount: 70000, currency: 'USD', period: 'annual', notes: '$70,000/yr confirmed. Lowest governor salary in US.', fetched_at: NOW },
    lobbying:       { status: 'not_publicly_trackable', fetched_at: NOW },
    stock_holdings: { status: 'requires_manual_portal_review', notes: 'ME Ethics Commission portal JS-rendered, manual access required.', fetched_at: NOW },
    net_worth:      { status: 'not_disclosed', fetched_at: NOW },
    last_updated:   NOW,
  },
};

function print() {
  console.log('\n[US-RI/VT/NH/ME Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  for (const [id, doc] of Object.entries(DOCS)) {
    console.log('\n  ' + id + ' — ' + doc.leader_name);
    console.log('    salary:         $' + doc.salary.amount.toLocaleString() + ' — ' + doc.salary.notes);
    console.log('    lobbying:       ' + doc.lobbying.status);
    console.log('    stock_holdings: ' + doc.stock_holdings.status);
    console.log('    net_worth:      ' + doc.net_worth.status);
  }
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ri_vt_nh_me_patch.js --write');
    return;
  }
  const db = getDb();
  await Promise.all(
    Object.entries(DOCS).map(([id, doc]) =>
      db.collection('subnational_leader_transparency').doc(id).set(doc, { merge: true })
    )
  );
  console.log('\n✅ US-RI, US-VT, US-NH, US-ME updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
