const { fetchSources } = require('./ingestion/fetcher');
const { processWithClaude } = require('./processing/claude');
const { writeOutput } = require('./output/writer');

/**
 * Main pipeline: fetch → process → output
 */
async function runPipeline(sources) {
  const activeSources = sources || require('../config/sources.json');

  console.log(`[pipeline] Starting ingestion for ${activeSources.length} source(s)`);

  for (const source of activeSources) {
    try {
      console.log(`[pipeline] Fetching: ${source.name}`);
      const raw = await fetchSources(source);

      console.log(`[pipeline] Processing: ${source.name}`);
      const processed = await processWithClaude(raw, source);

      console.log(`[pipeline] Writing output: ${source.name}`);
      await writeOutput(processed, source);

      console.log(`[pipeline] Done: ${source.name}`);
    } catch (err) {
      console.error(`[pipeline] Error processing ${source.name}: ${err.message}`);
    }
  }

  console.log('[pipeline] All sources complete.');
}

module.exports = { runPipeline };
