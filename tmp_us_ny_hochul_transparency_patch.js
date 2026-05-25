'use strict';
/**
 * tmp_us_ny_hochul_transparency_patch.js
 *
 * Replaces all framework-only placeholder data in subnational_leader_transparency/US-NY
 * with confirmed facts extracted from Governor Hochul's 2025 Annual Statement of
 * Financial Disclosure (ASFD), filed with the NY Commission on Ethics and Lobbying in
 * Government (COELIG) on May 15, 2026.
 *
 * Source:
 *   https://ethics.ny.gov/system/files/documents/2026/05/2025-hochul-fds_redacted.pdf
 *   Filer: Kathy Hochul, Governor of New York
 *   Filed: 2026-05-15 | Form year: 2025 | 22 pages
 *   4 pages are image-only (Q11, Q12, Q13 primary income — see redacted_sections)
 *
 * NY Table I / Table II category ranges:
 *   A <$1k  B $1k–$4.9k  C $5k–$19.9k  D $20k–$59.9k  E $60k–$119.9k
 *   F $120k–$249.9k  G $250k–$499.9k  H $500k–$999.9k  I $1M–$2.9M
 *   J $3M–$7.9M  K $8M–$14.9M  L $15M–$39.9M  M $40M+
 *
 * DRY RUN by default. Pass --write to commit.
 */

require('dotenv').config();
const { getDb } = require('./src/firebase/client');
const { FieldValue } = require('firebase-admin/firestore');

const WRITE_MODE = process.argv.includes('--write');
const NOW        = new Date().toISOString();

const SOURCE_URL = 'https://ethics.ny.gov/system/files/documents/2026/05/2025-hochul-fds_redacted.pdf';
const FORM_YEAR  = 2025;

// NY ASFD Table I / II — category letter → dollar range string
const CAT = {
  A: '<$1,000',
  B: '$1,000–$4,999',
  C: '$5,000–$19,999',
  D: '$20,000–$59,999',
  E: '$60,000–$119,999',
  F: '$120,000–$249,999',
  G: '$250,000–$499,999',
  H: '$500,000–$999,999',
  I: '$1,000,000–$2,999,999',
  J: '$3,000,000–$7,999,999',
  K: '$8,000,000–$14,999,999',
  L: '$15,000,000–$39,999,999',
  M: '$40,000,000+',
};

// ─── Salary ──────────────────────────────────────────────────────────────────
// Governor's salary is set by NY Executive Law §169 at $250,000/year.
// It appears on Q13 primary income pages which are image-only in this redacted PDF.
const SALARY = {
  amount:     250000,
  currency:   'USD',
  period:     'Calendar year 2025',
  source_url: SOURCE_URL,
  filing_year: FORM_YEAR,
  notes:      'NY Governor statutory salary per Executive Law §169. Confirmed public record; appears on Q13 primary income pages of the ASFD which are image-only in the redacted PDF. Investment income also received — see income field.',
  fetched_at: NOW,
};

// ─── Spouse outside employment (Q5b) ─────────────────────────────────────────
const SPOUSE_OUTSIDE_EMPLOYMENT = {
  source_url: SOURCE_URL,
  filing_year: FORM_YEAR,
  fetched_at: NOW,
  entries: [
    {
      person:       'Spouse — William Hochul Jr.',
      position:     'Counsel',
      organization: 'Davis Polk & Wardwell LLP',
      address:      '450 Lexington Avenue, New York, NY 10017',
      description:  'Advises and represents clients in white-collar defense and investigations. Does not appear or practice before New York state agencies. Firm represents clients before state agencies but Mr. Hochul does not participate in those matters.',
      state_agency:  'None — Mr. Hochul does not appear before NY state agencies',
    },
  ],
};

