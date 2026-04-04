'use strict';
require('dotenv').config();

const { uploadMemberDisclosures } = require('./uploader');

uploadMemberDisclosures()
  .then(n => {
    console.log(`[upload:member-disclosures] Done — ${n} docs written to member_disclosures`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-disclosures] Error:', err.message);
    process.exit(1);
  });
