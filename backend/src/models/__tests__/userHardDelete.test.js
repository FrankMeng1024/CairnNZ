'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const calls = [];
let eligible = true;
let failPattern = null;
let exportPaths = [];
let failUnlink = false;
const originalUnlink = fs.promises.unlink;
const conn = {
  beginTransaction: async () => { calls.push('BEGIN'); },
  commit: async () => { calls.push('COMMIT'); },
  rollback: async () => { calls.push('ROLLBACK'); },
  release: () => { calls.push('RELEASE'); },
  execute: async (sql, params) => {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ sql: normalized, params });
    if (failPattern && normalized.includes(failPattern)) throw new Error('injected-delete-failure');
    if (normalized.startsWith('SELECT id, email FROM users')) {
      return [eligible ? [{ id: 42, email: 'owner@example.test' }] : [], []];
    }
    if (normalized.startsWith('SELECT deleted_at FROM users')) {
      return [[{ deleted_at: new Date('2026-09-14T01:00:00.000Z') }], []];
    }
    if (normalized.startsWith('SELECT file_path FROM data_exports')) {
      return [exportPaths.map((filePath) => ({ file_path: filePath })), []];
    }
    if (normalized.startsWith('SELECT 1 AS present FROM information_schema.COLUMNS')) {
      return [[{ present: 1 }], []];
    }
    if (normalized.startsWith('DELETE FROM users')) return [{ affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  },
};

const dbPath = require.resolve('../../config/db');
const userPath = require.resolve('../User');
const originalDb = require.cache[dbPath];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getConnection: async () => conn } };
delete require.cache[userPath];
const User = require('../User');
fs.promises.unlink = async (filePath) => {
  calls.push({ unlink: filePath });
  if (failUnlink) throw Object.assign(new Error('injected-unlink-failure'), { code: 'EACCES' });
};

test.beforeEach(() => {
  calls.length = 0;
  eligible = true;
  failPattern = null;
  exportPaths = [];
  failUnlink = false;
});

test.after(() => {
  fs.promises.unlink = originalUnlink;
  delete require.cache[userPath];
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});

test('scheduling deletion atomically preserves the timestamp and invalidates sessions', async () => {
  const deletedAt = await User.scheduleDeletion(42);
  assert.equal(deletedAt.toISOString(), '2026-09-14T01:00:00.000Z');
  const sql = calls.filter((call) => typeof call === 'object').map((call) => call.sql).join('\n');
  assert.match(sql, /deleted_at = COALESCE\(deleted_at, CURRENT_TIMESTAMP\)/);
  assert.match(sql, /token_version = token_version \+ 1/);
  assert.deepEqual(calls.filter((call) => typeof call === 'string'), ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('hard delete commits all explicit owned-data cleanup in one transaction', async () => {
  assert.equal(await User.hardDelete(42), true);
  assert.equal(calls[0], 'BEGIN');
  const sql = calls.filter((call) => typeof call === 'object').map((call) => call.sql).join('\n');
  for (const table of [
    'unlocked_regions', 'idempotency_keys', 'abuse_signals', 'memory_points',
    'debug_events_v2', 'app_logs', 'telemetry_sessions', 'notification_log',
    'password_reset_email_events', 'password_reset_codes', 'pending_registrations', 'users',
  ]) assert.match(sql, new RegExp(`DELETE FROM ${table}`));
  const eligibility = calls.find((call) => typeof call === 'object' && call.sql.startsWith('SELECT id, email'));
  assert.deepEqual(eligibility.params, [42, 10080]);
  assert.ok(calls.indexOf('COMMIT') < calls.indexOf('RELEASE'));
  assert.equal(calls.includes('ROLLBACK'), false);
});

test('hard deletion fails closed when a personal export file cannot be removed', async () => {
  exportPaths = ['/protected/account-export.json'];
  failUnlink = true;
  await assert.rejects(() => User.hardDelete(42), /injected-unlink-failure/);
  const sql = calls.filter((call) => typeof call === 'object' && call.sql).map((call) => call.sql).join('\n');
  assert.doesNotMatch(sql, /DELETE FROM users/);
  assert.equal(calls.includes('COMMIT'), false);
  assert.ok(calls.indexOf('ROLLBACK') < calls.indexOf('RELEASE'));
});

test('a restored or not-yet-eligible account is never deleted', async () => {
  eligible = false;
  assert.equal(await User.hardDelete(42), false);
  const sql = calls.filter((call) => typeof call === 'object').map((call) => call.sql).join('\n');
  assert.doesNotMatch(sql, /DELETE FROM users/);
  assert.deepEqual(calls.filter((call) => typeof call === 'string'), ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('any owned-data cleanup failure rolls back before the user row is removed', async () => {
  failPattern = 'DELETE FROM abuse_signals';
  await assert.rejects(() => User.hardDelete(42), /injected-delete-failure/);
  const sql = calls.filter((call) => typeof call === 'object').map((call) => call.sql).join('\n');
  assert.doesNotMatch(sql, /DELETE FROM users/);
  assert.equal(calls.includes('COMMIT'), false);
  assert.ok(calls.indexOf('ROLLBACK') < calls.indexOf('RELEASE'));
});
