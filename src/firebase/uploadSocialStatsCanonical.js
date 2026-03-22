'use strict';
require('dotenv').config();

const { uploadSocialStatsCanonical } = require('./uploader');

uploadSocialStatsCanonical()
  .then(n => {
    console.log(`[upload:social-stats] Done — ${n} docs written`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:social-stats] Error:', err.message);
    process.exit(1);
  });
