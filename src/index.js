require('dotenv').config();
const { runPipeline } = require('./pipeline');

(async () => {
  try {
    await runPipeline();
  } catch (err) {
    console.error('Pipeline failed:', err.message);
    process.exit(1);
  }
})();
