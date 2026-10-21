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

function arrangeSendRow({
  row = {},
  tokens = [{ token: 'ExponentPushToken[device-a]', platform: 'ios' }],
} = {}) {
  let claimed = false;
  executeImpl = async (sql) => {
    const source = String(sql);
    if (source.includes('FROM notification_log') && source.includes('FOR UPDATE') && !claimed) {
      claimed = true;
      return [[{
        id: 9, recipient_user_id: 7, kind: 'memory_hit', related_id: 44,
        title: 'You found a Cairn', body: 'Saved', attempt_count: 0,
        provider_ticket_ids: null,
        ...row,
      }], []];
    }
    if (source.includes('FROM notification_log') && source.includes('FOR UPDATE')) return [[], []];
    if (source.includes('FROM cairn_acquisition_events')) return [[{ available: 1 }], []];
    if (source.includes('FROM user_push_prefs')) return [[{ enabled: 1 }], []];
    if (source.includes('FROM device_tokens')) return [tokens, []];
    return [{ affectedRows: 1 }, []];
  };
}

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
  assert.equal(retry[1][2], 9);
});

test('valid provider ticket control is the only HTTP 200 shape that becomes sent', async () => {
  arrangeSendRow();
  fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: [{ status: 'ok', id: 'ticket-a' }] }),
  });
  const stats = await PushNotification.sendPending({ batchSize: 1 });
  assert.deepEqual(stats, { attempted: 1, sent: 1, dropped: 0, failed: 0 });
  const sentUpdate = calls.find(([sql]) => String(sql).includes("SET status='sent',error_msg=?"));
  assert.ok(sentUpdate);
  const targets = JSON.parse(sentUpdate[1][1]);
  assert.equal(targets[0].status, 'ok');
  assert.equal(targets[0].id, 'ticket-a');
});

for (const [label, body] of [
  ['invalid JSON', 'not-json'],
  ['empty data', JSON.stringify({ data: [] })],
  ['top-level errors', JSON.stringify({ errors: [{ code: 'INTERNAL_ERROR' }] })],
  ['missing provider identity', JSON.stringify({ data: [{ status: 'ok' }] })],
  ['unknown ticket status', JSON.stringify({ data: [{ status: 'mystery', id: 'ticket-a' }] })],
]) {
  test(`HTTP 200 ${label} stays retryable rather than becoming sent`, async () => {
    arrangeSendRow();
    fetchImpl = async () => ({ ok: true, status: 200, text: async () => body });
    const stats = await PushNotification.sendPending({ batchSize: 1 });
    assert.deepEqual(stats, { attempted: 1, sent: 0, dropped: 0, failed: 0 });
    const retry = calls.find(([sql]) => String(sql).includes("SET status='queued',error_msg=?"));
    assert.ok(retry, label);
    assert.equal(calls.some(([sql]) => String(sql).includes("SET status='sent',error_msg=?")), false);
  });
}

test('short response preserves accepted target and retries only the unacknowledged target', async () => {
  const tokens = [
    { token: 'ExponentPushToken[device-a]', platform: 'ios' },
    { token: 'ExponentPushToken[device-b]', platform: 'ios' },
  ];
  arrangeSendRow({ tokens });
  const requestBodies = [];
  fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ data: [{ status: 'ok', id: 'ticket-a' }] }),
    };
  };
  const first = await PushNotification.sendPending({ batchSize: 1 });
  assert.deepEqual(first, { attempted: 1, sent: 0, dropped: 0, failed: 0 });
  const retry = calls.find(([sql]) => String(sql).includes("SET status='queued',error_msg=?"));
  const savedTargets = JSON.parse(retry[1][1]);
  assert.equal(savedTargets[0].status, 'ok');
  assert.equal(savedTargets[1].status, 'pending');

  calls.length = 0;
  arrangeSendRow({ row: { attempt_count: 1, provider_ticket_ids: JSON.stringify(savedTargets) }, tokens });
  fetchImpl = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({ data: [{ status: 'ok', id: 'ticket-b' }] }),
    };
  };
  const second = await PushNotification.sendPending({ batchSize: 1 });
  assert.deepEqual(second, { attempted: 1, sent: 1, dropped: 0, failed: 0 });
  assert.deepEqual(requestBodies.map(messages => messages.map(message => message.to)), [
    ['ExponentPushToken[device-a]', 'ExponentPushToken[device-b]'],
    ['ExponentPushToken[device-b]'],
  ]);
});

test('extra response tickets are not correlated to another target and are audited', async () => {
  arrangeSendRow();
  fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: [
      { status: 'ok', id: 'ticket-a' },
      { status: 'ok', id: 'unknown-extra-ticket' },
    ] }),
  });
  const stats = await PushNotification.sendPending({ batchSize: 1 });
  assert.equal(stats.sent, 1);
  const sentUpdate = calls.find(([sql]) => String(sql).includes("SET status='sent',error_msg=?"));
  assert.match(sentUpdate[1][0], /cardinality 2\/1/);
  assert.equal(JSON.parse(sentUpdate[1][1]).length, 1);
});

