'use strict';
require('dotenv').config();

const { uploadDepartmentBudgets } = require('./uploader');

uploadDepartmentBudgets()
  .then(n => {
    console.log(`[upload:department-budgets] Done — ${n} docs written to department_budgets`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:department-budgets] Error:', err.message);
    process.exit(1);
  });
