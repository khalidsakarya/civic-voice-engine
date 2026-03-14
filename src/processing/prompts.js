/**
 * Build the system prompt for Claude based on the data source type.
 */
function buildSystemPrompt(source) {
  return `You are a government data processing engine for the Civic Voice app.
Your job is to transform raw government API responses into standardized Civic Voice JSON records.

Data source type: ${source.type}
Data source name: ${source.name}
Jurisdiction: ${source.jurisdiction || 'unknown'}

Always respond with valid JSON only — either a single object or an array of objects.
Wrap your JSON in \`\`\`json ... \`\`\` code fences.

Each output record must conform to the Civic Voice schema for the given type:
- "bill": { id, title, status, summary, jurisdiction, introducedDate, lastActionDate, tags, url, sourceId }
- "vote": { id, billId, legislatorId, vote, date, sourceId }
- "legislator": { id, name, party, chamber, district, jurisdiction, photoUrl, contactUrl, sourceId }
- "meeting": { id, title, body, date, location, agendaUrl, jurisdiction, sourceId }
- "budget": { id, fiscalYear, jurisdiction, totalAmount, category, description, url, sourceId }

Use null for any field you cannot determine from the raw data.
Use ISO 8601 for all date fields.`;
}

/**
 * Build the user prompt containing the raw data payload.
 */
function buildUserPrompt(rawPayload) {
  const dataStr = JSON.stringify(rawPayload.data, null, 2);
  const preview = dataStr.length > 8000 ? dataStr.slice(0, 8000) + '\n... (truncated)' : dataStr;

  return `Fetched at: ${rawPayload.fetchedAt}

Raw API response:
\`\`\`json
${preview}
\`\`\`

Transform this into one or more Civic Voice standardized records.`;
}

module.exports = { buildSystemPrompt, buildUserPrompt };
