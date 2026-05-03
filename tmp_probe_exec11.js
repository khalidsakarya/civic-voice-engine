require('dotenv').config();
const axios = require('axios');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const T = 30000;
const hJson = { 'User-Agent': UA, Accept: 'application/json', 'OData-MaxVersion': '4.0' };
const hHtml = { 'User-Agent': UA, Accept: 'text/html, */*' };

async function probe(label, fn) {
  process.stdout.write(`${label}... `);
  try { const r = await fn(); console.log(`OK: ${r}`); }
  catch(e) { console.log(`FAIL(${e.response?.status ?? e.code}): ${e.message?.slice(0,100)}`); }
}

(async () => {
  console.log('=== AUSTRALIA OData Titles EntitySet ===');

  await probe('AU OData Titles top 3', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Titles?$top=3', { timeout: T, headers: hJson });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,500)}`;
  });

  await probe('AU OData Titles filter type=Act', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Titles?$filter=type eq 'Act'&$top=5&$orderby=start desc", { timeout: T, headers: hJson });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,500)}`;
  });

  await probe('AU OData TextSearch', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/TextSearch?$top=3', { timeout: T, headers: hJson });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,300)}`;
  });

  await probe('AU OData Session list', async () => {
    const r = await axios.get('https://api.prod.legislation.gov.au/v1/Sessions?$top=5', { timeout: T, headers: hJson });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  await probe('AU OData Documents filter by register prefix', async () => {
    // Documents uses registerId field - try filter by C2025A prefix
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Documents?$filter=startswith(titleId,'C2025A')&$top=10&$orderby=titleId", { timeout: T, headers: hJson });
    return `status=${r.status} count=${r.data?.value?.length} first=${JSON.stringify(r.data?.value?.[0])}`;
  });

  await probe('AU OData Titles filter startswith C2025A', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Titles?$filter=startswith(titleId,'C2025A')&$top=20&$orderby=titleId", { timeout: T, headers: hJson });
    const items = r.data?.value?.map(t => `${t.titleId}: ${t.title ?? t.name}`);
    return `status=${r.status} count=${r.data?.value?.length} items=${JSON.stringify(items?.slice(0,5))}`;
  });

  await probe('AU OData Titles filter startswith C2025L', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Titles?$filter=startswith(titleId,'C2025L')&$top=20&$orderby=titleId", { timeout: T, headers: hJson });
    const items = r.data?.value?.map(t => `${t.titleId}: ${t.title ?? t.name}`);
    return `status=${r.status} count=${r.data?.value?.length} items=${JSON.stringify(items?.slice(0,5))}`;
  });

  // Try the Versions entityset
  await probe('AU OData Versions filter 2025', async () => {
    const r = await axios.get("https://api.prod.legislation.gov.au/v1/Versions?$filter=startswith(registerId,'C2025A')&$top=10", { timeout: T, headers: hJson });
    return `status=${r.status} ${JSON.stringify(r.data).slice(0,400)}`;
  });

  console.log('\n=== CANADA Part II SOR index parsing ===');

  // Parse a Part II issue to understand SOR listing structure
  await probe('CA Gazette Part II 2025-04-09 SOR titles', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/index-eng.html', { timeout: T, headers: hHtml });
    // Get links to SOR pages and their anchor text
    const sorEntries = r.data.match(/href="(sor-[^"]+\.html)"[^>]*>([^<]{5,200})<\//gi) ?? [];
    const parsed = sorEntries.slice(0,5).map(m => {
      const parts = m.match(/href="(sor-[^"]+\.html)"[^>]*>([^<]+)</i);
      return parts ? `${parts[1]}: ${parts[2].trim()}` : m.slice(0,100);
    });
    return `count=${sorEntries.length} sample=${JSON.stringify(parsed)}`;
  });

  await probe('CA Gazette Part II index link structure', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/index-eng.html', { timeout: T, headers: hHtml });
    // Get all internal links with their text
    const links = r.data.match(/<a href="(sor-[^"]+)"[^>]*>([\s\S]{0,100}?)<\/a>/gi)?.slice(0,5).map(m => {
      const parts = m.match(/href="([^"]+)"[^>]*>([\s\S]+?)<\/a>/i);
      return `${parts?.[1]}: ${parts?.[2]?.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim().slice(0,80)}`;
    }) ?? [];
    return `links=${JSON.stringify(links)}`;
  });

  // Try a different approach: get the Part II issue index text directly
  await probe('CA Gazette Part II 2025-03-26 plain text extract', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-03-26/html/index-eng.html', { timeout: T, headers: hHtml });
    // Strip all HTML and get clean text
    const text = r.data.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/&nbsp;/g, ' ');
    return `text=${text.slice(200, 1500)}`;
  });

  // Try fetching a Part II SOR page directly to get title from the link text
  await probe('CA Gazette Part II index all linked titles', async () => {
    const r = await axios.get('https://www.gazette.gc.ca/rp-pr/p2/2025/2025-04-09/html/index-eng.html', { timeout: T, headers: hHtml });
    // Extract just sorXXX links and their titles from surrounding text (h3, td, li)
    const titleBlocks = r.data.match(/<(?:h3|h4|li|td)[^>]*>[\s\S]{0,500}?sor-[^"]+\.html[\s\S]{0,200}?<\/(?:h3|h4|li|td)>/gi)?.slice(0,3);
    return `blocks=${JSON.stringify(titleBlocks?.map(b=>b.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,150)))}`;
  });

  console.log('\nDone');
})().catch(e => console.error('Fatal:', e.message));
