'use strict';
const { getDb } = require('./client');

async function writeAuditLog({ collection_name, jurisdiction, data_pull_timestamp, source_endpoint, record_count, import_status, error_message = null, scheduler_tier }) {
  try {
    const db = getDb();
    await db.collection('data_audit_log').add({
      collection_name:     collection_name   || null,
      jurisdiction:        jurisdiction      || null,
      data_pull_timestamp: data_pull_timestamp || new Date().toISOString(),
      source_endpoint:     source_endpoint   || null,
      record_count:        record_count      ?? 0,
      import_status:       import_status     || 'unknown',
      error_message:       error_message     || null,
      scheduler_tier:      scheduler_tier    || 'manual',
      logged_at:           new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[auditLog] Failed to write audit log:', e.message);
  }
}

module.exports = { writeAuditLog };
