'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  lockName,
  acquireActivitySaveGuard,
} = require('../activitySaveGuard');

function fakePool(results) {
  const connections = [];
  return {
    connections,
    async getConnection() {
      const result = results.shift();
      const connection = {
        calls: [],
        released: false,
        destroyed: false,
        async execute(sql, params) {
          this.calls.push({ sql, params });
          if (sql.includes('GET_LOCK')) {
            if (result instanceof Error) throw result;
            return [[{ acquired: result }]];
          }
          if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        release() { this.released = true; },
        destroy() { this.destroyed = true; },
      };
      connections.push(connection);
      return connection;
    },
  };
}

test('save guard has a bounded owner/session-scoped lock name', () => {
  const first = lockName(17, 2147);
  assert.match(first, /^cairn-save:[a-f0-9]{48}$/);
  assert.equal(first.length < 64, true);
  assert.notEqual(first, lockName(18, 2147));
  assert.notEqual(first, lockName(17, 2146));
});

test('an acquired guard releases the named lock and connection exactly once', async () => {
  const pool = fakePool([1]);
  const guard = await acquireActivitySaveGuard(pool, { userId: 17, sessionId: 2147 });
  assert.equal(guard.acquired, true);
  assert.equal(guard.connection, pool.connections[0]);
  await guard.release();
  await guard.release();
  assert.equal(pool.connections[0].calls.filter(call => call.sql.includes('RELEASE_LOCK')).length, 1);
  assert.equal(pool.connections[0].released, true);
});

test('pool acquisition has a bounded terminal and releases a late connection', async () => {
  let provideConnection;
  const connection = { released: false, release() { this.released = true; } };
  const pool = {
    getConnection() {
      return new Promise(resolve => { provideConnection = () => resolve(connection); });
    },
  };
  await assert.rejects(
    acquireActivitySaveGuard(pool, { userId: 17, sessionId: 2147, poolAcquireTimeoutMs: 5 }),
    error => error?.code === 'ACTIVITY_SAVE_POOL_TIMEOUT',
  );
  provideConnection();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connection.released, true);
});

test('a busy guard is terminal and releases its unused connection', async () => {
  const pool = fakePool([0]);
  const guard = await acquireActivitySaveGuard(pool, { userId: 17, sessionId: 2147 });
  assert.equal(guard.acquired, false);
  assert.equal(pool.connections[0].released, true);
  await guard.release();
});

test('a lock acquisition error cannot leak its connection', async () => {
  const error = Object.assign(new Error('db unavailable'), { code: 'ECONNRESET' });
  const pool = fakePool([error]);
  await assert.rejects(
    acquireActivitySaveGuard(pool, { userId: 17, sessionId: 2147 }),
    /db unavailable/,
  );
  assert.equal(pool.connections[0].destroyed, true);
});
