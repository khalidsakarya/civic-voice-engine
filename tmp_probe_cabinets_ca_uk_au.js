'use strict';
require('dotenv').config();
const axios  = require('axios');
const https  = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)', Accept: 'text/html' },
      timeout: 45000,
    }, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve(d));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

function stripHtml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .replace(/&apos;/g,"'").replace(/&ndash;/g,'–').replace(/&mdash;/g,'—')
    .replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,' ')
    .replace(/\s+/g,' ').trim();
}

(async () => {
  // ── CANADA ────────────────────────────────────────────────────────────────
  console.log('\n════ CANADA ════════════════════════════════════════════════════');
  const caHtml = await httpsGet('https://www.canada.ca/en/government/ministers.html');
  const caRe = /<dt>\s*<a href="([^"]+)">(The Honourable[^<]+)<\/a>\s*<\/dt>\s*<dd>\s*([\s\S]*?)\s*<\/dd>/g;
  let m;
  const caAll = [];
  while ((m = caRe.exec(caHtml))) {
    const name  = stripHtml(m[2]).replace(/^The Honourable\s+/i, '').trim();
    const title = stripHtml(m[3]);
    caAll.push({ name, title });
  }
  console.log(`CA total ministers: ${caAll.length}`);
  // Show first 20 (full ministers)
  caAll.slice(0, 20).forEach(r => console.log(`  ${r.title.padEnd(60)} ${r.name}`));

  // ── UK ────────────────────────────────────────────────────────────────────
  console.log('\n════ UK ════════════════════════════════════════════════════════');
  const ukRes = await axios.get('https://www.gov.uk/government/ministers', {
    timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
  });
  const ukHtml = ukRes.data;
  const ukRe = /gem-c-image-card__title[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?gem-c-image-card__description"><p>([\s\S]*?)<\/p>/g;
  const ukAll = [];
  while ((m = ukRe.exec(ukHtml))) {
    const name        = stripHtml(m[2]);
    const rolesRaw    = m[3].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    const primaryTitle = rolesRaw.split(/\s*,\s*/)[0].trim();
    if (name && primaryTitle) ukAll.push({ name, title: primaryTitle });
  }
  console.log(`UK total ministers: ${ukAll.length}`);
  // Show cabinet-tier (first 25)
  ukAll.slice(0, 25).forEach(r => console.log(`  ${r.title.padEnd(60)} ${r.name}`));

  // ── AUSTRALIA ────────────────────────────────────────────────────────────
  console.log('\n════ AUSTRALIA ═════════════════════════════════════════════════');
  const AU_TIERS = [
    { url: 'https://www.directory.gov.au/commonwealth-parliament/cabinet', tier: 'cabinet' },
    { url: 'https://www.directory.gov.au/commonwealth-parliament/outer-ministry', tier: 'outer' },
  ];
  const auAll = [];
  for (const { url, tier } of AU_TIERS) {
    const { data: html } = await axios.get(url, {
      timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CivicVoice/1.0)' },
    });
    const articleRe = /<article class="portfolio-role child-roles clearfix">([\s\S]*?)<\/article>/g;
    let a;
    while ((a = articleRe.exec(html))) {
      const block  = a[1];
      const titleM = block.match(/<h3>([\s\S]*?)<\/h3>/);
      const nameM  = block.match(/class="[^"]*role-title[^"]*"[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
      if (!titleM || !nameM) continue;
      const title = stripHtml(titleM[1]);
      const name  = nameM[1].trim();
      auAll.push({ name, title, tier });
    }
  }
  console.log(`AU total ministers (cabinet+outer): ${auAll.length}`);
  auAll.forEach(r => console.log(`  [${r.tier.padEnd(6)}] ${r.title.padEnd(60)} ${r.name}`));

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
