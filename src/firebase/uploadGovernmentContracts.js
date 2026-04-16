'use strict';
require('dotenv').config();
const { uploadGovernmentContracts } = require('./uploader');

uploadGovernmentContracts()
  .then(n => {
    console.log(`[upload:government-contracts] Done — ${n} docs written`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:government-contracts] Error:', err.message);
    process.exit(1);
  });
