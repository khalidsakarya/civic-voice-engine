'use strict';
require('dotenv').config();

const { uploadDepartmentHeads } = require('./uploader');

uploadDepartmentHeads()
  .then(n => {
    console.log(`[upload:department-heads] Done — ${n} docs written to department_heads`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:department-heads] Error:', err.message);
    process.exit(1);
  });
