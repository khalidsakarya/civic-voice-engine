# Engine Cost & Credit Audit

**Audited:** 2026-05-10  
**Scope:** All files under `src/` — ingestion, processing, firebase layers  
**Rule:** Do not run any job marked PAID or QUOTA-CRITICAL without explicit approval.

---

## Summary Table

| Service | Category | Plan / Tier | Per-Run Cost | Approval Required? |
|---|---|---|---|---|
| Anthropic Claude API | AI credits | Pay-per-token | $0.01–$5+ per run | **YES** |
| Google Firestore | Quota-limited writes | Spark (free) or Blaze | Free up to 20k writes/day; $0.06/100k on Blaze | **YES for bulk writes** |
| TheyWorkForYou API | Paid API | £20+/month (or free for nonprofits) | Per-request | **YES — verify nonprofit status** |
| Congress.gov API | Free + API key | Free tier | Free | No |
| OpenParliament.ca | Free | Free | Free | No |
| USAspending.gov | Free | Free | Free | No |
| UK Parliament APIs | Free | Free | Free | No |
| lobbycanada.gc.ca | Free bulk CSV | Free | Free | No |
| ourcommons.ca | Free HTML scrape | Free | Free | No |
| Wikipedia MediaWiki API | Free | Free | Free | No |
| All other gov data APIs | Free | Free | Free | No |

---

## 1. Anthropic Claude API — PAID, AI CREDITS

**SDK:** `@anthropic-ai/sdk ^0.78.0`  
**Key env var:** `ANTHROPIC_API_KEY`  
**Pricing (Haiku 4.5):** ~$0.80 input / $2.40 output per 1M tokens  
**Pricing (Sonnet 4.6):** ~$3.00 input / $15.00 output per 1M tokens

### Processors that call Claude

| File | Model | max_tokens | Batch size | Triggered by |
|---|---|---|---|---|
| `src/processing/billProcessor.js` | haiku-4-5 | 1,024 | 1 bill/call | Daily cron (02:00) |
| `src/processing/expenseProcessor.js` | haiku-4-5 | 1,024 + 200×batch | 5 records/call | Monthly cron (1st) |
| `src/processing/wasteDetector.js` | haiku-4-5 | 512 + 150×batch | 8 records/call | Monthly cron (1st) |
| `src/processing/leaderExpenseProcessor.js` | haiku-4-5 | 512 + 300×leaders | 5 leaders/call | Monthly cron (1st) |
| `src/processing/leaderAnomalyDetector.js` | haiku-4-5 | 2,048 + 1,200×batch | 4 leaders/call | Monthly cron (1st) |
| `src/processing/govStatsProcessor.js` | **sonnet-4-6** | 1,200 | 1 country/call | Monthly gov-stats cycle |
| `src/processing/supremeCourtProcessor.js` | haiku-4-5 | 600 | 1 case/call | Weekly cron (Sunday 03:00) |
| `src/processing/stockTradesPDFParser.js` | haiku-4-5 | 1,024 | 1 PDF/call | Bimonthly (1st & 15th) |
| `src/processing/claude.js` | haiku-4-5 | 4,096 | generic | Various callers |

### Rough cost estimate per full scheduler run

- **Daily** (bills only): 10–200 bills × ~800 tokens avg = $0.002–$0.04
- **Weekly** (court cases): 5–50 cases × ~600 tokens = <$0.01
- **Monthly** (expenses + waste + leaders + gov stats): 500–5,000 API calls, Haiku-heavy = **$0.50–$5.00**
- **Bimonthly** (stock trade PDFs): variable, typically <$0.50

**Monthly total estimate: $2–$10 under normal load; can spike to $50+ if expense/waste processors run over large datasets.**

### What triggers these processors

The scheduler (`src/scheduler.js`) runs four cron cycles:

| Cycle | Default schedule | Claude processors invoked |
|---|---|---|
| Daily | `0 2 * * *` (02:00 daily) | `billProcessor` |
| Weekly | `0 3 * * 0` (03:00 Sunday) | `supremeCourtProcessor` |
| Monthly | `0 5 1 * *` (05:00 on 1st) | `expenseProcessor`, `wasteDetector`, `leaderExpenseProcessor`, `leaderAnomalyDetector`, `govStatsProcessor` |
| Bimonthly | `0 4 1,15 * *` (04:00 on 1st & 15th) | `stockTradesPDFParser` |

> **The scheduler is a long-running process.** Starting `node src/scheduler.js` or `node src/index.js` will silently queue all of the above on their cron schedules and begin spending AI credits automatically.

---

## 2. Google Firestore — QUOTA-LIMITED WRITES

