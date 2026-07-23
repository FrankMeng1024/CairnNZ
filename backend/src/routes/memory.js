/**
 * Memory routes — Memory mode points cloud sync.
 *
 *   POST /api/memory/points    (auth) — upload a batch of visited points
 *   GET  /api/memory/points    (auth) — download all visited points
 *   DELETE /api/memory/points  (auth) — wipe user's memory
 *
 * v0.2.6.3 (K2 fix):
 *   - UNIQUE key is now (user_id, client_id) not (user_id, ts) — multiple
 *     points sharing the same ms (e.g. recordPoint + recordCircleUnlock
 *     in the same tick) no longer collide.
 *   - Server-side fallback for legacy v0.2.6.2 clients that POST
 *     without cid: deterministic hash of (user_id, ts, lat, lng) so
 *     retries from the same client compute the same cid → INSERT IGNORE
 *     dedups correctly.
 *   - GET supports keyset pagination via after_ts + after_cid params
 *     so ts-collisions don't break the cursor.
 */
const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { deterministicCid } = require('../lib/deterministicCid');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

const router = express.Router();

// v412: deterministicCid 抽到 lib/deterministicCid.js, sessions.js /save 端点复用同一实现

/**
 * POST /api/memory/points
 * Body: { points: [{ lat, lng, ts, cid? }, ...] }
 * Returns: { accepted: N, rejected: N, points: [{ ts, cid }, ...] }
 *
 * Response includes the cid for each accepted row so clients on
 * v0.2.6.2 (no cid) can backfill locally on next pull.
 */
router.post('/points', authenticate, validateBody(schemas.memory.points), async (req, res) => {
  const userId = req.user.userId;
  const { points } = req.body;

  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'points must be an array' });
  }
  if (points.length === 0) {
    return res.json({ accepted: 0, rejected: 0, points: [] });
  }
  if (points.length > 1000) {
    return res.status(400).json({ error: 'batch too large (max 1000 points)' });
  }

  const tsUpperBound = Date.now() + 24 * 60 * 60 * 1000;
  const rows = [];
  const echo = [];
  let rejected = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || typeof p?.ts !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng) || !isFinite(p.ts) ||
      // M6: ts must be integer; fractional ts breaks deterministic-cid hashing.
      !Number.isInteger(p.ts) ||
      p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 ||
      p.ts <= 0 || p.ts > tsUpperBound || p.ts > Number.MAX_SAFE_INTEGER
    ) {
      rejected++;
      // M5: emit a null placeholder so request/response array indices stay aligned.
      echo.push(null);
      continue;
    }
    const cid = (typeof p.cid === 'string' && p.cid.length > 0 && p.cid.length <= 36)
      ? p.cid
      : deterministicCid(userId, p.ts, p.lat, p.lng);
    rows.push([userId, p.lat, p.lng, p.ts, cid]);
    echo.push({ batch_index: i, ts: p.ts, cid });
  }

  if (rows.length === 0) {
    return res.json({ accepted: 0, rejected, points: [] });
  }

  try {
    // M2 fix (v0.2.6.3): use INSERT ... ON DUPLICATE KEY UPDATE so non-
    // dedup errors surface as exceptions (vs INSERT IGNORE which
    // silently drops them — leading the client to mark non-stored
    // points as synced and lose them).
    //
    // The ON DUPLICATE clause is a no-op (`client_id=client_id`) — we
    // just need any expression so MySQL doesn't error on the conflict.
    // Then we SELECT the affected cids to confirm what really landed.
    await pool.query(
      'INSERT INTO memory_points (user_id, lat, lng, ts, client_id) VALUES ? ON DUPLICATE KEY UPDATE client_id = VALUES(client_id)',
      [rows]
    );
    // v439: attribute newly inserted points to unlocked_regions.
    // Runs after the INSERT so ST_Contains sees the fresh points.
    // Uses the pool (single-connection semantics ok for attribution).
    try {
      const { attributeMemoryPoints } = require('../lib/attributeMemoryPoints');
      const tsList = rows.map((r) => r[3]); // rows[i] = [user_id, lat, lng, ts, client_id]
      const minTs = Math.min(...tsList);
      const maxTs = Math.max(...tsList);
      await attributeMemoryPoints(pool, userId, minTs, maxTs);
    } catch (attrErr) {
      console.error(`[memory/points] ATTR_ERR user=${userId} err=${attrErr.message}`);
      // Do NOT throw — memory_points already inserted. Attribution can be
      // recomputed later via backfill if it fails here.
    }
    // Confirm storage by selecting back the cids we just inserted.
    const validEcho = echo.filter((e) => e !== null);
    const cidList = validEcho.map((e) => e.cid);
    const [confirmedRows] = cidList.length > 0
      ? await pool.query(
          `SELECT client_id FROM memory_points WHERE user_id = ? AND client_id IN (?)`,
          [userId, cidList]
        )
      : [[]];
    const confirmedSet = new Set(confirmedRows.map((r) => r.client_id));
    // Emit echo preserving null placeholders so client can align by index.
    const finalEcho = echo.map((e) => {
      if (e === null) return null;
      return confirmedSet.has(e.cid) ? e : null;
    });
    const acceptedCount = finalEcho.filter((e) => e !== null).length;
    return res.json({
      accepted: acceptedCount,
      duplicates: rows.length - acceptedCount,
      rejected,
      points: finalEcho,
    });
  } catch (err) {
    return res.status(500).json({ error: 'insert failed', detail: err.message });
  }
});