test('a revoked pending target is not replaced by a newly registered device or resent to an accepted target', async () => {
  const acceptedToken = 'ExponentPushToken[device-a]';
  const removedToken = 'ExponentPushToken[device-b]';
  const savedTargets = [
    { request_index: 0, token_fingerprint: crypto.createHash('sha256').update(acceptedToken).digest('hex'), status: 'ok', id: 'ticket-a', error: null },
    { request_index: 1, token_fingerprint: crypto.createHash('sha256').update(removedToken).digest('hex'), status: 'pending', id: null, error: 'MessageRateExceeded' },
  ];
  arrangeSendRow({
    row: { attempt_count: 1, provider_ticket_ids: JSON.stringify(savedTargets) },
    tokens: [
      { token: acceptedToken, platform: 'ios' },
      { token: 'ExponentPushToken[new-device]', platform: 'ios' },
    ],
  });
  const stats = await PushNotification.sendPending({ batchSize: 1 });
  assert.deepEqual(stats, { attempted: 1, sent: 1, dropped: 0, failed: 0 });
  assert.equal(calls.some(([sql]) => String(sql).includes('Expo push')), false);
});

test('response-body stall is bounded and returns the target to retry', async () => {
  arrangeSendRow();
  fetchImpl = async () => ({ ok: true, status: 200, text: async () => new Promise(() => {}) });
  const stats = await PushNotification.sendPending({ batchSize: 1, transportTimeoutMs: 5 });
  assert.deepEqual(stats, { attempted: 1, sent: 0, dropped: 0, failed: 0 });
  const retry = calls.find(([sql]) => String(sql).includes("SET status='queued',error_msg=?"));
  assert.match(retry[1][0], /timed out/);
});

test('malformed acknowledgements exhaust at the bounded attempt limit', async () => {
  arrangeSendRow({ row: { attempt_count: 5 } });
  fetchImpl = async () => ({ ok: true, status: 200, text: async () => 'not-json' });
  const stats = await PushNotification.sendPending({ batchSize: 1 });
  assert.deepEqual(stats, { attempted: 1, sent: 0, dropped: 0, failed: 1 });
  assert.ok(calls.find(([sql]) => String(sql).includes("SET status='failed',error_msg=?")));
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

  assert.deepEqual(stats, { checked: 1, deliveryFailed: 1, tokensRetired: 1, deferred: 0, unknown: 0 });
  const deleted = calls.find(([sql]) => String(sql).includes('DELETE FROM device_tokens'));
  assert.deepEqual(deleted[1], [7, token]);
  const update = calls.find(([sql]) => String(sql).includes('provider_receipt_checked_at=UTC_TIMESTAMP'));
  assert.equal(update[1][0], 'delivery_failed');
  assert.match(update[1][1], /DeviceNotRegistered/);
});

test('missing receipts are deferred without starving a later row and become explicit unknown at the bound', async () => {
  executeImpl = async (sql) => {
    const source = String(sql);
    if (source.includes('provider_receipt_next_attempt_at') && source.includes('FROM notification_log')) {
      return [[
        {
          id: 21, recipient_user_id: 7, provider_receipt_attempt_count: 2,
          provider_ticket_ids: JSON.stringify([{ status: 'ok', id: 'ticket-missing', token_fingerprint: 'a' }]),
        },
        {
          id: 22, recipient_user_id: 7, provider_receipt_attempt_count: 0,
          provider_ticket_ids: JSON.stringify([{ status: 'ok', id: 'ticket-present', token_fingerprint: 'b' }]),
        },
      ], []];
    }
    return [{ affectedRows: 1 }, []];
  };
  fetchImpl = async () => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ data: { 'ticket-present': { status: 'ok' } } }),
  });
  const stats = await PushNotification.checkPendingReceipts({ batchSize: 10 });
  assert.deepEqual(stats, { checked: 2, deliveryFailed: 0, tokensRetired: 0, deferred: 0, unknown: 1 });
  const terminalUpdates = calls.filter(([sql]) => String(sql).includes('provider_receipt_checked_at=UTC_TIMESTAMP'));
  assert.equal(terminalUpdates.some(([, args]) => args.includes(21)), true);
  assert.equal(terminalUpdates.some(([, args]) => args.includes(22)), true);
});

test('discover persists notification intent before committing its acquisition transaction', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../routes/cairn-memory.js'), 'utf8');
  const enqueue = source.indexOf('await PushNotification.enqueue({');
  const transactionalConnection = source.indexOf('connection: conn', enqueue);
  const commit = source.indexOf('await conn.commit();', enqueue);
  assert.ok(enqueue > 0 && transactionalConnection > enqueue && commit > transactionalConnection);
});
