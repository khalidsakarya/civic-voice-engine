require('dotenv').config();
const { uploadExpenseAnomalies } = require('./uploader');

(async () => {
  const count = await uploadExpenseAnomalies();
  console.log(`[upload:anomalies] Done — expense_anomalies: ${count}`);
  process.exit(0);
})().catch(err => {
  console.error('[upload:anomalies] Fatal:', err.message);
  process.exit(1);
});
