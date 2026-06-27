/**
 * Circle Routes — /api/circle/*
 *
 * Friend System v1 / Sprint 67 / STORY-00528
 *
 * "Circle" = the UNION of memory data from a viewer's subscribed friends
 * (subset of friends, capped at memory_subscription_limit — see
 * memory-subscriptions.js).
 *
 * Three endpoints, all gated by:
 *   - viewer is authenticated
 *   - viewer has subscribed to >= 1 friend (otherwise returns empty payload)
 *   - LEFT JOIN hidden_items: any (mark|route, item_id) the viewer has hidden
 *     is filtered out (per v4 §5: "Hide from me" is a personal blacklist that
 *     also removes the item even if it would otherwise be visible through a
 *     friend's fog UNION).
 *
 * GET /api/circle/markers  — UNION of subscribed-friends' (Friend + Public) markers
 * GET /api/circle/routes   — UNION of subscribed-friends' (Friend + Public) routes
 * GET /api/circle/fog      — UNION of subscribed-friends' memory_points (GPS history)
 *                            v1 returns a flat point list keyed by friend_id;
 *                            client tessellates into polygons. Server-side polygon
 *                            UNION is deferred (see SPIKE-67-1 finding).
 *
 * Permission ENUM note (see backend/src/constants/permission.js):
 *   markers.permission DB ENUM is ('personal','group','public') — legacy 'group'
 *   means "Friend tier". Routes ENUM is ('personal','friend','public') (migration 018).
 *   For shared-visibility filtering we list both 'friend' and 'group' explicitly.
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { normalize } = require('../constants/permission');

router.use(authenticate);

// ── Helper: get viewer's subscribed friend ids ───────────────────────────────
// Returns [] if the user has no subscriptions — caller short-circuits with [].
async function getSubscribedFriendIds(viewerId) {
  const [rows] = await pool.execute(
    'SELECT friend_id FROM memory_subscriptions WHERE user_id = ?',
    [viewerId]
  );
  return rows.map((r) => r.friend_id);
}

// ── GET /api/circle/markers ──────────────────────────────────────────────────
router.get('/markers', async (req, res) => {
  const viewerId = req.user.userId;
  try {
    const friendIds = await getSubscribedFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ markers: [] });
    }

    // Build placeholder list ?,?,? for IN(...) — mysql2 doesn't expand arrays
    // automatically when using pool.execute() prepared statements.
    const placeholders = friendIds.map(() => '?').join(',');

    // Filter: marker belongs to subscribed friend AND permission is shared tier
    // AND viewer has NOT hidden this marker.
    // Legacy 'group' included alongside 'friend' for markers ENUM.
    const sql = `
      SELECT m.id, m.user_id, m.type, m.text, m.lat, m.lng, m.alt,
             m.permission, m.approximate, m.created_at, m.updated_at,
             u.name AS author_name
        FROM markers m
        JOIN users  u  ON u.id = m.user_id
   LEFT JOIN hidden_items h
          ON h.user_id   = ?
         AND h.item_type = 'mark'
         AND h.item_id   = m.id
       WHERE m.user_id IN (${placeholders})
         AND m.permission IN ('friend','group','public')
         AND m.status = 'healthy'
         AND h.user_id IS NULL
    ORDER BY m.created_at DESC`;

    const [markers] = await pool.execute(sql, [viewerId, ...friendIds]);

    // Normalize 'group' → 'friend' on the client wire so the UI never sees legacy.
    // Public marks from friends remain 'public' (per v4: anonymous display still
    // applies — the client renders author_name=null for any public mark).
    const out = markers.map((m) => ({
      ...m,
      permission: normalize(m.permission),
      author_name: m.permission === 'public' ? null : m.author_name,
    }));
    return res.json({ markers: out });
  } catch (err) {
    console.error('[circle/markers]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/circle/routes ───────────────────────────────────────────────────
router.get('/routes', async (req, res) => {
  const viewerId = req.user.userId;
  try {
    const friendIds = await getSubscribedFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ routes: [] });
    }
    const placeholders = friendIds.map(() => '?').join(',');

    const sql = `
      SELECT r.id, r.user_id, r.name, r.description, r.points, r.distance_m,
             r.elevation_gain_m, r.permission, r.created_at, r.updated_at,
             u.name AS author_name
        FROM routes r
        JOIN users u ON u.id = r.user_id
   LEFT JOIN hidden_items h
          ON h.user_id   = ?
         AND h.item_type = 'route'
         AND h.item_id   = r.id
       WHERE r.user_id IN (${placeholders})
         AND r.permission IN ('friend','public')
         AND h.user_id IS NULL
    ORDER BY r.created_at DESC`;

    const [routes] = await pool.execute(sql, [viewerId, ...friendIds]);
    // Public routes anonymized (parity with markers).
    const out = routes.map((r) => ({
      ...r,
      author_name: r.permission === 'public' ? null : r.author_name,
    }));
    return res.json({ routes: out });
  } catch (err) {
    console.error('[circle/routes]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/circle/fog ──────────────────────────────────────────────────────
// Returns the raw memory_points (GPS history) for the viewer's subscribed
// friends. v1: flat array; client tessellates into fog polygons on the device.
//
// Server-side polygon UNION is deferred — see SPIKE-67-1 for the feasibility
// decision. If the spike concludes server-side UNION is viable, this endpoint
// will be upgraded to return GeoJSON polygons in a future Sprint without
// changing its path.
router.get('/fog', async (req, res) => {
  const viewerId = req.user.userId;
  try {
    const friendIds = await getSubscribedFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ friend_points: [] });
    }
    const placeholders = friendIds.map(() => '?').join(',');

    // One row per friend, points as a JSON array. Order by ts so client can
    // reconstruct trail polylines if needed.
    const sql = `
      SELECT mp.user_id AS friend_id,
             JSON_ARRAYAGG(JSON_OBJECT('lat', mp.lat, 'lng', mp.lng, 'ts', mp.ts)) AS points
        FROM memory_points mp
       WHERE mp.user_id IN (${placeholders})
    GROUP BY mp.user_id`;

    const [rows] = await pool.execute(sql, friendIds);
    // mysql2 returns JSON_ARRAYAGG as a parsed array on JSON-typed columns,
    // but JSON_OBJECT inside JSON_ARRAYAGG sometimes comes back as a string
    // depending on driver version. Normalize both shapes.
    const out = rows.map((r) => ({
      friend_id: r.friend_id,
      points: typeof r.points === 'string' ? JSON.parse(r.points) : r.points,
    }));
    return res.json({ friend_points: out });
  } catch (err) {
    console.error('[circle/fog]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
