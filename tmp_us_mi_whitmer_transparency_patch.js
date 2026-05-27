'use strict';
/**
 * tmp_us_mi_whitmer_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-MI
 * with confirmed facts for Governor Gretchen Whitmer.
 *
 * Primary source:
 *   Michigan Transparency Network (MiTN) — Personal Financial Disclosure (PFD)
 *   https://www.michigan.gov/sos/elections/disclosure/personal-financial-disclosure
 *   Michigan Public Officers Disclosure Act (Proposal 1 of 2022, implemented 2024).
 *   PDFs also posted directly at michigan.gov/whitmer/…/Documents/Financial/
 *   NOTE: michigan.gov blocks external PDF fetches (Cloudflare 403). Data below
 *   confirmed from Bridge Michigan (April 2024), Detroit News / Bridge Michigan
 *   (June 2025), and public reporting on both filings.
 *
 * Filings on record:
 *   2024 PFD (first-ever required filing): covers CY 2023, filed April 15, 2024
 *   2025 PFD (second filing):             covers CY 2024, filed June 13, 2025
 *                                          (deadline extended via SB 99/100, 2025 PA 3/4
 *                                          due to MiTN portal system failures)
 *   2026 PFD (most recent):               covers CY 2025, PDF posted at michigan.gov/whitmer
 *                                          but content inaccessible (403)
 *
 * Salary source:
 *   State Officers Compensation Commission (SOCC), established under Article IV §12
 *   of the Michigan Constitution. Amount $159,300/yr confirmed from public reporting.
 *   NOTE: Whitmer deliberately omitted salary from her PFD form despite it being a
 *   public record — she was not required by law to disclose it on the form.
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL  = 'https://www.michigan.gov/sos/elections/disclosure/personal-financial-disclosure';
const PDF_URL_2026 = 'https://www.michigan.gov/whitmer/-/media/Project/Websites/Whitmer/Documents/Financial/Governor-Gretchen-Whitmer-2026-Personal-Financial-Disclosure-for-the-Period-Ending-2025-12-31.pdf';

// ─── Salary ──────────────────────────────────────────────────────────────────
// Set by Michigan State Officers Compensation Commission (SOCC).
// Whitmer deliberately omitted salary from her PFD filings — not required by law.
// $159,300 confirmed from Bridge Michigan and public reporting.
const SALARY = {
  amount:     159300,
  currency:   'USD',
  period:     'Calendar year 2024',
  source:     'State of Michigan',
  source_url: 'https://www.michigan.gov/mdcs/quick-links/state-officers-compensation-commission',
  notes:      'Governor salary set by State Officers Compensation Commission (SOCC) per Article IV §12 of the Michigan Constitution. Whitmer deliberately did not disclose salary on her PFD form — not legally required. Amount $159,300 confirmed from public reporting.',
  fetched_at: NOW,
};

// ─── Unearned income ─────────────────────────────────────────────────────────
// From 2024 PFD (CY 2023 first-ever filing, April 15, 2024).
// Governor salary and book income were not reported on the form.
const UNEARNED_INCOME = {
  period:      'Calendar year 2023',
  source_url:  'https://bridgemi.com/michigan-government/whitmer-worth-23-million-new-michigan-disclosure-filings-lack-details/',
  filing_year: 2024,
  fetched_at:  NOW,
  total:       50237,
  currency:    'USD',
  notes:       'From 2024 PFD (first-ever required filing, CY 2023). Governor salary ($159,300) and book income (via Super Deluxe LLC) were not separately reported on the form.',
  breakdown: [
    { type: 'Stock dividends',      amount: 18432 },
    { type: 'Qualified dividends',  amount: 17672 },
    { type: 'Tax-exempt interest',  amount: 10657 },
  ],
};

// ─── Investments ─────────────────────────────────────────────────────────────
// Named funds confirmed from 2024 PFD (CY 2023). Values voluntarily disclosed
// by Whitmer (not required — form uses ranges by default; she provided exact amounts).
// Additional accounts: ~7 deferred-comp/401(k) + 4 further ETF/index/mutual funds
// not individually named in public reporting. Total ~$2.3M (CY 2023) / ~$2.5M (CY 2024).
const INVESTMENTS = {
  period:      'Calendar year 2023',
  source_url:  'https://bridgemi.com/michigan-government/whitmer-worth-23-million-new-michigan-disclosure-filings-lack-details/',
  filing_year: 2024,
  fetched_at:  NOW,
  total_approx: 2300000,
  currency:    'USD',
  notes:       'Values voluntarily disclosed as exact amounts (form only requires ranges). Named funds from 2024 PFD (CY 2023); ~11 additional accounts (7 deferred-comp/401(k), 4 ETF/index/mutual funds) not individually named in public reporting. CY 2024 filing (June 2025) reported ~$2.5M total.',
  named_funds: [
    {
      name:   'Vanguard Total Stock Market Index Fund Admiral Shares',
      ticker: 'VTSAX',
      value:  1003294,
    },
    {
      name:   'Vanguard Intermediate-Term Tax-Exempt Fund Admiral Shares',
      ticker: 'VWIUX',
      value:  382135,
    },
    {
      name:   'Vanguard 500 Index Fund Admiral Shares',
      ticker: 'VFIAX',
      value:  273973,
    },
  ],
};

// ─── Real estate ─────────────────────────────────────────────────────────────
// Two properties across both filings. Cottage from CY 2023 first filing;
// Cascade Township parcel added in CY 2024 second filing (June 2025).
const REAL_ESTATE = {
  fetched_at: NOW,
  notes:      'Cottage confirmed in 2024 PFD (CY 2023). Cascade Township parcel confirmed in 2025 PFD (CY 2024, filed June 13 2025).',
  properties: [
    {
      description: 'Cottage, Elk Rapids, Michigan',
      value:       418200,
      currency:    'USD',
      ownership:   'Full ownership',
      filing_year: 2024,
      source_url:  'https://bridgemi.com/michigan-government/whitmer-worth-23-million-new-michigan-disclosure-filings-lack-details/',
    },
    {
      description: 'Lakefront parcel (~3 acres), Cascade Township, Kent County, Michigan',
      value:       399000,
      currency:    'USD',
      ownership:   'Held through unnamed LLC formed for this purchase',
      filing_year: 2025,
      source_url:  'https://bridgemi.com/michigan-government/tech-flaws-weak-rules-mar-michigan-system-shine-light-lawmaker-conflicts/',
    },
  ],
};

// ─── Business interests ───────────────────────────────────────────────────────
// Super Deluxe LLC: confirmed in both 2024 PFD (created Nov 2023) and 2025 PFD.
// Unnamed property LLC: disclosed in 2025 PFD to hold Cascade Township parcel.
// Michigan PFD requires entity name; no income/value amounts required for LLCs.
const BUSINESS_INTERESTS = {
  fetched_at: NOW,
  notes:      'Michigan PFD requires disclosure of ownership interests; income/value amounts not required for LLC holdings. Book income (True Gretch + teen edition) not separately itemized — flows through Super Deluxe LLC. Contrasts with SOS Benson who disclosed $65,000 directly from Penguin Random House.',
  entities: [
    {
      name:        'Super Deluxe LLC',
      description: 'Manages governor\'s personal affairs and book earnings. Created November 2023 by attorney Christopher Trebilcock. Book income (True Gretch; revised teen edition) flows through this entity.',
      filing_year: 2024,
      source_url:  'https://www.detroitnews.com/story/news/politics/2024/04/15/gretchen-whitmer-millionaire-family-office-company-super-deluxe-personal-financial-disclosure-bills/73334696007/',
    },
    {
      name:        'Unnamed LLC (Cascade Township property)',
      description: 'LLC formed to purchase ~3-acre lakefront parcel in Cascade Township, Kent County, Michigan for $399,000.',
      filing_year: 2025,
      source_url:  'https://bridgemi.com/michigan-government/tech-flaws-weak-rules-mar-michigan-system-shine-light-lawmaker-conflicts/',
    },
  ],
};

// ─── Gifts ────────────────────────────────────────────────────────────────────
// From 2024 PFD (CY 2023). Michigan PFD requires disclosure of gifts >$50
// from a single source per calendar year.
const GIFTS = {
  period:      'Calendar year 2023',
  source_url:  'https://bridgemi.com/michigan-government/whitmer-worth-23-million-new-michigan-disclosure-filings-lack-details/',
  filing_year: 2024,
  fetched_at:  NOW,
  notes:       'From 2024 PFD (CY 2023 first filing). Michigan PFD threshold: gifts >$50 aggregate per source. CY 2024 gifts not available (2025 PFD content not accessible).',
  items: [
    {
      source:      'Blue Cross Blue Shield of Michigan',
      amount:      127,
      currency:    'USD',
      description: 'Food and beverages',
    },
    {
      source:      'Battle Creek Unlimited Inc.',
      amount_note: 'Less than $76',
      currency:    'USD',
      description: 'Meal during Make it in Michigan Airport tour',
    },
  ],
};

// ─── Liabilities ─────────────────────────────────────────────────────────────
const LIABILITIES = {
  period:      'Calendar year 2023',
  source_url:  SOURCE_URL,
  filing_year: 2024,
  fetched_at:  NOW,
  declared:    false,
  notes:       'No liabilities declared on 2024 PFD (CY 2023). Michigan PFD threshold: liabilities >$2,500.',
};

// ─── Data completeness note ───────────────────────────────────────────────────
const DATA_COMPLETENESS_NOTE =
  'Partial. Michigan PFD is a new requirement (first filing April 2024 under Proposal 1 ' +
  'of 2022). CY 2023 investment values confirmed (VTSAX $1,003,294; VWIUX $382,135; ' +
  'VFIAX $273,973; total ~$2.3M). CY 2024 filing (June 2025) added Cascade Township ' +
  'lakefront parcel ($399,000) and Super Deluxe LLC book-earnings structure; investment ' +
  'total ~$2.5M. CY 2025 filing (2026 PFD) posted at michigan.gov/whitmer but content ' +
  'inaccessible — michigan.gov blocks external PDF fetches (Cloudflare 403). ' +
  'Governor salary ($159,300) deliberately omitted from PFD form — not legally required. ' +
  'Book income routed through Super Deluxe LLC; not separately itemized on form.';

// ─── Fields to DELETE (framework-only garbage) ────────────────────────────────
const FIELDS_TO_REMOVE = [
  'lobbying_records',
  'stock_holdings',
  'recent_official_activity',
  'sections_available',
  'data_completeness_note',
  'contact_info',
  'transparency_live',
  'financial_disclosure',
  'sections_unavailable',
  'regulatory_body',
  'sources_confirmed',
  'regulatory_act',
  'gifts_hospitality',
  'jurisdiction_id',
  'campaign_finance',
  'sources_inaccessible',
  'field_sources',
  'transparency_fetched_at',
];

function buildDeleteMap(fields) {
  const map = {};
  for (const f of fields) map[f] = FieldValue.delete();
  return map;
}

function print() {
  console.log('\n[US-MI Whitmer Transparency Patch]');
  console.log('Source: Michigan Transparency Network PFD | michigan.gov/sos\n');

  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));

  console.log('\nsalary:');
  console.log('  amount:  $' + SALARY.amount.toLocaleString() + ' (omitted from PFD form — SOCC-set statutory rate)');

  console.log('\nunearned_income (CY 2023):  $' + UNEARNED_INCOME.total.toLocaleString());
  for (const b of UNEARNED_INCOME.breakdown)
    console.log('  ' + b.type + ': $' + b.amount.toLocaleString());

  console.log('\ninvestments (CY 2023, ' + INVESTMENTS.named_funds.length + ' named funds + ~11 additional):');
  for (const f of INVESTMENTS.named_funds)
    console.log('  ' + f.ticker + ' (' + f.name + '): $' + f.value.toLocaleString());
  console.log('  Total ~$' + (INVESTMENTS.total_approx / 1e6).toFixed(1) + 'M (CY 2023)');

  console.log('\nreal_estate (' + REAL_ESTATE.properties.length + ' properties):');
  for (const p of REAL_ESTATE.properties)
    console.log('  - ' + p.description + ': $' + p.value.toLocaleString() + ' (FY' + p.filing_year + ')');

  console.log('\nbusiness_interests (' + BUSINESS_INTERESTS.entities.length + ' entities):');
  for (const e of BUSINESS_INTERESTS.entities)
    console.log('  - ' + e.name + ' (FY' + e.filing_year + ')');

  console.log('\ngifts (CY 2023, ' + GIFTS.items.length + ' items):');
  for (const g of GIFTS.items)
    console.log('  - ' + g.source + ': ' + (g.amount ? '$' + g.amount : g.amount_note));

  console.log('\nliabilities: none declared (CY 2023)');
  console.log('status: filed | filing_year: 2024 (CY 2024)');
  console.log('data_completeness_note: ' + DATA_COMPLETENESS_NOTE.substring(0, 100) + '...');
}

async function main() {
  console.log('\n[us-mi-whitmer] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-mi-whitmer] DRY RUN — no writes.');
    console.log('[us-mi-whitmer] To apply: node tmp_us_mi_whitmer_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-MI').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                 SALARY,
      unearned_income:        UNEARNED_INCOME,
      investments:            INVESTMENTS,
      real_estate:            REAL_ESTATE,
      business_interests:     BUSINESS_INTERESTS,
      gifts:                  GIFTS,
      liabilities:            LIABILITIES,
      data_completeness_note: DATA_COMPLETENESS_NOTE,
      source_url:             SOURCE_URL,
      pdf_url_2026:           PDF_URL_2026,
      status:                 'filed',
      filing_year:            2024,
      filing_note:            'CY 2024 PFD filed June 13 2025 (deadline extended via SB 99/100 due to MiTN portal failures). CY 2023 first-ever PFD filed April 15 2024. CY 2025 PFD (2026 filing) posted at michigan.gov/whitmer.',
      last_updated:           NOW,
    },
    { merge: true }
  );

  console.log('\n[us-mi-whitmer] ✅ subnational_leader_transparency/US-MI updated.');
  console.log('[us-mi-whitmer] Done.');
}

main().catch(e => { console.error('[us-mi-whitmer] Fatal:', e.message); process.exit(1); });
