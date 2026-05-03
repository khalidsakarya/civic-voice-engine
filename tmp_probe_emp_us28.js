'use strict';
const axios = require('axios');

async function main() {
  // Check all USAspending agency sub-endpoints
  const subEndpoints = [
    'budgetary_resources', 'awards', 'awards/count', 'federal_account',
    'object_class', 'program_activity', 'sub_agency',
    'reporting_status', 'obligations_by_award_category',
    'new_awards_over_time', 'sub_components', 'total_obligations_over_time',
  ];

  for (const ep of subEndpoints) {
    try {
      const r = await axios.get(`https://api.usaspending.gov/api/v2/agency/075/${ep}/?limit=1`, { timeout: 5000 });
      const keys = Object.keys(r.data || {});
      console.log(`${ep}: keys=${keys.join(',')}`);
      // Check if any key looks like employee count
      if (keys.some(k => k.includes('employ') || k.includes('fte') || k.includes('headcount') || k.includes('staff'))) {
        console.log('  *** POTENTIAL EMPLOYEE COUNT FIELD ***');
        console.log('  Data:', JSON.stringify(r.data).substring(0, 300));
      }
    } catch(e) { console.log(`${ep}: ${e.response?.status || e.message.substring(0, 30)}`); }
  }
}
main().catch(e => console.error(e.message));
