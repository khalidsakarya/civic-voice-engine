/**
 * AU Stats Probe Script - Round 6
 * Last pass for studentDebt, schoolFunding, literacy, povertyRate
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
  console.log('=== AU STATS PROBE ROUND 6 ===\n');

  // ============================================================
  // 15. studentDebt — ATO publishes HELP debt statistics in annual report
  // ============================================================
  console.log('--- [15] studentDebt ---');

  await tryUrl('abs-education-2022-23',
    'https://www.abs.gov.au/statistics/people/education/education-and-work-australia/may-2023',
    (html) => {
      const text = stripHtml(html);
      // Check for any HELP / loan mentions
      const hIdx = text.toLowerCase().indexOf('student loan');
      const helpIdx = text.toLowerCase().indexOf('higher education loan');
      const hecsIdx = text.toLowerCase().indexOf('hecs');
      [hIdx, helpIdx, hecsIdx].filter(i => i > -1).forEach(i => {
        console.log(`  Context at ${i}: ${text.slice(Math.max(0,i-20), i+300)}`);
      });
      return null;
    }
  );

  // Try Department of Education annual report
  await tryUrl('education-annual-overview',
    'https://www.education.gov.au/higher-education-loan-program',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      const m = text.match(/\$[\s]*([\d,]+(?:\.\d+)?)\s*billion/gi);
      if (m) console.log(`  $ billions found: ${m.join(', ')}`);
      return null;
    }
  );

  // Try data.gov.au CKAN API for HELP dataset
  await tryUrl('data-gov-au-help',
    'https://data.gov.au/api/3/action/package_search?q=higher+education+loan+program+HELP+debt&rows=5',
    (data) => {
      if (data && data.result) {
        const pkgs = (data.result.results || []);
        console.log(`  Found ${pkgs.length} packages`);
        pkgs.forEach(p => console.log(`    - ${p.name} | ${p.title} | ${p.metadata_modified}`));
      }
      return null;
    }
  );

  // Try the ATO's dedicated HELP statistics page
  await tryUrl('ato-help-stats-2022',
    'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/superannuation-statistics/student-loan-programs-(help,-vet-student-loans-etc)',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      return null;
    }
  );

  // ============================================================
  // 16. schoolFunding — Try ABS government finance stats
  // ============================================================
  console.log('\n--- [16] schoolFunding ---');

  await tryUrl('abs-gfs-state-local',
    'https://www.abs.gov.au/statistics/economy/government/government-finance-statistics-australia/2022-23',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const idx = text.toLowerCase().indexOf('education');
      if (idx > -1) console.log(`  Education context: ${text.slice(idx, idx+500)}`);
      return null;
    }
  );

  await tryUrl('abs-gfs-2023-24',
    'https://www.abs.gov.au/statistics/economy/government/government-finance-statistics-australia/2023-24',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('education');
      if (idx > -1) console.log(`  Education context: ${text.slice(idx, idx+500)}`);
      return null;
    }
  );

  // Try Gonski funding overview
  await tryUrl('education-schooling-funding',
    'https://www.education.gov.au/school-funding',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion/gi);
      if (m) console.log(`  Billions: ${m.slice(0, 5).join(', ')}`);
      const m2 = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i);
      if (m2) return { val: parseInt(m2[1].replace(/,/g, '')), unit: 'AUD/student', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 17. literacy — try known PIAAC page on ABS
  // ============================================================
  console.log('\n--- [17] literacy ---');

  // Known 2011-12 data
  await tryUrl('abs-piaac-2011',
    'https://www.abs.gov.au/AUSSTATS/abs@.nsf/mf/4228.0',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // Try ABS skills release
  await tryUrl('abs-skills-may-2023',
    'https://www.abs.gov.au/statistics/people/education/education-and-work-australia/may-2023',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|numeracy|low skill|proficiency)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // OECD Australia at a Glance report mentions literacy
  await tryUrl('oecd-aus-education-overview',
    'https://www.oecd.org/australia/education-at-a-glance-australia-EN.pdf',
    () => null // Skip PDFs
  );

  // Try ABS PIAAC 2022-23
  await tryUrl('abs-piaac-news',
    'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-piaac/2022-23',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level|reading)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022-23' };
      return null;
    }
  );

  // Try with the known PIAAC URL patterns
  await tryUrl('abs-piaac-2022',
    'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-australia/2022-23',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|level|proficiency)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022-23' };
      return null;
    }
  );

  // ============================================================
  // 18. povertyRate — try known data points
  // ============================================================
  console.log('\n--- [18] povertyRate ---');

  // Poverty & Inequality Partnership data
  await tryUrl('povertyandinequality',
    'https://povertyandinequality.acoss.org.au/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*(?:million|%)[^.]*(?:poverty|below)/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v < 20) return { val: v, unit: m[0].includes('%') ? '%' : 'million people', period: '2022' };
      }
      return null;
    }
  );

  await tryUrl('acoss-poverty-report-2023',
    'https://www.acoss.org.au/poverty-in-australia-2023/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      const m = text.match(/(\d+(?:\.\d+)?)\s*(?:million|\%)[^.]*(?:poverty|low income|below)/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v < 25) return { val: v, unit: m[0].includes('%') ? '%' : 'million people', period: '2023' };
      }
      return null;
    }
  );

  console.log('\n=== ROUND 6 COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
