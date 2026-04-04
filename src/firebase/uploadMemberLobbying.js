'use strict';
require('dotenv').config();

const { uploadMemberLobbying } = require('./uploader');

uploadMemberLobbying()
  .then(n => {
    console.log(`[upload:member-lobbying] Done — ${n} docs written to member_lobbying`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-lobbying] Error:', err.message);
    process.exit(1);
  });
