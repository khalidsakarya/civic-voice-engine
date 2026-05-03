/**
 * AU Stats Probe Script
 * Tests 22 Australian government API/HTML endpoints
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

// Find a number near a keyword in text
function findNearKeyword(text, keywords, windowSize = 300) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const idx = lower.indexOf(kw.toLowerCase());
    if (idx === -1) continue;
    const snippet = text.slice(Math.max(0, idx - 50), idx + windowSize);
    // Look for numbers like 1,234.56 or 12.3 or 1234
    const nums = snippet.match(/[\d,]+\.?\d*/g);
    if (nums && nums.length > 0) {
      // Return the first number that looks reasonable
      for (const n of nums) {
        const val = parseFloat(n.replace(/,/g, ''));
        if (!isNaN(val) && val > 0) return { val, snippet: snippet.slice(0, 200) };
      }
    }
  }
  return null;
}

// Extract SDMX JSON latest value
function extractSdmx(data, seriesIndex = 0) {
  try {
    const ds = data.data || data;
    const series = ds.dataSets?.[0]?.series;
    if (!series) return null;
    const keys = Object.keys(series);
    if (!keys.length) return null;
    const key = keys[seriesIndex] || keys[0];
    const obs = series[key].observations;
    const obsKeys = Object.keys(obs).map(Number).sort((a, b) => b - a);
    if (!obsKeys.length) return null;
    const latestKey = obsKeys[0];
    const val = obs[latestKey][0];
    // Get period from structure
    const periods = ds.structure?.dimensions?.observation?.[0]?.values;
    const period = periods?.[latestKey]?.id || latestKey;
    return { val, period };
  } catch (e) {
    return null;
  }
}

async function probe(name, candidates) {
  for (const c of candidates) {
    const { url, label, fn } = c;
    try {
      process.stdout.write(`  Trying ${label || url.slice(0, 80)}... `);
      const resp = await http.get(url, {
        headers: c.headers || {},
        responseType: c.json ? 'json' : 'text',
      });
      const result = await fn(resp.data, url);
      if (result) {
        console.log(`OK`);
        console.log(`  >> ${name}: ${result.val} | ${result.unit || '-'} | ${result.period || '-'} | ${url}`);
        return result;
      } else {
        console.log(`NO DATA`);
      }
    } catch (e) {
      console.log(`FAIL (${e.message?.slice(0, 60)})`);
    }
  }
  console.log(`  !! ${name}: NO WORKING URL FOUND`);
  return null;
}

