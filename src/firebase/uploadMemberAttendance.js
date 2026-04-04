'use strict';
require('dotenv').config();

const { uploadMemberAttendance } = require('./uploader');

uploadMemberAttendance()
  .then(n => {
    console.log(`[upload:member-attendance] Done — ${n} docs written to member_attendance`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-attendance] Error:', err.message);
    process.exit(1);
  });
