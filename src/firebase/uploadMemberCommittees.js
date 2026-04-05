'use strict';
require('dotenv').config();

const { uploadMemberCommittees } = require('./uploader');

uploadMemberCommittees()
  .then(n => {
    console.log(`[upload:member-committees] Done — ${n} docs written to member_committees`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-committees] Error:', err.message);
    process.exit(1);
  });
