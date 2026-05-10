# Engine Cost & Credit Audit

**Audited:** 2026-05-10  
**Rule:** Do not run any job marked PAID or QUOTA-CRITICAL without explicit approval.  
**Part 1** covers the services matrix. This document is **Part 2**: per-job detail.

---

## How to read this document

- **Fetch-only option** — can the ingestion step run without triggering Claude?  
- **Preserves Firestore enrichment** — if the job re-runs, does it leave previously-written AI analysis fields intact?  
- **Behavior when credits missing** — what happens when `ANTHROPIC_API_KEY` is absent or quota-exhausted?  
- **Cost risk** — `free` · `low` (<10 Claude calls) · `medium` (10–100) · `high` (100+ or heavy Firestore) · `unknown`

---

## 1. Scheduler Cycles

### 1.1 Daily Cycle — `node src/scheduler.js --daily`
**Cron:** `0 2 * * *` (02:00 UTC daily)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Ingest bills & votes | Fetches bills/votes from `config/sources.json` (Congress.gov, OpenParliament, parliament.uk, aph.gov.au) | `CONGRESS_API_KEY` (falls back to `DEMO_KEY` if missing — rate-limited) | Free gov APIs only |
| 2 — Process bills with Claude | Calls `processBill()` once per bill in the latest output file | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, 1,024 tokens/bill** |
| 3 — Score efficiency | Local calculation from `scoreEfficiency.js` — reads bill/output files | None | None |
| 4 — Upload to Firestore | Writes `bills`, `votes`, `efficiency_scores` collections | Firebase credentials | Firestore batch writes |
| 4b — Elections (conditional) | Only if election ≤90 days away — fetches from elections.ca, FEC, DemocracyClub, AEC | None | Free gov APIs |

**Fetch-only option:** No built-in flag. To skip Claude, comment out step 2 (`processBillsFromOutput()`) or run only the pipeline directly. The fetch (step 1) and upload (step 4) can run without Claude if a previous enriched output file already exists.

**Behavior when credits missing:**  
`processBill()` throws on API error. The scheduler catches the error **per bill**, records `{ analysis: null, error: "..." }`, and continues to the next bill. After all bills, it writes a `bills_enriched_*.json` output file containing the failures with `analysis: null`. `uploadBills()` then reads this file and writes every bill to Firestore — including the failed ones with `analysis: null` as explicit field values.

**Preserves Firestore enrichment:** ❌ **NO.** `uploadBills()` writes `plainLanguageSummary: null`, `argumentsFor: []`, `analysis: null` for any bill where Claude failed. With `merge: true`, these null values overwrite previously-good enrichment fields in Firestore. A partial credit failure on re-run destroys enrichment for the failed bills.

**No skip-if-already-processed logic** — every daily run re-processes every bill in the pipeline, even ones enriched yesterday.

**Cost risk:** `medium` — depends on bill count in pipeline. Each new bill = 1 Claude Haiku call (~800 tokens input + 1,024 output). 100 bills ≈ $0.10; 1,000 bills ≈ $1.00. Firestore: low volume (hundreds of docs/day).

---

