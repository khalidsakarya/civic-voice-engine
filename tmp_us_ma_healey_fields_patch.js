'use strict';
require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SALARY = {
  amount_base:  243493,
  amount_total: 308493,
  currency:     'USD',
  period:       'annual',
  notes:        'Base $243,493 + housing stipend $65,000 = $308,493 total. Effective Jan 2025.',
  source_url:   'https://malegislature.gov/Laws/GeneralLaws',
  fetched_at:   NOW,
};

const LOBBYING = {
  status:     'not_publicly_trackable',
  notes:      'MA OCPF tracks lobbyist registrations but governor-specific meeting contacts not itemized at individual level.',
  fetched_at: NOW,
};

const STOCK_HOLDINGS = {
  status:     'requires_manual_portal_review',
  notes:      'MA SFI filed annually with State Ethics Commission under MGL c.268B. Portal requires manual navigation at ethics.state.ma.us.',
  fetched_at: NOW,
};

const NET_WORTH = {
  status:     'not_disclosed',
  notes:      'MA SFI does not require aggregate net worth totals. No figure published.',
  fetched_at: NOW,
};

function print() {
  console.log('\n[US-MA Healey Fields Patch — ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN') + ']');
  console.log('\nsalary:');
  console.log('  amount_base:  $' + SALARY.amount_base.toLocaleString());
  console.log('  amount_total: $' + SALARY.amount_total.toLocaleString());
  console.log('  notes:        ' + SALARY.notes);
  console.log('\nlobbying:   ' + LOBBYING.status);
  console.log('stock_holdings: ' + STOCK_HOLDINGS.status);
  console.log('net_worth:  ' + NET_WORTH.status);
}

async function main() {
  print();
  if (!WRITE_MODE) {
    console.log('\nDRY RUN — no writes.');
    console.log('To apply: node tmp_us_ma_healey_fields_patch.js --write');
    return;
  }
  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-MA').set(
    {
      salary:         SALARY,
      lobbying:       LOBBYING,
      stock_holdings: STOCK_HOLDINGS,
      net_worth:      NET_WORTH,
      last_updated:   NOW,
    },
    { merge: true }
  );
  console.log('\n✅ subnational_leader_transparency/US-MA updated.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
