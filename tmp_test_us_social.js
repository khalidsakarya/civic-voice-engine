require('dotenv').config();
const axios = require('axios');
const zlib  = require('zlib');
const path  = require('path');
const fs    = require('fs');

const TIMEOUT_MS = 25000;
const BROWSER_UA = 'Mozilla/5.0 (compatible; CivicBot/1.0)';
const FETCHED_AT = new Date().toISOString();
const safeNum = v => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isNaN(n) ? null : n; };
function result(country, stat, value, unit, date, source, sourceUrl, notes = '') {
  return { country, stat, value, unit, date, source, sourceUrl, notes, fetchedAt: FETCHED_AT };
}

// Import the actual fetchers by requiring targetedFetch logic
// Actually let's just test them directly here using inline references

async function probe(label, fn) {
  process.stdout.write(`  ${label}... `);
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`✓ ${r.value} ${r.unit?.slice(0,30)} [${r.date}] (${Date.now()-t}ms)`);
    return r;
  } catch(e) {
    console.log(`✗ ${e.message?.slice(0,100)} (${Date.now()-t}ms)`);
    return null;
  }
}

// Quick test: run the full targetedFetch but only for US social stats
// We'll require the module and call only the relevant functions

const tf = require('./src/ingestion/targetedFetch.js');
// targetedFetch.js runs main() on load, so just observe the output