/**
 * GET /api/memory/points
 * Query: ?after_ts=<n>&after_cid=<s>&limit=<n>&until=<n>
 *   - Keyset pagination: returns points where (ts > after_ts) OR
 *     (ts == after_ts AND cid > after_cid), ordered (ts ASC, cid ASC).
 *     Tolerates ts-collisions which are now possible since UNIQUE
 *     moved to cid.
 *   - `until` (optional): only return points with ts <= until — used
 *     by clients to bound a paginated pull to the snapshot at start
 *     time so concurrent writes don't extend the loop forever.
 *   - limit defaults to 5000, max 10000.
 *
 * Returns: { points: [{ lat, lng, ts, cid }, ...] }
 *
 * Backwards compat: if no query params, returns all points (subject to
 * default limit) — old v0.2.6.2 clients work unchanged.
 */
router.get('/points', authenticate, async (req, res) => {
  const userId = req.user.userId;
  const afterTs = Number(req.query.after_ts) || 0;
  const afterCid = typeof req.query.after_cid === 'string' ? req.query.after_cid : '';
  const until = Number(req.query.until) || Number.MAX_SAFE_INTEGER;
  const requested = Number(req.query.limit) || 5000;
  const limit = Math.max(1, Math.min(10000, requested));
  try {
    const [rows] = await pool.query(
      `SELECT lat, lng, ts, client_id FROM memory_points
       WHERE user_id = ?
         AND ts <= ?
         AND ((ts > ?) OR (ts = ? AND client_id > ?))
       ORDER BY ts ASC, client_id ASC
       LIMIT ?`,
      [userId, until, afterTs, afterTs, afterCid, limit]
    );
    return res.json({
      points: rows.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        ts: Number(r.ts),
        cid: r.client_id,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'query failed', detail: err.message });
  }
});

/**
 * DELETE /api/memory/points
 * Wipes all of the authenticated user's memory points. Used by the
 * Settings → "Clear my memory" action.
 */
router.delete('/points', authenticate, async (req, res) => {
  const userId = req.user.userId;
  try {
    const [result] = await pool.query(
      'DELETE FROM memory_points WHERE user_id = ?',
      [userId]
    );
    return res.json({ deleted: result.affectedRows ?? 0 });
  } catch (err) {
    return res.status(500).json({ error: 'delete failed', detail: err.message });
  }
});

module.exports = router;
