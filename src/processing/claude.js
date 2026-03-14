const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt, buildUserPrompt } = require('./prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Process raw government data with Claude and return structured Civic Voice JSON.
 * @param {Object} rawPayload - { source, data, fetchedAt }
 * @returns {Object} Civic Voice standardized record(s)
 */
async function processWithClaude(rawPayload, source) {
  const systemPrompt = buildSystemPrompt(source);
  const userPrompt = buildUserPrompt(rawPayload);

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const responseText = message.content[0].text;

  // Extract JSON from the response
  const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) ||
                    responseText.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);

  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON in response');
  }

  return JSON.parse(jsonMatch[1]);
}

module.exports = { processWithClaude };
