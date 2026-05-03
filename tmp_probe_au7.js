/**
 * AU Stats Probe Script - Round 7
 * Final targeted pass — poverty/inequality report, PIAAC literacy, studentDebt, schoolFunding
 */

require('dotenv').config();
const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 25000;

const http = axios.create({
  timeout: TIMEOUT,
  headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
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
    if (result) { console.log(`OK => ${JSON.stringify(result)}`); return result; }
    console.log('NO DATA');
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 100)}`);
  }
  return null;
}

async function main() {
  console.log('=== AU STATS PROBE ROUND 7 ===\n');

  // 18. povertyRate — try the actual povertyandinequality.acoss.org.au data page
  console.log('--- [18] povertyRate ---');

  await tryUrl('pia-data',
    'https://povertyandinequality.acoss.org.au/poverty/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 1000: ${text.slice(0, 1000)}`);
      const m = text.match(/(\d+(?:\.\d+)?)\s*(?:million|%)[^.]*(?:poverty|below|income)/i);
      if (m) console.log(`  Match: ${m[0]}`);
      return null;
    }
  );

  await tryUrl('pia-poverty2025',
    'https://povertyandinequality.acoss.org.au/poverty-in-australia-2025/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 1200: ${text.slice(0, 1200)}`);
      const m = text.match(/(\d+(?:\.\d+)?)\s*(?:million|%)[^.]*(?:poverty|below|income)/i);
      if (m) console.log(`  Match: ${m[0]}`);
      // Try to find key figures
      const patterns = [
        /(\d+(?:\.\d+)?)\s*million[^.]*(?:poverty|below|struggle)/gi,
        /(\d+(?:\.\d+)?)\s*%[^.]*(?:poverty|below|low income)/gi,
        /one\s*in\s*(\w+)[^.]*(?:poverty|poor|struggle)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          console.log(`  Pattern match: ${m[0]}`);
        }
      }
      return null;
    }
  );

  // 17. literacy — try PIAAC 2011-12 page and extract literacy %
  console.log('\n--- [17] literacy (PIAAC 2011-12) ---');

  await tryUrl('abs-piaac-2011-12-deep',
    'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-australia/2011-12',
    (html) => {
      const text = stripHtml(html);
      // Find literacy proficiency
      const idx = text.toLowerCase().indexOf('literacy');
      if (idx > -1) console.log(`  Literacy context: ${text.slice(idx, idx+600)}`);
      // Look for level 3+ or below level 3
      const patterns = [
        /level\s*3[^.]*?(\d{2}(?:\.\d)?)\s*%/gi,
        /(\d{2}(?:\.\d)?)\s*%[^.]*level\s*[12]/gi,
        /literacy[^.]*?(\d{2}(?:\.\d)?)\s*%/gi,
        /(\d{2}(?:\.\d)?)\s*%[^.]*literacy/gi,
        /(\d{2}(?:\.\d)?)\s*%[^.]*(?:proficient|proficiency)/gi,
      ];
      for (const pat of patterns) {
        const matches = [...text.matchAll(pat)];
        for (const m of matches.slice(0, 3)) {
          const v = parseFloat(m[1]);
          if (v > 10 && v < 100) {
            console.log(`  Candidate: ${v}% (${text.slice(Math.max(0,m.index-30), m.index+150)})`);
          }
        }
      }
      // Print first 500 chars to understand structure
      console.log(`  First 500: ${text.slice(0, 500)}`);
      return null;
    }
  );

  // Try PIAAC specific content pages
  await tryUrl('abs-piaac-key-findings',
    'https://www.abs.gov.au/statistics/people/education/programme-international-assessment-adult-competencies-australia/2011-12#key-statistics',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      return null;
    }
  );

  // 15. studentDebt — try a data.gov.au search API v2
  console.log('\n--- [15] studentDebt ---');

  await tryUrl('data-gov-au-v2',
    'https://data.gov.au/api/v0/search/datasets?query=HELP+higher+education+loan+debt&limit=5',
    (data) => {
      if (data && data.dataSets) {
        console.log(`  Found ${data.dataSets.length} datasets`);
        data.dataSets.forEach(d => console.log(`    - ${d.identifier}: ${d.title}`));
      } else {
        console.log(`  Response: ${JSON.stringify(data).slice(0, 300)}`);
      }
      return null;
    }
  );

  // Try ATO working link variant
  await tryUrl('ato-superannuation-stats',
    'https://www.ato.gov.au/about-ato/research-and-statistics/in-detail/superannuation-statistics/students/',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // Try Treasury paper on HELP
  await tryUrl('treasury-help',
    'https://treasury.gov.au/sites/default/files/2022-12/c2022-344890.pdf',
    () => null // skip PDF
  );

  // Try budget.gov.au
  await tryUrl('budget-education',
    'https://www.budget.gov.au/2024-25/content/glossy/education/html/edu_5.htm',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 600: ${text.slice(0, 600)}`);
      return null;
    }
  );

  // 16. schoolFunding — try ACARA's known data portal
  console.log('\n--- [16] schoolFunding ---');

  await tryUrl('acara-data-portal',
    'https://www.acara.edu.au/reporting/national-report-on-schooling-in-australia/national-report-on-schooling-in-australia-data-portal/school-funding-and-resources',
    (html) => {
      const text = stripHtml(html);
      console.log(`  First 800: ${text.slice(0, 800)}`);
      return null;
    }
  );

  // Try ABS education spending page directly
  await tryUrl('abs-gov-spending-edu',
    'https://www.abs.gov.au/statistics/economy/government/government-finance-statistics-australia/latest-release',
    (html) => {
      const text = stripHtml(html);
      // Look for education-related spending
      const idx = text.toLowerCase().indexOf('education');
      if (idx > -1) console.log(`  Education context: ${text.slice(idx, idx+500)}`);
      // Try to extract billions
      const m = text.match(/education[^.]{0,200}\$\s*([\d,]+(?:\.\d+)?)\s*billion/i) ||
                text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*billion[^.]{0,100}education/i);
      if (m) return { val: parseFloat(m[1].replace(/,/g, '')), unit: 'billion AUD', period: '2022-23' };
      return null;
    }
  );

  // Try data.gov.au school funding dataset
  await tryUrl('data-gov-au-school',
    'https://data.gov.au/api/3/action/package_search?q=school+funding+per+student+australia&rows=5',
    (data) => {
      if (data && data.result && data.result.results) {
        const pkgs = data.result.results;
        console.log(`  Found ${pkgs.length} packages`);
        pkgs.slice(0, 5).forEach(p => console.log(`    - ${p.name}: ${p.title}`));
      }
      return null;
    }
  );

  console.log('\n=== ROUND 7 COMPLETE ===');
}

main().catch(e => console.error('Fatal:', e.message));
