'use strict';

const crypto = require('crypto');

const LOCK_WAIT_SECONDS = 0;

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
async function acquireActivitySaveGuard(pool, input) {
  const startedAt = Date.now();
  const connection = await pool.getConnection();
  const name = lockName(input.userId, input.sessionId);
  try {
    const [rows] = await connection.execute(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, LOCK_WAIT_SECONDS],
    );
    const acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) {
      connection.release();
      return {
        acquired: false,
        waitMs: Math.max(0, Date.now() - startedAt),
        release: async () => undefined,
      };
    }
    let released = false;
    return {
      acquired: true,
      waitMs: Math.max(0, Date.now() - startedAt),
      async release() {
        if (released) return;
        released = true;
        try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [name]); }
        finally { connection.release(); }
      },
    };
  } catch (error) {
    connection.release();
    throw error;
  }
}

module.exports = { LOCK_WAIT_SECONDS, lockName, acquireActivitySaveGuard };