### 1.2 Weekly Cycle — `node src/scheduler.js --weekly`
**Cron:** `0 3 * * 0` (03:00 UTC every Sunday)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Ingest legislator profiles | `runPipeline(weeklySources)` — fetches member lists from Congress.gov, ourcommons.ca, parliament.uk, aph.gov.au | `CONGRESS_API_KEY` (optional); `THEYWORKFORYOU_API_KEY` (UK member source, **potentially paid**) | Free gov APIs; TheyWorkForYou = paid if not non-profit |
| 2 — Upload members | Writes `members` collection | Firebase | Firestore |
| 3 — Fetch member votes | CA: openparliament.ca (80ms delay); US: Congress.gov; UK: parliament.uk | `CONGRESS_API_KEY` | Free |
| 4 — Upload member votes | Writes `member_votes` | Firebase | Firestore |
| 5 — Fetch attendance | CA/US/UK attendance records from gov APIs | None required | Free |
| 6 — Upload attendance | Writes `member_attendance` | Firebase | Firestore |
| 7 — Fetch member bios | ourcommons.ca, bioguide.congress.gov, members.parliament.uk, aph.gov.au | `CONGRESS_API_KEY` | Free |
| 8 — Upload bios | Writes `member_bios` | Firebase | Firestore |
| 9 — Fetch committees | CA/US/UK/AU committee assignments | `CONGRESS_API_KEY` | Free |
| 10 — Upload committees | Writes `member_committees` | Firebase | Firestore |
| 11 — Fetch promises | liberal.ca mandate letters, WH priorities + EOs, UK King's Speech, AU ALP policies | None | Free web scraping |
| 12 — Upload promises | Writes `promise_tracker` | Firebase | Firestore |
| 13 — Fetch elections | elections.ca, FEC, DemocracyClub, AEC | None | Free |
| 14 — Upload elections | Writes `elections` | Firebase | Firestore |
| 15 — Fetch dept heads | canada.ca, US dept sites, gov.uk, directory.gov.au | None | Free web scraping |
| 16 — Upload dept heads | Writes `department_heads` | Firebase | Firestore |
| 17 — Validate cabinets | Scrapes live dept sites, compares vs Firestore, auto-updates changed heads | None | Free; triggers Firestore reads + writes |

**Fetch-only option:** Yes — no Claude is called anywhere in the weekly cycle.

**Behavior when credits missing:** Not applicable — no Claude calls.

**Preserves Firestore enrichment:** ✅ All uploads use `{ merge: true }`.  
⚠️ Exception: `validateAllCabinets()` directly updates cabinet docs in Firestore when changes are detected — this is intentional live correction, not enrichment.

**Cost risk:** `free` for Claude. Firestore: `medium` — member votes can be thousands of records per run. TheyWorkForYou UK source = `unknown` cost (depends on nonprofit status).

---

### 1.3 Monthly Cycle — `node src/scheduler.js --monthly`
**Cron:** `0 5 1 * *` (05:00 UTC on 1st of each month)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Ingest budget/audit/performance | `runPipeline(monthlySources)` — Open Canada, USAspending, data.gov.uk, data.gov.au | None | Free |
| 2 — Fetch audit findings | CA OAG, US GAO, UK NAO, AU ANAO reports | None | Free web scraping |
| 3 — Score efficiency | Local computation from output files | None | None |
| 4 — Upload efficiency/budget/audit | Writes `efficiency_scores_monthly`, `budget_spending`, `audit_findings`, `department_performance` | Firebase | Firestore |
| 5 — Targeted stats fetch | World Bank API, BLS, USAspending, CKAN — "live" snapshot stats | None | Free |
| 6 — Upload targeted stats | Writes `social_stats` (targeted) using `set()` without merge | Firebase | Firestore |
| 7 — Fetch dept budgets | CA/US/UK/AU budget breakdowns from open-data APIs | None | Free |
| 8 — Upload dept budgets | Writes `department_budgets` | Firebase | Firestore |
| 9 — Fetch foreign aid | World Bank ODA data, OECD DAC | None | Free |
| 10 — Upload foreign aid | Writes `foreign_aid` | Firebase | Firestore |
| 11 — Fetch gov contracts | Open Canada, USAspending, data.gov.uk, data.gov.au | None | Free |
| 12 — Upload contracts | Writes `government_contracts` | Firebase | Firestore |
| 13 — Fetch dept expenses | CA/US/UK/AU departmental spending reports | None | Free |
| 14 — Upload dept expenses | Writes `department_expenses` | Firebase | Firestore |

**Fetch-only option:** Yes — no Claude calls in the monthly cycle.

**Behavior when credits missing:** Not applicable.

**Preserves Firestore enrichment:** Mostly ✅ (`merge: true`).  
⚠️ Step 6 (`uploadTargetedStats`) uses `set()` without merge — **overwrites** `social_stats` docs for the 15 targeted fields without preserving any extra fields written by other jobs.

**Cost risk:** `free` for Claude. Firestore: `medium`–`high` depending on contract/expense volumes.

---