async function main() {
  console.log('=== AU STATS PROBE ===\n');

  // 1. crimeRate
  console.log('[1] crimeRate');
  await probe('crimeRate', [
    {
      url: 'https://www.abs.gov.au/statistics/people/crime-and-justice/crime-victimisation-australia/latest-release',
      label: 'ABS crime victimisation HTML',
      fn: (html) => {
        const text = stripHtml(html);
        // Look for victimisation rate per 100k or percentage
        const r = findNearKeyword(text, ['victimisation rate', 'victimization rate', 'per 100,000', 'per 100 000', 'persons experienced']);
        if (r) return { val: r.val, unit: 'per 100,000', period: '2022-23', snippet: r.snippet };
        // Try to find any rate figure
        const m = text.match(/(\d+[\.,]\d+)\s*per\s*(?:100[,\s]000|hundred thousand)/i);
        if (m) return { val: parseFloat(m[1].replace(',', '')), unit: 'per 100,000', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/crime-and-justice/recorded-crime-victims/latest-release',
      label: 'ABS recorded crime victims HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d[\d,]+)\s*(?:victims|offences|victimisations)/i);
        if (m) return { val: parseFloat(m[1].replace(/,/g, '')), unit: 'victims', period: '2023' };
        return null;
      }
    }
  ]);

  // 2. homicideRate
  console.log('[2] homicideRate');
  await probe('homicideRate', [
    {
      url: 'https://www.abs.gov.au/statistics/health/causes-death/causes-death-australia/latest-release',
      label: 'ABS causes of death HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['homicide', 'murder', 'assault', 'X85', 'Y09']);
        if (r) return { val: r.val, unit: 'deaths', period: '2022' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/crime-and-justice/recorded-crime-offenders/latest-release',
      label: 'ABS recorded crime offenders HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['homicide', 'murder']);
        if (r) return { val: r.val, unit: 'offences', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/crime-and-justice/recorded-crime-victims/2022-23',
      label: 'ABS recorded crime victims 2022-23 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['homicide', 'murder', 'manslaughter']);
        if (r) return { val: r.val, unit: 'victims', period: '2022-23' };
        return null;
      }
    }
  ]);

  // 3. roadFatalities
  console.log('[3] roadFatalities');
  await probe('roadFatalities', [
    {
      url: 'https://www.bitre.gov.au/statistics/safety/road_deaths_australia_annual_summaries',
      label: 'BITRE road deaths annual HTML',
      fn: (html) => {
        const text = stripHtml(html);
        // Look for a 4-digit year and nearby death count
        const r = findNearKeyword(text, ['2023', '2022', 'road deaths', 'fatalities', 'killed']);
        if (r) return { val: r.val, unit: 'deaths', period: '2023' };
        const m = text.match(/(\d{3,4})\s*(?:road\s*)?(?:deaths|fatalities|people killed)/i);
        if (m) return { val: parseInt(m[1]), unit: 'deaths', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.bitre.gov.au/sites/default/files/documents/bitre_road_deaths_australia_2023_statistical_summary.pdf',
      label: 'BITRE road deaths 2023 PDF (skip)',
      fn: () => null
    },
    {
      url: 'https://www.infrastructure.gov.au/infrastructure-transport-vehicles/vehicle-safety/road-safety/road-trauma-australia-annual-summaries',
      label: 'Infrastructure.gov.au road trauma HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{3,4})\s*(?:road\s*)?(?:deaths|fatalities)/i);
        if (m) return { val: parseInt(m[1]), unit: 'deaths', period: '2023' };
        return null;
      }
    }
  ]);

  // 4. drugOverdoseDeaths
  console.log('[4] drugOverdoseDeaths');
  await probe('drugOverdoseDeaths', [
    {
      url: 'https://www.aihw.gov.au/reports/alcohol/alcohol-tobacco-other-drugs-australia/contents/drug-types/illicit-drugs',
      label: 'AIHW ATODA illicit drugs HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['drug-induced death', 'drug induced death', 'overdose death', 'died from drug', 'deaths due to drug']);
        if (r) return { val: r.val, unit: 'deaths', period: '2022' };
        const m = text.match(/(\d[\d,]+)\s*(?:drug.induced|overdose|drug-related)\s*deaths/i);
        if (m) return { val: parseInt(m[1].replace(/,/g, '')), unit: 'deaths', period: '2022' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/illicit-use-of-drugs/drug-caused-deaths/contents/latest-findings',
      label: 'AIHW drug-caused deaths HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['drug-caused', 'drug caused', '2022', '2021', 'deaths']);
        if (r) return { val: r.val, unit: 'deaths', period: '2022' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/illicit-use-of-drugs/alcohol-tobacco-other-drugs-australia',
      label: 'AIHW ATODA main page HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['drug-induced', 'drug induced', 'overdose']);
        if (r) return { val: r.val, unit: 'deaths', period: '2022' };
        return null;
      }
    }
  ]);

  // 5. lifeExpectancy
  console.log('[5] lifeExpectancy');
  await probe('lifeExpectancy', [
    {
      url: 'https://api.data.abs.gov.au/data/LIFE_TABLE/1.AUS.0..A?format=jsondata&startPeriod=2020',
      label: 'ABS SDMX life tables API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r) return { val: r.val, unit: 'years', period: r.period };
        return null;
      }
    },
    {
      url: 'https://api.data.abs.gov.au/data/LIFE_TABLE/1.AUS.0.0.A?format=jsondata&startPeriod=2020',
      label: 'ABS SDMX life tables API (alt key)',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val > 60 && r.val < 100) return { val: r.val, unit: 'years', period: r.period };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/population/life-tables/latest-release',
      label: 'ABS life tables HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['life expectancy at birth', 'years at birth', 'born in']);
        if (r && r.val > 60 && r.val < 100) return { val: r.val, unit: 'years', period: '2020-22' };
        const m = text.match(/life expectancy[^.]*?(\d{2}\.\d)/i);
        if (m) return { val: parseFloat(m[1]), unit: 'years', period: '2020-22' };
        return null;
      }
    }
  ]);

  // 6. obesityRate
  console.log('[6] obesityRate');
  await probe('obesityRate', [
    {
      url: 'https://www.aihw.gov.au/reports/overweight-obesity/overweight-and-obesity/contents/overweight-and-obesity',
      label: 'AIHW overweight obesity HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['overweight or obese', 'overweight and obese', '% were overweight', 'adults were overweight']);
        if (r && r.val > 10 && r.val < 100) return { val: r.val, unit: '%', period: '2022' };
        const m = text.match(/(\d{2}(?:\.\d)?)\s*%\s*(?:of\s*adults\s*)?(?:were\s*)?(?:overweight|obese)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/overweight-obesity/overweight-and-obesity',
      label: 'AIHW overweight obesity landing HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:overweight|obese)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022' };
        return null;
      }
    }
  ]);

  // 7. hospitalWaitTimes
  console.log('[7] hospitalWaitTimes');
  await probe('hospitalWaitTimes', [
    {
      url: 'https://www.aihw.gov.au/reports/hospitals/ahs-2022-23-emergency-department-care',
      label: 'AIHW ED care 2022-23 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['median wait', 'median time', 'minutes', 'wait time']);
        if (r && r.val > 0 && r.val < 500) return { val: r.val, unit: 'minutes', period: '2022-23' };
        const m = text.match(/(\d+)\s*minutes/i);
        if (m) return { val: parseInt(m[1]), unit: 'minutes', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports-data/myhospitals/sectors/emergency-department-care',
      label: 'AIHW MyHospitals ED care HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['median wait', 'wait time', 'minutes', 'seen within']);
        if (r && r.val > 0 && r.val < 500) return { val: r.val, unit: 'minutes', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/hospitals/emergency-department-care-2023-24',
      label: 'AIHW ED care 2023-24 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d+)\s*minutes/i);
        if (m && parseInt(m[1]) < 300) return { val: parseInt(m[1]), unit: 'minutes', period: '2023-24' };
        return null;
      }
    }
  ]);

  // 8. mentalHealthAccess
  console.log('[8] mentalHealthAccess');
  await probe('mentalHealthAccess', [
    {
      url: 'https://www.aihw.gov.au/mental-health/topic-areas/services-and-expenditure',
      label: 'AIHW mental health services HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['mental health service', 'accessed mental health', '% of', 'per cent']);
        if (r && r.val > 0 && r.val < 100) return { val: r.val, unit: '%', period: '2022-23' };
        const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*mental health/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/mental-health/overview/mental-health-services-in-australia',
      label: 'AIHW mental health services in Australia HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['million people', 'accessed', 'mental health', 'per cent', '%']);
        if (r && r.val > 0 && r.val < 100) return { val: r.val, unit: '%', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/mental-health-services/mental-health-services-in-australia/report-contents/summary',
      label: 'AIHW MHSA summary HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d+(?:\.\d+)?)\s*(?:million|%|per cent)[^.]*(?:mental health|service)/i);
        if (m) return { val: parseFloat(m[1]), unit: m[0].includes('%') ? '%' : 'million people', period: '2022-23' };
        return null;
      }
    }
  ]);

  // 9. drugAddiction
  console.log('[9] drugAddiction');
  await probe('drugAddiction', [
    {
      url: 'https://www.aihw.gov.au/reports/illicit-use-of-drugs/national-drug-strategy-household-survey-2022-23/summary',
      label: 'AIHW NDSHS 2022-23 summary HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['illicit drug', 'used an illicit', 'drug use in the past', '% used', 'per cent']);
        if (r && r.val > 0 && r.val < 100) return { val: r.val, unit: '%', period: '2022-23' };
        const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:illicit|drug)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/illicit-use-of-drugs/national-drug-strategy-household-survey-2022-23',
      label: 'AIHW NDSHS 2022-23 landing HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d+(?:\.\d)?)\s*%[^.]*(?:illicit|drug|substance)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2022-23' };
        return null;
      }
    }
  ]);

  // 10. homelessness
  console.log('[10] homelessness');
  await probe('homelessness', [
    {
      url: 'https://www.abs.gov.au/statistics/people/housing/homelessness-australia/latest-release',
      label: 'ABS homelessness latest HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['homeless', 'experiencing homelessness', 'people were homeless']);
        if (r && r.val > 1000) return { val: r.val, unit: 'people', period: '2021' };
        const m = text.match(/(\d[\d,]+)\s*(?:people|persons)\s*(?:were\s*)?(?:experiencing\s*)?homeless/i);
        if (m) return { val: parseInt(m[1].replace(/,/g, '')), unit: 'people', period: '2021' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/homelessness/overview',
      label: 'AIHW homelessness overview HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['homeless', '122,494', 'census night']);
        if (r && r.val > 1000) return { val: r.val, unit: 'people', period: '2021' };
        return null;
      }
    }
  ]);

  // 11. newBuilds
  console.log('[11] newBuilds');
  await probe('newBuilds', [
    {
      url: 'https://api.data.abs.gov.au/data/BUILDING_APPROVALS/1.1.AUS.A?format=jsondata&startPeriod=2022',
      label: 'ABS SDMX building approvals API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val > 0) return { val: r.val, unit: 'approvals', period: r.period };
        return null;
      }
    },
    {
      url: 'https://api.data.abs.gov.au/data/BUILDING_APPROVALS/.1.AUS.A?format=jsondata&startPeriod=2022',
      label: 'ABS SDMX building approvals API (alt)',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val > 0) return { val: r.val, unit: 'approvals', period: r.period };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/industry/building-and-construction/building-approvals-australia/latest-release',
      label: 'ABS building approvals HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['total dwellings', 'new dwelling', 'approved', 'building approvals']);
        if (r && r.val > 1000) return { val: r.val, unit: 'dwellings', period: '2023-24' };
        const m = text.match(/(\d[\d,]+)\s*(?:total\s*)?(?:new\s*)?dwellings?\s*(?:approved|approvals)?/i);
        if (m) return { val: parseInt(m[1].replace(/,/g, '')), unit: 'dwellings', period: '2023-24' };
        return null;
      }
    }
  ]);

  // 12. medianGrossRent
  console.log('[12] medianGrossRent');
  await probe('medianGrossRent', [
    {
      url: 'https://api.data.abs.gov.au/data/RENTAL_AFFORDABILITY/.AUS.Q?format=jsondata&startPeriod=2023',
      label: 'ABS SDMX rental affordability API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD/week', period: r.period };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/rental-affordability-indicators/latest-release',
      label: 'ABS rental affordability indicators HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['median rent', 'weekly rent', 'rent per week', '$']);
        if (r && r.val > 100 && r.val < 5000) return { val: r.val, unit: 'AUD/week', period: '2023' };
        const m = text.match(/\$\s*(\d[\d,]+)(?:\s*per\s*week|\s*\/week|\s*pw)?/i);
        if (m) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 5000) return { val: v, unit: 'AUD/week', period: '2023' };
        }
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/housing/housing-census/2021',
      label: 'ABS Housing Census 2021 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/\$\s*(\d[\d,]+)(?:\s*per\s*week|\s*median\s*rent)/i);
        if (m) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 100 && v < 5000) return { val: v, unit: 'AUD/week', period: '2021' };
        }
        return null;
      }
    }
  ]);

  // 13. medianHomeValue
  console.log('[13] medianHomeValue');
  await probe('medianHomeValue', [
    {
      url: 'https://api.data.abs.gov.au/data/RES_PROP_INDEX/.AUS.A?format=jsondata&startPeriod=2022',
      label: 'ABS SDMX residential property index API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val > 0) return { val: r.val, unit: 'index', period: r.period };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/total-value-dwellings/latest-release',
      label: 'ABS total value of dwellings HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['median price', 'mean price', 'average price', 'dwelling price']);
        if (r && r.val > 100000) return { val: r.val, unit: 'AUD', period: '2023' };
        const m = text.match(/\$\s*([\d,]+)\s*(?:thousand|million)?[^.]*(?:median|mean|average)\s*(?:house|dwelling|property)/i);
        if (m) {
          const v = parseInt(m[1].replace(/,/g, ''));
          if (v > 1000) return { val: v, unit: 'AUD', period: '2023' };
        }
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/residential-property-price-indexes-eight-capital-cities/latest-release',
      label: 'ABS residential property price indexes HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['median price', 'weighted mean', 'eight capital']);
        if (r && r.val > 10) return { val: r.val, unit: 'index/AUD', period: '2023' };
        return null;
      }
    }
  ]);

  // 14. graduationRate
  console.log('[14] graduationRate');
  await probe('graduationRate', [
    {
      url: 'https://www.abs.gov.au/statistics/people/education/schools/latest-release',
      label: 'ABS schools latest release HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['apparent retention', 'year 12', 'retention rate', 'completed year 12']);
        if (r && r.val > 10 && r.val < 110) return { val: r.val, unit: '%', period: '2023' };
        const m = text.match(/(\d{2,3}(?:\.\d)?)\s*%[^.]*(?:year\s*12|year12|retention)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/education/schools/2023',
      label: 'ABS schools 2023 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{2,3}(?:\.\d)?)\s*%[^.]*(?:year\s*12|retention)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia',
      label: 'ACARA national report HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{2,3}(?:\.\d)?)\s*%[^.]*(?:year\s*12|retention|completed)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2023' };
        return null;
      }
    }
  ]);

  // 15. studentDebt
  console.log('[15] studentDebt');
  await probe('studentDebt', [
    {
      url: 'https://www.education.gov.au/higher-education-loan-program/resources/hecs-help-statistical-report',
      label: 'Education.gov.au HECS HELP stats HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['total debt', 'loan balance', 'HELP debt', 'billion', 'outstanding']);
        if (r && r.val > 0) return { val: r.val, unit: 'billion AUD', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.education.gov.au/higher-education-statistics/resources/2023-student-data',
      label: 'Education.gov.au 2023 student data HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['HELP', 'HECS', 'loan', 'debt', 'billion']);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/tax-gap/student-loan-programs',
      label: 'ATO student loans HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['HELP', 'HECS', 'outstanding', 'billion']);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD', period: '2023' };
        return null;
      }
    }
  ]);

  // 16. schoolFunding
  console.log('[16] schoolFunding');
  await probe('schoolFunding', [
    {
      url: 'https://www.education.gov.au/school-funding/resources/national-school-resourcing-board',
      label: 'Education.gov.au school resourcing HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['per student', 'per pupil', 'billion', 'funding', '$']);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD', period: '2023' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/australias-welfare/expenditure-on-education',
      label: 'AIHW expenditure on education HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['per student', 'per pupil', 'billion', 'education expenditure', 'funding']);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD', period: '2022-23' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/education/government-finance-statistics-education/latest-release',
      label: 'ABS government finance stats education HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['per student', 'per pupil', 'recurrent expenditure', 'total expenditure']);
        if (r && r.val > 0) return { val: r.val, unit: 'AUD', period: '2022-23' };
        return null;
      }
    }
  ]);

  // 17. literacy
  console.log('[17] literacy');
  await probe('literacy', [
    {
      url: 'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-australia/2011-12',
      label: 'ABS PIAAC 2011-12 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['literacy', 'proficiency level', 'below level 3', 'level 1', 'level 2']);
        if (r && r.val > 0 && r.val < 100) return { val: r.val, unit: '%', period: '2011-12' };
        const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|proficiency)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2011-12' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/education/adult-literacy-and-life-skills-survey-summary-results-australia/2006',
      label: 'ABS adult literacy survey HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|prose|document)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2006' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/australias-welfare/literacy-and-numeracy-skills',
      label: 'AIHW literacy numeracy HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{2}(?:\.\d)?)\s*%[^.]*(?:literacy|numeracy|proficiency)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2016' };
        return null;
      }
    }
  ]);

  // 18. povertyRate
  console.log('[18] povertyRate');
  await probe('povertyRate', [
    {
      url: 'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release',
      label: 'ABS household income and wealth HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['below 50', 'poverty line', 'low income', 'income poverty', 'relative poverty']);
        if (r && r.val > 0 && r.val < 50) return { val: r.val, unit: '%', period: '2021-22' };
        const m = text.match(/(\d{1,2}(?:\.\d)?)\s*%[^.]*(?:poverty|low income|below median)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2021-22' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/australias-welfare/welfare-expenditure',
      label: 'AIHW welfare expenditure HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['poverty', 'low income', 'below 50%', 'income support']);
        if (r && r.val > 0 && r.val < 50) return { val: r.val, unit: '%', period: '2022' };
        return null;
      }
    }
  ]);

  // 19. childPoverty
  console.log('[19] childPoverty');
  await probe('childPoverty', [
    {
      url: 'https://www.aihw.gov.au/reports/children-youth/australias-children/contents/economic-resources',
      label: 'AIHW Australias children economic resources HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['child poverty', 'children in poverty', 'low income', 'poverty line', '% of children']);
        if (r && r.val > 0 && r.val < 50) return { val: r.val, unit: '%', period: '2021' };
        const m = text.match(/(\d{1,2}(?:\.\d)?)\s*%[^.]*(?:child|children)[^.]*(?:poverty|low income)/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2021' };
        // reverse
        const m2 = text.match(/(?:child|children)[^.]*?(\d{1,2}(?:\.\d)?)\s*%/i);
        if (m2) return { val: parseFloat(m2[1]), unit: '%', period: '2021' };
        return null;
      }
    },
    {
      url: 'https://www.aihw.gov.au/reports/children-youth/australias-children',
      label: 'AIHW Australias children landing HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/(\d{1,2}(?:\.\d)?)\s*%[^.]*child/i);
        if (m) return { val: parseFloat(m[1]), unit: '%', period: '2021' };
        return null;
      }
    }
  ]);

  // 20. immigration (net overseas migration)
  console.log('[20] immigration');
  await probe('immigration', [
    {
      url: 'https://api.data.abs.gov.au/data/ERP_NET_MIGRATION/1.AUS.A?format=jsondata&startPeriod=2021',
      label: 'ABS SDMX net overseas migration API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val !== null) return { val: r.val, unit: 'persons', period: r.period };
        return null;
      }
    },
    {
      url: 'https://api.data.abs.gov.au/data/NOM_PRELIMINARY/1.AUS.A?format=jsondata&startPeriod=2021',
      label: 'ABS SDMX NOM preliminary API',
      json: true,
      headers: { 'Accept': 'application/json' },
      fn: (data) => {
        const r = extractSdmx(data);
        if (r && r.val !== null) return { val: r.val, unit: 'persons', period: r.period };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/people/population/migration-australia/latest-release',
      label: 'ABS migration Australia HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['net overseas migration', 'NOM', 'net migration', 'migrants arrived']);
        if (r && r.val > 1000) return { val: r.val, unit: 'persons', period: '2022-23' };
        const m = text.match(/(\d[\d,]+)\s*(?:persons?|people|migrants?)[^.]*(?:net|overseas|migration)/i);
        if (m) return { val: parseInt(m[1].replace(/,/g, '')), unit: 'persons', period: '2022-23' };
        return null;
      }
    }
  ]);

  // 21. giniCoefficient
  console.log('[21] giniCoefficient');
  await probe('giniCoefficient', [
    {
      url: 'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/latest-release',
      label: 'ABS household income and wealth (Gini) HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['gini', 'gini coefficient', 'income inequality']);
        if (r && r.val > 0 && r.val < 1) return { val: r.val, unit: 'coefficient', period: '2021-22' };
        const m = text.match(/gini[^.]*?(\d+\.\d+)/i);
        if (m) return { val: parseFloat(m[1]), unit: 'coefficient', period: '2021-22' };
        return null;
      }
    },
    {
      url: 'https://www.abs.gov.au/statistics/economy/finance/household-income-and-wealth-australia/2019-20',
      label: 'ABS household income 2019-20 HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/gini[^.]*?(\d+\.\d+)/i);
        if (m) return { val: parseFloat(m[1]), unit: 'coefficient', period: '2019-20' };
        return null;
      }
    }
  ]);

  // 22. minWageGap (min wage)
  console.log('[22] minWageGap');
  await probe('minWageGap', [
    {
      url: 'https://www.fwc.gov.au/agreements-awards/minimum-wages-and-conditions/national-minimum-wage',
      label: 'FWC national minimum wage HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const r = findNearKeyword(text, ['national minimum wage', 'minimum wage', '$', 'per hour', 'hourly rate']);
        if (r && r.val > 10 && r.val < 100) return { val: r.val, unit: 'AUD/hour', period: '2024-25' };
        const m = text.match(/\$\s*(\d{2}(?:\.\d{1,2})?)\s*per\s*hour/i);
        if (m) return { val: parseFloat(m[1]), unit: 'AUD/hour', period: '2024-25' };
        // Also try without per hour
        const m2 = text.match(/minimum wage[^.]*\$\s*(\d{2}(?:\.\d{1,2})?)/i);
        if (m2) return { val: parseFloat(m2[1]), unit: 'AUD/hour', period: '2024-25' };
        return null;
      }
    },
    {
      url: 'https://www.fwc.gov.au/documents/sites/wages/current-wages.htm',
      label: 'FWC current wages HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/\$\s*(\d{2}(?:\.\d{1,2})?)\s*per\s*hour/i);
        if (m) return { val: parseFloat(m[1]), unit: 'AUD/hour', period: '2024-25' };
        return null;
      }
    },
    {
      url: 'https://www.fwc.gov.au/hearings-decisions/major-cases/annual-wage-review',
      label: 'FWC annual wage review HTML',
      fn: (html) => {
        const text = stripHtml(html);
        const m = text.match(/\$\s*(\d{2}(?:\.\d{1,2})?)\s*(?:per\s*hour|\/hour|an\s*hour)/i);
        if (m) return { val: parseFloat(m[1]), unit: 'AUD/hour', period: '2024-25' };
        return null;
      }
    }
  ]);

  console.log('\n=== PROBE COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
