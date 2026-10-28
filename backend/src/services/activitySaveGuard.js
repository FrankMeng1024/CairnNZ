'use strict';

const crypto = require('crypto');

const LOCK_WAIT_SECONDS = 0;
const POOL_ACQUIRE_TIMEOUT_MS = 2_000;

function lockName(userId, sessionId) {
  const digest = crypto.createHash('sha256')
    .update(`cairn:activity-save:${userId}:${sessionId}`)
    .digest('hex');
  return `cairn-save:${digest.slice(0, 48)}`;
}

/**
 * MySQL named locks are connection-owned and therefore work across Node
 * workers and process-local retry maps.  They do not touch business rows and
 * are released automatically if the worker/connection dies.
 */
async function acquirePoolConnection(pool, timeoutMs = POOL_ACQUIRE_TIMEOUT_MS) {
  let expired = false;
  let timer;
  const pendingConnection = Promise.resolve()
    .then(() => pool.getConnection())
    .then(connection => {
      if (expired) {
        connection.release();
        return null;
      }
      return connection;
    });
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      const error = new Error('Activity Save database pool acquisition timed out.');
      error.code = 'ACTIVITY_SAVE_POOL_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([pendingConnection, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function discardConnection(connection) {
  if (typeof connection.destroy === 'function') connection.destroy();
  else connection.release();
}

async function acquireActivitySaveGuard(pool, input) {
  const startedAt = Date.now();
  const poolStartedAt = Date.now();
  const connection = await acquirePoolConnection(pool, input.poolAcquireTimeoutMs);
  const poolWaitMs = Math.max(0, Date.now() - poolStartedAt);
  if (!connection) {
    const error = new Error('Activity Save database pool acquisition timed out.');
    error.code = 'ACTIVITY_SAVE_POOL_TIMEOUT';
    throw error;
  }
  const name = lockName(input.userId, input.sessionId);
  try {
    const lockStartedAt = Date.now();
    const [rows] = await connection.execute(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, LOCK_WAIT_SECONDS],
    );
    const acquired = Number(rows?.[0]?.acquired) === 1;
    const lockWaitMs = Math.max(0, Date.now() - lockStartedAt);
    if (!acquired) {
      connection.release();
      return {
        acquired: false,
        waitMs: Math.max(0, Date.now() - startedAt),
        poolWaitMs,
        lockWaitMs,
        connection: null,
        release: async () => undefined,
      };
    }
    let released = false;
    return {
      acquired: true,
      waitMs: Math.max(0, Date.now() - startedAt),
      poolWaitMs,
      lockWaitMs,
      // The named lock and the short business transaction deliberately share
      // this one pooled connection. A Save can therefore consume at most one
      // pool slot; N concurrent distinct Saves cannot each hold a guard slot
      // while waiting for a second transaction slot.
      connection,
      async release() {
        if (released) return;
        released = true;
        try {
          await connection.execute('SELECT RELEASE_LOCK(?) AS released', [name]);
          connection.release();
        } catch (error) {
          discardConnection(connection);
          throw error;
        }
      },
    };
  } catch (error) {
    discardConnection(connection);
    throw error;
  }
}

module.exports = {
  LOCK_WAIT_SECONDS,
  POOL_ACQUIRE_TIMEOUT_MS,
  lockName,
  acquirePoolConnection,
  acquireActivitySaveGuard,
};
