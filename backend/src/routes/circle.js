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
    const sql = `
      SELECT m.id, m.user_id, m.type, m.text, m.lat, m.lng, m.alt,
             m.permission, m.approximate, m.created_at, m.updated_at,
             u.name AS author_name
        FROM friend_cairn_encounters encounter
        JOIN markers m ON m.id = encounter.marker_id
                      AND m.user_id = encounter.author_id
                      AND m.audience_epoch = encounter.audience_epoch
        JOIN friendship_episodes episode
          ON episode.id = encounter.friendship_episode_id AND episode.ended_at IS NULL
        JOIN friends f ON f.user_id = encounter.viewer_id AND f.friend_id = encounter.author_id
        JOIN users  u  ON u.id = m.user_id AND u.deleted_at IS NULL
   LEFT JOIN hidden_items h
          ON h.user_id   = ?
         AND h.item_type = 'mark'
         AND h.item_id   = m.id
       WHERE encounter.viewer_id = ?
         AND encounter.hidden_at IS NULL
         AND m.permission = 'group'
         AND m.status = 'healthy'
         AND h.user_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocked_users b
            WHERE (b.blocker_id = encounter.viewer_id AND b.blocked_id = encounter.author_id)
               OR (b.blocker_id = encounter.author_id AND b.blocked_id = encounter.viewer_id)
         )
    ORDER BY m.created_at DESC
    LIMIT 5000`;

    const [markers] = await pool.execute(sql, [viewerId, viewerId]);

    // Normalize 'group' → 'friend' on the client wire so the UI never sees legacy.
    // Public marks from friends remain 'public' (per v4: anonymous display still
    // applies — the client renders author_name=null for any public mark).
    const out = markers.map((m) => ({
      ...m,
      permission: normalize(m.permission),
      author_name: m.author_name,
      read_only: true,
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
    const friendIds = await getFriendIds(viewerId);
    if (friendIds.length === 0) {
      return res.json({ routes: [] });
    }
    const placeholders = friendIds.map(() => '?').join(',');

    // Sprint 6 R47: same soft-deleted filter as /circle/markers above.
    const sql = `
      SELECT r.id, r.user_id, r.name, r.description, r.distance_m,
             r.elevation_gain_m, r.permission, r.created_at, r.updated_at,
             u.name AS author_name
        FROM routes r
        JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL
   LEFT JOIN hidden_items h
          ON h.user_id   = ?
         AND h.item_type = 'route'
         AND h.item_id   = r.id
       WHERE r.user_id IN (${placeholders})
         AND r.permission = 'friend'
         AND h.user_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM blocked_users b
            WHERE (b.blocker_id = ? AND b.blocked_id = r.user_id)
               OR (b.blocker_id = r.user_id AND b.blocked_id = ?)
         )
    ORDER BY r.created_at DESC
    LIMIT 1000`;

    const [routes] = await pool.execute(sql, [viewerId, ...friendIds, viewerId, viewerId]);
    const out = routes.map((r) => ({
      ...r,
      read_only: true,
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
  return res.status(410).json({
    error: 'Raw friend Memory is no longer available.',
    code: 'FRIEND_MEMORY_PROJECTION_REQUIRED',
    replacement: '/api/friend-sharing/projections',
  });
});

module.exports = router;