### 1.4 Bimonthly Cycle — `node src/scheduler.js --bimonthly`
**Cron:** `0 4 1,15 * *` (04:00 UTC on 1st and 15th)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Ingest disclosures/lobbying/contracts | `runPipeline(biMonthlySources)` — gov open-data APIs for financial disclosures, lobbying registers, contracts, corporate affiliations | None | Free |
| 2 — Fetch member disclosures & lobbying | US/UK/AU/CA disclosure portals | None | Free web scraping |
| 3 — Upload disclosures/lobbying/contracts/corp | Writes `financial_disclosures`, `lobbying_activity`, `contracts`, `corporate_affiliations`, `member_disclosures`, `member_lobbying` | Firebase | Firestore |
| 4 — Fetch member expenses | CA NDP/Liberal expense reports, US eFD portal, UK IPSA, AU member expenses | None | Free |
| 5 — Upload member expenses | Writes `member_expenses` | Firebase | Firestore |
| 6 — Fetch stock trades | US House STOCK Act PDFs (disclosures-clerk.house.gov); Senate skipped (no programmatic source) | None | Free PDF download |
| 7 — Upload stock trades | Writes `member_stock_trades` | Firebase | Firestore |
| 8 — Fetch corporate affiliations | CA ourcommons.ca, US LDA, UK register, AU members register | None | Free |
| 9 — Upload corporate affiliations | Writes `member_corporate_affiliations` | Firebase | Firestore |

**Fetch-only option:** Yes — no Claude calls anywhere in bimonthly cycle.  
Note: `fetchAllStockTrades()` downloads House PDFs but does NOT parse them with Claude. The `stockTradesPDFParser.js` is a separate script invoked by its own cron.

**Behavior when credits missing:** Not applicable.

**Preserves Firestore enrichment:** ✅ All uploads use `{ merge: true }`.

**Cost risk:** `free` for Claude. Firestore: `high` — lobbying + contracts can be tens of thousands of records per run (e.g., the CA lobbying set is 71k records, split across multiple days on Spark free tier).

---

### 1.5 Expense Cycle — `node src/scheduler.js --expenses`
**Cron:** `0 1 * * 3` (01:00 UTC every Wednesday)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Fetch expenses | CA proactive disclosure API, US USAspending.gov, UK HMRC, AU Finance | None | Free |
| 2 — Process with Claude | `processExpenses()` — batches 5 expense records/call; flags waste patterns, scores severity | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~1,024–2,000 tokens/batch** |
| 3 — Detect waste patterns | `detectWaste()` — second Claude pass; batches 8 records/call; identifies 12 waste keywords | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~512–1,700 tokens/batch** |
| 4 — Upload | Writes `flagged_expenses`, `waste_reports` | Firebase | Firestore |

**Fetch-only option:** No built-in flag. Step 1 can be run standalone with `node src/ingestion/expenseFetcher.js` (free). Steps 2–3 require Claude.

**Behavior when credits missing:**  
`processExpenses()` catches errors per batch. Failed batches get `flagReason: "Analysis unavailable: <error>"` rather than AI flags. Continues to next batch. The expense cycle itself does not crash on per-batch Claude failure.  
`detectWaste()` reads `expenses_enriched.json` produced by step 2. If step 2 wrote partial output, `detectWaste()` runs on whatever is there.  
If `ANTHROPIC_API_KEY` is missing entirely, the SDK throws immediately on first call and the whole expense cycle fails.

**Preserves Firestore enrichment:** ✅ `{ merge: true }` for `flagged_expenses`. `waste_reports` uses `{ merge: true }` at the per-jurisdiction summary level.

**Cost risk:** `medium`–`high`. Depends on number of expense records fetched. If 1,000 records: ~200 batches of 5 = 200 Haiku calls ≈ $0.10 for step 2, plus ~125 batches for step 3 ≈ $0.06. Scales linearly with expense volume.

---

