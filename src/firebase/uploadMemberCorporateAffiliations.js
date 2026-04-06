'use strict';
require('dotenv').config();

const { uploadMemberCorporateAffiliations } = require('./uploader');

uploadMemberCorporateAffiliations()
  .then(n => {
    console.log(`[upload:member-corporate-affiliations] Done — ${n} docs written to member_corporate_affiliations`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-corporate-affiliations] Error:', err.message);
    process.exit(1);
  });
