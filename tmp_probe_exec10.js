require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 30000;
const h = { 'User-Agent': UA, Accept: 'application/json', 'OData-MaxVersion': '4.0' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== AUSTRALIA OData API ===');

  await probe('AU OData Documents EntitySet', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Documents?$top=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU OData Documents filter by year', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Documents?$filter=Year eq 2025&$top=5", { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU OData Content EntitySet', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Content?$top=3', { timeout: T, headers: h });
    return `status=${r.status} type=${r.headers['content-type']?.slice(0,40)} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU OData $metadata', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/$metadata', { timeout: T, headers: h });
    // Look for entity types and properties
    const entityTypes = r.data.match(/EntityType Name="([^"]+)"/g)?.map(m=>m.match(/Name="([^"]+)"/)?.[1]);
    const properties = r.data.match(/Property Name="([^"]+)" Type="([^"]+)"/g)?.map(m=>m.replace(/.*Name="([^"]+)" Type="([^"]+)".*/,'$1:$2')).slice(0,20);
    return `entityTypes=${JSON.stringify(entityTypes)} props=${JSON.stringify(properties?.slice(0,15))}`;
  });

  await probe('AU OData Legislations', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Legislations?$top=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  // Check if there's a LegislationType or Instruments path
  await probe('AU OData all entity types test', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/LegislativeInstruments?$top=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  // Try the Acts entityset
  await probe('AU OData Acts', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Acts?$top=5', { timeout: T, headers: h });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  console.log('\n=== CANADA Part I scan all 2025 Carney-era dates ===');

  // Scan Part I issues from March 15, 2025 onwards to find which ones have OICs
  const carneyDates2025 = [
    '2025-03-15','2025-03-22','2025-03-29','2025-04-05','2025-04-12','2025-04-19',
    '2025-04-26','2025-05-03','2025-05-10','2025-05-17','2025-05-24','2025-05-31',
    '2025-06-07','2025-06-14','2025-06-21','2025-06-28',
    '2025-07-05','2025-07-12','2025-07-19','2025-07-26',
    '2025-08-02','2025-08-09',
  ];

  const workingOIC = [];
  for (const date of carneyDates2025) {
    try {
      const r = await axios.get(`https://www.gazette.gc.ca/rp-pr/p1/2025/${date}/html/order-decret-eng.html`, { timeout: 10000, headers: { 'User-Agent': UA } });
      const hasOIC = r.data?.length > 10000 && r.data?.includes('ORDER');
      if (hasOIC) workingOIC.push(date);
      process.stdout.write(hasOIC ? 'O' : '.');
    } catch(e) { process.stdout.write('X'); }
  }
  console.log(`\nWorking OIC dates (${workingOIC.length}): ${JSON.stringify(workingOIC)}`);

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
