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
  console.log('=== USASpending EOP detail ===');

  await probe('USASpending EOP slug budgetary_resources', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/executive-office-of-the-president/budgetary_resources/?fiscal_year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,400);
  });
  await probe('USASpending EOP obligations by category', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/executive-office-of-the-president/object_class/count/?fiscal_year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,300);
  });
  await probe('USASpending EOP subagencies', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/executive-office-of-the-president/sub_agency/?fiscal_year=2025&limit=10', { timeout: T, headers: h });
    const subs = (r.data?.results ?? []).slice(0,5).map(s => `${s.name}: ${s.obligated_amount}`);
    return `total=${r.data?.total} subs=${subs.join(' | ')}`;
  });

  console.log('\n=== data.gov.au ministerial datasets ===');

  await probe('data.gov.au ministerial-operating-expenditure-summary', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=ministerial-operating-expenditure-summary', { timeout: T, headers: { 'User-Agent': UA } });
    const res = r.data?.result?.resources ?? [];
    return `resources=${res.length} names=${res.slice(0,5).map(x=>`${x.name}|${x.format}|${x.url?.slice(-60)}`).join(' ; ')}`;
  });
  await probe('data.gov.au ministerial-overseas-travel', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=ministerial-overseas-travel', { timeout: T, headers: { 'User-Agent': UA } });
    const res = r.data?.result?.resources ?? [];
    return `resources=${res.length} names=${res.slice(0,5).map(x=>`${x.name}|${x.format}|${x.url?.slice(-60)}`).join(' ; ')}`;
  });
  // Download a sample CSV from ministerial-operating-expenditure-summary
  await probe('data.gov.au ministerial-ops CSV download', async () => {
    const pkgR = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=ministerial-operating-expenditure-summary', { timeout: T, headers: { 'User-Agent': UA } });
    const res = pkgR.data?.result?.resources ?? [];
    const csv = res.find(r => r.format === 'CSV');
    if (!csv) return `no CSV found, formats=${res.map(r=>r.format).join(',')}`;
    const r = await axios.get(csv.url, { timeout: T, headers: { 'User-Agent': UA } });
    const lines = r.data.split('\n').filter(Boolean);
    return `rows=${lines.length} header=${lines[0]?.slice(0,150)} sample=${lines.slice(1,3).join(' | ')}`;
  });

  console.log('\n=== IPSA current structure ===');

  await probe('IPSA main site', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('IPSA MP costs page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*(?:csv|download|data|2024|2025)[^"]*)"/gi)].map(m=>m[1]).slice(0,10);
    return `status=${r.status} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });
  await probe('IPSA costs download page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/downloadable-data', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice(0,300)}`;
  });
  // Try IPSA open data direct URLs
  await probe('IPSA 2024-25 staffing CSV direct', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/staffing-and-business-costs/downloadable-data/2024-25', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('IPSA researchbriefings download', async () => {
    const r = await axios.get('https://researchbriefings.files.parliament.uk/documents/CBP-7640/CBP-7640.pdf', { timeout: T, headers: h, responseType: 'arraybuffer' });
    return `status=${r.status} size=${r.data?.byteLength}`;
  });

  console.log('\n=== LDA filing structure ===');

  await probe('LDA Senate list first filing', async () => {
    const r = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=1', { timeout: T, headers: h });
    const f = r.data?.results?.[0];
    return `uuid=${f?.filing_uuid} keys=${Object.keys(f ?? {}).join(',')}`;
  });
  await probe('LDA Senate filing detail by uuid', async () => {
    const listR = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=1', { timeout: T, headers: h });
    const uuid = listR.data?.results?.[0]?.filing_uuid;
    if (!uuid) return 'no uuid';
    const r = await axios.get(`https://lda.senate.gov/api/v1/filings/${uuid}/?format=json`, { timeout: T, headers: h });
    return `keys=${Object.keys(r.data ?? {}).join(',')} lobbyists=${JSON.stringify(r.data?.lobbyists?.slice(0,2)).slice(0,200)} entities=${JSON.stringify(r.data?.government_entities?.slice(0,2)).slice(0,200)} issues=${JSON.stringify(r.data?.lobbying_activities?.slice(0,1)).slice(0,200)}`;
  });

  console.log('\n=== OGE disclosures ===');

  await probe('OGE website links', async () => {
    const r = await axios.get('https://www.oge.gov/', { timeout: T, headers: h });
    const links = [...r.data.matchAll(/href="([^"]*(?:disclosure|financial|search|trump)[^"]*)"/gi)].map(m=>m[1]).slice(0,10);
    return `len=${r.data?.length} links=${JSON.stringify(links)}`;
  });
  await probe('OGE financial disclosures page', async () => {
    const r = await axios.get('https://www.oge.gov/web/oge.nsf/Financial+Disclosure', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('OGE public financial disclosure search', async () => {
    const r = await axios.get('https://efts.usoge.gov/EFTS/public/search?q=Trump&Filer_Type=PA', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,200)}`;
  });
  await probe('OGE Trump 278 disclosure', async () => {
    // Try known Trump OGE disclosure path format
    const r = await axios.get('https://www.oge.gov/Web/278eApplication.nsf/Public%20Disclosure%20Reports!OpenView&restricttocategory=Trump', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });

  console.log('\n=== APH Albanese interests PDF ===');

  await probe('APH Albanese PDF check', async () => {
    const r = await axios.get('https://www.aph.gov.au/-/media/03_Senators_and_Members/32_Members/Register/48p/AB/Albanese_48P.pdf', { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `status=${r.status} size=${r.data?.byteLength} type=${r.headers['content-type']}`;
  });
  await probe('APH Albanese member page', async () => {
    const r = await axios.get('https://www.aph.gov.au/Senators_and_Members/Parliamentarian?MPID=R36', { timeout: T, headers: { 'User-Agent': UA } });
    const interests = [...r.data.matchAll(/href="([^"]*[Ii]nterest[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const register = [...r.data.matchAll(/href="([^"]*[Rr]egister[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} interests=${JSON.stringify(interests)} register=${JSON.stringify(register)}`;
  });

  console.log('\n=== UK Parliament lobbying register ===');

  await probe('UK parliament lobbying register HTML', async () => {
    const r = await axios.get('https://www.parliament.uk/mps-lords-and-offices/standards-and-interests/the-lobbying-register/', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('UK parliament API Member Starmer biography', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/4514/Biography', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,400);
  });
  await probe('UK parliament API Member Starmer synopsis', async () => {
    const r = await axios.get('https://members-api.parliament.uk/api/Members/4514', { timeout: T, headers: h });
    const v = r.data?.value ?? {};
    return `name=${v.nameDisplayAs} party=${v.latestParty?.name} constituency=${v.latestHouseMembership?.membershipFrom} status=${v.latestHouseMembership?.membershipStatus?.statusDescription}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
