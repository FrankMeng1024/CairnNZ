'use strict';

// Deterministic isolated-QA scheduler for the reviewed N x 2 pool-starvation
// counterexample. It does not replace MySQL: every GET_LOCK is executed by the
// real disposable MySQL 8 instance. It only delays resolution to Express until
// the requested number of guard connections have acquired distinct locks.
// This forces a valid worst-case ordering without adding sleeps to production.
const mysql = require('mysql2/promise');

const target = Number(process.env.CAIRN_QA_GUARD_BARRIER || 0);
if (target > 0) {
  if (process.env.CAIRN_REALM !== 'isolated_review' || process.env.NODE_ENV !== 'test') {
    throw new Error('activity_save_pool_barrier_requires_isolated_test_realm');
  }
  const originalCreatePool = mysql.createPool.bind(mysql);
  mysql.createPool = function createBarrierPool(...args) {
    const pool = originalCreatePool(...args);
    const originalGetConnection = pool.getConnection.bind(pool);
    let guardCount = 0;
    let releaseBarrier;
    const barrier = new Promise(resolve => { releaseBarrier = resolve; });
    pool.getConnection = async function getBarrierConnection(...connectionArgs) {
      const connection = await originalGetConnection(...connectionArgs);
      const originalExecute = connection.execute.bind(connection);
      connection.execute = async function executeWithGuardBarrier(sql, params) {
        const result = await originalExecute(sql, params);
        if (typeof sql === 'string' && sql.includes('GET_LOCK')) {
          guardCount += 1;
          if (guardCount === target) releaseBarrier();
          await barrier;
        }
        return result;
      };
      return connection;
    };
    return pool;
  };
}
