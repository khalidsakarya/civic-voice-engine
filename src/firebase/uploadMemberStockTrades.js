'use strict';
require('dotenv').config();

const { uploadMemberStockTrades } = require('./uploader');

uploadMemberStockTrades()
  .then(n => {
    console.log(`[upload:member-stock-trades] Done — ${n} docs written to member_stock_trades`);
    process.exit(0);
  })
  .catch(err => {
    console.error('[upload:member-stock-trades] Error:', err.message);
    process.exit(1);
  });
