const axios = require('axios');

/**
 * Fetch raw data from a government API source.
 * @param {Object} source - Source config from sources.json
 * @returns {Object} { source, data, fetchedAt }
 */
async function fetchSources(source) {
  const { url, method = 'GET', params = {}, headers = {}, auth } = source;

  const requestHeaders = { ...headers };
  const requestParams = { ...params };

  if (auth) {
    const apiKey = process.env[auth.apiKeyEnvVar];
    if (!apiKey) {
      console.warn(`[fetcher] Warning: env var ${auth.apiKeyEnvVar} is not set for source "${source.name}"`);
    } else if (auth.apiKeyHeader) {
      requestHeaders[auth.apiKeyHeader] = apiKey;
    } else if (auth.apiKeyParam) {
      requestParams[auth.apiKeyParam] = apiKey;
    }
  }

  const response = await axios({
    method,
    url,
    params: requestParams,
    headers: requestHeaders,
    timeout: 30000,
  });

  return {
    source,
    data: response.data,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { fetchSources };
