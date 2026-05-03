require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 20000;
const h = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code ?? 'ERR'}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== EXPENSES ===');

  // Trump/OMB - USASpending EOP budget
  await probe('USASpending EOP(011) FY2025', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/011/?fiscal_year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });
  await probe('USASpending EOP awards', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/011/awards/?fiscal_year=2025&limit=3', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });
  // WH staff payroll via USA spending obligations
  await probe('USASpending WH obligations FY2025', async () => {
    const r = await axios.post('https://api.usaspending.gov/api/v2/search/spending_by_category/agency/', {
      filters: { agencies: [{ type: 'awarding', tier: 'toptier', name: 'Executive Office of the President' }], time_period: [{ start_date: '2025-10-01', end_date: '2026-09-30' }] },
      limit: 5,
    }, { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });

  // Albanese/finance.gov.au
  await probe('finance.gov.au travel main', async () => {
    const r = await axios.get('https://www.finance.gov.au/government/managing-commonwealth-resources/ministerial-resources/ministerial-travel', { timeout: T, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    const links = [...(r.data?.matchAll(/href="([^"]*(?:xlsx|csv|expenses)[^"]*)"/gi) || [])].map(m=>m[1]).slice(0,5);
    return `noindex=${noindex} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });
  await probe('data.gov.au ministerial expenses pkg', async () => {
    const r = await axios.get('https://data.gov.au/api/3/action/package_search?q=ministerial+expenses+albanese&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });
  await probe('data.gov.au ministerial travel pkg', async () => {
    const r = await axios.get('https://data.gov.au/api/3/action/package_search?q=ministerial+travel+expenses&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });

  // Starmer/IPSA
  await probe('IPSA members list', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/getAllMembers', { timeout: T, headers: h });
    const data = r.data;
    const starmer = JSON.stringify(data).match(/"[^"]*[Ss]tarmer[^"]*"[^}]{0,100}/)?.[0];
    return `type=${typeof data} len=${JSON.stringify(data).length} starmer=${starmer?.slice(0,120)}`;
  });
  await probe('IPSA expense claim Starmer(3936)', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/expense?memberId=3936&year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });
  await probe('IPSA expense claim Starmer year=2024', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/expense?memberId=3936&year=2024', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });
  await probe('IPSA search member Starmer', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/searchmember?name=Starmer', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });

  console.log('\n=== LOBBYING ===');

  // Trump/LDA Senate
  await probe('LDA Senate API filings 2025', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/?filing_year=2025&filing_type=RR&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${JSON.stringify(r.data?.results?.[0]).slice(0,200)}`;
  });
  await probe('LDA Senate search EOP', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${JSON.stringify(r.data?.results?.[0]).slice(0,200)}`;
  });
  await probe('LDA Senate lobbyist search Trump', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/lobbyists/?lobbyist_name=trump&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count}`;
  });

  // Albanese/transparency.gov.au
  await probe('transparency.gov.au main', async () => {
    const r = await axios.get('https://www.transparency.gov.au/', { timeout: T, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    return `status=${r.status} noindex=${noindex} len=${r.data?.length}`;
  });
  await probe('lobbyists.gov.au main', async () => {
    const r = await axios.get('https://www.lobbyists.gov.au/', { timeout: T, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    return `status=${r.status} noindex=${noindex} len=${r.data?.length}`;
  });
  await probe('lobbyists.gov.au API contacts', async () => {
    const r = await axios.get('https://www.lobbyists.gov.au/lobbyists', { timeout: T, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    return `status=${r.status} noindex=${noindex} len=${r.data?.length}`;
  });
  await probe('data.gov.au lobbying register', async () => {
    const r = await axios.get('https://data.gov.au/api/3/action/package_search?q=lobbying+register&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });

  // Starmer/UK parliament lobbying
  await probe('UK parliament members API Starmer', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/search?Name=Starmer&IsCurrentMember=true&House=Commons', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 300);
  });
  await probe('UK parliament Starmer interests(4514)', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/4514/RegisteredInterests', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 400);
  });

  console.log('\n=== DISCLOSURES ===');

  // Trump/OGE
  await probe('OGE EFTS search Trump', async () => {
    const r = await axios.get('https://efts.usoge.gov/EFTS/public/search?Filer_LastName=Trump&Filer_Type=PA&report_type=SF278', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0, 400);
  });
  await probe('OGE EFTS API v2', async () => {
    const r = await axios.get('https://efts.usoge.gov/EFTS/public/search?q=Trump&categories%5B%5D=Presidential+Appointee', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });
  await probe('OGE main site', async () => {
    const r = await axios.get('https://www.oge.gov/web/oge.nsf/Financial+Disclosure', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // Albanese/APH
  await probe('APH members register', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Members/Register', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });
  await probe('APH interests link parse', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Members/Register', { timeout: T, headers: h });
    const links = [...(r.data?.matchAll(/href="([^"]*[Aa]lbanese[^"]*)"/) || [])].map(m=>m[1]).slice(0,5);
    return `links=${JSON.stringify(links)}`;
  });

  // Starmer/parliament.uk
  await probe('UK parliament Starmer interests detail', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/4514/RegisteredInterests', { timeout: T, headers: h });
    const data = r.data;
    const cats = data?.value?.map(c => `${c.name}: ${c.interests?.length} items`)?.slice(0,5);
    return `categories: ${cats?.join(' | ')}`;
  });
  await probe('UK parl interests HTML', async () => {
    const r = await axios.get('https://www.parliament.uk/mps-lords-and-offices/standards-and-interests/register-of-members-financial-interests/', { timeout: T, headers: h });
    const links = [...(r.data?.matchAll(/href="([^"]*[Ss]tarmer[^"]*)"/) || [])].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
