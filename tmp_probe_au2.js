/**
 * AU Stats Probe Script - Round 2
 * Focus on failed/bad-value stats from round 1
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
    'Cache-Control': 'no-cache',
  },
  maxRedirects: 5,
});

// Curl-like approach with different headers for AIHW
const httpAihw = axios.create({
  timeout: TIMEOUT,
  headers: {
    'User-Agent': 'curl/7.88.1',
    'Accept': '*/*',
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

function findNearKeyword(text, keywords, windowSize = 400) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx === -1) continue;
    const snippet = text.slice(Math.max(0, idx - 100), idx + windowSize);
    const nums = snippet.match(/[\d,]+\.?\d*/g);
    if (nums && nums.length > 0) {
      for (const n of nums) {
        const val = parseFloat(n.replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return { val, snippet: snippet.slice(0, 300) };
      }
    }
  }
  return null;
}

async function tryUrl(label, url, fn, client = http) {
  try {
    process.stdout.write(`  [${label}] ${url.slice(0, 80)}... `);
    const resp = await client.get(url);
    const result = fn(resp.data, url);
    if (result) {
      console.log(`OK => ${JSON.stringify(result)}`);
      return result;
    }
    console.log('NO DATA');
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 80)}`);
  }
  return null;
}

async function main() {
  console.log('=== AU STATS PROBE ROUND 2 ===\n');

  // ============================================================
  // 1. crimeRate - value was 2014 (wrong - was year not rate)
  // Need to find actual victimisation rate per 100,000
  // ============================================================
  console.log('\n--- [1] crimeRate (better extraction) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/people/crime-and-justice/crime-victimisation-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      // Look specifically for patterns like "X,XXX per 100,000" or "XX.X per cent of persons"
      const patterns = [
        /(\d[\d,]*\.?\d*)\s*per\s*(?:100[,\s]?000|hundred thousand)/gi,
        /victimisation rate[^.]*?(\d[\d,]*\.?\d*)/gi,
        /(\d+\.?\d*)\s*%\s*of\s*(?:persons|people|adults|households)\s*(?:were|had|experienced)/gi,
        /experienced[^.]*?(\d+\.?\d*)\s*%/gi,
        /(\d+\.?\d*)\s*per\s*cent\s*of\s*(?:persons|people|households|Australians)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        if (matches.length) {
          console.log(`  Pattern ${pat.source.slice(0, 50)}: found ${matches.length} matches`);
          for (const m of matches.slice(0, 3)) {
            const v = parseFloat(m[1].replace(/,/g, ''));
            console.log(`    => ${v} (context: ${text.slice(Math.max(0, m.index - 30), m.index + 80)})`);
          }
        }
      }
      // Print a large text snippet for manual inspection
      const idx = text.toLowerCase().indexOf('victimis');
      if (idx > -1) {
        console.log(`  Context around 'victimis': ...${text.slice(idx, idx + 500)}...`);
      }
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // ============================================================
  // 2. homicideRate - value was 1 (too low - extraction issue)
  // ============================================================
  console.log('\n--- [2] homicideRate (better extraction) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      const idx = text.toLowerCase().indexOf('homicid');
      if (idx > -1) {
        console.log(`  Context around 'homicid': ...${text.slice(Math.max(0, idx-50), idx + 400)}...`);
      }
      const patterns = [
        /assault[^.]*?(\d[\d,]+)/gi,
        /homicid[^.]*?(\d[\d,]+)/gi,
        /murder[^.]*?(\d[\d,]+)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 2)) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          console.log(`    ${pat.source}: => ${v}`);
        }
      }
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // Try ABS recorded crime - homicide stats
  await tryUrl('homicide-recorded-crime',
    'https://www.abs.gov.au/statistics/people/crime-and-justice/recorded-crime-victims/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('homicid');
      if (idx > -1) {
        const snippet = text.slice(idx, idx + 500);
        console.log(`  Homicide context: ${snippet}`);
        const m = snippet.match(/(\d[\d,]+)/);
        if (m) {
          const v = parseInt(m[1].replace(/,/g, ''));
          // Homicide count in Australia should be ~200-500 per year
          if (v > 100 && v < 2000) return { val: v, unit: 'victims', period: '2022-23' };
        }
      }
      return null;
    }
  );

  // ============================================================
  // 3. roadFatalities - all BITRE timed out
  // ============================================================
  console.log('\n--- [3] roadFatalities (alternative sources) ---');

  // Try ABS causes of death for transport accidents
  await tryUrl('abs-transport-deaths',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('transport');
      if (idx > -1) {
        const snippet = text.slice(idx, idx + 300);
        console.log(`  Transport context: ${snippet}`);
      }
      const m = text.match(/land transport[^.]*?(\d[\d,]+)/i) || text.match(/road[^.]*?(\d[\d,]+)\s*(?:death|fatal)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100 && v < 5000) return { val: v, unit: 'deaths', period: '2022' };
      }
      return null;
    }
  );

  // Try BITRE with short timeout to see if just slow
  await tryUrl('bitre-road-deaths-direct',
    'https://www.bitre.gov.au/statistics/safety',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d{3,4})\s*(?:road\s*)?(?:deaths|fatalities|people killed)/i);
      if (m) return { val: parseInt(m[1]), unit: 'deaths', period: '2023' };
      // look for year and number
      const idx = text.toLowerCase().indexOf('2023');
      if (idx > -1) console.log(`  2023 context: ${text.slice(Math.max(0,idx-20), idx+200)}`);
      return null;
    }
  );

  // Try NISC / ATSB
  await tryUrl('abs-road-transport-stats',
    'https://www.abs.gov.au/statistics/people/population',
    (html) => null
  );

  // ============================================================
  // 4. drugOverdoseDeaths - AIHW blocked with 403
  // Try data.gov.au, ABS causes of death
  // ============================================================
  console.log('\n--- [4] drugOverdoseDeaths (alternative sources) ---');

  await tryUrl('abs-drug-deaths',
    'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('drug');
      if (idx > -1) {
        const snippet = text.slice(idx, idx + 400);
        console.log(`  Drug context: ${snippet}`);
      }
      const m = text.match(/drug[^.]{0,100}(\d[\d,]+)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100 && v < 20000) return { val: v, unit: 'deaths', period: '2022' };
      }
      return null;
    }
  );

  await tryUrl('aihw-drug-deaths-api',
    'https://www.aihw.gov.au/api/reports/illicit-use-of-drugs/drug-caused-deaths',
    (data) => {
      console.log('  Response type:', typeof data, JSON.stringify(data).slice(0, 200));
      return null;
    }
  );

  // Try data.gov.au for drug deaths
  await tryUrl('data-gov-au-drug',
    'https://data.gov.au/api/3/action/datastore_search?resource_id=&q=drug+deaths+australia',
    (data) => {
      console.log('  data.gov.au response:', JSON.stringify(data).slice(0, 200));
      return null;
    }
  );

  // ============================================================
  // 6. obesityRate - AIHW 403
  // ============================================================
  console.log('\n--- [6] obesityRate (alternative sources) ---');

  await tryUrl('abs-nhs-obesity',
    'https://www.abs.gov.au/statistics/health/health-conditions-and-risks/obesity/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('obes');
      if (idx > -1) console.log(`  Obesity context: ${text.slice(idx, idx + 400)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:obes|overweight)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      return null;
    }
  );

  await tryUrl('abs-nhs-body-weight',
    'https://www.abs.gov.au/statistics/health/health-conditions-and-risks/overweight-and-obesity/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('obes');
      if (idx > -1) console.log(`  Obesity context: ${text.slice(idx, idx + 400)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:obes|overweight)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      return null;
    }
  );

  await tryUrl('aihw-obesity-curl',
    'https://www.aihw.gov.au/reports/overweight-obesity/overweight-and-obesity/contents/overweight-and-obesity',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500 chars: ${text.slice(0, 500)}`);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%/g);
      if (m) console.log(`  % values found: ${m.slice(0, 10).join(', ')}`);
      return null;
    },
    httpAihw
  );

  // ============================================================
  // 7. hospitalWaitTimes - AIHW 403
  // ============================================================
  console.log('\n--- [7] hospitalWaitTimes (alternative sources) ---');

  await tryUrl('aihw-ed-curl',
    'https://www.aihw.gov.au/reports/hospitals/ahs-2022-23-emergency-department-care',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500 chars: ${text.slice(0, 500)}`);
      const m = text.match(/(\d+)\s*minutes/i);
      if (m && parseInt(m[1]) < 300) return { val: parseInt(m[1]), unit: 'minutes', period: '2022-23' };
      return null;
    },
    httpAihw
  );

  await tryUrl('abs-hospital-data',
    'https://www.abs.gov.au/statistics/health/health-services/patient-experiences/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('wait');
      if (idx > -1) console.log(`  Wait context: ${text.slice(idx, idx + 400)}`);
      const m = text.match(/(\d+)\s*(?:minutes?|hours?)[^.]*(?:wait|emergency)/i);
      if (m) return { val: parseInt(m[1]), unit: 'minutes', period: '2022-23' };
      return null;
    }
  );

  // ============================================================
  // 8. mentalHealthAccess - AIHW 403
  // ============================================================
  console.log('\n--- [8] mentalHealthAccess (alternative sources) ---');

  await tryUrl('aihw-mh-curl',
    'https://www.aihw.gov.au/mental-health/topic-areas/services-and-expenditure',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 500 chars: ${text.slice(0, 500)}`);
      return null;
    },
    httpAihw
  );

  await tryUrl('abs-mental-health',
    'https://www.abs.gov.au/statistics/health/mental-health',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*mental health/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      const idx = text.toLowerCase().indexOf('mental');
      if (idx > -1) console.log(`  Mental context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  await tryUrl('abs-nhms',
    'https://www.abs.gov.au/statistics/health/mental-health/national-health-survey/latest-release',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*mental/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      const idx = text.toLowerCase().indexOf('mental');
      if (idx > -1) console.log(`  Mental context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  // ============================================================
  // 9. drugAddiction - AIHW 403
  // ============================================================
  console.log('\n--- [9] drugAddiction (alternative sources) ---');

  await tryUrl('abs-drug-use',
    'https://www.abs.gov.au/statistics/health/health-conditions-and-risks/national-health-survey/latest-release',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:drug|substance|alcohol)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      return null;
    }
  );

  await tryUrl('aihw-ndshs-curl',
    'https://www.aihw.gov.au/reports/illicit-use-of-drugs/national-drug-strategy-household-survey-2022-23/summary',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600 chars: ${text.slice(0, 600)}`);
      return null;
    },
    httpAihw
  );

  // ============================================================
  // 10. homelessness - ABS 404, AIHW 403
  // ============================================================
  console.log('\n--- [10] homelessness (alternative sources) ---');

  await tryUrl('abs-homelessness-2021',
    'https://www.abs.gov.au/statistics/people/housing/homelessness/2021',
    (html) => {
      const text = stripHtml(html);
      const r = findNearKeyword(text, ['homeless', 'experiencing homelessness']);
      if (r && r.val > 1000) return { val: r.val, unit: 'people', period: '2021' };
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  await tryUrl('abs-homelessness-census',
    'https://www.abs.gov.au/census/find-census-data/quickstats/2021/AUS',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/homeless[^.]*?(\d[\d,]+)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 1000) return { val: v, unit: 'people', period: '2021' };
      }
      return null;
    }
  );

  await tryUrl('abs-homelessness-methodology',
    'https://www.abs.gov.au/statistics/people/housing/estimating-homelessness-census-methodology/2021',
    (html) => {
      const text = stripHtml(html);
      const r = findNearKeyword(text, ['homeless', 'estimate', 'total']);
      if (r && r.val > 1000) return { val: r.val, unit: 'people', period: '2021' };
      const idx = text.toLowerCase().indexOf('homeless');
      if (idx > -1) console.log(`  Homeless context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  // ============================================================
  // 11. newBuilds - value was 2026 (wrong year extracted)
  // ============================================================
  console.log('\n--- [11] newBuilds (better extraction) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      // Look for total dwelling approvals - should be ~150,000-180,000 per year
      const patterns = [
        /total dwellings?[^.]*?(\d[\d,]+)/gi,
        /(\d[\d,]+)\s*dwellings?\s*(?:were\s*)?approved/gi,
        /(\d[\d,]+)\s*new\s*(?:dwelling|home|house)/gi,
        /approved[^.]*?(\d[\d,]+)\s*dwellings?/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          console.log(`  Pattern match: ${v} (context: ${text.slice(Math.max(0,m.index-30), m.index+100)})`);
        }
      }
      // Also check for 2023 numbers
      const idx = text.toLowerCase().indexOf('total dwellings');
      if (idx > -1) console.log(`  Total dwellings context: ${text.slice(idx, idx + 400)}`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // ============================================================
  // 12. medianGrossRent
  // ============================================================
  console.log('\n--- [12] medianGrossRent (alternative sources) ---');

  await tryUrl('abs-census-rent',
    'https://www.abs.gov.au/census/find-census-data/quickstats/2021/AUS',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/median[^.]*?rent[^.]*?\$\s*(\d[\d,]+)/i) || text.match(/\$\s*(\d[\d,]+)[^.]*?(?:median|rent)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 100 && v < 5000) return { val: v, unit: 'AUD/week', period: '2021' };
      }
      // Show rent context
      const idx = text.toLowerCase().indexOf('rent');
      if (idx > -1) console.log(`  Rent context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  await tryUrl('abs-rental-prices',
    'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/residential-property-price-indexes-eight-capital-cities/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('rent');
      if (idx > -1) console.log(`  Rent context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  // ============================================================
  // 13. medianHomeValue - value was 2022 (index, not price)
  // ============================================================
  console.log('\n--- [13] medianHomeValue (better extraction) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/residential-property-price-indexes-eight-capital-cities/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      // Look for actual dollar values
      const patterns = [
        /\$\s*([\d,]+(?:\.\d+)?)\s*(?:thousand|million|billion)?[^.]*(?:median|mean|average)/gi,
        /median[^.]*?\$\s*([\d,]+)/gi,
        /weighted\s*mean[^.]*?\$\s*([\d,]+)/gi,
        /dwelling\s*price[^.]*?\$\s*([\d,]+)/gi,
        /average\s*price[^.]*?\$\s*([\d,]+)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseFloat(m[1].replace(/,/g, ''));
          console.log(`  Pattern: ${v} (context: ${text.slice(Math.max(0,m.index-30), m.index+120)})`);
        }
      }
      const idx = text.toLowerCase().indexOf('median');
      if (idx > -1) console.log(`  Median context: ${text.slice(idx, idx + 400)}`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  await tryUrl('abs-total-value-dwellings',
    'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release',
    (html) => {
      const text = stripHtml(html);
      const idx = text.toLowerCase().indexOf('mean');
      if (idx > -1) console.log(`  Mean context: ${text.slice(idx, idx + 400)}`);
      const m = text.match(/mean[^.]*?\$\s*([\d,]+)/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''));
        if (v > 10000) return { val: v, unit: 'AUD', period: '2023' };
      }
      return null;
    }
  );

  // ============================================================
  // 15. studentDebt - education.gov.au timed out
  // ============================================================
  console.log('\n--- [15] studentDebt (alternative sources) ---');

  await tryUrl('abs-student-debt',
    'https://www.abs.gov.au/statistics/people/education',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/HECS|HELP|student loan|student debt/i);
      console.log(`  Found student loan ref: ${!!m}`);
      return null;
    }
  );

  // Try ATO HELP debt statistics
  await tryUrl('ato-help-stats',
    'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/tax-statistics/tax-statistics-2021-22/chapter-9---higher-education-loan-program',
    (html) => {
      const text = stripHtml(html);
      const r = findNearKeyword(text, ['HELP', 'HECS', 'outstanding', 'total debt', 'billion']);
      if (r) return { val: r.val, unit: 'AUD', period: '2021-22' };
      const idx = text.toLowerCase().indexOf('help');
      if (idx > -1) console.log(`  HELP context: ${text.slice(idx, idx + 400)}`);
      return null;
    }
  );

  await tryUrl('education-gov-hecs',
    'https://www.education.gov.au/higher-education-loan-program',
    (html) => {
      const text = stripHtml(html);
      const r = findNearKeyword(text, ['billion', 'total', 'outstanding', 'debt', 'loan']);
      if (r) return { val: r.val, unit: 'AUD', period: '2023' };
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  // ============================================================
  // 16. schoolFunding
  // ============================================================
  console.log('\n--- [16] schoolFunding (alternative sources) ---');

  await tryUrl('abs-education-spending',
    'https://www.abs.gov.au/statistics/people/education/government-finance-statistics-education/latest-release',
    (html) => {
      const text = stripHtml(html);
      const r = findNearKeyword(text, ['per student', 'per pupil', 'recurrent expenditure', 'total expenditure', 'billion']);
      if (r && r.val > 0) {
        console.log(`  Found near kw: ${r.val} (snippet: ${r.snippet?.slice(0, 200)})`);
        return { val: r.val, unit: 'AUD', period: '2022-23' };
      }
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  await tryUrl('myfuture-school-funding',
    'https://www.abs.gov.au/statistics/people/education',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/government\s*(?:school\s*)?(?:funding|expenditure)[^.]*?\$\s*([\d,]+)/i);
      if (m) return { val: parseInt(m[1].replace(/,/g, '')), unit: 'AUD', period: '2023' };
      return null;
    }
  );

  // ============================================================
  // 17. literacy
  // ============================================================
  console.log('\n--- [17] literacy (alternative sources) ---');

  await tryUrl('abs-piaac-2023',
    'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-piaac',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  await tryUrl('aihw-literacy',
    'https://www.aihw.gov.au/reports/australias-welfare/literacy-and-numeracy',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency|level|below)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    },
    httpAihw
  );

  await tryUrl('abs-literacy-skills',
    'https://www.abs.gov.au/statistics/people/education/skills-australia-series',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|numeracy|proficiency)/i);
      if (m) return { val: parseFloat(m[1]), unit: '%', period: '2020' };
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  // ============================================================
  // 18. povertyRate - value was 40 (seems wrong)
  // ============================================================
  console.log('\n--- [18] povertyRate (verify/fix) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      // Look for poverty-related text
      const idx = text.toLowerCase().indexOf('pover');
      if (idx > -1) console.log(`  Poverty context: ${text.slice(idx, idx + 600)}`);
      // Look for low income
      const idx2 = text.toLowerCase().indexOf('low income');
      if (idx2 > -1) console.log(`  Low income context: ${text.slice(idx2, idx2 + 600)}`);
      // Gini check
      const idx3 = text.toLowerCase().indexOf('gini');
      if (idx3 > -1) console.log(`  Gini context: ${text.slice(idx3, idx3 + 400)}`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // ============================================================
  // 19. childPoverty - AIHW 403
  // ============================================================
  console.log('\n--- [19] childPoverty (alternative sources) ---');

  await tryUrl('aihw-children-economic-curl',
    'https://www.aihw.gov.au/reports/children-youth/australias-children/contents/economic-resources',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    },
    httpAihw
  );

  await tryUrl('abs-child-poverty',
    'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      const m = text.match(/child[^.]*?(\d+(?:\.\d)?)\s*%/i) || text.match(/(\d+(?:\.\d)?)\s*%[^.]*child/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v < 50) return { val: v, unit: '%', period: '2021-22' };
      }
      return null;
    }
  );

  // ============================================================
  // 20. immigration - value was 194400 - verify this
  // ============================================================
  console.log('\n--- [20] immigration (verify) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/people/population/migration-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      const idx = text.toLowerCase().indexOf('net overseas');
      if (idx > -1) console.log(`  NOM context: ${text.slice(idx, idx + 500)}`);
      const patterns = [
        /net overseas migration[^.]*?([\d,]+)/gi,
        /NOM[^.]*?([\d,]+)/g,
        /([\d,]+)\s*persons?[^.]*?(?:arrived|migrated|net)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 10000) console.log(`  Pattern match: ${v} (context: ${text.slice(Math.max(0,m.index-20), m.index+100)})`);
        }
      }
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // ============================================================
  // 21. giniCoefficient - value was 0.329 - verify (looks correct)
  // ============================================================
  console.log('\n--- [21] giniCoefficient (verify) ---');
  {
    const url = 'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      const idx = text.toLowerCase().indexOf('gini');
      if (idx > -1) console.log(`  Gini context: ${text.slice(Math.max(0, idx-50), idx + 500)}`);
      const m = text.match(/gini[^.]*?(\d\.\d+)/i);
      if (m) console.log(`  Gini value: ${m[1]}`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  // ============================================================
  // 22. minWageGap - value was 24.95 - verify (looks correct)
  // ============================================================
  console.log('\n--- [22] minWageGap (verify) ---');
  {
    const url = 'https://www.fwc.gov.au/agreements-awards/minimum-wages-and-conditions/national-minimum-wage';
    try {
      const resp = await http.get(url);
      const text = stripHtml(resp.data);
      const idx = text.toLowerCase().indexOf('minimum wage');
      if (idx > -1) console.log(`  Min wage context: ${text.slice(idx, idx + 500)}`);
      const m = text.match(/\$\s*(\d{2}\.\d{2})/g);
      if (m) console.log(`  Dollar values: ${m.slice(0, 10).join(', ')}`);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
  }

  console.log('\n=== ROUND 2 PROBE COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
