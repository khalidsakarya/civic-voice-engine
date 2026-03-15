require('dotenv').config();
const allSources = require('../config/sources.json');

// ─── Claude Haiku 4.5 pricing ─────────────────────────────────────────────────
const HAIKU_INPUT_PER_M  = 0.80; // $ per million input tokens
const HAIKU_OUTPUT_PER_M = 4.00; // $ per million output tokens

// Per-bill token estimates (system prompt + user prompt + bill JSON / JSON response)
const INPUT_TOKENS_PER_BILL  = 870;
const OUTPUT_TOKENS_PER_BILL = 500;

// ─── Tier definitions ─────────────────────────────────────────────────────────
const TIERS = [
  {
    key:         'daily',
    label:       'Daily',
    cron:        process.env.CRON_DAILY     || '0 2 * * *',
    desc:        'Every day at 02:00',
    types:       ['bill', 'vote'],
    collections: ['bills', 'votes', 'efficiency_scores'],
    usesAI:      true,
  },
  {
    key:         'weekly',
    label:       'Weekly',
    cron:        process.env.CRON_WEEKLY    || '0 3 * * 0',
    desc:        'Every Sunday at 03:00',
    types:       ['legislator'],
    collections: ['members'],
    usesAI:      false,
  },
  {
    key:         'monthly',
    label:       'Monthly',
    cron:        process.env.CRON_MONTHLY   || '0 5 1 * *',
    desc:        '1st of each month at 05:00',
    types:       ['efficiency_score', 'budget', 'audit', 'department_performance'],
    collections: ['efficiency_scores_monthly', 'budget_spending', 'audit_findings', 'department_performance'],
    usesAI:      false,
  },
  {
    key:         'bimonthly',
    label:       'Bimonthly',
    cron:        process.env.CRON_BIMONTHLY || '0 4 1,15 * *',
    desc:        '1st and 15th of each month at 04:00',
    types:       ['financial_disclosure', 'lobbying', 'contract', 'corporate_affiliation'],
    collections: ['financial_disclosures', 'lobbying_activity', 'contracts', 'corporate_affiliations'],
    usesAI:      false,
  },
];

// ─── Compute next cron date ───────────────────────────────────────────────────
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

  // If today's slot has already passed, start from tomorrow
  if (next <= now) next.setDate(next.getDate() + 1);

  if (dowS !== '*') {
    // Weekly: advance to the target day-of-week
    const targetDow = parseInt(dowS, 10);
    for (let i = 0; i < 7; i++) {
      if (next.getDay() === targetDow) break;
      next.setDate(next.getDate() + 1);
    }
  } else if (domS !== '*') {
    // Monthly / bimonthly: advance to a valid day-of-month
    const validDays = domS.split(',').map(Number);
    for (let i = 0; i < 32; i++) {
      if (validDays.includes(next.getDate())) break;
      next.setDate(next.getDate() + 1);
    }
  }

  // Re-apply time after date shifts
  next.setHours(hour);
  next.setMinutes(minute);
  next.setSeconds(0);
  next.setMilliseconds(0);
  return next;
}

