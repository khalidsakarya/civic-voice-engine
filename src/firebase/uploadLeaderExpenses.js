require('dotenv').config();
const { uploadLeaderExpenses } = require('./uploader');

(async () => {
  const count = await uploadLeaderExpenses();
  console.log(`[upload:leaders] Done — leader_expenses: ${count}`);
  process.exit(0);
})().catch(err => {
  console.error('[upload:leaders] Fatal:', err.message);
  process.exit(1);
});