**SDK:** `firebase-admin ^13.7.0`  
**Free tier (Spark):** 20,000 writes/day, 50,000 reads/day, 1 GB storage  
**Blaze (pay-as-you-go):** $0.06/100k writes, $0.06/100k reads, $0.18/GB/month

### Collections written by the engine

`bills`, `members`, `votes`, `efficiency_scores`, `budget_spending`, `audit_findings`, `financial_disclosures`, `lobbying_activity`, `member_disclosures`, `member_lobbying`, `member_attendance`, `member_committees`, `member_corporate_affiliations`, `member_stock_trades`, `member_votes`, `bills_enacted_summary`, `social_stats`, `gov_stats`, `expense_anomalies`, `leader_expenses`, `expense_records`, `scheduler_status`, `audit_logs`

### Quota-critical ingestion scripts

| Script | Writes per run | Risk |
|---|---|---|
| `src/ingestion/caLobbyingFetcher.js` | 71,146 total (resume-aware) | Exceeds Spark daily limit — requires 4 days on Spark or Blaze |
| `src/ingestion/caConflictOfInterestFetcher.js` | 343 | Safe on Spark |
| `src/ingestion/congressFetcher.js` | 536 members | Safe on Spark |
| `src/firebase/uploader.js` (weekly cycle) | 1,000–10,000+ | Can breach Spark limit in weekly run |
| `src/firebase/uploadMemberVotes.js` | Potentially 10,000+ | High risk on Spark |
| `src/firebase/uploadExpenses.js` | Variable | Monitor |

**Current Firestore plan:** Assumed Spark (free). The CA lobbying load (71k records) confirmed the 20k/day cap. Upgrade to Blaze before running any bulk ingestion job with >20k records in one day.

---

## 3. TheyWorkForYou API — POTENTIALLY PAID

**Config:** `config/sources.json` → source `uk_theyworkforyou_mps`  
**URL:** `https://www.theyworkforyou.com/api/getMPs`  
**Key env var:** `THEYWORKFORYOU_API_KEY`  
**Pricing:** Free for registered charities/non-profits; £20+/month for commercial use  
**Used in:** `src/ingestion/memberBioFetcher.js` (weekly cycle)

> **Action required:** Confirm whether this project qualifies for the non-profit exemption before the weekly cycle runs. If not exempt, each weekly run incurs a charge.

---

## 4. Government Data APIs — Free, Rate-Limited

These are all free but may return HTTP 429 if called too aggressively. Rate-limit handling is already implemented in the codebase (delays, retry with backoff).

| API | Rate limit handling | Location |
|---|---|---|
| Congress.gov | `CONGRESS_API_KEY` env var, no explicit delay | `congressFetcher.js` |
| OpenParliament.ca | 80ms delay between requests | `memberVotesFetcher.js` |
| Wikipedia MediaWiki | 2s delay between requests | `supremeCourtFetcher.js` |
| USAspending.gov | No explicit delay (low volume) | `budgetAnalyticsFetcher.js` |
| Federal Register | No explicit delay (low volume) | `executiveActionsFetcher.js` |
| UK Parliament | No explicit delay (low volume) | various |
| Data.gov.au / Data.gov.uk | No explicit delay (low volume) | various |
| lobbycanada.gc.ca | Bulk CSV download (one request) | `caLobbyingFetcher.js` |

---

## 5. Jobs Safe to Run Without Approval

These scripts make only free API calls and write ≤20k Firestore docs per run:

- `src/ingestion/caConflictOfInterestFetcher.js` — 343 writes
- `src/ingestion/congressFetcher.js` — 536 writes
- `src/ingestion/supremeCourtFetcher.js` — scrapes Wikipedia, writes <100
- `src/ingestion/leaderProfileFetcher.js` — <50 writes
- `src/ingestion/carneyProfileFetcher.js` — <50 writes
- Any fetcher that only reads from free gov APIs and writes small doc counts

---

## 6. Jobs That Require Explicit Approval Before Running

| Job | Reason |
|---|---|
| `node src/scheduler.js` / `node src/index.js` | Starts all cron cycles — will spend Claude credits automatically |
| `node src/processBills.js` | Calls Claude per bill |
| Any `src/processing/*.js` processor run directly | All call Claude API |
| `node src/ingestion/caLobbyingFetcher.js` (if Firestore is still on Spark and <20k quota remaining) | Hits daily write cap |
| Any bulk uploader writing >20k docs in one session | Firestore quota |
| Any job using `THEYWORKFORYOU_API_KEY` | Potentially paid API |

---

*Last updated: 2026-05-10. Re-audit after any new ingestion script or processor is added.*
