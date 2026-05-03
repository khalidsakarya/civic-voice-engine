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
  console.log('=== EXPENSES deep probes ===');

  // USASpending - find correct agency for White House / EOP
  await probe('USASpending agency list search EOP', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/references/agency/', { timeout: T, headers: h, params: { limit: 100 } });
    const eop = (r.data?.results ?? []).filter(a => /executive office|white house/i.test(a.agency_name));
    return `eop_agencies=${JSON.stringify(eop.slice(0,5))}`;
  });
  await probe('USASpending toptier agency 011', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/references/toptier_agencies/', { timeout: T, headers: h });
    const eop = (r.data?.results ?? []).filter(a => /executive office|white house|EOP/i.test(a.agency_name));
    return `eop=${JSON.stringify(eop.slice(0,5))}`;
  });
  await probe('USASpending budget by agency name search', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/search/', { timeout: T, headers: h, params: { query: 'Executive Office' } });
    return JSON.stringify(r.data).slice(0,300);
  });
  // Try to find WH agency toptier code via a keyword search
  await probe('USASpending all agencies list', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/references/agency/?limit=500', { timeout: T, headers: h });
    const all = r.data?.results ?? [];
    const wh = all.filter(a => /president|white house|EOP|executive office/i.test(a.agency_name));
    return `total=${all.length} wh=${JSON.stringify(wh.slice(0,8))}`;
  });

  // IPSA - alternative paths
  await probe('IPSA API members 2025', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/members?year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,200);
  });
  await probe('IPSA costs page HTML', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*(?:starmer|4936|download|csv|data)[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });
  await probe('IPSA Starmer MP page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/?memberId=4514', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('IPSA open data CSV', async () => {
    // Known IPSA open data download page
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/downloadable-data/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const xlsLinks = [...r.data.matchAll(/href="([^"]*\.xlsx?[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} csv=${JSON.stringify(links)} xls=${JSON.stringify(xlsLinks)}`;
  });
  // IPSA direct download URLs
  await probe('IPSA download 2024-25 data', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/api/download?year=2024-25&type=staffing', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} type=${r.headers['content-type']}`;
  });

  // finance.gov.au alternatives
  await probe('finance.gov.au with timeout 30s', async () => {
    const r = await axios.get('https://www.finance.gov.au/government/managing-commonwealth-resources/accountability-resources/ministerial-expenses', { timeout: 30000, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    const links = [...r.data.matchAll(/href="([^"]*(?:xlsx|csv|expenses)[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `noindex=${noindex} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });
  await probe('finance.gov.au expenses direct', async () => {
    const r = await axios.get('https://www.finance.gov.au/sites/default/files/2025-04/ministerial-expenses-2024-25.xlsx', { timeout: 30000, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status=${r.status} size=${r.data?.byteLength} type=${r.headers['content-type']}`;
  });
  await probe('data.gov.au CKAN search ministerial', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=ministerial+expenses&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });
  await probe('data.gov.au CKAN search travel', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_search?q=ministerial+travel&rows=5', { timeout: T, headers: { 'User-Agent': UA } });
    const pkgs = r.data?.result?.results ?? [];
    return `count=${pkgs.length} names=${pkgs.map(p=>p.name).slice(0,3).join('|')}`;
  });

  console.log('\n=== LOBBYING deep ===');

  // LDA Senate filing detail
  await probe('LDA Senate EOP filings detail', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=White+House&filing_year=2025&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count} sample=${JSON.stringify(r.data?.results?.[0]).slice(0,250)}`;
  });
  await probe('LDA Senate EOP filings contact_name', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=President&filing_year=2025&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count}`;
  });
  // What fields does a filing have?
  await probe('LDA Senate single filing detail', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/4f33e46d-4018-4899-8926-c03bb9977ae2/?format=json', { timeout: T, headers: h });
    return `keys=${Object.keys(r.data ?? {}).join(',')} govt_entities=${JSON.stringify(r.data?.government_entities).slice(0,200)}`;
  });

  // transparency.gov.au content
  await probe('transparency.gov.au content', async () => {
    const r = await axios.get('https://www.transparency.gov.au/', { timeout: T, headers: { 'User-Agent': UA } });
    const text = r.data.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500);
    return `len=${r.data?.length} text=${text}`;
  });
  await probe('transparency.gov.au lobbying contacts', async () => {
    const r = await axios.get('https://www.transparency.gov.au/annual-reports/all-annual-reports', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} noindex=${r.data?.includes('NOINDEX')} len=${r.data?.length}`;
  });
  await probe('APH lobbying/interests page', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Parliamentarian?MPID=R36', { timeout: T, headers: { 'User-Agent': UA } });
    return `status=${r.status} len=${r.data?.length} noindex=${r.data?.includes('NOINDEX')}`;
  });

  console.log('\n=== DISCLOSURES deep ===');

  // OGE alternative
  await probe('OGE direct URL', async () => {
    const r = await axios.get('https://www.oge.gov/', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('OGE disclosure public search', async () => {
    const r = await axios.get('https://extapps2.oge.gov/201/Presiden.nsf/PAS+Index/Trump', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  // APH Albanese interests
  await probe('APH register list links', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Members/Register', { timeout: T, headers: { 'User-Agent': UA } });
    // Find Albanese link
    const albLinks = [...r.data.matchAll(/href="([^"]*[Aa]lbanase?[^"]*|[^"]*R36[^"]*|[^"]*albanese[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    // Generic register links format
    const regLinks = [...r.data.matchAll(/href="([^"]*Register[^"]*\?[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const sample = r.data.slice(0,2000);
    return `alb_links=${JSON.stringify(albLinks)} reg_links=${JSON.stringify(regLinks)} sample=${sample.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,200)}`;
  });

  // UK Parliament interests full structure
  await probe('UK parliament interests full(4514)', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/4514/RegisteredInterests', { timeout: T, headers: h });
    return JSON.stringify(r.data?.value?.map(c => ({
      cat: c.name,
      count: c.interests?.length,
      sample: c.interests?.[0]?.interest?.slice(0,80),
    }))).slice(0,500);
  });

  // LDA lobbying contacts for specific filings
  await probe('LDA Senate contacts endpoint', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/contributions/?filing_year=2025&format=json&limit=3', { timeout: T, headers: h });
    return `count=${r.data?.count}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
