require('dotenv').config();
const { uploadFlaggedExpenses, uploadWasteReports } = require('./uploader');

(async () => {
  const expenseCount = await uploadFlaggedExpenses();
  const wasteCount   = await uploadWasteReports();
  console.log(`[upload:expenses] Done — flagged_expenses: ${expenseCount}  waste_reports: ${wasteCount}`);
  process.exit(0);
})().catch(err => {
  console.error('[upload:expenses] Fatal:', err.message);
  process.exit(1);
});
