'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
let executeImpl = async () => [[], []];
let fetchImpl = async () => { throw new Error('unexpected fetch'); };
const connection = {
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
  execute: async (...args) => executeImpl(...args),
};
const mockPool = {
  execute: async (...args) => {
    calls.push(args);
    return executeImpl(...args);
  },
  getConnection: async () => connection,
};
const dbPath = require.resolve('../../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockPool };
global.fetch = (...args) => fetchImpl(...args);
process.env.PUSH_TRANSPORT = 'expo';

const PushNotification = require('../PushNotification');

test.beforeEach(() => {
  calls.length = 0;
  executeImpl = async () => [[], []];
  fetchImpl = async () => { throw new Error('unexpected fetch'); };
});

test('enqueue can join the caller transaction and never falls through to the pool', async () => {
  const transactionalCalls = [];
  const transactionalConnection = {
    execute: async (...args) => {
      transactionalCalls.push(args);
      if (String(args[0]).includes('SELECT pref_memory_hits')) return [[{ enabled: 1 }], []];
      return [{ insertId: 81 }, []];
    },
  };
  await assert.doesNotReject(() => PushNotification.enqueue({
    recipientUserId: 7,
    kind: 'memory_hit',
    relatedId: 44,
    title: 'You found a Cairn',
    body: 'Saved in Memory.',
    connection: transactionalConnection,
  }));
  assert.equal(transactionalCalls.length, 2);
  assert.equal(calls.length, 0);
  assert.match(transactionalCalls[1][0], /INSERT IGNORE INTO notification_log/);
});

test('transient provider failure returns the claimed outbox row to a bounded backoff queue', async () => {
  let claimSelect = true;
  executeImpl = async (sql) => {
    const source = String(sql);
    if (source.includes('FROM notification_log') && source.includes('FOR UPDATE') && claimSelect) {
      claimSelect = false;
      return [[{
        id: 9, recipient_user_id: 7, kind: 'memory_hit', related_id: 44,
        title: 'You found a Cairn', body: 'Saved', attempt_count: 0,
      }], []];
    }
    if (source.includes('FROM cairn_acquisition_events')) return [[{ available: 1 }], []];
    if (source.includes('FROM user_push_prefs')) return [[{ enabled: 1 }], []];
    if (source.includes('FROM device_tokens')) return [[{ token: 'ExponentPushToken[device-a]', platform: 'ios' }], []];
    return [{ affectedRows: 1 }, []];
  };
  fetchImpl = async () => ({ ok: false, status: 503, text: async () => 'temporary outage' });

  const stats = await PushNotification.sendPending({ batchSize: 1 });

  assert.deepEqual(stats, { attempted: 1, sent: 0, dropped: 0, failed: 0 });
  const retry = calls.find(([sql]) => String(sql).includes("SET status='queued',error_msg=?"));
  assert.ok(retry);
  assert.match(retry[0], /INTERVAL 1 MINUTE/);
  assert.equal(retry[1][1], 9);
});

test('provider receipt failure is audited and retires only the matching dead token', async () => {
  const token = 'ExponentPushToken[device-a]';
  const fingerprint = crypto.createHash('sha256').update(token).digest('hex');
  executeImpl = async (sql) => {
    const source = String(sql);
    if (source.includes('provider_receipt_checked_at IS NULL') && source.includes('FROM notification_log')) {
      return [[{
        id: 11,
        recipient_user_id: 7,
        provider_ticket_ids: JSON.stringify([{
          request_index: 0, token_fingerprint: fingerprint, status: 'ok', id: 'ticket-a', error: null,
        }]),
      }], []];
    }
    if (source.includes('SELECT token FROM device_tokens')) return [[{ token }, { token: 'ExponentPushToken[device-b]' }], []];
    if (source.includes('DELETE FROM device_tokens')) return [{ affectedRows: 1 }, []];
    return [{ affectedRows: 1 }, []];
  };
  fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      data: {
        'ticket-a': { status: 'error', message: 'Device is not registered', details: { error: 'DeviceNotRegistered' } },
      },
    }),
  });

  const stats = await PushNotification.checkPendingReceipts({ batchSize: 10 });

  assert.deepEqual(stats, { checked: 1, deliveryFailed: 1, tokensRetired: 1 });
  const deleted = calls.find(([sql]) => String(sql).includes('DELETE FROM device_tokens'));
  assert.deepEqual(deleted[1], [7, token]);
  const update = calls.find(([sql]) => String(sql).includes('provider_receipt_checked_at=UTC_TIMESTAMP'));
  assert.equal(update[1][0], 'delivery_failed');
  assert.match(update[1][1], /DeviceNotRegistered/);
});

test('discover persists notification intent before committing its acquisition transaction', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../routes/cairn-memory.js'), 'utf8');
  const enqueue = source.indexOf('await PushNotification.enqueue({');
  const transactionalConnection = source.indexOf('connection: conn', enqueue);
  const commit = source.indexOf('await conn.commit();', enqueue);
  assert.ok(enqueue > 0 && transactionalConnection > enqueue && commit > transactionalConnection);
});
