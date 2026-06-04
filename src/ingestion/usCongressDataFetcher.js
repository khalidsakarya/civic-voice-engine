'use strict';
/**
 * US Congress Member Data Fetcher
 *
 * Fetches official public data for US House members from government sources:
 *
 *   Financial Disclosures → disclosures-clerk.house.gov (House Clerk — official)
 *     Annual disclosure filings (Form A) for all current House members
 *     Required under the Ethics in Government Act
 *
 *   Expense Reports       → disbursements.house.gov (House Clerk — official)
 *     Statement of Disbursements — quarterly office expenditure data
 *     All House member office expenses publicly itemized
 *
 *   Lobbying              → lda.senate.gov/api/v1 (Senate LDA system — official)
 *     Note: US LDA tracks lobbying at the organization/agency level, NOT by
 *     individual member. Provides aggregate context, not per-member contacts.
 *
 * Run:  node src/ingestion/usCongressDataFetcher.js
 */

require('dotenv').config();
const axios  = require('axios');
const { getDb } = require('../firebase/client');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':     'text/html, application/json, */*',
};

const HOUSE_DISCLOSURE_URL = 'https://disclosures-clerk.house.gov/FinancialDisclosure/ViewMemberSearchResult';
const HOUSE_DOC_BASE       = 'https://disclosures-clerk.house.gov';
const CURRENT_YEAR         = new Date().getFullYear();

// ── Step 1: Fetch House Annual Financial Disclosures ─────────────────────────

async function fetchHouseDisclosures() {
  const filingYear = CURRENT_YEAR - 2; // 2024 — most recent complete annual disclosures
  console.log(`\n[US:Disclosures] Fetching House disclosures for ${filingYear}...`);

  const r = await axios.post(
    HOUSE_DISCLOSURE_URL,
    `LastName=&FilingYear=${CURRENT_YEAR - 2}&State=&District=&ReportType=`,
    {
      headers: {
        ...HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin':   'https://disclosures-clerk.house.gov',
        'Referer':  'https://disclosures-clerk.house.gov/FinancialDisclosure',
      },
      timeout: 30000,
    }
  );

  const html    = r.data;
  const records = [];

  // Parse using a line-by-line approach — more reliable than regex on large HTML
  // Each row is: Name (with link) | Office | Filing Year | Filing Type
  const rows = html.split('<tr role="row">');
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.includes('public_disc')) continue;

    // Extract PDF link
    const linkMatch = row.match(/href="(public_disc\/[^"]+\.pdf)"/i);
    const docUrl    = linkMatch ? `${HOUSE_DOC_BASE}/${linkMatch[1]}` : null;

    // Extract name from link text
    const nameMatch = row.match(/href="public_disc[^"]*"[^>]*>([^<]+)<\/a>/i);
    const rawName   = nameMatch ? nameMatch[1].trim() : '';
    if (!rawName) continue;

    // Convert "LastName, Hon.. FirstName Middle" → "FirstName LastName"
    const cleanTitle = (s) => s.replace(/^(Hon|Dr|Mr|Mrs|Ms)\.{1,2}\s*/gi, '').trim();
    const parts      = rawName.split(',').map(s => cleanTitle(s));
    const memberName = parts.length >= 2 ? `${parts[1]} ${parts[0]}`.trim() : cleanTitle(rawName);
    if (!memberName || memberName.length < 3) continue;

    // Extract plain td cells (those without nested HTML)
    const tdMatches = [...row.matchAll(/<td[^>]*>([^<]{1,100})<\/td>/g)].map(m => m[1].trim()).filter(Boolean);

    // tdMatches: [Office, Filing Year, Filing Type]  (Name cell skipped — has nested <a>)
    const office   = tdMatches[0] || '';
    const year     = tdMatches[1] || filingYear.toString();
    const fileType = tdMatches[2] || '';

    records.push({
      member_name:  memberName,
      office,
      filing_year:  year,
      filing_type:  fileType.includes('FD') ? 'Annual Disclosure' : fileType.includes('PTR') ? 'Stock Trade Report' : fileType,
      document_url: docUrl,
      source_name:  'US House Clerk — disclosures-clerk.house.gov',
      source_url:   'https://disclosures-clerk.house.gov/FinancialDisclosure',
      jurisdiction: 'US',
      chamber:      'House',
      last_updated: new Date().toISOString(),
    });
  }

  console.log(`[US:Disclosures] Parsed ${records.length} House disclosure filings`);
  if (records.length > 0) console.log(`  Sample: ${JSON.stringify(records[0])}`);
  return records;
}

