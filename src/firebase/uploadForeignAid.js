'use strict';
require('dotenv').config();

const { uploadForeignAid } = require('./uploader');

uploadForeignAid()
  .then(n => {
    console.log(`[upload:foreign-aid] Done — ${n} docs written to foreign_aid`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:foreign-aid] Error:', err.message);
    process.exit(1);
  });
