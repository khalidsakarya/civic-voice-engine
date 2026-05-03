/**
 * AU Stats Probe Script - Round 3
 * Final targeted probes for remaining unknowns
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
    process.stdout.write(`  [${label}] ... `);
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
  console.log('=== AU STATS PROBE ROUND 3 ===\n');

  // ============================================================
  // 3. roadFatalities - try infrastructure.gov.au and abs.gov.au causes of death
  // ============================================================
  console.log('--- [3] roadFatalities ---');

  // Try ABS causes of death - search for transport accident deaths
  await tryUrl('abs-cod-transport',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/2022',
    (html) => {
      const text = stripHtml(html);
      // Transport accidents (V01-V99) - look for the number
      const patterns = [
        /land transport[^.]*?(\d[\d,]+)/gi,
        /road transport[^.]*?(\d[\d,]+)/gi,
        /motor vehicle[^.]*?(\d[\d,]+)\s*(?:deaths|people)/gi,
        /transport accident[^.]*?(\d[\d,]+)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 2)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 5000) {
            console.log(`  Found: ${v} (${text.slice(Math.max(0,m.index-20), m.index+120)})`);
            return { val: v, unit: 'deaths', period: '2022' };
          }
        }
      }
      return null;
    }
  );

  // Try abs.gov.au mortality statistics
  await tryUrl('abs-mortality',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/2023',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('transport');
      if (idx > -1) console.log(`  Transport: ${text.slice(idx, idx+300)}`);
      const m = text.match(/(?:road|land|motor vehicle)[^.]*?(\d[\d,]+)\s*(?:deaths|fatalities)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100 && v < 5000) return { val: v, unit: 'deaths', period: '2023' };
      }
      return null;
    }
  );

  // Try ABS causes of death 2023
  await tryUrl('abs-cod-2023',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Search for transport/road
      const patterns = [
        /transport[^.]{0,200}(\d[\d,]+)\s*deaths/gi,
        /(\d[\d,]+)[^.]{0,50}transport[^.]{0,50}deaths/gi,
        /V\d\d[^.]{0,100}(\d[\d,]+)/g,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 2)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 5000) {
            console.log(`  Road deaths candidate: ${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          }
        }
      }
      return null;
    }
  );

  // ============================================================
  // 4. drugOverdoseDeaths - check ABS causes of death more carefully
  // ============================================================
  console.log('\n--- [4] drugOverdoseDeaths ---');

  await tryUrl('abs-cod-drugs',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Drug-induced deaths (F11-F19 poisoning, X40-X44)
      const idx = text.toLowerCase().indexOf('drug');
      if (idx > -1) {
        console.log(`  Drug context from COD page: ${text.slice(idx, idx + 800)}`);
      }
      // Check for drug poisoning numbers
      const patterns = [
        /drug.induced[^.]*?(\d[\d,]+)/gi,
        /drug poisoning[^.]*?(\d[\d,]+)/gi,
        /accidental drug[^.]*?(\d[\d,]+)/gi,
        /(\d[\d,]+)[^.]*?drug.induced death/gi,
        /overdose[^.]*?(\d[\d,]+)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 2)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 20000) {
            console.log(`  Drug deaths candidate: ${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
            return { val: v, unit: 'deaths', period: '2023' };
          }
        }
      }
      return null;
    }
  );

  // Try ABS causes of death 2022 specifically
  await tryUrl('abs-cod-2022-drug',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/2022',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('drug');
      if (idx > -1) console.log(`  Drug context: ${text.slice(idx, idx+600)}`);
      const m = text.match(/drug.induced[^.]*?(\d[\d,]+)/i) || text.match(/(\d[\d,]+)[^.]*?drug.induced/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100 && v < 20000) return { val: v, unit: 'deaths', period: '2022' };
      }
      return null;
    }
  );

  // ============================================================
  // 7. hospitalWaitTimes
  // ============================================================
  console.log('\n--- [7] hospitalWaitTimes ---');

  await tryUrl('abs-patient-experiences-ed',
    'https://www.abs.gov.au/statistics/health/health-services/patient-experiences/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Look for ED/emergency wait time
      const idx = text.toLowerCase().indexOf('emergency');
      if (idx > -1) console.log(`  Emergency context: ${text.slice(idx, idx+400)}`);
      const m = text.match(/emergency[^.]*?(\d+)\s*(?:minutes?|hours?)/i);
      if (m) {
        const v = parseInt(m[1]);
        if (v < 300) return { val: v, unit: 'minutes', period: '2022-23' };
      }
      return null;
    }
  );

  // Try MyHospitals data
  await tryUrl('myhospitals-ed',
    'https://www.aihw.gov.au/reports/hospitals/emergency-department-care-2022-23',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      const m = text.match(/(\d+)\s*minutes/i);
      if (m && parseInt(m[1]) < 300) return { val: parseInt(m[1]), unit: 'minutes', period: '2022-23' };
      return null;
    }
  );

  // ============================================================
  // 10. homelessness
  // ============================================================
  console.log('\n--- [10] homelessness ---');

  // ABS Census 2021 homelessness report
  await tryUrl('abs-homelessness-2021-report',
    'https://www.abs.gov.au/census/find-census-data/census-data-categories/homelessness/2021',
    (html) => {
      const text = stripHtml(html);
      const r_match = text.match(/(\d[\d,]+)\s*(?:people|persons)[^.]*?homeless/i) ||
                      text.match(/homeless[^.]*?(\d[\d,]+)\s*(?:people|persons)/i);
      if (r_match) {
        const v = parseInt(r_match[1].replace(/,/g, ''));
        if (v > 1000) return { val: v, unit: 'people', period: '2021' };
      }
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  await tryUrl('abs-census-homelessness',
    'https://www.abs.gov.au/statistics/people/housing/census-and-housing/2021',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  await tryUrl('abs-homelessness-key-stats',
    'https://www.abs.gov.au/statistics/people/housing/homelessness-and-people-at-risk-of-homelessness/2021-22',
    (html) => {
      const text = stripHtml(html);
      const r_match = text.match(/(\d[\d,]+)\s*(?:people|persons)[^.]*?homeless/i) ||
                      text.match(/homeless[^.]*?(\d[\d,]+)/i);
      if (r_match) {
        const v = parseInt(r_match[1].replace(/,/g, ''));
        if (v > 1000) return { val: v, unit: 'people', period: '2021-22' };
      }
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  // Try the SHS (Specialist Homelessness Services) report
  await tryUrl('aihw-shs-report',
    'https://www.aihw.gov.au/reports/homelessness-services/specialist-homelessness-services-annual-report',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 400: ${text.slice(0, 400)}`);
      return null;
    }
  );

  // Try with known URL format
  await tryUrl('abs-people-homelessness',
    'https://www.abs.gov.au/statistics/people/housing',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  // ============================================================
  // 11. newBuilds - clarify: 14564 is monthly, need annual
  // ============================================================
  console.log('\n--- [11] newBuilds (annual figure) ---');

  await tryUrl('abs-building-approvals-annual',
    'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/2022-23',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('total dwell');
      if (idx > -1) console.log(`  Total dwellings: ${text.slice(idx, idx+400)}`);
      const m = text.match(/total\s*dwelling[^.]*?(\d[\d,]+)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 10000) return { val: v, unit: 'approvals/year', period: '2022-23' };
      }
      return null;
    }
  );

  // ============================================================
  // 13. medianHomeValue - need dollar value not index
  // ============================================================
  console.log('\n--- [13] medianHomeValue (dollar value) ---');

  await tryUrl('abs-total-value-dwellings-2025',
    'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Found "mean price of residential dwellings rose $44,000 to $920,100"
      const patterns = [
        /mean price[^.]*?\$\s*([\d,]+)/gi,
        /median price[^.]*?\$\s*([\d,]+)/gi,
        /\$\s*([\d,]+)[^.]*?mean price/gi,
        /dwelling[^.]*?\$\s*([\d,]+)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100000 && v < 2000000) {
            console.log(`  Found: $${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
            return { val: v, unit: 'AUD', period: '2025' };
          }
        }
      }
      // Get any dollar amount in the right range
      const allDollarMatches = [...text.matchAll(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:thousand|million|billion)?/gi)];
      for (const m of allDollarMatches) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (v > 400000 && v < 2000000) {
          console.log(`  Dollar candidate: $${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          return { val: v, unit: 'AUD', period: 'Q4 2025' };
        }
      }
      // Show text with numbers
      console.log(`  First 1000 chars: ${text.slice(0, 1000)}`);
      return null;
    }
  );

  // ============================================================
  // 15. studentDebt
  // ============================================================
  console.log('\n--- [15] studentDebt ---');

  // Try ATO statistics on student loans via a direct page
  await tryUrl('ato-individual-stats',
    'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/tax-statistics/tax-statistics-2022-23/',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('help');
      if (idx > -1) console.log(`  HELP context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  // Try myUniversity or universities Australia
  await tryUrl('unis-australia-hecs',
    'https://www.universitiesaustralia.edu.au/media-item/hecs-help-debt-statistics/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion/i);
      if (m) return { val: parseFloat(m[1]), unit: 'billion AUD', period: '2023' };
      return null;
    }
  );

  // Try ndia or a known data.gov.au HELP dataset
  await tryUrl('data-gov-au-help-search',
    'https://data.gov.au/api/3/action/package_search?q=HELP+debt+higher+education+loan',
    (data) => {
      if (typeof data === 'object' && data.result) {
        const pkgs = data.result.results || [];
        console.log(`  Found ${pkgs.length} packages`);
        pkgs.slice(0, 3).forEach(p => console.log(`    - ${p.name}: ${p.title}`));
      }
      return null;
    }
  );

  // Try abs education stats
  await tryUrl('abs-education-finance',
    'https://www.abs.gov.au/statistics/people/education/education-and-training-experience-australia/2021',
    (html) => {
      const text = stripHtml(html);
      const r = text.match(/HECS|HELP|student loan|student debt/i);
      console.log(`  Found HECS ref: ${!!r}`);
      if (r) {
        const idx = text.toLowerCase().indexOf(r[0].toLowerCase());
        console.log(`  Context: ${text.slice(idx, idx+400)}`);
      }
      return null;
    }
  );

  // ============================================================
  // 16. schoolFunding
  // ============================================================
  console.log('\n--- [16] schoolFunding ---');

  // Try ABS education spending
  await tryUrl('abs-education-spending-2024',
    'https://www.abs.gov.au/statistics/people/education/government-finance-education/latest-release',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const r = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i) ||
                text.match(/\$\s*([\d,]+)[^.]*per\s*(?:student|pupil)/i);
      if (r) return { val: parseInt(r[1].replace(/,/g, '')), unit: 'AUD/student', period: '2023' };
      return null;
    }
  );

  await tryUrl('productivity-commission-education',
    'https://www.pc.gov.au/research/ongoing/report-on-government-services/2024/child-care-education-and-training/school-education',
    (html) => {
      const text = stripHtml(html);
      const r = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i) ||
                text.match(/\$\s*([\d,]+)[^.]*per\s*(?:student|pupil)/i);
      if (r) {
        const v = parseInt(r[1].replace(/,/g, ''));
        console.log(`  Found per-student: $${v}`);
        return { val: v, unit: 'AUD/student', period: '2023-24' };
      }
      const idx = text.toLowerCase().indexOf('expenditure');
      if (idx > -1) console.log(`  Expenditure context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  await tryUrl('myschool-stats',
    'https://www.myschool.edu.au/media/1884/data-guide-for-downloading-school-profile-data.pdf',
    () => null
  );

  // Try ACARA recurrent income
  await tryUrl('acara-school-finance',
    'https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia/national-report-on-schooling-in-australia-data-portal/school-funding',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const r = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i);
      if (r) return { val: parseInt(r[1].replace(/,/g, '')), unit: 'AUD/student', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 17. literacy
  // ============================================================
  console.log('\n--- [17] literacy ---');

  // PIAAC 2023 results may be on ABS
  await tryUrl('abs-piaac-2023-results',
    'https://www.abs.gov.au/statistics/people/education/skills-and-qualifications-australia',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  await tryUrl('abs-literacy-numeracy',
    'https://www.abs.gov.au/statistics/people/education/literacy-and-numeracy-skills',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // Try OECD Australia literacy
  await tryUrl('abs-piaac-media-release',
    'https://www.abs.gov.au/media-centre/media-releases/australia-achieves-below-average-scores-reading-and-maths',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level|reading)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 19. childPoverty
  // ============================================================
  console.log('\n--- [19] childPoverty ---');

  // Try ABS income distribution for children
  await tryUrl('abs-child-poverty-alt',
    'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Look for children/child in poverty context
      const patterns = [
        /child[^.]*?(\d+(?:\.\d)?)\s*%/gi,
        /(\d+(?:\.\d)?)\s*%[^.]*?child[^.]*?(?:poverty|low income)/gi,
        /children[^.]*?poverty[^.]*?(\d+(?:\.\d)?)\s*%/gi,
        /families with children[^.]*?(\d+(?:\.\d)?)\s*%/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 2)) {
          const v = parseFloat(m[1]);
          if (v > 0 && v < 50) {
            console.log(`  Child poverty candidate: ${v}% (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          }
        }
      }
      return null;
    }
  );

  // Try ACOSS poverty report data
  await tryUrl('acoss-poverty',
    'https://www.acoss.org.au/poverty/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 400: ${text.slice(0, 400)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*child/i) || text.match(/child[^.]*?(\d+(?:\.\d)?)\s*%/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v < 50) return { val: v, unit: '%', period: '2022' };
      }
      return null;
    }
  );

  // ============================================================
  // Summary of confirmed findings
  // ============================================================
  console.log('\n=== CONFIRMED FINDINGS SUMMARY ===');
  console.log('crimeRate: 3.9% personal crime (2024-25) OR use victimisation rate context');
  console.log('homicideRate: 448 victims / 2 per 100,000 (2024) | https://www.abs.gov.au/statistics/people/crime-and-justice/recorded-crime-victims/latest-release');
  console.log('obesityRate: 65.8% overweight or obese (2022) | https://www.abs.gov.au/statistics/health/health-conditions-and-risks/overweight-and-obesity/latest-release');
  console.log('lifeExpectancy: 81.1 years (2020-22) | https://www.abs.gov.au/statistics/people/population/life-tables/latest-release');
  console.log('mentalHealthAccess: 38.8% (2022) | https://www.abs.gov.au/statistics/health/mental-health');
  console.log('drugAddiction: 26.8% (2022) | https://www.abs.gov.au/statistics/health/health-conditions-and-risks/national-health-survey/latest-release');
  console.log('newBuilds: 14,564/month (SA) or ~172,000/year | https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release');
  console.log('medianGrossRent: $375/week (2021 Census) | https://www.abs.gov.au/census/find-census-data/quickstats/2021/AUS');
  console.log('medianHomeValue: $920,100 mean price (Q4 2025) | https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release');
  console.log('graduationRate: 80.7% Year 12 (2023) | https://www.abs.gov.au/statistics/people/education/schools/latest-release');
  console.log('povertyRate: Gini 0.324, no direct poverty % on ABS page');
  console.log('immigration: 518,100 NOM (2022-23) | https://www.abs.gov.au/statistics/people/population/migration-australia/latest-release');
  console.log('giniCoefficient: 0.324 equivalised disposable income (2019-20) | https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release');
  console.log('minWageGap: $24.95/hour (2024-25) | https://www.fwc.gov.au/agreements-awards/minimum-wages-and-conditions/national-minimum-wage');

  console.log('\n=== ROUND 3 PROBE COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
