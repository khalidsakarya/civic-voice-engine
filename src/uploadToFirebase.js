require('dotenv').config();
const { uploadAll } = require('./firebase/uploader');

uploadAll()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[upload] Fatal:', err.message);
    process.exit(1);
  });
