const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Run a single bill through Claude to produce a Civic Voice enriched bill record.
 * @param {Object} bill - A Civic Voice bill record
 * @returns {Object} Enriched bill with AI analysis fields
 */
async function processBill(bill) {
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: `You are a nonpartisan civic education engine for the Civic Voice app.
Your job is to analyse government bills and produce clear, accessible, unbiased output for everyday citizens.
Always respond with valid JSON only — no prose outside the JSON object.`,
    messages: [
      {
        role: 'user',
        content: `Analyse this bill and return a JSON object with exactly these fields:

{
  "plainLanguageSummary": "2-3 sentence plain English explanation of what this bill does",
  "argumentsFor": ["array", "of", "3-5 concise arguments supporting the bill"],
  "argumentsAgainst": ["array", "of", "3-5 concise arguments opposing the bill"],
  "citizenImpactScore": <integer 1-10, where 1=minimal impact on daily life, 10=major direct impact>,
  "citizenImpactRationale": "one sentence explaining the impact score",
  "predictedOutcome": "one of: likely_to_pass | likely_to_fail | uncertain | already_passed | already_failed",
  "predictedOutcomeRationale": "one sentence explaining the prediction"
}

Bill data:
${JSON.stringify(bill, null, 2)}`,
      },
    ],
  });

  const text = message.content[0].text.trim();
  const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text];
  const analysis = JSON.parse(jsonMatch[1]);

  return {
    ...bill,
    analysis,
    processedAt: new Date().toISOString(),
  };
}

module.exports = { processBill };
