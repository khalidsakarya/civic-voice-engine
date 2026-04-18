'use strict';
require('dotenv').config();
const { uploadDepartmentExpenses } = require('./uploader');

uploadDepartmentExpenses()
  .then(n => {
    console.log(`[upload:department-expenses] Done — ${n} docs written`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:department-expenses] Error:', err.message);
    process.exit(1);
  });