// ── Step 2: Fetch House Disbursements (Expense Reports) ──────────────────────

async function fetchHouseDisbursements() {
  console.log('\n[US:Expenses] Fetching House disbursements page...');

  // First get the latest CSV link from the page
  const page = await axios.get('https://disbursements.house.gov', { headers: HEADERS, timeout: 15000 });
  const html  = page.data;

  // Find the most recent Detail CSV
  const csvLinks = [...html.matchAll(/href="(\/sites\/default\/files\/[^"]*SOD[^"]*DETAIL[^"]*\.csv)"/gi)]
    .map(m => 'https://disbursements.house.gov' + m[1]);

  if (csvLinks.length === 0) {
    console.warn('[US:Expenses] No CSV links found on disbursements page');
    return [];
  }

  const latestCsv = csvLinks[0];
  console.log(`[US:Expenses] Latest CSV: ${latestCsv}`);

  try {
    const r = await axios.get(latestCsv, {
      headers: { ...HEADERS, 'Referer': 'https://disbursements.house.gov' },
      timeout: 60000,
    });

    if (!r.data || typeof r.data !== 'string' || r.data.includes('<!DOCTYPE')) {
      console.warn('[US:Expenses] CSV download returned HTML — requires browser session');
      return [];
    }

    const lines  = r.data.split('\n');
    const header = lines[0].split(',');
    console.log(`[US:Expenses] CSV columns: ${header.slice(0, 6).join(', ')}`);
    console.log(`[US:Expenses] Rows: ${lines.length}`);

    // Group by member office
    const byMember = new Map();
    for (const line of lines.slice(1, 200)) {
      const cols = line.split(',');
      if (cols.length < 4) continue;
      const office  = cols[0]?.replace(/"/g, '').trim();
      const quarter = cols[1]?.replace(/"/g, '').trim();
      const category = cols[2]?.replace(/"/g, '').trim();
      const amount   = parseFloat(cols[cols.length - 1]?.replace(/[",]/g, '')) || 0;
      if (!office || !amount) continue;
      if (!byMember.has(office)) byMember.set(office, { office, quarter, total: 0, categories: {} });
      const m = byMember.get(office);
      m.total += amount;
      m.categories[category] = (m.categories[category] || 0) + amount;
    }

    return [...byMember.values()].slice(0, 100);
  } catch (e) {
    console.warn('[US:Expenses] Download failed:', e.message);
    return [];
  }
}

// ── Step 3: Upload disclosures to Firestore ───────────────────────────────────

async function uploadDisclosures(records) {
  if (records.length === 0) return;
  const db = getDb();
  const batch_size = 400;
  let uploaded = 0;

  for (let i = 0; i < records.length; i += batch_size) {
    const chunk = records.slice(i, i + batch_size);
    const batch = db.batch();
    for (const rec of chunk) {
      const slug  = rec.member_name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const docId = `us-house-disclosure-${slug}-${rec.filing_year}`;
      batch.set(db.collection('member_disclosures').doc(docId), rec, { merge: true });
    }
    await batch.commit();
    uploaded += chunk.length;
    process.stdout.write(`  Uploaded ${uploaded}/${records.length}...\r`);
  }
  console.log(`\n[US:Disclosures] Done — ${uploaded} records in Firestore`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🏛️  US Congress Data Fetcher');
  console.log('   Sources: disclosures-clerk.house.gov | disbursements.house.gov\n');

  // Financial Disclosures
  const disclosures = await fetchHouseDisclosures();
  await uploadDisclosures(disclosures);

  // Expense Reports
  const expenses = await fetchHouseDisbursements();
  if (expenses.length > 0) {
    console.log(`[US:Expenses] Fetched ${expenses.length} office expense summaries`);
    // TODO: match to bioguide_id and upload per member
  } else {
    console.log('[US:Expenses] Disbursements CSV requires browser session — data available at disbursements.house.gov');
  }

  // Lobbying note
  console.log('\n[US:Lobbying] Note: US LDA (lda.senate.gov) tracks lobbying at organization/agency level,');
  console.log('  NOT by individual member. Unlike Canada\'s OCL, individual Congress member contacts');
  console.log('  are not required to be reported under the Lobbying Disclosure Act.');

  console.log('\n✅ Done\n');
}

run().then(() => process.exit(0)).catch(e => { console.error('\n❌', e.message); process.exit(1); });
