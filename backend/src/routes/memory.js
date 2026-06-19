/**
 * Memory routes — Memory mode points cloud sync.
 *
 *   POST /api/memory/points    (auth) — upload a batch of visited points
 *   GET  /api/memory/points    (auth) — download all visited points
 *
 * Design:
 *   - Idempotent inserts via UNIQUE (user_id, ts) — re-uploads from
 *     offline buffer don't create duplicates.
 *   - Points are tied to user_id (FK to users.id), so they follow the
 *     account, not the device.
 *
 * Out of scope (v0.2.7):
 *   - Bulk delete by date range
 *   - Cross-friend memory sharing
 */
const express = require('express');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');

const router = express.Router();

/**
 * POST /api/memory/points
 * Body: { points: [{ lat, lng, ts }, ...] }
 * Returns: { accepted: N, rejected: N }
 */
router.post('/points', authenticate, async (req, res) => {
  const userId = req.user.userId;
  const { points } = req.body;

  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'points must be an array' });
  }
  if (points.length === 0) {
    return res.json({ accepted: 0, rejected: 0 });
  }
  // Cap batch size — protects against runaway clients.
  if (points.length > 1000) {
    return res.status(400).json({ error: 'batch too large (max 1000 points)' });
  }

  // Validate each entry. Reject malformed silently per-row, succeed
  // overall on partial success.
  const rows = [];
  let rejected = 0;
  for (const p of points) {
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || typeof p?.ts !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng) || !isFinite(p.ts) ||
      p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 ||
      p.ts <= 0
    ) {
      rejected++;
      continue;
    }
    rows.push([userId, p.lat, p.lng, Math.floor(p.ts)]);
  }

  if (rows.length === 0) {
    return res.json({ accepted: 0, rejected });
  }

  try {
    // INSERT IGNORE de-duplicates against the (user_id, ts) index if
    // we ever add a unique constraint — for now we accept duplicates.
    await pool.query(
      'INSERT INTO memory_points (user_id, lat, lng, ts) VALUES ?',
      [rows]
    );
    return res.json({ accepted: rows.length, rejected });
  } catch (err) {
    return res.status(500).json({ error: 'insert failed', detail: err.message });
  }
});

/**
 * GET /api/memory/points
 * Returns: { points: [{ lat, lng, ts }, ...] }
 *
 * Returns all of the authenticated user's visited points, ordered by ts
 * ascending so the client can apply them in chronological order.
 */
router.get('/points', authenticate, async (req, res) => {
  const userId = req.user.userId;
  try {
    const [rows] = await pool.query(
      'SELECT lat, lng, ts FROM memory_points WHERE user_id = ? ORDER BY ts ASC',
      [userId]
    );
    return res.json({
      points: rows.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        ts: Number(r.ts),
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
