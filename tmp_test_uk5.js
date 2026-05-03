require('dotenv').config();
const axios = require('axios');
const zlib = require('zlib');
const TIMEOUT_MS = 30000;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCHED_AT = new Date().toISOString();
const safeNum = v => { const n = parseFloat(String(v ?? '').replace(/[$,]/g, '')); return isNaN(n) ? null : n; };
function result(country, stat, value, unit, date, source, sourceUrl, notes = '') {
  return { country, stat, value, unit, date, source, sourceUrl, notes, fetchedAt: FETCHED_AT };
}
async function probe(label, fn) {
  process.stdout.write(label + '... ');
  const t = Date.now();
  try {
    const r = await fn();
    console.log('OK ' + r.value + ' | ' + String(r.unit).slice(0,35) + ' | [' + r.date + '] (' + (Date.now()-t) + 'ms)');
    return r;
  } catch(e) {
    console.log('FAIL ' + String(e.message).slice(0,120) + ' (' + (Date.now()-t) + 'ms)');
    return null;
  }
}

async function fetchUK_MinWage() {
  const URL = 'https://www.gov.uk/national-minimum-wage-rates';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const text = String(resp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const nlwMatch = text.match(/(?:National Living Wage|21 and over)[^£]{0,80}£([\d.]+)/i);
  if (!nlwMatch) throw new Error('GOV.UK NMW: could not find NLW rate');
  const val = safeNum(nlwMatch[1]);
  if (val == null) throw new Error('GOV.UK NMW: cannot parse rate');
  const periodMatch = text.match(/(?:April|from)\s+\d{4}/i);
  return result('UK', 'minWageGap', val, 'GBP per hour - NLW (aged 21+)', periodMatch ? periodMatch[0] : null, 'GOV.UK - National Minimum Wage rates', URL);
}

async function fetchUK_HospitalWaitTimes() {
  const pageUrl = 'https://www.england.nhs.uk/statistics/statistical-work-areas/rtt-waiting-times/rtt-data-2024-25/';
  const pageResp = await axios.get(pageUrl, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const xlsxLinks = [...String(pageResp.data).matchAll(/href="([^"]*Incomplete-Commissioner[^"]*\.xlsx?)"/gi)].map(m => m[1]);
  if (xlsxLinks.length === 0) throw new Error('RTT: no Incomplete-Commissioner XLSX link');
  const xlsxUrl = xlsxLinks[0].startsWith('http') ? xlsxLinks[0] : 'https://www.england.nhs.uk' + xlsxLinks[0];
  console.log('\n  [downloading ' + xlsxUrl.split('/').pop() + ']');
  const resp = await axios.get(xlsxUrl, { timeout: 90000, headers: { 'User-Agent': BROWSER_UA }, responseType: 'arraybuffer' });
  const buf = Buffer.from(resp.data);
  const entries = {};
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const method = buf.readUInt16LE(i+8), compSize = buf.readUInt32LE(i+18);
      const fnLen = buf.readUInt16LE(i+26), exLen = buf.readUInt16LE(i+28);
      const name = buf.slice(i+30, i+30+fnLen).toString('utf8');
      const dataStart = i+30+fnLen+exLen;
      const compressed = buf.slice(dataStart, dataStart+compSize);
      if (method === 0) entries[name] = compressed;
      else if (method === 8) { try { entries[name] = zlib.inflateRawSync(compressed); } catch(_) {} }
      i = dataStart + compSize;
    } else i++;
  }
  const ssXml = entries['xl/sharedStrings.xml'] ? entries['xl/sharedStrings.xml'].toString('utf8') : '';
  const strings = [...ssXml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map(m => m[1]);
  const totalIdx = strings.indexOf('Total');
  if (totalIdx < 0) throw new Error('RTT XLSX: Total string not found');

  const sh1 = entries['xl/worksheets/sheet1.xml'] ? entries['xl/worksheets/sheet1.xml'].toString('utf8') : '';
  // Use simple row split without row number attribute capture
  const rowRe = /<row[^>]*>(.*?)<\/row>/gs;
  let medianWeeks = null, pctWithin18 = null, totalPathways = null;
  let rm;
  while ((rm = rowRe.exec(sh1)) !== null) {
    const rowContent = rm[1];
    // Only match if the "Total" string appears in column B or C (treatment function label cols)
    // Cell refs for col B or C look like: r="B38" or r="C38"
    const labelCellRe = /<c r="[BC]\d+"[^>]*t="s"[^>]*><v>(\d+)<\/v>/g;
    let lcm;
    let foundTotalInLabel = false;
    while ((lcm = labelCellRe.exec(rowContent)) !== null) {
      if (parseInt(lcm[1]) === totalIdx) { foundTotalInLabel = true; break; }
    }
    if (!foundTotalInLabel) continue;

    const cellRe = /<c r="([^"]+)"[^>]*(?:t="([^"]+)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g;
    const colMap = {};
    let cm;
    while ((cm = cellRe.exec(rowContent)) !== null) {
      const col = cm[1].replace(/\d/g, '');
      colMap[col] = cm[2] === 's' ? strings[parseInt(cm[3])] : cm[3];
    }
    totalPathways = safeNum(colMap['DE']);
    medianWeeks = safeNum(colMap['DH']);
    pctWithin18 = safeNum(colMap['DG']);
    break;
  }
  if (medianWeeks == null) throw new Error('RTT XLSX: could not extract median wait from Total row (label cols B/C)');
  const monthMatch = xlsxUrl.match(/([A-Z][a-z]{2}\d{2})(?=[-.])/);
  const period = monthMatch ? monthMatch[1].slice(0,3) + ' 20' + monthMatch[1].slice(3) : null;
  const pctStr = pctWithin18 != null ? String(Math.round(pctWithin18*1000)/10) + '%' : 'n/a';
  return result('UK', 'hospitalWaitTimes', Math.round(medianWeeks*10)/10,
    'weeks (median, all incomplete RTT pathways, national)', period,
    'NHS England - Consultant-led RTT waiting times', pageUrl,
    'Total pathways: ' + String(totalPathways?.toLocaleString()) + '; % within 18 weeks: ' + pctStr);
}

async function fetchUK_MentalHealthAccess() {
  const URL = 'https://www.england.nhs.uk/mental-health/adults/nhs-talking-therapies/';
  const resp = await axios.get(URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const text = String(resp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/([\d,]+)\s+people\s+received\s+a\s+course\s+of\s+treatment\s+in\s+([\d\/]+)/i);
  if (!m) throw new Error('NHS England Talking Therapies: treatment count not found');
  const val = safeNum(m[1]);
  if (val == null) throw new Error('NHS England Talking Therapies: cannot parse count');
  return result('UK', 'mentalHealthAccess', val,
    'people finishing a course of NHS Talking Therapies treatment', m[2],
    'NHS England - NHS Talking Therapies for Anxiety and Depression', URL,
    'Formerly IAPT (Improving Access to Psychological Therapies)');
}

async function fetchUK_DrugAddiction() {
  const CONTENT_URL = 'https://www.gov.uk/api/content/government/statistics/substance-misuse-treatment-for-adults-statistics-2024-to-2025';
  const contentResp = await axios.get(CONTENT_URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const atts = (contentResp.data && contentResp.data.details && contentResp.data.details.attachments) ? contentResp.data.details.attachments : [];
  const reportAtt = atts.find(a => /report/i.test(a.title || ''));
  if (!reportAtt || !reportAtt.url) throw new Error('NDTMS: no report attachment');
  // URL may be relative - prepend gov.uk base
  const reportUrl = reportAtt.url.startsWith('http') ? reportAtt.url : 'https://www.gov.uk' + reportAtt.url;
  const reportResp = await axios.get(reportUrl, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA } });
  const text = String(reportResp.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = text.match(/([\d,]+)\s+adults?\s+(?:aged\s+[\d\s+and]+over\s+)?in\s+contact\s+with\s+drug\s+and\s+alcohol\s+treatment/i);
  if (!m) throw new Error('NDTMS: adults-in-treatment figure not found');
  const val = safeNum(m[1]);
  const yearMatch = text.match(/(?:April|1\s+April)\s+(\d{4})\s+(?:to|and)\s+(?:31\s+)?March\s+(\d{4})/i);
  const period = yearMatch ? yearMatch[1] + '-' + yearMatch[2].slice(2) : '2024-25';
  return result('UK', 'drugAddiction', val,
    'adults in contact with drug and alcohol treatment services (England)', period,
    'OHID NDTMS - Adult Substance Misuse Treatment Statistics 2024-25',
    'https://www.gov.uk/government/statistics/substance-misuse-treatment-for-adults-statistics-2024-to-2025',
    'Annual NDTMS data; covers April 2024 to March 2025');
}

async function fetchUK_Literacy() {
  const PUB_URL = 'https://content.explore-education-statistics.service.gov.uk/api/publications/further-education-and-skills/releases/latest';
  const resp = await axios.get(PUB_URL, { timeout: TIMEOUT_MS, headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' } });
  const keyStats = (resp.data && resp.data.keyStatistics) ? resp.data.keyStatistics : [];
  const adultStat = keyStats.find(s => /adult.*further.*education.*skills.*participation/i.test(s.title || '')) ||
                    keyStats.find(s => /adult.*further.*education/i.test(s.title || ''));
  if (!adultStat) throw new Error('DfE FE skills: no adult stat. Available: ' + keyStats.map(s => s.title).join(' | '));
  const val = safeNum(String(adultStat.statistic || '').replace(/[£,]/g, ''));
  if (val == null) throw new Error('DfE FE skills: cannot parse: ' + adultStat.statistic);
  const yearTitle = (resp.data && resp.data.yearTitle) || (resp.data && resp.data.title) || null;
  return result('UK', 'literacy', val,
    'Adult (19+) further education and skills participation (England)', yearTitle,
    'Department for Education - Further Education and Skills statistics',
    'https://explore-education-statistics.service.gov.uk/find-statistics/further-education-and-skills',
    'Includes FE colleges, independent learning providers, and local authority providers');
}

(async () => {
  const r1 = await probe('UK minWageGap', fetchUK_MinWage);
  const r2 = await probe('UK hospitalWaitTimes', fetchUK_HospitalWaitTimes);
  const r3 = await probe('UK mentalHealthAccess', fetchUK_MentalHealthAccess);
  const r4 = await probe('UK drugAddiction', fetchUK_DrugAddiction);
  const r5 = await probe('UK literacy', fetchUK_Literacy);
  console.log('\n--- Results ---');
  for (const r of [r1, r2, r3, r4, r5]) {
    if (r) console.log(r.stat + ': ' + r.value + ' | ' + String(r.unit).slice(0,40) + ' | [' + r.date + '] | ' + String(r.sourceUrl).slice(-60));
  }
})().catch(e => console.error('Fatal:', e.message));
