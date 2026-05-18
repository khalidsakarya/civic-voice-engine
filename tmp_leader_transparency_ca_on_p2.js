'use strict';
/**
 * tmp_leader_transparency_ca_on_p2.js
 *
 * Merges lobbying_records and stock_holdings fields into
 * subnational_leader_transparency/CA-ON (Doug Ford).
 *
 * Sources:
 *   lobbying_records:
 *     - Lobbyists Registration Act, 1998 (regulatory framework)
 *     - OICO Annual Report 2024-25 (aggregate registry statistics,
 *       PDF downloaded and extracted: OICO_annual_report_24-25_EN.pdf)
 *     - lobbyist.oico.on.ca (portal — requires authentication; no public search available)
 *     - data.ontario.ca/dataset?q=lobbyist — no datasets found
 *
 *   stock_holdings:
 *     - Members' Integrity Act, 1994, ss.10-18 (cabinet asset prohibition)
 *     - OICO Cabinet Ministers guidance (oico.on.ca/en/mpp-integrity-cabinet-ministers)
 *     - OICO Annual Report 2024-25 (trust count confirmed: 8 trusts after June 2024 shuffle)
 *     - pds.oico.on.ca — JS-rendered; individual holdings not accessible
 *
 * Inaccessible:
 *   - Individual lobbyist registrations naming the Premier/Office of the Premier
 *     (lobbyist.oico.on.ca requires authentication; no public API or dataset)
 *   - Ford's specific trust/holdings type and value (pds.oico.on.ca JS-rendered portal)
 *
 * Merge only. No deletes. Default: DRY RUN. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE   = process.argv.includes('--write');
const JURISDICTION = 'CA-ON';
const COLLECTION   = 'subnational_leader_transparency';

async function buildPatch() {
  const now = new Date().toISOString();

  // ── Lobbying Records ──────────────────────────────────────────────────────
  // The Ontario Lobbyist Registry (lobbyist.oico.on.ca) requires authentication
  // for all search functionality. No public API exists. data.ontario.ca has no
  // lobbyist dataset. Aggregate statistics below are from OICO Annual Report 2024-25
  // (PDF extracted via pdftotext).
  const lobbyingRecords = {
    registry_portal: 'https://lobbyist.oico.on.ca',
    portal_access: 'Requires authentication — no public search available without login',
    regulatory_framework: 'Lobbyists Registration Act, 1998',
    public_data_available: false,
    public_api_available: false,
    ontario_open_data: 'No lobbyist dataset found (data.ontario.ca/dataset?q=lobbyist — zero results)',

    registry_statistics_fy_2024_25: {
      active_registrations_march_2025: 3514,
      active_registrations_march_2024: 3628,
      active_registered_lobbyists_march_2025: 3519,
      active_registered_lobbyists_march_2024: 3446,
      new_updated_renewed_registrations_monthly_avg: 500,
      compliance_reviews_potential_non_compliance: 309,
      compliance_reviews_note: 'Highest annual total in 6 years',
      investigations_referred_for_assessment: 77,
      investigations_commenced: 27,
      investigations_refused: 44,
      investigations_concluded: 17,
      penalties_imposed: 6,
      penalty_firsts: [
        'First penalties naming lobbyists who placed public office holders in real or perceived conflict of interest',
        'First penalty prohibiting a lobbyist from lobbying Ontario government for two years',
      ],
      greenbelt_note: 'Most concluded investigations (2024-25) arose from Greenbelt land removal inquiry (2023); several involved unregistered lobbying to amend Greenbelt Plan/regulations',
    },

    premier_office_specific_registrations: 'no_official_records_found',
    premier_office_note: 'Registry search requires authentication; no public endpoint exposes registrations filtered by "Office of the Premier" as a lobbying target. Aggregate statistics in OICO Annual Report do not break down by public office holder targeted.',

    data_source: 'OICO Annual Report 2024-2025 (PDF, pp. 50-60) — aggregate statistics only',
    source_url: 'https://www.oico.on.ca/en/blog/annual-reports/annual-report-2024-2025',
    reporting_period: '2024-25',
    fetched_at: now,
  };

  // ── Stock Holdings ────────────────────────────────────────────────────────
  // Members' Integrity Act, 1994 prohibits cabinet ministers from holding
  // individual securities. Ford as Premier must divest or place in management
  // trust within 60 days of appointment. OICO Annual Report 2024-25 confirms
  // 8 management trusts exist (as of June 2024 cabinet shuffle) but does not
  // name Ford or identify trust contents publicly.
  const stockHoldings = {
    cabinet_prohibition: 'Cabinet ministers (including Premier) are prohibited from holding individual securities, stocks, futures, or commodities under the Members\' Integrity Act, 1994',
    prohibited_instruments: [
      'Individual securities',
      'Stocks',
      'Futures',
      'Commodities',
    ],
    permitted_instruments: [
      'Broad-based mutual funds (permitted exception)',
      'GICs and government bonds held generically',
    ],
    compliance_mechanism: 'Divestiture or placement in management trust within 60 days of appointment to cabinet',
    management_trusts_confirmed: {
      total_trusts_fy_2024_25: 8,
      trusts_established_june_2024_shuffle: 2,
      note: 'OICO Annual Report 2024-25 confirms 8 total management trusts; does not name which ministers hold each trust',
    },
    ford_specific_holdings: 'no_official_records_found',
    ford_specific_note: 'Individual disclosure statements (including trust type and holdings categories) are published at pds.oico.on.ca but require JavaScript-rendered dropdown interaction; specific values cannot be retrieved programmatically',
    portal: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx',
    portal_note: 'Select year → Doug Ford → Etobicoke North to access individual statement PDF',
    needs_manual_review: ['specific_trust_type', 'specific_holdings_and_value', 'divestiture_items'],
    data_source: 'Members\' Integrity Act, 1994; OICO Cabinet Ministers guidance; OICO Annual Report 2024-25',
    source_url: 'https://www.oico.on.ca/en/mpp-integrity-cabinet-ministers',
    reporting_period: '2024-25',
    fetched_at: now,
  };

  return {
    lobbying_records: lobbyingRecords,
    stock_holdings: stockHoldings,
    last_updated: now,
  };
}

async function main() {
  console.log(`\n[ca-on-p2] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'} — subnational_leader_transparency/CA-ON (lobbying + stock)\n`);

  const patch = await buildPatch();

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('[lobbying_records]');
  console.log(`  Registry portal: ${patch.lobbying_records.registry_portal}`);
  console.log(`  Portal access: ${patch.lobbying_records.portal_access}`);
  console.log(`  Active registrations (Mar 2025): ${patch.lobbying_records.registry_statistics_fy_2024_25.active_registrations_march_2025}`);
  console.log(`  Active lobbyists (Mar 2025): ${patch.lobbying_records.registry_statistics_fy_2024_25.active_registered_lobbyists_march_2025}`);
  console.log(`  Investigations concluded FY 2024-25: ${patch.lobbying_records.registry_statistics_fy_2024_25.investigations_concluded}`);
  console.log(`  Penalties imposed: ${patch.lobbying_records.registry_statistics_fy_2024_25.penalties_imposed}`);
  console.log(`  Premier's Office registrations: ${patch.lobbying_records.premier_office_specific_registrations}`);
  console.log(`  Source: ${patch.lobbying_records.source_url}`);

  console.log('\n[stock_holdings]');
  console.log(`  Cabinet prohibition: ${patch.stock_holdings.cabinet_prohibition.slice(0, 80)}...`);
  console.log(`  Management trusts confirmed: ${patch.stock_holdings.management_trusts_confirmed.total_trusts_fy_2024_25} total`);
  console.log(`  Ford-specific holdings: ${patch.stock_holdings.ford_specific_holdings}`);
  console.log(`  Needs manual review: ${patch.stock_holdings.needs_manual_review.join(', ')}`);
  console.log(`  Source: ${patch.stock_holdings.source_url}`);

  if (!WRITE_MODE) {
    console.log('\n[ca-on-p2] DRY RUN — no writes.');
    console.log('[ca-on-p2] To apply: node tmp_leader_transparency_ca_on_p2.js --write');
    return;
  }

  const db = getDb();
  await db.collection(COLLECTION).doc(JURISDICTION).set(patch, { merge: true });
  console.log(`\n[ca-on-p2] ✅ Written ${COLLECTION}/${JURISDICTION}`);
  console.log('[ca-on-p2] Done.');
}

main().catch(e => { console.error('[ca-on-p2] Fatal:', e.message); process.exit(1); });
