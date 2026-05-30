'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const DOC = {
  jurisdiction_id:        'US-WA',
  leader_name:            'Bob Ferguson',
  title:                  'Governor',
  party:                  'Democratic',
  took_office:            '2025-01-15',
  transparency_live:      true,
  transparency_fetched_at: NOW,
  regulatory_body:        'Washington State Public Disclosure Commission (PDC)',
  salary: {
    amount:     218744,
    currency:   'USD',
    period:     'annual',
    notes:      '$204,205 Jan-Jun 2025, $218,744 Jul 2025-Jun 2026, $234,275 from Jul 2026. Per RCW 43.06.010.',
    source_url: 'https://app.leg.wa.gov/rcw/default.aspx?cite=43.06.010',
    fetched_at: NOW,
  },
  lobbying: {
    status:     'not_publicly_trackable',
    notes:      'PDC tracks lobbyist registrations but governor-specific meeting contacts not itemized at individual level.',
    fetched_at: NOW,
  },
  stock_holdings: {
    status:     'requires_manual_portal_review',
    notes:      'EEB Form 10 filed annually. First Ferguson filing due April 15 2025 should exist but requires manual portal access at ethics.wa.gov.',
    fetched_at: NOW,
  },
  net_worth: {
    status:     'not_disclosed',
    notes:      'WA EEB Form 10 does not require net worth totals. No aggregate figure published.',
    fetched_at: NOW,
  },
  last_updated: NOW,
};

function print() {
  console.log('\n[US-WA Ferguson REPLACE — ' + (WRITE_MODE ? '⚠  WRITE MODE (full replace, no merge)' : 'DRY RUN') + ']');
  console.log('  jurisdiction_id:   ' + DOC.jurisdiction_id);
  console.log('  leader_name:       ' + DOC.leader_name);
  console.log('  party:             ' + DOC.party);
  console.log('  took_office:       ' + DOC.took_office);
  console.log('  regulatory_body:   ' + DOC.regulatory_body);
  console.log('  salary:            $' + DOC.salary.amount.toLocaleString() + ' — ' + DOC.salary.notes);
  console.log('  lobbying:          ' + DOC.lobbying.status);
  console.log('  stock_holdings:    ' + DOC.stock_holdings.status + ' — ' + DOC.stock_holdings.notes);
  console.log('  net_worth:         ' + DOC.net_worth.status + ' — ' + DOC.net_worth.notes);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_wa_ferguson_replace.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-WA').set(DOC);
  console.log('\n✅ subnational_leader_transparency/US-WA replaced (no merge).');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
