'use strict';
require('dotenv').config();

const { uploadMemberExpenses } = require('./uploader');

uploadMemberExpenses()
  .then(n => {
    console.log(`[upload:member-expenses] Done — ${n} docs written to member_expenses`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-expenses] Error:', err.message);
    process.exit(1);
  });
