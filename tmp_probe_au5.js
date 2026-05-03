/**
 * AU Stats Probe Script - Round 5
 * Final targeted probes for remaining: hospitalWaitTimes, studentDebt, schoolFunding, literacy, povertyRate
 */

require('dotenv').config();
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 25000;

const http = axios.create({
  timeout: TIMEOUT,
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
  },
  maxRedirects: 5,
});

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tryUrl(label, url, fn) {
  try {
    process.stdout.write(`  [${label}]... `);
    const resp = await http.get(url);
    const result = fn(resp.data, url);
    if (result) {
      console.log(`OK => ${JSON.stringify(result)}`);
      return result;
    }
    console.log('NO DATA');
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 100)}`);
  }
  return null;
}

async function main() {
  console.log('=== AU STATS PROBE ROUND 5 ===\n');

  // ============================================================
  // 7. hospitalWaitTimes
  // Only known source is AIHW (blocked). Try alternative approaches.
  // Use ABS patient experiences for ED wait proxy.
  // ============================================================
  console.log('--- [7] hospitalWaitTimes ---');

  // Patient experiences survey explicitly mentions ED
  await tryUrl('abs-patient-exp-2023-24',
    'https://www.abs.gov.au/statistics/health/health-services/patient-experiences/2023-24',
    (html) => {
      const text = stripHtml(html);
      // Look for "waited longer than acceptable" for ED
      const idx = text.toLowerCase().indexOf('emergency');
      if (idx > -1) console.log(`  ED context: ${text.slice(idx, idx+600)}`);
      const m = text.match(/emergency[^.]*?(\d+)\s*(?:minutes?|hours?)/i);
      if (m) return { val: parseInt(m[1]), unit: 'minutes', period: '2023-24' };
      // Look for % waited too long
      const m2 = text.match(/emergency[^.]*?(\d+(?:\.\d)?)\s*%/i);
      if (m2) return { val: parseFloat(m2[1]), unit: '% waited longer than acceptable', period: '2023-24' };
      return null;
    }
  );

  // Try AIHW reports overview page
  await tryUrl('aihw-hospital-overview',
    'https://www.aihw.gov.au/reports/hospitals',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+)\s*minutes/gi);
      if (m) console.log(`  Minutes: ${m.slice(0, 5).join(', ')}`);
      return null;
    }
  );

  // Try AIHW myhospitals
  await tryUrl('aihw-myhospitals-main',
    'https://www.aihw.gov.au/reports-data/myhospitals',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+)\s*minutes/gi);
      if (m) console.log(`  Minutes: ${m.slice(0, 5).join(', ')}`);
      return null;
    }
  );

  // ============================================================
  // 15. studentDebt - try ATO tax statistics
  // ============================================================
  console.log('\n--- [15] studentDebt ---');

  // ATO tax stats 2021-22
  await tryUrl('ato-tax-stats',
    'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/tax-statistics/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // Try abs.gov.au education stats for HELP debt
  await tryUrl('abs-education-overview',
    'https://www.abs.gov.au/statistics/people/education/education-and-work-australia/may-2024',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('hecs');
      if (idx === -1) {
        const idx2 = text.toLowerCase().indexOf('help');
        if (idx2 > -1) console.log(`  HELP context: ${text.slice(idx2, idx2+400)}`);
      } else {
        console.log(`  HECS context: ${text.slice(idx, idx+400)}`);
      }
      return null;
    }
  );

  // TEQSA
  await tryUrl('teqsa-stats',
    'https://www.teqsa.gov.au/publications-resources/research-and-data/higher-education-statistics',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  // Try RBA bulletin - HELP debt
  await tryUrl('rba-help-debt',
    'https://www.rba.gov.au/education/resources/explainers/higher-education-loan-program.html',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion/gi);
      if (m) console.log(`  Billions: ${m.join(', ')}`);
      return null;
    }
  );

  // ============================================================
  // 16. schoolFunding
  // ============================================================
  console.log('\n--- [16] schoolFunding ---');

  // National School Resourcing Board
  await tryUrl('nsrb',
    'https://www.nsrb.gov.au/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // Try schooling.edu.au
  await tryUrl('schooling-edu',
    'https://www.schooling.edu.au/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 400: ${text.slice(0, 400)}`);
      return null;
    }
  );

  // Try abs.gov.au with different path
  await tryUrl('abs-gfs-education',
    'https://www.abs.gov.au/statistics/economy/government/government-finance-statistics-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('education');
      if (idx > -1) console.log(`  Education context: ${text.slice(idx, idx+500)}`);
      const m = text.match(/education[^.]*?\$\s*([\d,]+(?:\.\d+)?)\s*(?:billion|million)?/i);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        console.log(`  Education spending: $${v}`);
        return { val: v, unit: 'billion AUD', period: '2022-23' };
      }
      return null;
    }
  );

  // Try ACARA's National Report
  await tryUrl('acara-national-report-2023',
    'https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia/2023',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i) ||
                text.match(/\$\s*([\d,]+)[^.]*per\s*(?:student|pupil)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        console.log(`  Per student: $${v}`);
        return { val: v, unit: 'AUD/student', period: '2023' };
      }
      return null;
    }
  );

  // ============================================================
  // 17. literacy
  // ============================================================
  console.log('\n--- [17] literacy ---');

  // Try OECD skills outlook Australia
  await tryUrl('abs-piaac-factsheet',
    'https://www.abs.gov.au/statistics/people/education/skills-and-competencies-australia',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level|reading)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // Try ABS search for PIAAC
  await tryUrl('abs-statistics-search',
    'https://www.abs.gov.au/statistics/people/education',
    (html) => {
      const text = stripHtml(html);
      // Look for any literacy-related links
      const idx = text.toLowerCase().indexOf('piaac');
      if (idx > -1) console.log(`  PIAAC context: ${text.slice(Math.max(0,idx-50), idx+400)}`);
      const idx2 = text.toLowerCase().indexOf('literacy');
      if (idx2 > -1) console.log(`  Literacy context: ${text.slice(Math.max(0,idx2-50), idx2+400)}`);
      return null;
    }
  );

  // Look at ABS media releases for PIAAC 2023
  await tryUrl('abs-media-2024',
    'https://www.abs.gov.au/media-centre/media-releases',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('literacy');
      if (idx > -1) console.log(`  Literacy media: ${text.slice(Math.max(0,idx-50), idx+400)}`);
      const idx2 = text.toLowerCase().indexOf('piaac');
      if (idx2 > -1) console.log(`  PIAAC media: ${text.slice(Math.max(0,idx2-50), idx2+400)}`);
      return null;
    }
  );

  // ============================================================
  // 18. povertyRate
  // ============================================================
  console.log('\n--- [18] povertyRate ---');

  // ACOSS Poverty in Australia report
  await tryUrl('acoss-poverty-2023',
    'https://www.acoss.org.au/poverty-in-australia/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*(?:million|%)[^.]*(?:poverty|below|low income)/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v < 100) return { val: v, unit: m[0].includes('%') ? '%' : 'million people', period: '2022' };
      }
      return null;
    }
  );

  // Try ABS household income - look for the specific poverty rate table
  await tryUrl('abs-income-poverty-table',
    'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/2021-22',
    (html) => {
      const text = stripHtml(html);
      // 50% median is what's used in Australia
      const idx = text.toLowerCase().indexOf('50%');
      if (idx > -1) console.log(`  50% context: ${text.slice(Math.max(0,idx-100), idx+500)}`);
      const idx2 = text.toLowerCase().indexOf('below median');
      if (idx2 > -1) console.log(`  Below median context: ${text.slice(idx2, idx2+400)}`);
      const idx3 = text.toLowerCase().indexOf('poverty');
      if (idx3 > -1) console.log(`  Poverty context: ${text.slice(idx3, idx3+400)}`);
      return null;
    }
  );

  // Social Policy Research Centre HILDA poverty
  await tryUrl('sprc-poverty',
    'https://www.sprc.unsw.edu.au/research/projects/poverty-in-australia/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:poverty|below|income)/i);
      if (m && parseFloat(m[1]) < 30) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      return null;
    }
  );

  console.log('\n=== ROUND 5 COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
