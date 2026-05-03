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
  console.log('=== USASpending EOP toptier code 1100 ===');
  // Correct format uses toptier_code not slug
  await probe('USASpending /agency/1100/', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/1100/?fiscal_year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,400);
  });
  await probe('USASpending /agency/1100/budgetary_resources/', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/1100/budgetary_resources/?fiscal_year=2025', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,500);
  });
  await probe('USASpending /agency/1100/sub_agency/', async () => {
    const r = await axios.get('https://api.usaspending.gov/api/v2/agency/1100/sub_agency/?fiscal_year=2025&limit=10', { timeout: T, headers: h });
    const subs = (r.data?.results ?? []).slice(0,5).map(s => `${s.name}=$${s.obligated_amount?.toFixed(0)}`);
    return `total=${r.data?.total} ${subs.join(' | ')}`;
  });

  console.log('\n=== data.gov.au ministerial travel PDF ===');
  await probe('AU ministerial overseas travel latest PDF URL', async () => {
    const r = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=ministerial-overseas-travel', { timeout: T, headers: { 'User-Agent': UA } });
    const res = r.data?.result?.resources ?? [];
    return `latest 3: ${res.slice(0,3).map(x=>`${x.name} → ${x.url}`).join(' | ')}`;
  });
  await probe('AU ministerial travel latest PDF download test', async () => {
    // Get the latest PDF URL and check its size
    const pkgR = await axios.get('https://data.gov.au/data/api/3/action/package_show?id=ministerial-overseas-travel', { timeout: T, headers: { 'User-Agent': UA } });
    const res = pkgR.data?.result?.resources ?? [];
    const latest = res[0];
    const r = await axios.get(latest.url, { timeout: T, headers: { 'User-Agent': UA }, responseType: 'arraybuffer' });
    return `name=${latest.name} url=${latest.url?.slice(-50)} size=${r.data?.byteLength} type=${r.headers['content-type']}`;
  });
  // Try finance.gov.au directly with longer timeout
  await probe('finance.gov.au ministerial-expenses page (35s)', async () => {
    const r = await axios.get('https://www.finance.gov.au/government/managing-commonwealth-resources/accountability-resources/ministerial-expenses', { timeout: 35000, headers: { 'User-Agent': UA } });
    const noindex = r.data?.includes('NOINDEX');
    const links = [...r.data.matchAll(/href="([^"]*(?:xlsx|csv|\.pdf|expenses)[^"]*)"/gi)].map(m=>m[1]).slice(0,8);
    return `noindex=${noindex} len=${r.data?.length} links=${JSON.stringify(links)}`;
  });

  console.log('\n=== IPSA current website structure ===');
  await probe('IPSA other-payment-data page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/other-payment-data', { timeout: T, headers: h });
    const csvLinks = [...r.data.matchAll(/href="([^"]*\.csv[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const xlsLinks = [...r.data.matchAll(/href="([^"]*\.xlsx?[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    const dataLinks = [...r.data.matchAll(/href="([^"]*(?:data|download|export|open)[^"]*)"/gi)].map(m=>m[1]).filter(l=>l.startsWith('/')||l.startsWith('http')).slice(0,5);
    return `status=${r.status} len=${r.data?.length} csv=${JSON.stringify(csvLinks)} xls=${JSON.stringify(xlsLinks)} data=${JSON.stringify(dataLinks)}`;
  });
  await probe('IPSA MP costs main page links', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/', { timeout: T, headers: h });
    const allLinks = [...r.data.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(l => l.includes('data') || l.includes('download') || l.includes('csv') || l.includes('open') || l.includes('2024') || l.includes('2025')).slice(0,10);
    return `allLinks=${JSON.stringify(allLinks)}`;
  });
  await probe('IPSA open data page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/open-data', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('IPSA sitemap', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/sitemap.xml', { timeout: T, headers: h });
    const urls = [...r.data.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).filter(u => /data|download|csv|expenses|costs/i.test(u));
    return `relevant=${JSON.stringify(urls.slice(0,10))}`;
  });
  await probe('IPSA API expenses-data-for-mp', async () => {
    // Try various API path formats
    const r = await axios.get('https://www.theipsa.org.uk/api/expenses-data-for-mp?mpId=4514', { timeout: T, headers: h });
    return JSON.stringify(r.data).slice(0,200);
  });
  await probe('IPSA their-costs Starmer page', async () => {
    const r = await axios.get('https://www.theipsa.org.uk/mp-staffing-business-costs/their-costs/', { timeout: T, headers: h });
    const apiCalls = [...r.data.matchAll(/fetch\(['"]([^'"]+)['"]/g)].map(m=>m[1]).slice(0,5);
    const scriptUrls = [...r.data.matchAll(/src="([^"]*(?:api|data)[^"]*)"/gi)].map(m=>m[1]).slice(0,5);
    return `status=${r.status} len=${r.data?.length} fetches=${JSON.stringify(apiCalls)} scripts=${JSON.stringify(scriptUrls)}`;
  });

  console.log('\n=== LDA filing detail fix ===');
  await probe('LDA filing structure via first result', async () => {
    const listR = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=3', { timeout: T, headers: h });
    const filings = listR.data?.results ?? [];
    // Summarise inline rather than fetching detail
    return filings.map(f => `registrant=${f.registrant?.name} client=${f.client?.name} activities=${f.lobbying_activities?.length} income=${f.income} expenses=${f.expenses}`).join(' | ');
  });
  await probe('LDA activities detail sample', async () => {
    const listR = await axios.get('https://lda.senate.gov/api/v1/filings/?government_entity_name=executive+office+of+the+president&filing_year=2025&format=json&limit=1', { timeout: T, headers: h });
    const f = listR.data?.results?.[0];
    const acts = f?.lobbying_activities ?? [];
    const act = acts[0] ?? {};
    return `act_keys=${Object.keys(act).join(',')} entities=${JSON.stringify(act.government_entities).slice(0,200)} issues=${JSON.stringify(act.general_issue_code).slice(0,100)}`;
  });

  console.log('\n=== OGE disclosure search ===');
  await probe('OGE Lotus Notes search form', async () => {
    const r = await axios.get('https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?OpenForm', { timeout: T, headers: h });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,200)}`;
  });
  await probe('OGE 278 Trump search', async () => {
    const r = await axios.post('https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?SearchView', {
      query: 'Trump', ReportType: '278'
    }, { timeout: T, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return `status=${r.status} len=${r.data?.length}`;
  });
  await probe('OGE search by name Trump', async () => {
    const params = new URLSearchParams({ 'Query': '[lastName]=Trump', 'SearchMax': '10', 'SearchOrder': '4' });
    const r = await axios.post('https://www.oge.gov/web/OGE.nsf/Officials%20Individual%20Disclosures%20Search%20Collection?SearchView', params.toString(), { timeout: T, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' } });
    return `status=${r.status} len=${r.data?.length} snip=${r.data?.slice(0,300)}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