### 1.6 Leader Expense Cycle — `node src/scheduler.js --leader-expenses`
**Cron:** `0 2 * * 4` (02:00 UTC every Thursday)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Fetch leader expenses | CA Treasury Board, US agency FOIA/proactive, UK Cabinet Office IPSA, AU Finance ministerial | None | Free |
| 2 — Process with Claude | `processLeaderExpenses()` — batches 5 leaders/call; produces waste scores, peer comparison, plain-language summary | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~512–2,000 tokens/batch** |
| 3 — Anomaly detection | `detectLeaderAnomalies()` — second Claude pass; batches 4 leaders/call; scores 6 anomaly pattern types (luxury, frequency, inconsistency, etc.) | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~2,048–7,000 tokens/batch** |
| 4 — Build leaderboard | `buildLeaderboard()` — local sort + trend arrows vs previous run output; no API | None | None |
| 5 — Upload expenses + anomalies | Writes `leader_expenses`, `expense_anomalies` | Firebase | Firestore |
| 6 — Upload leaderboard | Writes `expense_leaderboard` | Firebase | Firestore |

**Fetch-only option:** No built-in flag. `node src/ingestion/leaderExpenseFetcher.js` can run standalone (free).

**Behavior when credits missing:**  
Both processors throw if API key is missing or quota exhausted. The entire leader expense cycle fails at whichever step hits the error; any completed upload steps before the failure remain in Firestore.  
`leaderAnomalyDetector` has JSON recovery logic (regex fallback if Claude returns malformed JSON) but does not have a no-AI fallback path.

**Preserves Firestore enrichment:** ✅ `{ merge: true }` for all uploads.

**Cost risk:** `medium`. Typically ~20–80 ministers/secretaries across 4 jurisdictions. Step 2: ~5–16 batches of 5 ≈ $0.01–$0.03. Step 3: anomaly batches of 4 are token-heavier (~2,048–7k tokens each) ≈ $0.01–$0.10. Low absolute cost but runs every week.

---

### 1.7 Budget Analytics Cycle — `node src/scheduler.js --budget-analytics`
**Cron:** `0 6 1 * *` (06:00 UTC on 1st of each month)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Fetch budget analytics | World Bank, BLS, USAspending, open.canada.ca CKAN, data.gov.uk, data.gov.au — GDP, unemployment, inflation, crime, deficit | None | Free |
| 2 — Score efficiency | Local computation | None | None |
| 3 — Upload | Writes `budget_data`, `analytics_data` | Firebase | Firestore |

**Fetch-only option:** Yes — no Claude anywhere.

**Behavior when credits missing:** Not applicable.

**Preserves Firestore enrichment:** ✅ `{ merge: true }`.

**Cost risk:** `free`.

---

### 1.8 Gov Stats Cycle (Quarterly) — `node src/scheduler.js --gov-stats`
**Cron:** `0 7 1 1,4,7,10 *` (07:00 UTC on 1st of Jan, Apr, Jul, Oct)

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Fetch gov stats | World Bank fiscal indicators, BLS unemployment, USAspending grants, open.canada.ca CKAN — revenue, spending, deficit, debt, ODA, grants per dept | None | Free |
| 2 — Process with Claude | `processGovStats()` — one call per country (4 total); produces revenue/spending/debt insights, key bullets, fiscal health score | `ANTHROPIC_API_KEY` | **Claude Sonnet 4.6, ~1,200 tokens output × 4 countries** |
| 3 — Upload | Writes `government_stats` | Firebase | Firestore |

**Fetch-only option:** No built-in flag. `node src/ingestion/govStatsFetcher.js` can run standalone (free). The processor is a separate script.

**Behavior when credits missing:** `processGovStats()` throws on API error; the gov stats cycle fails and no Firestore write occurs for that quarter.

**Preserves Firestore enrichment:** ✅ `{ merge: true }`.

**Cost risk:** `low`. Exactly 4 Claude Sonnet 4.6 calls per quarter. Sonnet is ~10× more expensive than Haiku (~$0.02 per 4 calls at 1,200 output tokens each). Negligible absolute cost but uses the more expensive model.

---

### 1.9 `node src/scheduler.js --targeted-stats`
Not a scheduled cron — manual trigger only.

| Step | What it does | API keys required | AI/API usage |
|---|---|---|---|
| 1 — Targeted fetch | `runTargetedFetch()` — pulls 15 specific stats (unemployment rate, debt-to-GDP, etc.) from World Bank, BLS, and open-data APIs | None | Free |
| 2 — Upload | `uploadTargetedStats()` — writes `social_stats` using `set()` without merge | Firebase | Firestore |

