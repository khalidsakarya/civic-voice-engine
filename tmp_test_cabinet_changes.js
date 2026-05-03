'use strict';
require('dotenv').config();

const { fetchDeptSources, fetchUSDeptHeads } = require('./src/ingestion/departmentHeadsFetcher');
const fs   = require('fs');
const path = require('path');

(async () => {
  console.log('── fetchDeptSources (9 direct sources) ─────────────────');
  const deptResults = await fetchDeptSources();
  console.log(`\nResults: ${deptResults.size}/9 succeeded`);
  for (const [key, val] of [...deptResults.entries()].sort()) {
    console.log(`  ${key.padEnd(12)} → ${val.name}`);
  }

  console.log('\n── fetchUSDeptHeads (WH acting detection + dept-direct merge) ──');
  await fetchUSDeptHeads();

  // Read the output file to inspect merged records
  const outDir = path.resolve(__dirname, 'output/department_heads');
  const files  = fs.readdirSync(outDir).filter(f => f.startsWith('department_heads_US')).sort();
  const latest = JSON.parse(fs.readFileSync(path.join(outDir, files[files.length - 1])));
  const records = latest.records;

  const actingOnes = records.filter(r => r.title?.startsWith('Acting'));
  console.log(`\nActing designations in merged output: ${actingOnes.length}`);
  actingOnes.forEach(r => console.log(`  ${r.name} — ${r.title}`));

  console.log('\n── All merged US records ────────────────────────────────');
  records.sort((a,b) => a.title.localeCompare(b.title))
         .forEach(r => console.log(`  ${r.title.padEnd(48)} ${r.name}  [${r.source}]`));

  process.exit(0);
})().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
