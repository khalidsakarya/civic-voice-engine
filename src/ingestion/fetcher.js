const axios = require('axios');

/**
 * Fetch raw data from a government API source.
 * @param {Object} source - Source config from sources.json
 * @returns {Object} { source, data, fetchedAt }
 */
async function fetchSources(source) {
  const { url, method = 'GET', params = {}, headers = {}, auth } = source;

  const requestHeaders = { ...headers };
  if (auth?.apiKeyHeader && process.env[auth.apiKeyEnvVar]) {
    requestHeaders[auth.apiKeyHeader] = process.env[auth.apiKeyEnvVar];
  }

  const response = await axios({
    method,
    url,
    params,
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