**Preserves Firestore enrichment:** ⚠️ `set()` without merge — **overwrites** the 15 targeted stat docs entirely. Does not destroy other `social_stats` docs (different doc IDs) but overwrites the targeted ones.

**Cost risk:** `free`.

---

## 2. Standalone Fetcher / Enrichment Scripts

These are not wired into the scheduler and are run manually.

| Script | What it does | API keys required | AI/API usage | Fetch-only or no-AI option | Behavior when credits missing | Preserves Firestore enrichment | Cost risk |
|---|---|---|---|---|---|---|---|
| `src/ingestion/caConflictOfInterestFetcher.js` | Fetches 343 current Canadian MPs from ourcommons.ca; sets COI disclosure fields to null (CIEC is JS-only) | None | None | Yes — fetch-only by design | N/A | ✅ `merge: true` | `free` |
| `src/ingestion/caLobbyingFetcher.js` | Downloads OCL bulk CSV from lobbycanada.gc.ca; matches 71k DPOH communications to current MPs; saves to `member_lobbying` | None | None | Yes — fetch-only by design | N/A | ✅ `merge: true`; has resume logic to skip existing docs | `free` for Claude; Firestore: `high` (71k writes — requires 4 days on Spark free tier or Blaze) |
| `src/ingestion/congressFetcher.js` | Fetches all 536 US House + Senate members from Congress.gov API | `CONGRESS_API_KEY` (falls back to `DEMO_KEY`) | None | Yes | N/A | ✅ `merge: true` | `free` |
| `src/ingestion/supremeCourtFetcher.js` | Fetches CA/US/UK/AU supreme court cases; AU uses Wikipedia HCA category (2s delay); others use gov court sites | None | None | Yes | N/A | ✅ `merge: true` | `free` |
| `src/ingestion/leaderProfileFetcher.js` | Fetches profile sections for Trump, Albanese, Starmer from public gov websites | None | None | Yes | N/A | ✅ `merge: true` | `free` |
| `src/ingestion/carneyProfileFetcher.js` | Fetches Mark Carney's 4 profile sections from pm.gc.ca | None | None | Yes | N/A | ✅ `merge: true` | `free` |
| `src/processing/billProcessor.js` (standalone) | Processes a single bill through Claude Haiku | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, 1,024 tokens** | No | Throws immediately | N/A — writes to local file only | `low` per bill |
| `src/processing/expenseProcessor.js` (standalone) | Reads expense output files, batches through Claude Haiku, writes `expenses_enriched.json` | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~1,024–2,000 tokens/batch of 5** | No | Catches per-batch; continues with `flagReason: "Analysis unavailable"` | N/A — writes to local file; Firestore written by uploader separately | `medium`–`high` |
| `src/processing/wasteDetector.js` (standalone) | Reads `expenses_enriched.json`, runs second Claude pass for waste patterns, writes `waste_report.json` | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~512–1,700 tokens/batch of 8** | No | Throws if API key missing; per-batch catch otherwise | N/A — writes to local file | `medium` |
| `src/processing/leaderExpenseProcessor.js` (standalone) | Reads leader expense files, batches through Claude Haiku, writes `leader_expenses_enriched.json` | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~512–2,000 tokens/batch of 5** | No | Throws on missing key; per-batch catch otherwise | N/A — writes to local file | `medium` |
| `src/processing/leaderAnomalyDetector.js` (standalone) | Reads enriched leader expenses, runs anomaly scoring through Claude Haiku | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~2,048–7,000 tokens/batch of 4** | No | Throws on missing key; JSON recovery fallback for malformed responses | N/A — writes to local file | `medium` |
| `src/processing/govStatsProcessor.js` (standalone) | Reads gov stats output, generates 4 country summaries through Claude Sonnet 4.6 | `ANTHROPIC_API_KEY` | **Claude Sonnet 4.6, ~1,200 tokens × 4 calls** | No | Throws on missing key | N/A — writes to local file | `low` |
| `src/processing/stockTradesPDFParser.js` (standalone) | Reads downloaded House stock trade PDFs, extracts trades using Claude Haiku with retry (max 4 attempts, exponential backoff for 429) | `ANTHROPIC_API_KEY` | **Claude Haiku 4.5, ~1,024 tokens/PDF** | No | Retries on 429; throws on auth error | N/A — writes to local file | `medium`–`unknown` (depends on PDF count) |

