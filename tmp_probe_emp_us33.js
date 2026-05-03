'use strict';
const axios = require('axios');

async function main() {
  // Sample the remaining OPM CSV files (higher numbers that might have employment data)
  // Files 122-250 - sample every 3rd
  const csvLinks = [
    'https://www.opm.gov/data/datasets/Files/122/bc695411-eee0-4bdd-ae6e-3d5e51bed48b.csv',
    'https://www.opm.gov/data/datasets/Files/125/542f8049-2874-4a7b-8b92-0f07c095adc7.csv',
    'https://www.opm.gov/data/datasets/Files/128/10718978-2872-41de-a01e-536290b0adcb.csv',
    'https://www.opm.gov/data/datasets/Files/131/fd3f9d7f-66f7-4ecd-8205-189376e4b263.csv',
    'https://www.opm.gov/data/datasets/Files/189/4a9cbb11-74ca-42f8-9d43-129b531cac13.csv',
    'https://www.opm.gov/data/datasets/Files/197/80e5c22d-43fd-4e19-a0bf-42917ff225fa.csv',
    'https://www.opm.gov/data/datasets/Files/202/4ab22e45-4f2a-462a-9507-a72b5b0b61d8.csv',
    'https://www.opm.gov/data/datasets/Files/203/bfaaab32-bf6f-46da-9a69-b0a1b743f3d4.csv',
    'https://www.opm.gov/data/datasets/Files/208/64813191-1be9-4c69-8b61-af405ff9713d.csv',
    'https://www.opm.gov/data/datasets/Files/220/fd64f63f-5049-4bb8-bad4-237bf3029131.csv',
    'https://www.opm.gov/data/datasets/Files/221/554edc11-f27c-4070-a06e-bc7a4504e9bb.csv',
    'https://www.opm.gov/data/datasets/Files/222/774078a9-a510-433e-9cbf-7873df0a9c68.csv',
    'https://www.opm.gov/data/datasets/Files/223/8cc03179-b3fa-4115-a886-137e67ad28fc.csv',
    'https://www.opm.gov/data/datasets/Files/8/1c51f75f-1d62-4a81-b884-f43cfc5d08a5.csv',
  ];

  for (const url of csvLinks) {
    try {
      const r = await axios.get(url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const firstLine = r.data.split('\n')[0];
      const fileId = url.split('/Files/')[1].split('/')[0];
      const label = firstLine.includes('agency') || firstLine.includes('Agency') || firstLine.includes('Department') ? '*** ' : '';
      console.log(`${label}${fileId}: ${firstLine.substring(0, 120)}`);
    } catch(e) { process.stdout.write('.'); }
  }
  console.log('\n');
}
main().catch(e => console.error(e.message));
