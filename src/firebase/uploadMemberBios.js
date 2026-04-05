'use strict';
require('dotenv').config();

const { uploadMemberBios } = require('./uploader');

uploadMemberBios()
  .then(n => {
    console.log(`[upload:member-bios] Done — ${n} docs written to member_bios`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-bios] Error:', err.message);
    process.exit(1);
  });