---

## 3. Critical Findings

### 3.1 Daily cycle destroys bill enrichment on partial failure
The daily cycle processes every bill on every run with no "skip if already enriched" guard. If Claude fails mid-run (key missing, quota exhausted, network error), the scheduler writes `analysis: null` for failed bills and the uploader writes those null values to Firestore via `{ merge: true }`, **overwriting any previously-good enrichment**. A single failed daily run can zero out enrichment for bills that were successfully processed the day before.

### 3.2 `social_stats` canonical upload deletes before rewriting
`uploadSocialStats()` (the canonical 8×4 matrix) **deletes all existing `social_stats` docs** before writing new ones. If the fetch or build step fails after the delete, the collection is left empty.

### 3.3 No AI credit budget guard in any cycle
No cycle checks the Claude API balance or rate limit before starting. A cycle that starts when credits are near-zero will partially spend credits, partially enrich data, and leave a mixed Firestore state.

### 3.4 `node src/scheduler.js` (no flags) starts all crons immediately on startup
Running the scheduler with no arguments registers all 8 cron schedules **and immediately runs all cycles on startup** (see line 808: `console.log('[scheduler] Running initial cycles on startup...')`). This means simply starting the process triggers a full run within seconds.

### 3.5 TheyWorkForYou key absent = warning only, request continues
If `THEYWORKFORYOU_API_KEY` is not set, `fetcher.js` logs a warning but still makes the request — the API may return an error or a degraded response rather than refusing. If the API requires a key and the key is absent, the response will likely be a 403/401 but it will not halt the weekly cycle (the error propagates to the pipeline runner).

---

## 4. Approval Matrix

| Action | Approved to run freely? |
|---|---|
| `node src/ingestion/caConflictOfInterestFetcher.js` | ✅ Yes |
| `node src/ingestion/caLobbyingFetcher.js` | ✅ Yes (free APIs; Firestore quota managed by resume logic) |
| `node src/ingestion/congressFetcher.js` | ✅ Yes |
| `node src/ingestion/supremeCourtFetcher.js` | ✅ Yes |
| `node src/ingestion/leaderProfileFetcher.js` | ✅ Yes |
| `node src/ingestion/carneyProfileFetcher.js` | ✅ Yes |
| Any other standalone fetcher (no Claude, free API) | ✅ Yes — verify first |
| `node src/scheduler.js --weekly` | ✅ Yes (no Claude; TheyWorkForYou status unknown) |
| `node src/scheduler.js --monthly` | ✅ Yes (no Claude; monitor Firestore write count) |
| `node src/scheduler.js --bimonthly` | ✅ Yes (no Claude; monitor Firestore write count) |
| `node src/scheduler.js --budget-analytics` | ✅ Yes (no Claude) |
| `node src/scheduler.js --targeted-stats` | ✅ Yes (no Claude; note: overwrites social_stats targeted docs) |
| `node src/scheduler.js --daily` | ⛔ Requires approval — calls Claude per bill |
| `node src/scheduler.js --expenses` | ⛔ Requires approval — calls Claude per batch |
| `node src/scheduler.js --leader-expenses` | ⛔ Requires approval — calls Claude per batch |
| `node src/scheduler.js --gov-stats` | ⛔ Requires approval — calls Claude Sonnet (more expensive) |
| `node src/scheduler.js` (no flags) | ⛔ Requires approval — starts ALL cycles immediately |
| `node src/scheduler.js --now` | ⛔ Requires approval — runs all cycles sequentially |
| Any `src/processing/*.js` processor | ⛔ Requires approval — all call Claude |

---

*Last updated: 2026-05-10. Re-audit after adding any new ingestion script, processor, or scheduler step.*
