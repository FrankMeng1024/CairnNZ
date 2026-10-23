'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('migration 057 adds owner-scoped policy, streams and idempotent batches with TTL indexes', () => {
  const sql = read('migrations/057_automatic_diagnostics.sql');
  assert.match(sql, /CREATE TABLE diagnostic_qa_enrollments/);
  assert.match(sql, /CREATE TABLE diagnostic_streams/);
  assert.match(sql, /CREATE TABLE diagnostic_batches/);
  assert.match(sql, /UNIQUE KEY uk_diagnostic_batch_owner/);
  assert.match(sql, /FOREIGN KEY \(owner_user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /idx_diagnostic_activity.*owner_user_id.*client_activity_id.*last_event_at/s);
  assert.match(sql, /expires_at/);
});

test('authenticated automatic ingest and operations-only retrieval are mounted in the existing telemetry route', () => {
  const route = read('routes/telemetry.js');
  assert.match(route, /router\.get\('\/diagnostics\/policy', authenticate/);
  assert.match(route, /router\.post\('\/diagnostics\/batches', diagnosticUploadLimiter, authenticate/);
  assert.match(route, /router\.get\('\/diagnostics\/activity\/:clientActivityId', diagnosticReadLimiter, requireReadApiKey/);
  assert.match(route, /ingestAutomaticDiagnosticBatch/);
  assert.match(route, /queryAutomaticDiagnostics/);
  assert.match(read('services/automaticDiagnostics.js'), /Batch sequence range overlaps existing evidence/);
});

test('session and Route deletion remove diagnostics and retain tombstone rejection authority', () => {
  const sessions = read('routes/sessions.js');
  const sessionModel = read('models/Session.js');
  const routeModel = read('models/Route.js');
  assert.match(sessions, /DELETE FROM diagnostic_streams[\s\S]*client_activity_id/);
  assert.match(sessionModel, /DELETE FROM diagnostic_streams[\s\S]*client_activity_id/);
  assert.match(routeModel, /DELETE FROM diagnostic_streams[\s\S]*client_route_id/);
});

test('read-only Codex triage supports recent, Activity, Route and Memory lookups', () => {
  const cli = read('../scripts/diagnostics-readonly.js');
  assert.match(cli, /--recent/);
  assert.match(cli, /--activity/);
  assert.match(cli, /--route-session/);
  assert.match(cli, /--memory-scope/);
  assert.match(cli, /UNKNOWN_NO_SERVER_STREAM_CLIENT_STATE_UNAVAILABLE/);
  assert.doesNotMatch(cli, /\b(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP)\b/i);
});

test('server-side one-time QA enrollment records consent and erases diagnostics on disable', () => {
  const admin = read('../scripts/diagnostics-policy-admin.js');
  const service = read('services/automaticDiagnostics.js');
  assert.match(admin, /--consent-version/);
  assert.match(admin, /setAutomaticDiagnosticEnrollment/);
  assert.match(service, /DELETE FROM diagnostic_streams WHERE owner_user_id = \?/);
});

test('retention deletes expired batches before empty streams and reads only retained evidence', () => {
  const service = read('services/automaticDiagnostics.js');
  const route = read('routes/telemetry.js');
  assert.match(service, /SELECT id FROM diagnostic_batches[\s\S]*expires_at < UTC_TIMESTAMP/);
  assert.match(service, /DELETE FROM diagnostic_batches WHERE id IN/);
  assert.match(service, /NOT EXISTS \([\s\S]*diagnostic_batches b WHERE b\.stream_fk/);
  assert.match(service, /retained\.expires_at >= UTC_TIMESTAMP/);
  assert.match(service, /FROM diagnostic_batches WHERE stream_fk = \? AND expires_at >= UTC_TIMESTAMP/);
  assert.doesNotMatch(route, /setImmediate\([\s\S]*purgeExpiredAutomaticDiagnostics/);
});
