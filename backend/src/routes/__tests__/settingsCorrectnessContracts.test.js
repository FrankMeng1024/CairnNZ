'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(backendRoot, relative), 'utf8');

test('feedback has a durable acknowledged and idempotent server contract', () => {
  const route = read('src/routes/account.js');
  const migration = read('src/migrations/035_settings_correctness.sql');
  assert.match(route, /router\.post\('\/feedback', authenticate, feedbackLimiter/);
  assert.ok(route.indexOf('INSERT IGNORE INTO feedback_messages') < route.indexOf('acknowledged: true'));
  assert.match(route, /duplicate = result\.affectedRows === 0/);
  assert.match(migration, /UNIQUE KEY uniq_feedback_user_submission \(user_id, client_submission_id\)/);
  assert.match(migration, /CONSTRAINT fk_feedback_user[\s\S]*ON DELETE CASCADE/);
});

test('export exposes request, recovery, ready download and expiry from readiness', () => {
  const route = read('src/routes/account.js');
  const model = read('src/models/DataExport.js');
  assert.match(route, /router\.post\('\/export', authenticate/);
  assert.match(route, /router\.get\('\/exports', authenticate/);
  assert.match(route, /download_url/);
  assert.match(model, /VALUES \(\?, 'queued', \?, NULL\)/);
  assert.match(model, /status='ready'[\s\S]*expires_at=DATE_ADD\(UTC_TIMESTAMP\(\), INTERVAL \? SECOND\)/);
  const worker = model.slice(model.indexOf('async function buildPending'), model.indexOf('async function buildBundle'));
  assert.ok(worker.indexOf("status='ready'") < worker.indexOf('await sendDataExportReady'));
  assert.match(model, /bundle\.feedback = feedback/);
  assert.match(model, /bundle\.unlockedRegions = unlockedRegions/);
  assert.match(model, /first_unlocked_at,[\s\S]*last_visit_ts[\s\S]*ORDER BY last_visit_ts DESC/);
  assert.doesNotMatch(model, /SELECT region_id, unlocked_at/);
});

test('account deletion uses a deliberate seven-day grace and revokes every session', () => {
  const route = read('src/routes/auth.js');
  const model = read('src/models/User.js');
  const sweep = read('src/cron/authSweep.js');
  assert.match(route, /const RESTORE_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(model, /const ACCOUNT_DELETION_GRACE_MINUTES = 7 \* 24 \* 60/);
  assert.match(sweep, /graceMinutes = 7 \* 24 \* 60/);
  assert.match(sweep, /const BATCH = 10000/);
  assert.doesNotMatch(sweep, /DELETE FROM friend_requests[\s\S]{0,260}LIMIT \?/);
  const deletion = route.slice(route.indexOf("router.delete('/account'"), route.indexOf("router.post('/account/restore'"));
  assert.ok(deletion.indexOf('User.scheduleDeletion(user.id)') < deletion.indexOf('return res.json'));
  const schedule = model.slice(model.indexOf('async function scheduleDeletion'), model.indexOf('async function restoreDeleted'));
  assert.match(schedule, /deleted_at = COALESCE\(deleted_at, CURRENT_TIMESTAMP\)/);
  assert.match(schedule, /token_version = token_version \+ 1/);
  assert.ok(schedule.indexOf('await conn.commit()') < schedule.indexOf('return new Date'));
  assert.doesNotMatch(deletion, /5 \* 60 \* 1000|TEST-MODE/);
});

test('owned backend data has cascading or explicit hard-delete coverage', () => {
  const model = read('src/models/User.js');
  const migration = read('src/migrations/035_settings_correctness.sql');
  for (const table of [
    'unlocked_regions', 'idempotency_keys', 'abuse_signals', 'telemetry_sessions',
    'notification_log', 'password_reset_email_events', 'password_reset_codes',
    'pending_registrations',
  ]) assert.match(model, new RegExp(`DELETE FROM ${table}`));
  for (const optional of ['memory_points', 'debug_events_v2', 'app_logs']) {
    assert.match(model, new RegExp(`\\['${optional}', 'user_id'\\]`));
  }
  assert.match(model, /deleteOptionalOwnedRows/);
  assert.match(migration, /fk_telemetry_owner[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /JOIN sessions s ON s\.client_activity_id = t\.session_id[\s\S]*SET t\.owner_user_id = s\.user_id/);
  assert.match(migration, /fk_unlocked_regions_user[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /DELETE ur FROM unlocked_regions ur[\s\S]*WHERE u\.id IS NULL/);
  const hardDelete = model.slice(model.indexOf('async function hardDelete'), model.indexOf('async function hashPassword'));
  assert.ok(hardDelete.indexOf('SELECT file_path FROM data_exports') < hardDelete.indexOf('DELETE FROM users'));
  assert.ok(hardDelete.indexOf('fs.promises.unlink') < hardDelete.indexOf('DELETE FROM users'));
  assert.ok(hardDelete.indexOf('fs.promises.unlink') < hardDelete.indexOf('await conn.commit()'));
});

test('privacy authority describes implemented controls instead of historical promises', () => {
  const policy = read('public/privacy.html');
  assert.match(policy, /Last updated: 14 September 2026/);
  assert.match(policy, /restore server-backed data by signing in during the next seven days/i);
  assert.match(policy, /Ready links expire after 24 hours/);
  assert.match(policy, /precise coordinates from real-location events before sending/);
  assert.doesNotMatch(policy, /only when you have opted in via Settings|edit your name, email, and password|action within 5 business days/);
});

test('generic operational diagnostics are privacy-scrubbed at both boundaries', () => {
  const route = read('src/routes/edit-diag.js');
  const sanitizer = read('src/utils/qaTelemetryPrivacy.js');
  assert.match(route, /sanitizeQaEvent\(\{ coordinateSource: 'real', fields: item\.ctx \}\)/);
  assert.match(sanitizer, /user\.\?id\|owner\.\?id\|author\.\?id/);
});
