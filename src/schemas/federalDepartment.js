'use strict';

/**
 * Standard unified schema for a federal government department record.
 *
 * Used across all jurisdictions (CA, US, UK, AU) to normalise department-level
 * budget, staffing, and accountability data into a consistent Firestore shape.
 *
 * Firestore collection: federal_departments
 *
 * All monetary amounts are stored in the jurisdiction's local currency:
 *   CA → CAD  |  US → USD  |  UK → GBP  |  AU → AUD
 */

/**
 * @typedef {Object} GrantRecord
 * @property {string|null}  recipient   - Name of the grant recipient organisation
 * @property {number|null}  amount      - Grant value in local currency
 * @property {string|null}  currency    - ISO 4217 currency code (e.g. "CAD", "GBP")
 * @property {string|null}  purpose     - Brief description of the grant purpose
 * @property {string|null}  fiscal_year - Fiscal year the grant was awarded (e.g. "2024-25")
 * @property {string|null}  source_url  - URL to the grant disclosure or database entry
 */

/**
 * @typedef {Object} InternalSpendingRecord
 * @property {string|null}  category    - Spending category (e.g. "Salaries", "IT", "Travel")
 * @property {number|null}  amount      - Amount in local currency
 * @property {string|null}  currency    - ISO 4217 currency code (e.g. "CAD", "GBP")
 * @property {string|null}  description - Optional detail on what was purchased / why
 * @property {string|null}  fiscal_year - Fiscal year of the spend
 */

/**
 * @typedef {Object} SourceMetadata
 * @property {string|null}  source_name - Name of the data source (e.g. "Treasury Board of Canada")
 * @property {string|null}  source_url  - URL of the primary source document or API endpoint
 * @property {string|null}  retrieved_at - ISO 8601 timestamp of when data was fetched
 * @property {string|null}  fiscal_year - Fiscal year the source data covers
 * @property {string|null}  currency    - ISO 4217 currency code amounts are stored in
 */

/**
 * @typedef {Object} FederalDepartment
 *
 * Identity
 * @property {string}       department_id    - Unique document ID (e.g. "ca-dept-environment")
 * @property {string}       department_name  - Official department name as published by the government
 * @property {string}       jurisdiction     - ISO jurisdiction code: "CA" | "US" | "UK" | "AU"
 * @property {string|null}  currency         - ISO 4217 code for all monetary fields (e.g. "CAD")
 *
 * Leadership
 * @property {string|null}  leader_name      - Full name of the current Minister / Secretary / equivalent
 * @property {string|null}  leader_title     - Official title (e.g. "Minister of Finance")
 * @property {string|null}  political_party  - Party of the appointing government (e.g. "Liberal")
 * @property {string|null}  start_date       - ISO 8601 date the current leader took office
 *
 * Budget period
 * @property {string|null}  fiscal_year      - Fiscal year these figures cover (e.g. "2024-25")
 *
 * Financial figures (in local currency — see `currency` field)
 * @property {number|null}  budget_authority  - Total approved spending authority for the period
 * @property {number|null}  obligations       - Amount committed / obligated to date
 * @property {number|null}  outlays           - Amount actually disbursed / spent
 * @property {number|null}  remaining_balance - budget_authority minus obligations (or outlays)
 *
 * Workforce
 * @property {number|null}  employees_count  - Full-time equivalent headcount
 *
 * Mandate
 * @property {string|null}  responsibilities - Plain-language summary of the department's mandate
 *
 * Detailed spend breakdowns
 * @property {GrantRecord[]}            grants            - External grants awarded by the department
 * @property {InternalSpendingRecord[]} internal_spending - Internal operational expenditure line items
 *
 * Provenance
 * @property {SourceMetadata}  source_metadata - Where the data came from and when it was fetched
 *
 * Classification (US only)
 * @property {Object|null}  financial_classification - Structured semantics for published figures
 *          (type, scope, exclusions, source_transparency); obligations/outlays intentionally omitted at cabinet scope.
 */

/** Canonical field list — use this to validate or construct records programmatically. */
const FEDERAL_DEPARTMENT_FIELDS = [
  // Identity
  'department_id',
  'department_name',
  'jurisdiction',
  'currency',

  // Leadership
  'leader_name',
  'leader_title',
  'political_party',
  'start_date',

  // Budget period
  'fiscal_year',

  // Financial (local currency)
  'budget_authority',
  'obligations',
  'outlays',
  'remaining_balance',

  // Workforce
  'employees_count',

  // Mandate
  'responsibilities',

  // Detailed breakdowns (arrays)
  'grants',
  'internal_spending',

  // Provenance
  'source_metadata',

  // US: explicit metric semantics (cabinet vs federal-wide)
  'financial_classification',
];

/**
 * Returns a blank FederalDepartment record with every field initialised to its
 * zero value. Useful as a base when constructing records in fetchers.
 *
 * @param {Partial<FederalDepartment>} overrides
 * @returns {FederalDepartment}
 */
function createDepartmentRecord(overrides = {}) {
  const base = {
    department_id:     null,
    department_name:   null,
    jurisdiction:      null,
    currency:          null,
    leader_name:       null,
    leader_title:      null,
    political_party:   null,
    start_date:        null,
    fiscal_year:       null,
    budget_authority:  null,
    obligations:       null,
    outlays:           null,
    remaining_balance: null,
    employees_count:   null,
    responsibilities:  null,
    grants:            [],
    internal_spending: [],
    source_metadata:   {
      source_name:  null,
      source_url:   null,
      retrieved_at: null,
      fiscal_year:  null,
      currency:     null,
    },
    financial_classification: null,
  };
  return { ...base, ...overrides };
}

module.exports = { FEDERAL_DEPARTMENT_FIELDS, createDepartmentRecord };
