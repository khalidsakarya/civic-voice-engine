require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 25000;
const h = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code ?? 'ERR'}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== USASpending EOP full data ===');
  await probe('USASpending EOP budgetary_resources FY2025', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/1100/budgetary_resources/?fiscal_year=2025', { timeout: T, headers: h });
    const d = r.data?.agency_data_by_year?.find(y => y.fiscal_year === 2025) ?? r.data?.agency_data_by_year?.[0];
    return `fy=${d?.fiscal_year} budget=$${d?.agency_budgetary_resources?.toFixed(0)} obligated=$${d?.agency_total_obligated?.toFixed(0)} outlayed=$${d?.agency_total_outlayed?.toFixed(0)}`;
  });
  await probe('USASpending EOP object_class breakdown', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/1100/object_class/?fiscal_year=2025&limit=10', { timeout: T, headers: h });
    const items = (r.data?.results ?? []).slice(0,5).map(x => `${x.name}=$${x.obligated_amount?.toFixed(0)}`);
    return `total=${r.data?.total} items=${items.join(' | ')}`;
  });

  console.log('\n=== OGE Trump 278 disclosure ===');
  // OGE publishes documents - try to find Trump's annual report
  await probe('OGE website search links', async () => {
    const r = await axios.get('https://www.oge.gov/', { timeout: T, headers: h });
    const discLinks = [...r.data.matchAll(/href="([^"]*[Dd]isclosure[^"]*)"/g)].map(m=>m[1]).filter(l=>!l.includes('FAQ')).slice(0,8);
    return JSON.stringify(discLinks);
  });
  await probe('OGE individual disclosures search form', async () => {
    const r = await axios.get('https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?OpenForm', { timeout: T, headers: h });
    // Look for search input names
    const inputs = [...r.data.matchAll(/<input[^>]*name="([^"]+)"[^>]*>/gi)].map(m=>m[1]).slice(0,10);
    const action = r.data.match(/<form[^>]*action="([^"]+)"/i)?.[1];
    return `action=${action} inputs=${JSON.stringify(inputs)}`;
  });
  await probe('OGE search GET for Trump', async () => {
    const r = await axios.get('https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?SearchView&Query=FIELD+LastName+CONTAINS+Trump&SearchMax=10', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*Trump[^"]*278[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500);
    return `status=${r.status} len=${r.data?.length} trump_links=${JSON.stringify(links)} text=${text}`;
  });
  await probe('OGE known Trump 2025 278', async () => {
    // Try direct known URL pattern for Trump 278
    const r = await axios.get('https://www.oge.gov/web/oge.nsf/All+Public+Financial+Disclosure+Reports+2025', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('OGE public disclosure index', async () => {
    const r = await axios.get('https://www.oge.gov/web/oge.nsf/vwCandidateReports?OpenView', { timeout: T, headers: h });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,300);
    return `status=${r.status} len=${r.data?.length} text=${text}`;
  });

  console.log('\n=== Australian federal ministerial expenses ===');
  // finance.gov.au is blocked, try alternatives
  await probe('AU finance ministerial expenses PDF direct', async () => {
    // Known URL pattern for AU ministerial expenses
    const r = await axios.get('https://www.finance.gov.au/sites/default/files/2025-02/ministerial-expenses-july-december-2024.pdf', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status=${r.status} size=${r.data?.byteLength} type=${r.headers['content-type']}`;
  });
  await probe('AU finance ministers xlsx 2025', async () => {
    const r = await axios.get('https://www.finance.gov.au/sites/default/files/2025-02/ministerial-expenses-january-june-2024.xlsx', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status=${r.status} size=${r.data?.byteLength}`;
  });
  // Try APH for Albanese expenses/entitlements
  await probe('APH Albanese entitlements', async () => {
    const r = await axios.get('https://www.aph.gov.au/About_Parliament/Parliamentary_Departments/Parliamentary_Services/salaries_and_allowances', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length}`;
  });
  // Try remuneration tribunal for AU PM salary
  await probe('AU remuneration tribunal', async () => {
    const r = await axios.get('https://www.remunerationtribunal.gov.au/remuneration/public-office-holders', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });
  // Try data.gov.au CKAN with different search
  await probe('data.gov.au CKAN ministerial entitlements', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=ministerial+entitlements&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).join('|')}`;
  });
  await probe('data.gov.au CKAN PM expenses', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=prime+minister+expenses&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).join('|')}`;
  });

  console.log('\n=== IPSA Starmer via current website ===');
  await probe('IPSA their-costs search', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/their-costs/', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('IPSA API search member name', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/v1/members?search=Starmer', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,200);
  });
  await probe('IPSA API v2 expenses', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/v2/expenses?memberId=4514&year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,200);
  });
  await probe('IPSA Contentful assets - find latest data', async () => {
    // IPSA uses Contentful - check for a data API
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/', { timeout: T, headers: h });
    // Find Contentful Space ID and access token from HTML
    const spaceId = r.data.match(/space(?:Id|_id)['":\s]+['"]?([a-z0-9]{10,})/i)?.[1];
    const token = r.data.match(/access[_\s]?token['":\s]+['"]?([a-z0-9]{20,})/i)?.[1];
    return `spaceId=${spaceId} token=${token?.slice(0,20)}`;
  });

  console.log('\n=== Starmer lobbying/meetings gov.uk ===');
  await probe('govuk PM meetings transparency', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?q=prime+minister+meetings+external+organisations&filter_organisations=prime-ministers-office-10-downing-street&count=5&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} titles=${r.data?.results?.slice(0,3).map(x=>x.title).join(' | ')}`;
  });
  await probe('govuk PM quarterly meetings publication', async () => {
    const r = await axios.get('https://www.gov.uk/api/content/government/publications/pm-meetings-with-external-organisations', { timeout: T, headers: h });
    const atts = r.data?.details?.attachments ?? [];
    return `title=${r.data?.title} atts=${atts.length}: ${atts.slice(0,3).map(a=>`${a.title}→${a.url?.slice(-50)}`).join(' | ')}`;
  });
  await probe('govuk Starmer ministerial gifts hospitality', async () => {
    const r = await axios.get('https://www.gov.uk/api/search.json?q=prime+minister+gifts+hospitality&filter_organisations=prime-ministers-office-10-downing-street&count=5&order=-public_timestamp', { timeout: T, headers: h });
    return `total=${r.data?.total} titles=${r.data?.results?.slice(0,3).map(x=>x.title).join(' | ')}`;
  });

  console.log('\n=== Australian lobbying alternative ===');
  await probe('APH lobbying disclosures register', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Members/Register', { timeout: T, headers: { 'User-Agent': UA } });
    // find ALL PDF links in the register page
    const pdfs = [...r.data.matchAll(/href="([^"]*\.pdf[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} pdfs=${JSON.stringify(pdfs)}`;
  });
  await probe('AU lobbying register data.gov.au', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=lobbying-register', { timeout: T, headers: { 'User-Agent': UA } });
    const res = r.data?.result?.resources ?? [];
    return `resources=${res.length} formats=${res.slice(0,3).map(x=>x.format+'|'+x.url?.slice(-40)).join(' ; ')}`;
  });
  await probe('APH lobbyists register', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Members/Lobbyists_register', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
