/**
 * AU Stats Probe Script - Round 4
 * Final cleanup for remaining unknowns
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
  console.log('=== AU STATS PROBE ROUND 4 ===\n');

  // ============================================================
  // 3. roadFatalities - abs-cod-2022 returned 2022 (year), abs-mortality returned 1290 but was that correct?
  // The abs-mortality one said 2023 and found 1290 - let's verify
  // ============================================================
  console.log('--- [3] roadFatalities (verify 2023 figure) ---');
  await tryUrl('abs-cod-2023-detailed',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/2023',
    (html) => {
      const text = stripHtml(html);
      // Find transport accident context
      const idx = text.toLowerCase().indexOf('transport accident');
      if (idx > -1) console.log(`  Transport accident context: ${text.slice(idx, idx+500)}`);
      const idx2 = text.toLowerCase().indexOf('land transport');
      if (idx2 > -1) console.log(`  Land transport context: ${text.slice(idx2, idx2+500)}`);
      const idx3 = text.toLowerCase().indexOf('road');
      if (idx3 > -1) console.log(`  Road context: ${text.slice(idx3, idx3+400)}`);

      // Look for motor vehicle or transport deaths
      const patterns = [
        /(\d[\d,]+)\s*(?:deaths?|people)\s*(?:from|due to|in)\s*(?:road|transport|motor vehicle)/gi,
        /(?:road|transport|motor vehicle)[^.]*?(\d[\d,]+)\s*deaths?/gi,
        /V\d\d[^\n]{0,200}(\d[\d,]+)/g,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 5000) {
            console.log(`  Candidate: ${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          }
        }
      }
      return null;
    }
  );

  // Try transport stat from ATSB or NTC
  await tryUrl('ntc-road-deaths',
    'https://www.ntc.gov.au/transport-regulation/road-safety/national-road-safety-strategy',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // ============================================================
  // 4. drugOverdoseDeaths - fix: 2020 was extracted as a year not deaths
  // Need to find drug-induced deaths from ABS COD
  // ============================================================
  console.log('\n--- [4] drugOverdoseDeaths (fix extraction) ---');

  // Explore the 2022 COD page more carefully for drug-induced deaths
  await tryUrl('abs-cod-2022-full-drug-search',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/2022',
    (html) => {
      const text = stripHtml(html);
      // Search the full text more systematically
      const searchTerms = ['drug', 'accidental poison', 'overdose', 'F1', 'X4', 'X6'];
      for (const term of searchTerms) {
        const idx = text.toLowerCase().indexOf(term.toLowerCase());
        if (idx > -1) {
          console.log(`  '${term}' context: ${text.slice(Math.max(0,idx-20), idx+300)}`);
        }
      }
      // Try to find the drug-induced deaths number (should be ~1800-2200)
      const patterns = [
        /accidental poison[^.]*?(\d[\d,]+)/gi,
        /(\d[\d,]+)[^.]*?accidental poison/gi,
        /drug.induced[^.]*?(\d[\d,]+)/gi,
        /(\d[\d,]+)[^.]*?drug.induced/gi,
        /X4[0-9][^.]*?(\d[\d,]+)/g,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 500 && v < 10000) {
            console.log(`  Drug deaths candidate: ${v} (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          }
        }
      }
      return null;
    }
  );

  // Try aihw drug report via wget-style curl headers
  await tryUrl('aihw-drug-deaths-wget',
    'https://www.aihw.gov.au/reports/illicit-use-of-drugs/drug-caused-deaths/contents/latest-findings',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600 chars: ${text.slice(0, 600)}`);
      const m = text.match(/(\d[\d,]+)\s*(?:drug.caused|drug.induced|overdose)\s*deaths/i) ||
                text.match(/(\d[\d,]+)\s*deaths[^.]*(?:drug|overdose)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 500 && v < 10000) return { val: v, unit: 'deaths', period: '2022' };
      }
      return null;
    }
  );

  // ============================================================
  // 7. hospitalWaitTimes - no luck from ABS/AIHW
  // Try a different AIHW URL pattern
  // ============================================================
  console.log('\n--- [7] hospitalWaitTimes ---');

  await tryUrl('aihw-ed-2023-24',
    'https://www.aihw.gov.au/reports/hospitals/emergency-department-care-2023-24/contents/summary',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+)\s*minutes/gi);
      if (m) console.log(`  Minutes found: ${m.slice(0, 5).join(', ')}`);
      return null;
    }
  );

  await tryUrl('aihw-hospital-summary',
    'https://www.aihw.gov.au/reports/hospitals/australias-hospitals-at-a-glance/contents/summary',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d+)\s*minutes/gi);
      if (m) console.log(`  Minutes found: ${m.slice(0, 5).join(', ')}`);
      return null;
    }
  );

  await tryUrl('abs-patient-experiences-wait',
    'https://www.abs.gov.au/statistics/health/health-services/patient-experiences/2024-25',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('emergency');
      if (idx > -1) console.log(`  Emergency context: ${text.slice(idx, idx+600)}`);
      // Look for ED wait time - usually 20-30 mins
      const m = text.match(/emergency[^.]*?(\d+)\s*minutes/i);
      if (m) return { val: parseInt(m[1]), unit: 'minutes', period: '2024-25' };
      return null;
    }
  );

  // ============================================================
  // 10. homelessness - found 122,494 in round 3 via ABS housing page!
  // ============================================================
  console.log('\n--- [10] homelessness (confirm 122,494 from ABS housing) ---');
  await tryUrl('abs-housing-page',
    'https://www.abs.gov.au/statistics/people/housing',
    (html) => {
      const text = stripHtml(html);
      const idx = text.indexOf('122,494');
      if (idx > -1) {
        console.log(`  Found 122,494 context: ${text.slice(Math.max(0,idx-50), idx+400)}`);
        return { val: 122494, unit: 'people', period: '2021', url: 'https://www.abs.gov.au/statistics/people/housing' };
      }
      return null;
    }
  );

  // ============================================================
  // 15. studentDebt - try TEQSA or parliamentary budget office
  // ============================================================
  console.log('\n--- [15] studentDebt ---');

  await tryUrl('pbo-help-debt',
    'https://www.pbo.gov.au/fiscal-outlook/help-debt-projections',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion/i);
      if (m) return { val: parseFloat(m[1]), unit: 'billion AUD', period: '2023' };
      return null;
    }
  );

  await tryUrl('abs-education-hecs',
    'https://www.abs.gov.au/statistics/people/education/education-and-work-australia/may-2023',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/HECS|HELP|student loan|student debt/i);
      if (m) {
        const idx = text.toLowerCase().indexOf(m[0].toLowerCase());
        console.log(`  HECS context: ${text.slice(Math.max(0,idx-30), idx+400)}`);
      }
      return null;
    }
  );

  // Try the education.gov.au annual report
  await tryUrl('education-annual-report',
    'https://www.education.gov.au/about-department/resources/annual-report-2022-23',
    (html) => {
      const text = stripHtml(html);
      const r = text.match(/HELP[^.]*?\$\s*([\d,]+(?:\.\d+)?)\s*billion/i) ||
                text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion[^.]*HELP/i);
      if (r) return { val: parseFloat(r[1]), unit: 'billion AUD', period: '2022-23' };
      const idx = text.toLowerCase().indexOf('help');
      if (idx > -1) console.log(`  HELP context: ${text.slice(idx, idx+400)}`);
      return null;
    }
  );

  // Try MyUniversity data or studyassist
  await tryUrl('studyassist-hecs',
    'https://www.studyassist.gov.au/loans-and-scholarships/hecs-help',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  // ============================================================
  // 16. schoolFunding - try Productivity Commission ROGS
  // ============================================================
  console.log('\n--- [16] schoolFunding ---');

  await tryUrl('pc-rogs-2024',
    'https://www.pc.gov.au/ongoing/report-on-government-services/2024/child-care-education-and-training/school-education',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const r = text.match(/per\s*(?:student|pupil)[^.]*?\$\s*([\d,]+)/i);
      if (r) {
        const v = parseInt(r[1].replace(/,/g, ''));
        console.log(`  Per student: $${v}`);
        return { val: v, unit: 'AUD/student', period: '2023-24' };
      }
      return null;
    }
  );

  await tryUrl('acara-reporting-finance',
    'https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia/national-report-on-schooling-in-australia-data-portal',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // Try myschool.edu.au
  await tryUrl('myschool',
    'https://www.myschool.edu.au/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      const r = text.match(/\$\s*([\d,]+)[^.]*(?:per student|per pupil)/i);
      if (r) return { val: parseInt(r[1].replace(/,/g, '')), unit: 'AUD/student', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 17. literacy - try searching ABS education landing
  // ============================================================
  console.log('\n--- [17] literacy ---');

  await tryUrl('abs-education-landing',
    'https://www.abs.gov.au/statistics/people/education',
    (html) => {
      const text = stripHtml(html);
      // Look for PIAAC or literacy
      const idx = text.toLowerCase().indexOf('literacy');
      if (idx > -1) console.log(`  Literacy context: ${text.slice(idx, idx+400)}`);
      const idx2 = text.toLowerCase().indexOf('piaac');
      if (idx2 > -1) console.log(`  PIAAC context: ${text.slice(idx2, idx2+400)}`);
      return null;
    }
  );

  // Try searching for OECD PIAAC Australia data
  await tryUrl('abs-skills-work',
    'https://www.abs.gov.au/statistics/people/education/skills-at-work',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level|reading)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // Try NCVER (National Centre for Vocational Education Research) literacy stats
  await tryUrl('ncver-literacy',
    'https://www.ncver.edu.au/research-and-statistics/collections/australian-vocational-education-and-training-statistics',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 400: ${text.slice(0, 400)}`);
      return null;
    }
  );

  // Try OECD Australia PISA/PIAAC data
  await tryUrl('oecd-piaac-au',
    'https://www.oecd.org/en/topics/sub-issues/adult-skills/country-note-australia.html',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 18. povertyRate - the ABS page mentions OECD uses 50% median threshold
  // Need to find the actual figure
  // ============================================================
  console.log('\n--- [18] povertyRate (find actual figure) ---');

  // ACOSS poverty in Australia report
  await tryUrl('acoss-poverty-rate',
    'https://www.acoss.org.au/poverty/',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('poverty line');
      if (idx > -1) console.log(`  Poverty line context: ${text.slice(idx, idx+500)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:poverty|below|income)/i) ||
                text.match(/(\d[\d,]+)\s*(?:people|Australians)[^.]*(?:poverty|below)/i);
      if (m) {
        const v = parseFloat(m[1].replace(/,/g, ''));
        if (v > 0 && v < 30) return { val: v, unit: '%', period: '2022' };
      }
      return null;
    }
  );

  // Melbourne Institute poverty estimates
  await tryUrl('melbinst-poverty',
    'https://melbourneinstitute.unimelb.edu.au/hilda/poverty-statistics',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500: ${text.slice(0, 500)}`);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:poverty|below|income)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // FINAL SUMMARY
  // ============================================================
  console.log('\n=== FINAL CONFIRMED VALUES ===');
  console.log('Need to check: road fatalities (BITRE down), drug overdose deaths, hospital wait times, student debt, school funding, literacy');

  console.log('\n=== ROUND 4 COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
