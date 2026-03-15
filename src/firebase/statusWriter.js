const { getDb } = require('./client');

// Claude Haiku 4.5 pricing used by the daily tier
const HAIKU_INPUT_PER_M  = 0.80; // $ per million input tokens
const HAIKU_OUTPUT_PER_M = 4.00; // $ per million output tokens
const INPUT_TOKENS_PER_BILL  = 870;  // system + user prompt + bill JSON
const OUTPUT_TOKENS_PER_BILL = 500;  // JSON analysis response (avg)

/**
 * Compute the next occurrence of a cron expression.
 * Handles the four patterns used by this scheduler:
 *   "0 2 * * *"     (daily)
 *   "0 3 * * 0"     (weekly — day-of-week)
 *   "0 5 1 * *"     (monthly — specific DOM)
 *   "0 4 1,15 * *"  (bimonthly — multiple DOMs)
 */
function nextCronDate(cronStr) {
  const [minS, hourS, domS, , dowS] = cronStr.split(' ');
  const minute = parseInt(minS, 10);
  const hour   = parseInt(hourS, 10);

  const now  = new Date();
  const next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  next.setMinutes(minute);
  next.setHours(hour);

  // If today's slot already passed, start looking from tomorrow
  if (next <= now) next.setDate(next.getDate() + 1);

  if (dowS !== '*') {
    const targetDow = parseInt(dowS, 10);
    for (let i = 0; i < 7; i++) {
      if (next.getDay() === targetDow) break;
      next.setDate(next.getDate() + 1);
    }
  } else if (domS !== '*') {
    const validDays = domS.split(',').map(Number);
    for (let i = 0; i < 32; i++) {
      if (validDays.includes(next.getDate())) break;
      next.setDate(next.getDate() + 1);
    }
  }

  next.setHours(hour);
  next.setMinutes(minute);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

/**
 * Write a run-status document to Firestore collection `scheduler_status`.
 * One document per tier (doc ID = tier key), always reflecting the latest run.
 *
 * @param {string} tierKey   - 'daily' | 'weekly' | 'monthly' | 'bimonthly'
 * @param {object} opts
 *   startedAt       {Date}    - when the cycle began
 *   status          {string}  - 'success' | 'error'
 *   collections     {Array}   - Firestore collections updated
 *   recordsUpdated  {number}  - total documents written to Firestore
 *   recordsSkipped  {number}  - bills that failed AI processing (daily) or 0
 *   aiCallsMade     {number}  - successful Claude API calls (0 for non-daily tiers)
 *   cronSchedule    {string}  - cron expression, used to compute nextScheduledRun
 *   errorMessage    {string?} - set when status === 'error'
 */
async function writeSchedulerStatus(tierKey, {
  startedAt,
  status,
  collections,
  recordsUpdated,
  recordsSkipped,
  aiCallsMade,
  cronSchedule,
  errorMessage,
}) {
  const db          = getDb();
  const completedAt = new Date();
  const durationMs  = completedAt - startedAt;

  const estimatedCostUSD = aiCallsMade > 0
    ? parseFloat((
        aiCallsMade * INPUT_TOKENS_PER_BILL  / 1e6 * HAIKU_INPUT_PER_M +
        aiCallsMade * OUTPUT_TOKENS_PER_BILL / 1e6 * HAIKU_OUTPUT_PER_M
      ).toFixed(6))
    : 0;

  const nextScheduledRun = cronSchedule
    ? nextCronDate(cronSchedule).toISOString()
    : null;

  const doc = {
    tier:              tierKey,
    lastRunAt:         startedAt.toISOString(),
    completedAt:       completedAt.toISOString(),
    durationMs,
    status,
    collectionsUpdated: collections,
    recordsUpdated,
    recordsSkipped,
    aiCallsMade,
    estimatedCostUSD,
    nextScheduledRun,
    errorMessage:      errorMessage || null,
    last_updated:      completedAt.toISOString(),
  };

  await db.collection('scheduler_status').doc(tierKey).set(doc);
  console.log(
    `[scheduler_status] ✓ ${tierKey} — ${status}  ` +
    `records: ${recordsUpdated}  skipped: ${recordsSkipped}  ` +
    `AI calls: ${aiCallsMade}  cost: $${estimatedCostUSD.toFixed(4)}  ` +
    `next: ${nextScheduledRun}`
  );
  return doc;
}

module.exports = { writeSchedulerStatus };
