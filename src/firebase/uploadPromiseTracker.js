'use strict';
require('dotenv').config();

const { uploadPromiseTracker } = require('./uploader');

uploadPromiseTracker()
  .then(n => {
    console.log(`[upload:promise-tracker] Done — ${n} docs written to promise_tracker`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:promise-tracker] Error:', err.message);
    process.exit(1);
  });
