'use strict';
const axios = require('axios');

async function main() {
  const csvLinks = [
    'https://www.opm.gov/data/datasets/Files/98/501f5997-cee0-4d70-897f-0108ef3304a7.csv',
    'https://www.opm.gov/data/datasets/Files/95/45bf67a0-ff92-4d3d-85b0-1f2763fef9d6.csv',
    'https://www.opm.gov/data/datasets/Files/475/7b56190a-8680-4a6f-8948-66c04fbbdea3.csv',
    'https://www.opm.gov/data/datasets/Files/403/27b6059b-e284-4583-8315-37b0450eac57.csv',
    'https://www.opm.gov/data/datasets/Files/392/e7f49dc2-81b2-4ce0-bab0-7724f7988bed.csv',
    'https://www.opm.gov/data/datasets/Files/344/be548bbe-289f-46f1-b2e5-6eb0a3851392.csv',
    'https://www.opm.gov/data/datasets/Files/104/aa6ddcaf-240e-47e8-9062-2689379ded08.csv',
  ];

  for (const url of csvLinks) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const lines = r.data.split('\n').slice(0, 3);
      console.log('\nURL:', url.split('/').pop());
      lines.forEach((l, i) => console.log(`[${i}]`, l.substring(0, 120)));
    } catch(e) { console.log(url.split('/').pop(), ':', e.message); }
  }
}
main().catch(e => console.error(e.message));
