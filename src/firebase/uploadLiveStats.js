'use strict';
require('dotenv').config();

const { uploadLiveStats } = require('./uploader');

uploadLiveStats()
  .then(n => {
    console.log(`[upload:live-stats] Done — ${n} docs written`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:live-stats] Error:', err.message);
    process.exit(1);
  });
