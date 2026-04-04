'use strict';
require('dotenv').config();

const { uploadMemberVotes } = require('./uploader');

uploadMemberVotes()
  .then(n => {
    console.log(`[upload:member-votes] Done — ${n} docs written to member_votes`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-votes] Error:', err.message);
    process.exit(1);
  });
