'use strict';
const axios = require('axios');

async function main() {
  // Try FedScope data definition files directly
  // They publish employment cubes at specific URLs
  const attempts = [
    'https://www.fedscope.opm.gov/datadefn/aehri_September2024_agency.csv',
    'https://www.fedscope.opm.gov/datadefn/aehri_september2024_agency.csv',
    'https://www.fedscope.opm.gov/datadefn/aehri_December2024_agency.csv',
  ];

  for (const url of attempts) {
    try {
      const r = await axios.get(url, { timeout: 10000 });
      console.log('SUCCESS:', url, r.status);
      console.log(r.data.substring(0, 200));
      break;
    } catch(e) { console.log('FAIL:', url, e.message.substring(0, 50)); }
  }

  // Try OPM FedScope via the employment.aspx page to find data download links
  try {
    const r = await axios.get('https://www.fedscope.opm.gov/employment.aspx', {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
    });
    console.log('\nFedScope employment page len:', r.data.length);
    const links = [...r.data.matchAll(/href="([^"]*(?:csv|zip|xlsx|download)[^"]*)"/gi)].map(m => m[1]);
    console.log('Download links:', links.slice(0, 10));
  } catch(e) { console.log('\nFedScope page:', e.message); }

  // Check USA Facts or some other aggregated source
  // Actually, let's try USAspending.gov total headcount - check if there's an employees endpoint
  // Or check BLS employment by industry - federal government
  // Or check OMB budget data which often has FTE counts

  // Check OMB budget data (public budget authority with FTE)
  try {
    // OMB MAX Budget Data - check if there's an accessible API
    const r = await axios.get('https://api.fiscaldata.treasury.gov/services/api/v1/financial_data/treasury_savings_bond_redemption/?filters=record_date:gte:2024-01-01&fields=record_date,redemption_amount&page[size]=1', { timeout: 10000 });
    console.log('\nFiscal Data API check:', r.status);
  } catch(e) { console.log('\nFiscal Data API:', e.message); }

  // Actually - let's check the fiscal data Treasury API for federal employment
  try {
    const r = await axios.get('https://api.fiscaldata.treasury.gov/services/api/v1/datasets/', { timeout: 10000 });
    const datasets = r.data?.data || [];
    const empDatasets = datasets.filter(d => d.dataset_name && d.dataset_name.toLowerCase().includes('employ'));
    console.log('\nFiscal Data employment datasets:', empDatasets.map(d => d.dataset_name));
  } catch(e) { console.log('\nFiscal Data datasets:', e.message); }
}
main().catch(e => console.error(e.message));
