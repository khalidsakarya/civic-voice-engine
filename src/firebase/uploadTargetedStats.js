'use strict';
require('dotenv').config();

const { uploadTargetedStats } = require('./uploader');

uploadTargetedStats()
  .then(n => {
    console.log(`[upload:targeted] Done — ${n} docs written to social_stats`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:targeted] Error:', err.message);
    process.exit(1);
  });
