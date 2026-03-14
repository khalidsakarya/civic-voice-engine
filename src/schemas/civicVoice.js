/**
 * Civic Voice standardized data schemas.
 * These define the shape of output records produced by the engine.
 */

const schemas = {
  bill: {
    id: 'string',
    title: 'string',
    status: 'string',           // e.g. "introduced", "passed", "failed", "signed"
    summary: 'string',
    jurisdiction: 'string',     // e.g. "US", "CA", "NYC"
    introducedDate: 'ISO8601',
    lastActionDate: 'ISO8601',
    tags: 'string[]',
    url: 'string',
    sourceId: 'string',
  },

  vote: {
    id: 'string',
    billId: 'string',
    legislatorId: 'string',
    vote: 'string',             // "yea", "nay", "abstain", "absent"
    date: 'ISO8601',
    sourceId: 'string',
  },

  legislator: {
    id: 'string',
    name: 'string',
    party: 'string',
    chamber: 'string',          // "senate", "house", "assembly", etc.
    district: 'string',
    jurisdiction: 'string',
    photoUrl: 'string',
    contactUrl: 'string',
    sourceId: 'string',
  },

  meeting: {
    id: 'string',
    title: 'string',
    body: 'string',             // governing body name
    date: 'ISO8601',
    location: 'string',
    agendaUrl: 'string',
    jurisdiction: 'string',
    sourceId: 'string',
  },

  budget: {
    id: 'string',
    fiscalYear: 'string',
    jurisdiction: 'string',
    totalAmount: 'number',
    category: 'string',
    description: 'string',
    url: 'string',
    sourceId: 'string',
  },
};

module.exports = { schemas };