function formatDate(d) {
  const pad2 = n => String(n).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${pad2(d.getDate())} ${d.getFullYear()}  ${pad2(d.getHours())}:${pad2(d.getMinutes())} local`;
}

function timeUntil(d) {
  const ms   = d - Date.now();
  const mins = Math.round(ms / 60000);
  if (mins < 60)  return `in ${mins}m`;
  const hrs  = Math.round(mins / 60);
  if (hrs  < 48)  return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}

const col = (str, w) => String(str == null ? '' : str).padEnd(w);

// ─── Build row data ───────────────────────────────────────────────────────────
const rows = TIERS.map(tier => {
  const sources    = allSources.filter(s => tier.types.includes(s.type));
  const apiCalls   = sources.length;
  const billSources = tier.usesAI ? allSources.filter(s => s.type === 'bill') : [];
  const maxBills   = billSources.reduce((sum, s) => {
    const p = s.params || {};
    return sum + (p.limit || p.rows || p.take || p.per_page || 20);
  }, 0);
  const inputTok   = maxBills * INPUT_TOKENS_PER_BILL;
  const outputTok  = maxBills * OUTPUT_TOKENS_PER_BILL;
  const aiCost     = (inputTok / 1e6 * HAIKU_INPUT_PER_M) + (outputTok / 1e6 * HAIKU_OUTPUT_PER_M);
  const next       = nextCronDate(tier.cron);

  return { ...tier, sources, apiCalls, maxBills, inputTok, outputTok, aiCost, next };
});

// ─── Print ────────────────────────────────────────────────────────────────────
const LINE  = '═'.repeat(108);
const line  = '─'.repeat(108);

console.log('\n╔' + '═'.repeat(106) + '╗');
console.log('║' + '  CIVIC VOICE ENGINE — SCHEDULER DRY RUN'.padEnd(106) + '║');
console.log('║' + `  As of: ${new Date().toISOString()}`.padEnd(106) + '║');
console.log('╚' + '═'.repeat(106) + '╝');

// ── Summary table ─────────────────────────────────────────────────────────────
console.log('\n' + line);
console.log(
  col('TIER', 13) +
  col('SCHEDULE', 37) +
  col('NEXT RUN', 36) +
  col('API CALLS', 12) +
  col('AI COST/RUN', 14)
);
console.log(line);

for (const r of rows) {
  console.log(
    col(r.label, 13) +
    col(r.desc, 37) +
    col(`${formatDate(r.next)}  (${timeUntil(r.next)})`, 36) +
    col(r.apiCalls, 12) +
    col(r.aiCost > 0 ? `$${r.aiCost.toFixed(4)}` : '—', 14)
  );
}
console.log(line);

// ── Per-tier detail ───────────────────────────────────────────────────────────
for (const r of rows) {
  console.log(`\n  ▸ ${r.label.toUpperCase()}  cron: ${r.cron}  →  ${r.desc}`);
  console.log(`    Next run    : ${formatDate(r.next)}  (${timeUntil(r.next)})`);
  console.log(`    API sources : ${r.apiCalls}  →  ${r.sources.map(s => s.name).join(', ')}`);
  console.log(`    Collections : ${r.collections.join(', ')}`);

  if (r.usesAI) {
    console.log(`    AI model    : claude-haiku-4-5-20251001`);
    console.log(`    Bills/run   : up to ${r.maxBills}  (${r.sources.filter(s=>s.type==='bill').length} sources × 20 records)`);
    console.log(`    Token est.  : ~${r.inputTok.toLocaleString()} input  /  ~${r.outputTok.toLocaleString()} output`);
    console.log(`    AI cost     : $${r.aiCost.toFixed(4)}  @ $${HAIKU_INPUT_PER_M}/MTok in, $${HAIKU_OUTPUT_PER_M}/MTok out`);
  } else {
    console.log(`    AI usage    : none`);
  }
}

// ── Projected totals ──────────────────────────────────────────────────────────
const daily      = rows.find(r => r.key === 'daily');
const weekly     = rows.find(r => r.key === 'weekly');
const monthly    = rows.find(r => r.key === 'monthly');
const bimonthly  = rows.find(r => r.key === 'bimonthly');

const aiPerMonth = daily.aiCost * 30;
const aiPerYear  = daily.aiCost * 365;

const apiPerMonth =
  daily.apiCalls     * 30 +
  weekly.apiCalls    *  4 +
  monthly.apiCalls   *  1 +
  bimonthly.apiCalls *  2;

console.log('\n' + line);
console.log('  PROJECTED TOTALS');
console.log(line);
console.log(`  AI cost / month  :  $${aiPerMonth.toFixed(2)}   (daily tier × 30 runs)`);
console.log(`  AI cost / year   :  $${aiPerYear.toFixed(2)}  (daily tier × 365 runs)`);
console.log(`  API calls / month:  ~${apiPerMonth}  (daily×30 + weekly×4 + monthly×1 + bimonthly×2)`);
console.log(`  Firestore writes :  bills, votes, members, efficiency_scores, efficiency_scores_monthly,`);
console.log(`                      budget_spending, audit_findings, department_performance,`);
console.log(`                      financial_disclosures, lobbying_activity, contracts, corporate_affiliations`);
console.log(line);

console.log('\n  [DRY RUN COMPLETE]  No data was fetched or written to Firestore. Scheduler not started.\n');