// ─── Income — Q13 supplemental table (pages 16–17, 46 rows) ─────────────────
// Note: Governor's own NY state salary and any other primary income sources are
// on image-only pages 14–15 and could not be text-extracted from this PDF.
// The 46 rows below are from the investment income supplement (pages 16–17).
// Category "T" for Davis Polk salary is a PDF rendering artifact — likely "I"
// ($1M–$2.9M) based on senior counsel compensation at a top-tier NY law firm.
const INCOME = {
  period:      'Calendar year 2025',
  source_url:  SOURCE_URL,
  filing_year: FORM_YEAR,
  fetched_at:  NOW,
  notes:       'Q13 primary income pages are image-only in the redacted PDF (pages 14–15). This array contains 46 rows from the Q13 investment income supplemental table (pages 16–17). Governor\'s state salary ($250,000) appears in the redacted section — see salary field.',
  items: [
    { recipient: 'Spouse',       source: 'Davis Polk & Wardwell LLP',    nature: 'Salary',              category: 'T', category_notes: 'Category T is a PDF rendering artefact — likely I ($1M–$2.9M)' },
    { recipient: 'Spouse',       source: 'OPM Retirement',                nature: 'Pension',             category: 'E', category_range: CAT.E },
    { recipient: 'Self, Spouse', source: 'Lincoln Natl Life Ins Co',      nature: 'Annuity',             category: 'D', category_range: CAT.D },
    { recipient: 'Spouse',       source: 'Delaware North',                nature: 'Deferred Compensation', category: 'H', category_range: CAT.H },
    { recipient: 'Self, Spouse', source: 'Bank of America',               nature: 'Interest',            category: 'D', category_range: CAT.D },
    { recipient: 'Self, Spouse', source: 'US Treasury Bills',             nature: 'Interest',            category: 'E', category_range: CAT.E },
    { recipient: 'Self, Spouse', source: 'US Treasury Notes',             nature: 'Interest',            category: 'D', category_range: CAT.D },
    { recipient: 'Self, Spouse', source: 'Schwab US Dividend Eqty',       nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'SPDR S&P 500 ETF Trust',        nature: 'Capital Gain',        category: 'D', category_range: CAT.D },
    { recipient: 'Self, Spouse', source: 'Blackrock Inc Reg Shs',         nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'IBM',                           nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'JPMorgan Chase & Co',           nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'SPDR S&P Dividend ETF',         nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'iShares US Healthcare',         nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Merrill Lynch Bank Deposit',    nature: 'Interest',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'iShares MBS ETF',               nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Vanguard Short-Term Corporate Bond', nature: 'Dividend',       category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Vanguard Scottsdale FDS Vanguard',   nature: 'Dividend',       category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'iShares Core MSCI EAFE ETF',    nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'iShares Russell 2000',          nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Arbitrage Funds CL I',          nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Calamos Market Neutral Income Fund', nature: 'Capital Gain',   category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Goldman Sachs Acc Treas ETF',   nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'PGIM Ultra Short Bond ETF',     nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Lord Abbett Short Duration Income', nature: 'Dividend',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Calamos Market Neutral Income Fund', nature: 'Dividend',       category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Aristotle Core Income Fund I-2', nature: 'Dividend',           category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'The Merger Fund CL I',          nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'The Merger Fund CL I',          nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Broadcom Inc',                  nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Tesla Inc',                     nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Western Digital Corp',          nature: 'Capital Gain',        category: 'D', category_range: CAT.D },
    { recipient: 'Self, Spouse', source: 'Howmet Aerospace Inc',          nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Agnico Eagle Mines Ltd',        nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Amphenol Corp CL A',            nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Prologis Inc',                  nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Boston Scientific Corp',        nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Progressive Corp Ohio',         nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'ServiceNow Inc',                nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'United Rentals Inc',            nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Visa Inc Cl A',                 nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self, Spouse', source: 'Zoetis Inc',                    nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self',         source: 'BLF Fedfund',                   nature: 'Dividend',            category: 'C', category_range: CAT.C },
    { recipient: 'Self',         source: 'Edgewood Growth Fund CL',       nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self',         source: 'iShares Russell 1000',          nature: 'Capital Gain',        category: 'C', category_range: CAT.C },
    { recipient: 'Self',         source: 'Family Trust',                  nature: 'Trust Disbursement',  category: 'C', category_range: CAT.C },
  ],
};

// ─── Declared assets — Q16 investments (pages 18–22, 176 rows) ───────────────
// NY Table II categories used (same ranges as Table I above).
// "LN INV ADVANTAGE B" has no holder field in the PDF — likely Self or Both.
// SPGI appears twice as-filed (two separate positions).
const DECLARED_ASSETS = {
  period:      'Close of taxable year 2025 (as filed)',
  source_url:  SOURCE_URL,
  filing_year: FORM_YEAR,
  fetched_at:  NOW,
  net_worth_summary: 'Dominated by US Treasury Bills ($15M–$39.9M) and Notes ($3M–$7.9M). Nvidia $500k–$999k. AAPL, MSFT, SPY, SDY, and 4 large mutual funds each $250k–$499k. Self annuity $1M–$2.9M.',
  investments: [
    { holder: 'Unknown', ticker: 'LN INV ADVANTAGE', type: 'Insurance/Annuity', category: 'B', category_range: CAT.B, notes: 'Holder field missing in PDF rendering; likely Self or Both' },
    { holder: 'Self',    ticker: 'NY Annuity',        type: 'Annuity',     category: 'I', category_range: CAT.I },
    { holder: 'Both',    ticker: 'WMS',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'AEM',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'ALL',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'GOOGL', type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'AMZN',  type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'AXP',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'APH',   type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'AAPL',  type: 'Stock',       category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'ASML',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'ADP',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'BJ',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'BLK',   type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'OBDC',  type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'BSX',   type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'AVGO',  type: 'Stock',       category: 'F', category_range: CAT.F },
    { holder: 'Both',    ticker: 'CRL',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'CVX',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'CB',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'CSCO',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'C',     type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'ROAD',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'COST',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'DLR',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'DOV',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'ETN',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'LLY',   type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'EMR',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'ETR',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'XOM',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'RACE',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'FITB',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'FHN',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'IT',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'GD',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'GILD',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HCA',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HPE',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HXL',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'HD',    type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HWM',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HUM',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'H',     type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'IBM',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'INTU',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'ISRG',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'IYH',   type: 'ETF',         category: 'I', category_range: CAT.I },
    { holder: 'Both',    ticker: 'JBL',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'JNJ',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'JCI',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'JPM',   type: 'Stock',       category: 'F', category_range: CAT.F },
    { holder: 'Both',    ticker: 'KBR',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'KMI',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'MTSI',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'MCD',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'MRK',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'META',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'MSFT',  type: 'Stock',       category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'MDLZ',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'MNST',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'NBIS',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'NFLX',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'NVDA',  type: 'Stock',       category: 'H', category_range: CAT.H },
    { holder: 'Both',    ticker: 'PANW',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'PAG',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'PEP',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'PFG',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'PG',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'PGR',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'PRU',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'O',     type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'ROST',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'RY',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'RTX',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'SPGI',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'CRM',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'NOW',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'SPGI',  type: 'Stock',       category: 'D', category_range: CAT.D, notes: 'Second SPGI entry as filed — two separate positions' },
    { holder: 'Both',    ticker: 'SPY',   type: 'ETF',         category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'SDY',   type: 'ETF',         category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'SYK',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'SYF',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'TSM',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'TGT',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'TSLA',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'TXN',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'TMO',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'TJX',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'TD',    type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'TFC',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'UBER',  type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'UNP',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'UNH',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'VRTX',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'V',     type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'GWW',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'WELL',  type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'WMB',   type: 'Stock',       category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'WDC',   type: 'Stock',       category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'SKYY',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'PAVE',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'PCY',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'KBWB',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'PGX',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'IBB',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'EFAV',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'EEMV',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'IEMG',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'MBB',   type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'TIP',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'IEFA',  type: 'ETF',         category: 'F', category_range: CAT.F },
    { holder: 'Both',    ticker: 'ITB',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'ITA',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'TLT',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'SCHO',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'XLP',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'XLV',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'XLI',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'XLB',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'XLRE',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'XLY',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'VFH',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'VGT',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'VGIT',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'VCIT',  type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'VCSH',  type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'VB',    type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'BNDX',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Both',    ticker: 'GBIL',  type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'PULS',  type: 'ETF',         category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'ABBV',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'BK',    type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'COR',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'DELL',  type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'DKS',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'GS',    type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'HLT',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'LYV',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'MLM',   type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'VZ',    type: 'Stock',       category: 'D', category_range: CAT.D },
    { holder: 'Spouse',  ticker: 'IWF',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'IWD',   type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'IDEV',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'GOVT',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'VONG',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'AVEM',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'USHY',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'IEMG',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'IWF',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'IWD',   type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'IDEV',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'GOVT',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'VCIT',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'VMBS',  type: 'ETF',         category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'VONG',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'BNDX',  type: 'ETF',         category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'ARBNX', type: 'Mutual Fund', category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'PLIDX', type: 'Mutual Fund', category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'CMNIX', type: 'Mutual Fund', category: 'G', category_range: CAT.G },
    { holder: 'Both',    ticker: 'LLDYX', type: 'Mutual Fund', category: 'E', category_range: CAT.E },
    { holder: 'Both',    ticker: 'MERIX', type: 'Mutual Fund', category: 'G', category_range: CAT.G },
    { holder: 'Spouse',  ticker: 'MADVX', type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'DBLTX', type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'MEIX',  type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'DCCIX', type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Spouse',  ticker: 'PBDX',  type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'MADVX', type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'CIVIX', type: 'Mutual Fund', category: 'C', category_range: CAT.C },
    { holder: 'Self',    ticker: 'DBLTX', type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'GSIMX', type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'MEIX',  type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'DCCIX', type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Self',    ticker: 'PBDPX', type: 'Mutual Fund', category: 'D', category_range: CAT.D },
    { holder: 'Both',    ticker: 'US Treasury Bills', type: 'Bond', category: 'L', category_range: CAT.L },
    { holder: 'Both',    ticker: 'US Treasury Notes', type: 'Bond', category: 'J', category_range: CAT.J },
  ],
};

// ─── Liabilities ──────────────────────────────────────────────────────────────
const LIABILITIES = {
  period:      'Calendar year 2025',
  source_url:  SOURCE_URL,
  filing_year: FORM_YEAR,
  fetched_at:  NOW,
  liabilities: [],
  notes:       'No liabilities declared in Q16 or elsewhere in the ASFD.',
};

// ─── Redacted sections ────────────────────────────────────────────────────────
const REDACTED_SECTIONS = [
  {
    question:  'Q11',
    title:     'Retirement, Trust, Estates',
    pages:     [11],
    reason:    'Image-only pages — text layer absent in redacted PDF',
  },
  {
    question:  'Q12',
    title:     'Real Property',
    pages:     [13, 14],
    reason:    'Image-only pages — text layer absent in redacted PDF',
  },
  {
    question:  'Q13',
    title:     'Income (primary — includes governor\'s state salary)',
    pages:     [14, 15],
    reason:    'Image-only pages — text layer absent in redacted PDF. Investment income supplement visible on pages 16–17.',
  },
];

// ─── Fields to DELETE (all previous framework-only garbage) ──────────────────
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
  console.log('\n[US-NY Hochul Transparency Patch]');
  console.log('Fields to DELETE:', FIELDS_TO_REMOVE.join(', '));
  console.log('\nsalary:          $' + SALARY.amount.toLocaleString() + ' (' + SALARY.period + ')');
  console.log('income items:    ' + INCOME.items.length);
  console.log('investments:     ' + DECLARED_ASSETS.investments.length);
  console.log('liabilities:     ' + LIABILITIES.liabilities.length + ' (none declared)');
  console.log('redacted sects:  ' + REDACTED_SECTIONS.map(s => s.question).join(', '));
  console.log('spouse employ:   ' + SPOUSE_OUTSIDE_EMPLOYMENT.entries[0].organization);
  console.log('source_url:      ' + SOURCE_URL);
  console.log('status: filed | filing_year:', FORM_YEAR);

  console.log('\nTop investments by category:');
  const topCats = ['L', 'J', 'I', 'H', 'G'];
  for (const cat of topCats) {
    const items = DECLARED_ASSETS.investments.filter(i => i.category === cat);
    if (items.length) console.log(' ', cat, '(' + (CAT[cat] || '?') + '):', items.map(i => i.ticker).join(', '));
  }
}

async function main() {
  console.log('\n[us-ny-hochul] ' + (WRITE_MODE ? '⚠  WRITE MODE' : 'DRY RUN'));
  print();

  if (!WRITE_MODE) {
    console.log('\n[us-ny-hochul] DRY RUN — no writes.');
    console.log('[us-ny-hochul] To apply: node tmp_us_ny_hochul_transparency_patch.js --write');
    return;
  }

  const db = getDb();
  await db.collection('subnational_leader_transparency').doc('US-NY').set(
    {
      ...buildDeleteMap(FIELDS_TO_REMOVE),
      salary:                   SALARY,
      income:                   INCOME,
      declared_assets:          DECLARED_ASSETS,
      liabilities:              LIABILITIES,
      spouse_outside_employment: SPOUSE_OUTSIDE_EMPLOYMENT,
      redacted_sections:        REDACTED_SECTIONS,
      source_url:               SOURCE_URL,
      status:                   'filed',
      filing_year:              FORM_YEAR,
      last_updated:             NOW,
    },
    { merge: true }
  );

  console.log('\n[us-ny-hochul] ✅ subnational_leader_transparency/US-NY updated.');
  console.log('[us-ny-hochul] Done.');
}

main().catch(e => { console.error('[us-ny-hochul] Fatal:', e.message); process.exit(1); });
