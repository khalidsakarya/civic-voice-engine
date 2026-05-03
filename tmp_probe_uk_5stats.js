require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  const t = Date.now();
  try { const r = await fn(); console.log(`✓ ${r} (${Date.now()-t}ms)`); }
  catch(e) { console.log(`✗ ${e.message?.slice(0,120)} (${Date.now()-t}ms)`); }
}

(async () => {

  // ── 1. minWageGap ────────────────────────────────────────────────────────────
  // GOV.UK content API for NMW/NLW rates page
  await probe('minWage: GOV.UK content API NMW rates', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/national-minimum-wage-rates',
      { timeout: T, headers: { 'User-Agent': UA } });
    const body = r.data?.details?.body ?? '';
    // Look for rate figures in the body HTML
    const matches = body.match(/£[\d.]+\s*(?:to|per|an)\s*hour[^<]*/gi) ?? [];
    return `title=${r.data?.title} rate_matches: ${matches.slice(0,5).join(' | ')}`;
  });

  // Scrape the page HTML directly
  await probe('minWage: GOV.UK NMW rates HTML', async () => {
    const r = await axios.get('https://www.gov.uk/national-minimum-wage-rates',
      { timeout: T, headers: { 'User-Agent': UA } });
    const text = String(r.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Look for NLW rate (25 and over)
    const nlwMatch = text.match(/(?:National Living Wage|21 and over|25 and over)[^£]{0,80}£([\d.]+)/i);
    const rateMatches = [...text.matchAll(/£([\d.]+)\s*(?:to|per)\s*hour/gi)].map(m => m[0]).slice(0,5);
    const periodMatch = text.match(/(?:April|from)\s+\d{4}/i);
    return `NLW=${nlwMatch?.[1]} period=${periodMatch?.[0]} rates: ${rateMatches.join(' | ')}`;
  });

  // GOV.UK search for NMW rates publication
  await probe('minWage: GOV.UK NMW rates guidance JSON', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/guidance/national-minimum-wage-and-national-living-wage-rates',
      { timeout: T, headers: { 'User-Agent': UA } });
    const body = String(r.data?.details?.body ?? '');
    const rates = body.match(/£[\d.]+/g)?.slice(0,10) ?? [];
    return `title=${r.data?.title} rates: ${rates.join(' | ')}`;
  });

  // ── 2. hospitalWaitTimes ─────────────────────────────────────────────────────
  // NHS England RTT waiting times - open data API
  await probe('hospitalWait: NHS England RTT CSV (latest)', async () => {
    // NHS England open data portal
    const r = await axios.get('https://www.england.nhs.uk/statistics/statistical-work-areas/rtt-waiting-times/',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data);
    // Find CSV download links
    const csvLinks = [...html.matchAll(/href="([^"]*(?:rtt|RTT|waiting)[^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const xlsLinks = [...html.matchAll(/href="([^"]*(?:rtt|RTT|waiting)[^"]*\.xls[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `csv_links: ${csvLinks.join(' | ')}\nxls_links: ${xlsLinks.join(' | ')}`;
  });

  await probe('hospitalWait: NHS England open data FHIR', async () => {
    const r = await axios.get('https://opendata.england.nhs.uk/api/3/action/package_search?q=referral+treatment+waiting&rows=3',
      { timeout: T, headers: { 'User-Agent': UA } });
    const packages = r.data?.result?.results ?? [];
    return packages.slice(0,3).map(p => `${p.name}: ${p.resources?.slice(0,2).map(res=>res.url?.slice(-60)).join(', ')}`).join('\n  ');
  });

  await probe('hospitalWait: NHS England RTT provider timeseries CSV', async () => {
    // Known NHS England RTT provider-level CSV format
    const r = await axios.get('https://www.england.nhs.uk/statistics/wp-content/uploads/sites/2/2025/04/RTT-overview-timeseries-to-Feb25.csv',
      { timeout: T, headers: { 'User-Agent': UA } });
    const lines = String(r.data).split('\n').filter(l=>l.trim());
    return `rows=${lines.length} header=${lines[0]?.slice(0,120)}\nlast_row=${lines[lines.length-1]?.slice(0,120)}`;
  });

  await probe('hospitalWait: NHS England RTT aggregate Jan 2025', async () => {
    const r = await axios.get('https://www.england.nhs.uk/statistics/wp-content/uploads/sites/2/2025/03/RTT-overview-timeseries-to-Jan25.csv',
      { timeout: T, headers: { 'User-Agent': UA } });
    const lines = String(r.data).split('\n').filter(l=>l.trim());
    return `rows=${lines.length} header=${lines[0]?.slice(0,150)}\nlast=${lines[lines.length-1]?.slice(0,150)}`;
  });

  // Try the NHS England statistics API / data portal
  await probe('hospitalWait: NHS England stats page for RTT', async () => {
    const r = await axios.get('https://www.england.nhs.uk/statistics/statistical-work-areas/rtt-waiting-times/rtt-data-2025-26/',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data);
    const links = [...html.matchAll(/href="([^"]*(?:Jan|Feb|Mar|Apr|May|Jun)[^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `links: ${links.join(' | ')}`;
  });

  // ── 3. mentalHealthAccess ────────────────────────────────────────────────────
  await probe('mentalHealth: NHS Digital MHSDS dashboard', async () => {
    const r = await axios.get('https://digital.nhs.uk/data-and-information/publications/statistical/mental-health-services-monthly-statistics',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data);
    // Find recent data links
    const dataLinks = [...html.matchAll(/href="([^"]*mental.health[^"]*(?:csv|xlsx|ods)[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const contentLinks = [...html.matchAll(/href="([^"]*mental-health-services-monthly[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `data_links: ${dataLinks.join(' | ')}\ncontent_links: ${contentLinks.slice(0,3).join(' | ')}`;
  });

  await probe('mentalHealth: NHS Digital MHSDS API', async () => {
    const r = await axios.get('https://digital.nhs.uk/data-and-information/publications/statistical/mental-health-services-monthly-statistics/performance-october-2024',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Look for "contacts", "referrals", "waiting" figures
    const m1 = text.match(/(\d[\d,]+)\s+(?:people|patients|contacts)[^.]{0,80}/gi)?.slice(0,3) ?? [];
    const csvLinks = [...html.matchAll(/href="([^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `text_matches: ${m1.join(' | ')}\ncsvs: ${csvLinks.join(' | ')}`;
  });

  await probe('mentalHealth: NHS Digital MHSDS latest perf page', async () => {
    const r = await axios.get('https://digital.nhs.uk/data-and-information/publications/statistical/mental-health-services-monthly-statistics/performance-november-2024',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m1 = text.match(/\d[\d,]+\s+(?:people|contacts|referrals|new\s+referrals)[^.]{0,100}/gi)?.slice(0,5) ?? [];
    const csvLinks = [...html.matchAll(/href="([^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `matches: ${m1.join(' | ')}\ncsvs: ${csvLinks.join(' | ')}`;
  });

  await probe('mentalHealth: NHS Digital catalogue API', async () => {
    const r = await axios.get('https://digital.nhs.uk/api-catalogue/mental-health-services-data-set',
      { timeout: T, headers: { 'User-Agent': UA } });
    const html = String(r.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0,400);
    return html;
  });

  // ── 4. drugAddiction ─────────────────────────────────────────────────────────
  await probe('drugAddiction: GOV.UK drug misuse stats content API', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/collections/drug-misuse-declared',
      { timeout: T, headers: { 'User-Agent': UA } });
    const docs = (r.data?.links?.documents ?? []).slice(0,5);
    return `title=${r.data?.title} docs: ${docs.map(d=>d.title+'→'+d.api_url).join(' | ')}`;
  });

  await probe('drugAddiction: GOV.UK drug treatment stats latest', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/statistics/substance-misuse-treatment-in-england-2023-to-2024-statistics',
      { timeout: T, headers: { 'User-Agent': UA } });
    const atts = r.data?.details?.attachments ?? [];
    return `title=${r.data?.title} atts=${atts.length}: ${atts.slice(0,5).map(a=>a.title+'→'+a.url?.slice(-60)).join(' | ')}`;
  });

  await probe('drugAddiction: GOV.UK drug treatment 2023-24 HTML', async () => {
    const r = await axios.get('https://www.gov.uk/government/statistics/substance-misuse-treatment-in-england-2023-to-2024-statistics',
      { timeout: T, headers: { 'User-Agent': UA } });
    const text = String(r.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/(\d[\d,]+)\s+(?:people|adults|individuals)[^.]{0,100}(?:treatment|drug|alcohol|misuse)/gi)?.slice(0,5) ?? [];
    return `matches: ${m.join(' | ')}`;
  });

  await probe('drugAddiction: GOV.UK drug misuse search', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json', {
      timeout: T, headers: { 'User-Agent': UA },
      params: { q: 'drug misuse statistics adults treatment England', filter_document_type: 'statistics_published', order: 'updated-newest', count: 3 }
    });
    return (r.data?.results ?? []).map(r => r.link + ' | ' + r.title).join('\n  ');
  });

  // ── 5. literacy ──────────────────────────────────────────────────────────────
  await probe('literacy: GOV.UK education training stats search', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json', {
      timeout: T, headers: { 'User-Agent': UA },
      params: { q: 'adult literacy skills England', filter_document_type: 'statistics_published', order: 'updated-newest', count: 5 }
    });
    return (r.data?.results ?? []).map(r => r.link + ' | ' + r.title).join('\n  ');
  });

  await probe('literacy: GOV.UK skills survey content API', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/statistics/adult-skills-and-learning-participation-survey-results-england-2022-to-2023',
      { timeout: T, headers: { 'User-Agent': UA } });
    const atts = r.data?.details?.attachments ?? [];
    return `title=${r.data?.title} atts=${atts.length}: ${atts.slice(0,5).map(a=>a.title+'→'+a.url?.slice(-60)).join(' | ')}`;
  });

  await probe('literacy: GOV.UK functional skills/literacy stats', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/statistics/national-achievement-rates-tables-2022-to-2023',
      { timeout: T, headers: { 'User-Agent': UA } });
    return `title=${r.data?.title} status=${r.status}`;
  });

  await probe('literacy: DfE EES literacy/skills publication', async () => {
    const r = await axios.get('https://content.explore-education-statistics.service.gov.uk/api/publications/skills-participation-in-england',
      { timeout: T, headers: { 'User-Agent': UA } });
    const ks = r.data?.keyStatistics ?? [];
    return `title=${r.data?.title} keyStats=${ks.length}: ${ks.map(s=>s.title+' '+s.statistic).join(' | ')}`;
  });

  await probe('literacy: DfE EES adult education/FE stats', async () => {
    const r = await axios.get('https://content.explore-education-statistics.service.gov.uk/api/publications/further-education-and-skills',
      { timeout: T, headers: { 'User-Agent': UA } });
    const ks = r.data?.keyStatistics ?? [];
    return `title=${r.data?.title} keyStats=${ks.length}: ${ks.slice(0,5).map(s=>s.title+' '+s.statistic).join(' | ')}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
