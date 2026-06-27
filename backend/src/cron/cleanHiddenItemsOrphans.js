/**
 * cleanHiddenItemsOrphans.js — Friend System v1 / Sprint 67 / STORY-00529
 *
 * Weekly cron job: remove rows in `hidden_items` whose target mark/route has
 * been deleted.
 *
 * Why no FK on hidden_items.item_id (per v4 plan §6 / §1 row R):
 *   - hidden_items is polymorphic: item_type ∈ {'mark','route'} → 2 parents
 *   - MySQL doesn't support polymorphic FK; using a single FK to one table
 *     would either constrain item_type or break the schema
 *   - Trade-off: schema is simpler; we accept "eventual consistency" via cron
 *
 * Job:
 *   Sunday 03:00 UTC → DELETE hidden_items rows where the referenced
 *   marker/route no longer exists. Idempotent.
 *
 * Manual invocation (used by integration test):
 *   const { run } = require('./cron/cleanHiddenItemsOrphans');
 *   await run({ verbose: true });
 *
 * Schedule registration (in index.js):
 *   const cron = require('node-cron');
 *   const { run } = require('./cron/cleanHiddenItemsOrphans');
 *   cron.schedule('0 3 * * 0', () => run({ verbose: true }).catch(console.error), {
 *     timezone: 'UTC',
 *   });
 */
const pool = require('../config/db');

// Cap each DELETE at 1000 rows to keep the lock window short. The job loops
// until affectedRows < BATCH_SIZE, so unbounded backlog still drains.
const BATCH_SIZE = 1000;

async function cleanOne(itemType, parentTable) {
  let totalDeleted = 0;
  // Loop in case the orphan count is large; each iteration deletes up to
  // BATCH_SIZE rows. Stop when a batch deletes fewer than BATCH_SIZE.
  //
  // Why two-step (SELECT ids → DELETE WHERE IN): MySQL does NOT allow LIMIT
  // on a multi-table DELETE with JOIN. Doing the join inside a subquery and
  // then DELETE ... WHERE (user_id, item_type, item_id) IN (...) is the
  // canonical workaround. The subquery uses LIMIT itself.
  for (let i = 0; i < 100; i++) { // hard cap 100 batches = 100k rows / run
    // Step 1: find orphan PK tuples (LIMIT honored on a plain SELECT).
    // Note: hidden_items PK is (user_id, item_type, item_id).
    const [orphans] = await pool.execute(
      `SELECT h.user_id, h.item_type, h.item_id
         FROM hidden_items h
    LEFT JOIN ${parentTable} p ON p.id = h.item_id
        WHERE h.item_type = ? AND p.id IS NULL
        LIMIT ${BATCH_SIZE}`,
      [itemType]
    );
    if (orphans.length === 0) break;

    // Step 2: delete by tuple. mysql2 doesn't support row-constructor IN with
    // prepared statements in all driver versions, so emit (?, ?, ?) tuples
    // explicitly via parameterized DELETE in a single round-trip per batch.
    // user_id and item_id are integers from the DB (safe), item_type is
    // hard-pinned to the function input ('mark'|'route') which we validate
    // by source — never user-controlled.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const row of orphans) {
        await conn.execute(
          `DELETE FROM hidden_items WHERE user_id = ? AND item_type = ? AND item_id = ?`,
          [row.user_id, row.item_type, row.item_id]
        );
      }
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }
    totalDeleted += orphans.length;
    if (orphans.length < BATCH_SIZE) break;
  }
  return totalDeleted;
}

async function run({ verbose = false } = {}) {
  const startedAt = new Date();
  try {
    const marksDeleted  = await cleanOne('mark',  'markers');
    const routesDeleted = await cleanOne('route', 'routes');
    const finishedAt = new Date();
    const durationMs = finishedAt - startedAt;
    if (verbose) {
      console.log(
        `[cron/cleanHiddenItemsOrphans] startedAt=${startedAt.toISOString()} ` +
        `durationMs=${durationMs} marksDeleted=${marksDeleted} routesDeleted=${routesDeleted}`
      );
    }
    return { marksDeleted, routesDeleted, durationMs, startedAt, finishedAt };
  } catch (err) {
    // Per Story AC: log to console.error on failure. Errors don't crash
    // the host process because node-cron swallows them by default; we
    // surface them so monitoring picks them up.
    console.error('[cron/cleanHiddenItemsOrphans] ERROR', err.message, err.stack);
    throw err;
  }
}

module.exports = { run, BATCH_SIZE };
