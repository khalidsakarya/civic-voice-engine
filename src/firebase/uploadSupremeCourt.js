'use strict';
require('dotenv').config();
const { uploadSupremeCourtJustices, uploadSupremeCourtCases } = require('./uploader');

Promise.all([uploadSupremeCourtJustices(), uploadSupremeCourtCases()])
  .then(([j, c]) => {
    console.log(`[upload:supreme-court] Done — ${j} justice docs, ${c} case docs written`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:supreme-court] Error:', err.message);
    process.exit(1);
  });
