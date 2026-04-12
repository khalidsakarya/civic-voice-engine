'use strict';
require('dotenv').config();

const { uploadElections } = require('./uploader');

uploadElections()
  .then(n => {
    console.log(`[upload:elections] Done — ${n} docs written to elections`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:elections] Error:', err.message);
    process.exit(1);
  });
