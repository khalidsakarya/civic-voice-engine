'use strict';
/**
 * tmp_leader_transparency_ca_on.js
 *
 * Writes subnational_leader_transparency/CA-ON with Doug Ford transparency data.
 *
 * Sources (official only):
 *   conflict_of_interest_filings  — OICO Commissioner's Reports (PDFs read and verified)
 *   financial_disclosure_framework — OICO Annual Report 2024-25 + Cabinet Ministers guidance
 *   declared_assets               — Members' Integrity Act, 1994; OICO guidance pages
 *   gifts_hospitality             — Members' Integrity Act, 1994 s.6; OICO Annual Report 2024-25
 *
 * Not available via automated fetch (JS-rendered or unavailable portals):
 *   - Specific asset/income values (pds.oico.on.ca — JS-rendered dropdown system)
 *   - Lobbyist registry targets (lobbyist.oico.on.ca — JS-rendered)
 *   - Campaign finance (Elections Ontario EFAPPS — system unavailable)
 *   - Minister expenses (ontario.ca proactive disclosure pages return 404)
 *
 * Merge only. No deletes. No empty overwrites.
 * Default: DRY RUN. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');

const WRITE_MODE   = process.argv.includes('--write');
const JURISDICTION = 'CA-ON';
const COLLECTION   = 'subnational_leader_transparency';

async function buildDoc() {
  const now = new Date().toISOString();

  // ── Conflict of Interest Filings ──────────────────────────────────────────
  // Source: OICO Commissioner's Reports page (oico.on.ca/en/mpp-integrity-commissioner's-reports)
  // Individual reports confirmed: PDFs downloaded and extracted with pdftotext
  const conflictOfInterestFilings = {
    total_requests_naming_ford: 6,
    all_outcomes: 'No breach found in any inquiry. Five requests resulted in insufficient grounds; one full inquiry (March 2019) found no breach but identified a flawed appointment process.',
    inquiries: [
      {
        date: '2019-03-20',
        title: 'Re: The Honourable Doug Ford — OPP Commissioner Appointment (Ron Taverner)',
        commissioner: 'J. David Wake, K.C., Integrity Commissioner',
        type: 'Full section 31 inquiry',
        subject: 'Appointment of personal friend Ron Taverner as OPP Commissioner; alleged breach of sections 2 (conflict of interest), 4 (influence), 8 and 16 (procedure on conflict)',
        outcome: 'No breach found. Premier found to have stayed at arm\'s length from recruitment process. Appointment process found \'flawed\'; Commissioner recommended an independent, transparent appointment process for future OPP Commissioner appointments.',
        witnesses_interviewed: 21,
        documents_reviewed: 3500,
        source_url: 'https://www.oico.on.ca/web/default/files/public/3-march-20-2019.pdf',
      },
      {
        date: '2019-05-07',
        title: 'Re: The Honourable Doug Ford — OPP Deputy Commissioner Termination (Brad Blair)',
        commissioner: 'J. David Wake, K.C., Integrity Commissioner',
        type: 'Section 30 request — no inquiry commenced',
        subject: 'Alleged involvement in termination of OPP Deputy Commissioner Brad Blair; alleged breach of sections 2 and 4',
        outcome: 'Insufficient grounds to conduct inquiry. No evidence Premier participated in or sought to influence the Public Service Commission\'s termination decision.',
        source_url: 'https://www.oico.on.ca/web/default/files/public/2-may-7-2019.pdf',
      },
      {
        date: '2021-12-09',
        title: 'Re: The Honourable Doug Ford — Bradford Bypass Highway',
        commissioner: 'J. David Wade, K.C., Integrity Commissioner',
        type: 'Section 30 request — no inquiry commenced',
        subject: 'Bradford Bypass highway revival; alleged conflict of interest with developer donations to PC Party (section 2)',
        outcome: 'Insufficient grounds to conduct inquiry. Donations to a political party constitute a \'political interest\', not a \'private interest\' under the Members\' Integrity Act, 1994.',
        source_url: 'https://www.oico.on.ca/web/default/files/public/Commissioners%20Reports/Re%20The%20Honourable%20Doug%20Ford%20-%20December%209%2C%202021.pdf',
      },
      {
        date: '2023-01-18',
        title: 'Re: The Honourable Doug Ford and The Honourable Steve Clark — Greenbelt Land Removal',
        commissioner: 'J. David Wake, K.C., Integrity Commissioner',
        type: 'Section 30 request — no inquiry into Ford; Clark inquiry commenced',
        subject: 'Niagara Region Greenbelt land removal (15 properties); alleged conflict of interest and use of insider information (sections 2, 3)',
        outcome: 'Insufficient grounds for inquiry into Ford. Media articles alone insufficient to establish reasonable and probable grounds. No credible evidence linking Ford to selection of properties. Inquiry into Minister Clark separately commenced on Stiles request.',
        source_url: 'https://www.oico.on.ca/web/default/files/public/Commissioners%20Reports/Re%20Premier%20Doug%20Ford%20and%20Minister%20Steve%20Clark%20-%20January%2018%2C%202023.pdf',
      },
      {
        date: '2023-09-21',
        title: 'Re: The Honourable Doug Ford — Daughter\'s Wedding Events and Greenbelt Context',
        commissioner: 'J. David Wake, K.C., Integrity Commissioner',
        type: 'Section 30 request — interim report March 16 2023; final report September 21 2023; no formal inquiry',
        subject: 'Developers attending daughter\'s wedding (Sep 25, 2022) and stag-and-doe (Aug 11, 2022); alleged breach of sections 2 (conflict), 4 (influence), 6(1) (gifts)',
        outcome: 'No violation. Ford did not participate in selecting Greenbelt properties for removal. Inviting personal friends who are developers to a family event does not offend the Act. Gift rule does not extend to gifts received by adult children. No evidence of financial contributions from guests to Ford personally.',
        source_url: 'https://www.oico.on.ca/web/default/files/public/Commissioners%20Reports/Report%20Re%20Premier%20Ford%20-%20September%2021%2C%202023.pdf',
      },
      {
        date: '2025-08-20',
        title: 'Re: The Honourable Doug Ford, Khanjin, McCarthy, Lecce — Dresden Landfill / Bill 5',
        commissioner: 'Cathryn Motherwell, Integrity Commissioner',
        type: 'Section 30 request — no inquiry commenced',
        subject: 'Bill 5 exemption of Dresden Landfill from Environmental Assessment Act review (Schedule 3); alleged breach of sections 2, 3, 4, 8',
        outcome: 'Insufficient grounds for inquiry into Ford or three ministers. No credible evidence of personal relationship with landfill owners, no evidence of improper purpose. Objective policy rationale documented: reducing Ontario\'s reliance on U.S. landfills.',
        source_url: 'https://www.oico.on.ca/web/default/files/public/Commissioners%20Reports/Report_Re_Premier_Ford_Ministers_Khanjin_McCarthy_Lecce_August_20_2025.pdf',
      },
    ],
    data_source: 'Ontario Office of the Integrity Commissioner — Commissioner\'s Reports',
    source_url: 'https://www.oico.on.ca/en/mpp-integrity-commissioner\'s-reports',
    reporting_period: '2019–2025',
    fetched_at: now,
  };

  // ── Financial Disclosure Framework ────────────────────────────────────────
  // Source: OICO Annual Report 2024-25 (confirmed all 124 MPPs filed in fall 2024);
  //         OICO Cabinet Ministers guidance page (asset restrictions);
  //         Members' Integrity Act, 1994, ss.10-18
  const financialDisclosure = {
    filing_status_2024: 'Filed — all 124 sitting Ontario MPPs submitted annual financial disclosure statements in fall 2024 (confirmed: OICO Annual Report 2024-25)',
    portal: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx',
    portal_note: 'Portal is JavaScript-rendered (year dropdown then MPP selection). Individual statement PDFs require portal interaction; automated retrieval not possible.',
    regulatory_framework: 'Members\' Integrity Act, 1994 (ss. 18-24)',
    what_is_disclosed: [
      'Sources and amounts of income',
      'Investments (securities, stocks, bonds)',
      'Real property (excluding primary residence described generically)',
      'Ownership interests in companies',
      'Pension entitlements',
      'Liabilities: mortgages, lines of credit, unpaid taxes, co-signed loans',
    ],
    cabinet_restrictions: [
      'Cannot hold individual securities, stocks, or commodities (exception: broad-based mutual funds)',
      'Cannot hold individual securities where total value does not exceed $2,500',
      'Cannot acquire investment real estate while serving in cabinet',
      'Cannot engage in outside employment or professional practice',
      '12-month post-employment restriction on certain activities',
    ],
    disclosure_note: 'Redacted versions are publicly available. Primary residence is not individually identified in public statements.',
    needs_manual_review: ['specific_asset_values', 'specific_income_amounts', 'specific_liability_amounts'],
    data_source: 'Members\' Integrity Act, 1994; OICO Cabinet Ministers guidance; OICO Annual Report 2024-25',
    source_url: 'https://www.oico.on.ca/en/mpp-integrity-cabinet-ministers',
    reporting_period: 'Annual — most recent filing: fall 2024',
    fetched_at: now,
  };

  // ── Declared Assets ───────────────────────────────────────────────────────
  // Source: Members' Integrity Act, 1994 + OICO guidance (confirmed accessible pages)
  // Specific dollar values: requires JS portal interaction — marked needs_manual_review
  const declaredAssets = {
    framework: 'Members\' Integrity Act, 1994',
    annual_filing_required: true,
    portal: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx',
    categories_required: [
      'Sources and amounts of income',
      'Investments and securities',
      'Real property holdings',
      'Company directorships and ownership',
      'Pension entitlements',
      'Liabilities over threshold',
    ],
    asset_restrictions_as_premier: [
      'Prohibited: individual securities, stocks, commodities (broad-based mutual funds exempted)',
      'Prohibited: acquisition of investment real estate',
      'Compliance deadline: 60 days after appointment to cabinet',
    ],
    specific_values_available_at: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx (select year, then Doug Ford, Etobicoke North)',
    needs_manual_review: ['asset_values', 'income_sources', 'liability_totals'],
    data_source: 'Members\' Integrity Act, 1994, ss.18-24; OICO public disclosure system',
    source_url: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx',
    reporting_period: '2018–2025 (annual, each fall)',
    fetched_at: now,
  };

  // ── Gifts & Hospitality ───────────────────────────────────────────────────
  // Source: Members' Integrity Act 1994 s.6; OICO Annual Report 2024-25 (confirmed accessible)
  const giftsHospitality = {
    regulatory_framework: 'Members\' Integrity Act, 1994, section 6',
    rule_summary: 'An MPP shall not accept a fee, gift, or personal benefit that is connected directly or indirectly with the performance of their duties of office.',
    approved_disclosure_threshold_cad: 200,
    public_disclosure_note: 'Gifts worth more than $200 that the Integrity Commissioner determined an MPP could accept are publicly disclosed in the MPP\'s annual financial disclosure statement.',
    fy_2024_25_gift_advice_requests_all_mpps: 80,
    fy_2024_25_note: '80 gift-related advice requests made by all Ontario MPPs in 2024-25 (source: OICO Annual Report 2024-25). Figure is aggregate for all MPPs, not Ford-specific.',
    individual_disclosures_portal: 'https://pds.oico.on.ca/Pages/Public/PublicDisclosures.aspx',
    needs_manual_review: ['specific_gift_records_ford_2024', 'specific_gift_records_ford_2023'],
    data_source: 'Members\' Integrity Act, 1994; OICO Annual Report 2024-2025',
    source_url: 'https://www.oico.on.ca/en/blog/annual-reports/annual-report-2024-2025',
    reporting_period: '2024-25',
    fetched_at: now,
  };

  return {
    jurisdiction_id: JURISDICTION,
    leader_name: 'Doug Ford',
    leader_title: 'Premier of Ontario',
    leader_party: 'Progressive Conservative Party of Ontario',
    riding: 'Etobicoke North',
    in_office_since: '2018-06-29',
    regulatory_body: 'Ontario Office of the Integrity Commissioner (oico.on.ca)',
    regulatory_act: 'Members\' Integrity Act, 1994, S.O. 1994, c. 38',

    conflict_of_interest_filings: conflictOfInterestFilings,
    financial_disclosure: financialDisclosure,
    declared_assets: declaredAssets,
    gifts_hospitality: giftsHospitality,

    data_status: 'partial_official',
    data_completeness_note: 'Conflict of interest filing records complete (all 6 reports, PDFs read and verified). Financial disclosure framework and gift rules confirmed from official guidance. Specific asset/income values, individual gift records, lobbyist registry data, and minister expense figures require manual portal access (JavaScript-rendered systems).',
    sources_confirmed: [
      'OICO Commissioner\'s Reports PDFs (6 reports naming Ford, 2019–2025) — text extracted and read',
      'OICO Annual Report 2024-2025 — filing statistics confirmed',
      'OICO Cabinet Ministers guidance page — cabinet asset restrictions confirmed',
      'Members\' Integrity Act, 1994 — regulatory framework confirmed',
      'Ontario Legislative Assembly MPP profile — basic office details confirmed',
    ],
    sources_inaccessible: [
      'pds.oico.on.ca — Individual MPP financial disclosure amounts (JavaScript-rendered portal)',
      'lobbyist.oico.on.ca — Lobbyist registry activities targeting Premier\'s office (JavaScript-rendered)',
      'Elections Ontario EFAPPS — Campaign finance statements (system unavailable)',
      'ontario.ca proactive disclosure — Minister expense figures (pages return 404)',
    ],
    last_updated: now,
    fetched_at: now,
  };
}

async function main() {
  console.log(`\n[ca-on-leader] ${WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'} — subnational_leader_transparency/CA-ON\n`);

  const doc = await buildDoc();

  // ── Report ───────────────────────────────────────────────────────────────
  console.log('[conflict_of_interest_filings]');
  console.log(`  Total requests naming Ford: ${doc.conflict_of_interest_filings.total_requests_naming_ford}`);
  doc.conflict_of_interest_filings.inquiries.forEach(r =>
    console.log(`  ${r.date}  ${r.title.slice(0, 70)}`));
  console.log(`  Source: ${doc.conflict_of_interest_filings.source_url}`);

  console.log('\n[financial_disclosure]');
  console.log(`  Filing status 2024: ${doc.financial_disclosure.filing_status_2024.slice(0, 80)}`);
  console.log(`  Cabinet restrictions: ${doc.financial_disclosure.cabinet_restrictions.length} rules`);
  console.log(`  Portal: ${doc.financial_disclosure.portal}`);

  console.log('\n[declared_assets]');
  console.log(`  Framework: ${doc.declared_assets.framework}`);
  console.log(`  Categories: ${doc.declared_assets.categories_required.length}`);
  console.log(`  Needs manual review: ${doc.declared_assets.needs_manual_review.join(', ')}`);

  console.log('\n[gifts_hospitality]');
  console.log(`  Disclosure threshold: CAD $${doc.gifts_hospitality.approved_disclosure_threshold_cad}`);
  console.log(`  FY 2024-25 gift advice requests (all MPPs): ${doc.gifts_hospitality.fy_2024_25_gift_advice_requests_all_mpps}`);
  console.log(`  Needs manual review: ${doc.gifts_hospitality.needs_manual_review.join(', ')}`);

  if (!WRITE_MODE) {
    console.log('\n[ca-on-leader] DRY RUN — no writes.');
    console.log('[ca-on-leader] To apply: node tmp_leader_transparency_ca_on.js --write');
    return;
  }

  const db = getDb();
  await db.collection(COLLECTION).doc(JURISDICTION).set(doc, { merge: true });
  console.log(`\n[ca-on-leader] ✅ Written ${COLLECTION}/${JURISDICTION}`);
  console.log('[ca-on-leader] Done.');
}

main().catch(e => { console.error('[ca-on-leader] Fatal:', e.message); process.exit(1); });
