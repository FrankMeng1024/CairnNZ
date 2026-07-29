/**
 * Circle Routes — /api/circle/*
 *
 * Friend System v1 / Sprint 67 / STORY-00528
 *
 * "Circle" historically meant "UNION from subscribed friends" (capped at
 * memory_subscription_limit). v376 split this into TWO scopes per v4 §1:
 *
 *   - /markers, /routes — gated on MUTUAL FRIENDSHIP only (no cap, no
 *     memory subscription required). Friend-tier shares are bidirectional:
 *     two users are friends → both see each other's Friend-tier content.
 *   - /fog               — gated on MEMORY_SUBSCRIPTIONS (cap = 5). This
 *     is the only "explore together with N friends" budget; fog UNION
 *     reveals others' GPS history and is the privacy-sensitive piece.
 *
 * All three endpoints share:
 *   - viewer must be authenticated
 *
 * /markers and /routes additionally:
 *   - LEFT JOIN hidden_items: any (mark|route, item_id) the viewer has hidden
 *     is filtered out (per v4 §5: "Hide from me" is a personal blacklist).
 *
 * /fog does NOT use hidden_items — hidden_items only supports item_type of
 * 'mark' or 'route' (see migration 021). Fog is friend-scoped GPS history;
 * to stop seeing a friend's fog, unsubscribe them via
 * DELETE /api/memory-subscriptions/:friendId. Fog respects that
 * unsubscribe via getSubscribedFriendIds() at query time.
 *
 * Sprint 6 round-19 R19: prior docstring incorrectly claimed /fog also
 * used hidden_items — a contract-vs-code mismatch. Product intent is
 * "unsubscribe = don't see fog", not "hide individual fog points",
 * matching what the code actually does.
 *
 * GET /api/circle/markers  — UNION of mutual-friends' (Friend + Public) markers
 * GET /api/circle/routes   — UNION of mutual-friends' (Friend + Public) routes
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
// USED BY /fog ONLY. Memory fog UNION is the only scope capped at
// memory_subscription_limit=5 (v4 §1 row M). Routes and Markers DO NOT use
// this — they query mutual friendships directly (see getFriendIds).
async function getSubscribedFriendIds(viewerId) {
  const [rows] = await pool.execute(
    'SELECT friend_id FROM memory_subscriptions WHERE user_id = ?',
    [viewerId]
  );
  return rows.map((r) => r.friend_id);
}

// ── Helper: get viewer's mutual-friend ids (v376 fix) ────────────────────────
// Returns [] if the user has zero friends. Used by /markers and /routes.
//
// Root cause behind v376 fix: previously /markers and /routes also gated on
// memory_subscriptions, conflating two unrelated mechanisms. Per v4 §1 row
// matrix:
//   - Memory fog UNION: capped at memory_subscription_limit (the "explore
//     together with N people" budget).
//   - Routes / Markers (Friend tier): NO limit. Once two users are mutual
//     friends and one of them shares a route/mark at Friend tier, the other
//     sees it. Subscribing in Memory tab is irrelevant.
//
// The `friends` table stores ACCEPTED friendships as two symmetric rows
// (see routes/friends.js INSERT after request accept), so a single
// `WHERE user_id = ?` is sufficient — every row already represents a
// mutual friendship from the viewer's perspective.
async function getFriendIds(viewerId) {
  const [rows] = await pool.execute(
    'SELECT friend_id FROM friends WHERE user_id = ?',
    [viewerId]
  );
  return rows.map((r) => r.friend_id);
}

// ── GET /api/circle/markers ──────────────────────────────────────────────────
router.get('/markers', async (req, res) => {
  const viewerId = req.user.userId;
  try {
    // v376 fix: Markers are gated on mutual friendship, NOT memory subscription.
    // See getFriendIds rationale.
    const friendIds = await getFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ markers: [] });
    }

    // Build placeholder list ?,?,? for IN(...) — mysql2 doesn't expand arrays
    // automatically when using pool.execute() prepared statements.
    const placeholders = friendIds.map(() => '?').join(',');

    // Filter: marker belongs to subscribed friend AND permission is shared tier
    // AND viewer has NOT hidden this marker.
    // Legacy 'group' included alongside 'friend' for markers ENUM.
    // Sprint 6 R47: filter soft-deleted authors so a friend pending
    // hard-delete stops appearing in the shared feed with their cached
    // name. Their account is going away; showing their content is
    // stale UX. Mirror of R37 fix on friends.js list endpoints.
    const sql = `
      SELECT m.id, m.user_id, m.type, m.text, m.lat, m.lng, m.alt,
             m.permission, m.approximate, m.created_at, m.updated_at,
             u.name AS author_name
        FROM markers m
        JOIN users  u  ON u.id = m.user_id AND u.deleted_at IS NULL
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
    // v376 fix: Routes are gated on mutual friendship, NOT memory subscription.
    // See getFriendIds rationale.
    const friendIds = await getFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ routes: [] });
    }
    const placeholders = friendIds.map(() => '?').join(',');

    // Sprint 6 R47: same soft-deleted filter as /circle/markers above.
    const sql = `
      SELECT r.id, r.user_id, r.name, r.description, r.points, r.distance_m,
             r.elevation_gain_m, r.permission, r.created_at, r.updated_at,
             u.name AS author_name
        FROM routes r
        JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL
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

    // Sprint 6 round-35 R35B1+B2: fog was silently broken for any friend
    // with > ~10 memory_points. MySQL's default group_concat_max_len=1024
    // causes JSON_ARRAYAGG to truncate at 1024 bytes → invalid JSON blob
    // → JSON.parse throws → 500 for the whole /fog request. Real prod
    // data shows heavy users have 500-700+ memory_points each (~54KB
    // aggregated JSON) — every subscription to such a user was breaking.
    //
    // Fix: get a dedicated connection, bump group_concat_max_len to 16MB
    // for this session only (doesn't affect other pool users), and cap
    // points-per-friend at MAX_POINTS_PER_FRIEND via a subquery ORDER BY
    // ts DESC LIMIT. The cap protects against sim-walker abuse producing
    // 500k+ rows for a single friend.
    const MAX_POINTS_PER_FRIEND = 20000;
    const conn = await pool.getConnection();
    let rows;
    try {
      await conn.execute('SET SESSION group_concat_max_len = 16777216');
      const sql = `
        SELECT sub.user_id AS friend_id,
               JSON_ARRAYAGG(JSON_OBJECT('lat', sub.lat, 'lng', sub.lng, 'ts', sub.ts)) AS points
          FROM (
            SELECT user_id, lat, lng, ts
              FROM memory_points
             WHERE user_id IN (${placeholders})
             ORDER BY ts DESC
             LIMIT ${MAX_POINTS_PER_FRIEND * friendIds.length}
          ) sub
      GROUP BY sub.user_id`;
      [rows] = await conn.execute(sql, friendIds);
    } finally {
      conn.release();
    }
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
