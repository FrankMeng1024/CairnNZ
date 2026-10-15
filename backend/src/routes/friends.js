/**
 * Friends Routes — /api/friends
 *
 * Endpoints:
 * POST   /api/friends/request       — Send friend request by email
 * GET    /api/friends/requests      — Get pending incoming requests
 * GET    /api/friends/requests/outbound — O18 FRI-out: my sent requests
 * POST   /api/friends/accept        — Accept a friend request
 * POST   /api/friends/reject        — Reject a friend request
 * DELETE /api/friends/requests/:id  — O18 FRI-out: cancel my outbound
 * GET    /api/friends               — List all friends
 * DELETE /api/friends/:id           — Remove a friend
 * GET    /api/friends/:id/profile   — O18 PROF-03: minimal profile card
 * POST   /api/friends/:id/block     — O18 FRI-block: block a user
 * DELETE /api/friends/:id/block     — O18 FRI-block: unblock
 * GET    /api/friends/blocked       — O18 FRI-block: my blocklist
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const {
  ensureFriendshipEpisode,
  provisionFriendshipGrants,
  closeFriendshipEpisode,
  currentMemoryGrant,
  setExplicitMemoryGrant,
} = require('../services/friendAuthorization');

// All routes require auth
router.use(authenticate);

// Sprint 6 round-36 R36B3: rate-limit POST /friends/request to blunt
// friend-spam + email enumeration. Pre-fix, a single authenticated user
// could POST /request against 10k different emails/hour, using the 404
// vs 200 response as an email-existence oracle across the entire
// userbase. Combined with rejection-loop replay (R36B2), a determined
// harasser could DoS a victim's push tokens. Cap: 30/hour/user — a
// legitimate user might friend 5-10 people in a day; 30/hour has 3-6x
// headroom. Key per-user (authenticate runs first).
const friendRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `frireq:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many friend requests. Please wait an hour.' },
});

// Every pair-mutating transaction takes the two user rows in numeric order.
// This is the common serialization point for request/accept/reject/block and
// prevents opposite-direction sends from acquiring request rows in a cycle.
async function lockActivePairUsers(conn, userA, userB) {
  const ids = [Number(userA), Number(userB)].sort((a, b) => a - b);
  const [rows] = await conn.execute(
    `SELECT id FROM users
      WHERE id IN (?, ?) AND deleted_at IS NULL
      ORDER BY id FOR UPDATE`,
    ids,
  );
  return rows.length === 2;
}

// ── Send friend request ─────────────────────────────────────────────────────
router.post('/request', friendRequestLimiter, validateBody(schemas.friend.request), async (req, res) => {
  try {
    const { email, shareMemory = false } = req.body;
    const fromUserId = req.user.userId;

    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Find target user (Sprint 6 review M1: exclude soft-deleted accounts
    // so a friend request can't be sent to a user pending deletion, and
    // enumeration via 404-vs-existing responses stays uniform).
    const [users] = await pool.execute(
      'SELECT id, name, email FROM users WHERE email = ? AND deleted_at IS NULL',
      [email],
    );
    if (users.length === 0) return res.status(404).json({ error: 'User not found' });

    const toUser = users[0];
    // Sprint 6 round-45 R45: fix type-coercion self-request bypass.
    // toUser.id from mysql2 is Number (BIGINT UNSIGNED for small vals);
    // fromUserId = req.user.userId is String (JWT payload per
    // User.toPublic `id: String(user.id)`). Strict `===` between number
    // and string is always false → self-request guard silently failed,
    // letting a user friend-request themselves. Same class as R38B2
    // (own-marker vote) and R45's block-self check below.
    if (String(toUser.id) === String(fromUserId)) return res.status(400).json({ error: 'Cannot add yourself' });

    const conn = await pool.getConnection();
    let createdRequest;
    try {
      await conn.beginTransaction();
      if (!await lockActivePairUsers(conn, fromUserId, toUser.id)) {
        await conn.rollback();
        return res.status(404).json({ error: 'User not found' });
      }

      const [blocks] = await conn.execute(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_id = ? AND blocked_id = ?)
            OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1`,
        [fromUserId, toUser.id, toUser.id, fromUserId],
      );
      if (blocks.length > 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'User not found' });
      }

      // Friendship and request checks are inside the same pair lock as the
      // insert. Historical accepted/declined/cancelled attempts are audit
      // records and never block a fresh attempt.
      const [existing] = await conn.execute(
        `SELECT 1 FROM friends
          WHERE (user_id = ? AND friend_id = ?)
             OR (user_id = ? AND friend_id = ?)
          LIMIT 1`,
        [fromUserId, toUser.id, toUser.id, fromUserId],
      );
      if (existing.length > 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Already friends' });
      }
      const [pending] = await conn.execute(
        `SELECT id FROM friend_requests
           WHERE ((from_user_id = ? AND to_user_id = ?)
               OR (from_user_id = ? AND to_user_id = ?))
             AND status = 'pending'
           FOR UPDATE`,
        [fromUserId, toUser.id, toUser.id, fromUserId]
      );
      if (pending.length > 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Request already sent' });
      }
      const [reqResult] = await conn.execute(
        `INSERT INTO friend_requests
           (from_user_id, to_user_id, status, requester_memory_share,
            accepter_memory_share, created_at)
         VALUES (?, ?, 'pending', ?, 0, UTC_TIMESTAMP(3))`,
        [fromUserId, toUser.id, shareMemory ? 1 : 0]
      );
      createdRequest = {
        id: Number(reqResult.insertId),
        to_user_id: Number(toUser.id),
        to_name: toUser.name,
        to_email: toUser.email,
        status: 'pending',
        requester_memory_share: Boolean(shareMemory),
        sent_at: new Date().toISOString(),
      };
      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      if (txErr.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'Request already sent' });
      }
      throw txErr;
    } finally {
      conn.release();
    }

    // O18 batch 6.5: notify recipient that they got a new friend request.
    // Fire-and-forget so a push-service outage never blocks request creation.
    // 2026-08-31: push disabled — no device tokens in production and UI
    // section hidden. Re-enable together with SettingsScreen Notifications
    // section once push is ready end-to-end.
    // try {
    //   const [meRows] = await pool.execute('SELECT name FROM users WHERE id = ? LIMIT 1', [fromUserId]);
    //   const myName = meRows[0]?.name || 'A hiker';
    //   const PushNotification = require('../models/PushNotification');
    //   PushNotification.enqueue({
    //     recipientUserId: toUser.id,
    //     actorUserId: fromUserId,
    //     kind: 'friend_request',
    //     relatedId: reqResult.insertId,
    //     title: `${myName} wants to be your friend`,
    //     body: 'Tap to review and accept.',
    //   }).catch(err => console.error('[push] friend_request enqueue failed:', err.message));
    // } catch (pushErr) {
    //   console.error('[push] friend_request trigger failed:', pushErr.message);
    // }

    res.status(201).json({ message: 'Friend request sent', request: createdRequest });
  } catch (err) {
    console.error('[friends/request]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Get pending incoming requests ───────────────────────────────────────────
router.get('/requests', async (req, res) => {
  try {
    // Sprint 6 R74: cap pending list at 200. Combined with R36B3 rate
    // limit on POST /request (30/hour), no legitimate user has more
    // than a handful of pending incoming requests. 200 covers a
    // popular user with a large fan base.
    const [requests] = await pool.execute(
      `SELECT fr.id, fr.from_user_id, u.name as from_name, u.email as from_email,
              fr.requester_memory_share, fr.created_at as sent_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.from_user_id AND u.deleted_at IS NULL
       WHERE fr.to_user_id = ? AND fr.status = "pending"
       ORDER BY fr.created_at DESC
       LIMIT 200`,
      [req.user.userId]
    );
    res.json(requests);
  } catch (err) {
    console.error('[friends/requests]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Accept friend request ───────────────────────────────────────────────────
router.post('/accept', validateBody(schemas.friend.accept), async (req, res) => {
  try {
    const { requestId, shareMemory = false } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    // Read only enough to discover the pair, then lock both user rows in the
    // global order before re-reading the request for authority.
    const [candidateRows] = await pool.execute(
      'SELECT from_user_id, to_user_id FROM friend_requests WHERE id = ? AND to_user_id = ? LIMIT 1',
      [requestId, req.user.userId],
    );
    if (candidateRows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const conn = await pool.getConnection();
    let request;
    let alreadyResolved = false;
    try {
      await conn.beginTransaction();
      if (!await lockActivePairUsers(conn, candidateRows[0].from_user_id, req.user.userId)) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      const [requests] = await conn.execute(
        'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? FOR UPDATE',
        [requestId, req.user.userId],
      );
      if (requests.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      request = requests[0];

      if (request.status === 'accepted') {
        const [friendRows] = await conn.execute(
          `SELECT COUNT(*) AS n FROM friends
            WHERE (user_id = ? AND friend_id = ?)
               OR (user_id = ? AND friend_id = ?)`,
          [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId],
        );
        if (Number(friendRows[0]?.n) === 2) {
          alreadyResolved = true;
          await conn.commit();
        } else {
          await conn.rollback();
          return res.status(409).json({ error: 'Request is no longer actionable' });
        }
      } else if (request.status !== 'pending') {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }

      if (!alreadyResolved) {
        const [blocks] = await conn.execute(
          `SELECT 1 FROM blocked_users
           WHERE (blocker_id = ? AND blocked_id = ?)
              OR (blocker_id = ? AND blocked_id = ?)
           LIMIT 1`,
          [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId],
        );
        if (blocks.length > 0) {
          await conn.rollback();
          return res.status(404).json({ error: 'Request not found' });
        }

        await conn.execute(
          `INSERT INTO friends (user_id, friend_id, created_at)
           VALUES (?, ?, UTC_TIMESTAMP(3)), (?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE created_at = created_at`,
          [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId],
        );
        const friendshipEpisode = await ensureFriendshipEpisode(
          conn,
          req.user.userId,
          request.from_user_id,
        );
        await provisionFriendshipGrants(
          conn,
          req.user.userId,
          request.from_user_id,
          friendshipEpisode,
        );
        if (request.requester_memory_share) {
          await setExplicitMemoryGrant(conn, request.from_user_id, req.user.userId, true);
        }
        if (shareMemory) {
          await setExplicitMemoryGrant(conn, req.user.userId, request.from_user_id, true);
        }
        await conn.execute(
          `UPDATE friend_requests
              SET status = 'accepted', accepter_memory_share = ?, resolved_at = UTC_TIMESTAMP(3)
            WHERE id = ? AND status = 'pending'`,
          [shareMemory ? 1 : 0, requestId],
        );
        await conn.commit();
      }
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    } finally {
      conn.release();
    }

    // Sprint 6 round-16 R16F-friends: respond BEFORE the push enqueue.
    // Pre-fix, the SELECT for myName + PushNotification.enqueue could
    // both throw — the outer catch would 500 the caller even though the
    // friendship transaction already committed. Result: user sees "Server
    // error" but on refresh their friend is actually added. Now: response
    // ships first, push is best-effort in the background.
    res.json({
      message: 'Friend request accepted',
      already_resolved: alreadyResolved,
      friend_id: Number(request.from_user_id),
    });

    // O18 batch 6.5: notify the original requester that their request
    // was accepted. Fire-and-forget — do not block the response.
    // 2026-08-31: push disabled — see friend_request block above for rationale.
    // (async () => {
    //   try {
    //     const [meRows] = await pool.execute('SELECT name FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
    //     const myName = meRows[0]?.name || 'A friend';
    //     const PushNotification = require('../models/PushNotification');
    //     await PushNotification.enqueue({
    //       recipientUserId: request.from_user_id,
    //       actorUserId: req.user.userId,
    //       kind: 'friend_accept',
    //       relatedId: requestId,
    //       title: `${myName} accepted your friend request`,
    //       body: 'You can now see each other\'s cairns and share hikes.',
    //     });
    //   } catch (pushErr) {
    //     console.error('[push] friend_accept post-response enqueue failed:', pushErr.message);
    //   }
    // })();
  } catch (err) {
    console.error('[friends/accept]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Reject friend request ───────────────────────────────────────────────────
router.post('/reject', validateBody(schemas.friend.reject), async (req, res) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });
    const [candidateRows] = await pool.execute(
      'SELECT from_user_id FROM friend_requests WHERE id = ? AND to_user_id = ? LIMIT 1',
      [requestId, req.user.userId],
    );
    if (candidateRows.length === 0) return res.status(404).json({ error: 'Request not found' });

    const conn = await pool.getConnection();
    let alreadyResolved = false;
    try {
      await conn.beginTransaction();
      if (!await lockActivePairUsers(conn, candidateRows[0].from_user_id, req.user.userId)) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      const [rows] = await conn.execute(
        'SELECT status FROM friend_requests WHERE id = ? AND to_user_id = ? FOR UPDATE',
        [requestId, req.user.userId],
      );
      if (rows.length === 0 || !['pending', 'rejected'].includes(rows[0].status)) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      alreadyResolved = rows[0].status === 'rejected';
      if (!alreadyResolved) {
        await conn.execute(
          `UPDATE friend_requests
              SET status = 'rejected', resolved_at = UTC_TIMESTAMP(3)
            WHERE id = ? AND status = 'pending'`,
          [requestId],
        );
      }
      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    } finally {
      conn.release();
    }
    res.json({ message: 'Request declined', already_resolved: alreadyResolved });
  } catch (err) {
    console.error('[friends/reject]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── List friends ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Sprint 6 round-37 R37: filter soft-deleted friends. Pre-fix, a
    // soft-deleted friend still appeared in the friend list with cached
    // name/email — user thinks they can share hikes with them but the
    // account is pending hard-delete.
    // Sprint 6 R74: cap at 1000. Users with more than 1000 friends are
    // pathological (Cairn's UX doesn't render a scroll of 1000 friends
    // meaningfully). Prevents multi-MB responses on hydrate.
    const [friends] = await pool.execute(
      `SELECT f.friend_id as id, u.name, u.email, f.created_at as added_at
       FROM friends f
       JOIN users u ON u.id = f.friend_id AND u.deleted_at IS NULL
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC
       LIMIT 1000`,
      [req.user.userId]
    );
    res.json(friends);
  } catch (err) {
    console.error('[friends/list]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Remove friend ───────────────────────────────────────────────────────────
// O18 FRI-out: get MY outgoing pending requests. Complements /requests
// (incoming) so users can see + cancel what they've sent.
// Sprint 6 round-8 review R8B1: these MUST be registered before
// `router.delete('/:id', ...)` so Express matches /requests/:id
// correctly. Pre-fix, numeric guard on /:id short-circuited to 400
// before Express could try /requests/:id as a fallback.
router.get('/requests/outbound', async (req, res) => {
  try {
    // Sprint 6 round-37 R37: filter soft-deleted targets. Outbound
    // pending request to a user pending-deletion is dead-on-arrival —
    // hide it from my outbound list.
    // Sprint 6 R74: cap at 200 (matches inbound pending cap).
    const [rows] = await pool.execute(
      `SELECT fr.id, fr.to_user_id, u.name AS to_name, u.email AS to_email,
              CASE WHEN fr.status = 'rejected' THEN 'declined' ELSE fr.status END AS status,
              fr.requester_memory_share, fr.created_at AS sent_at,
              fr.resolved_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.to_user_id AND u.deleted_at IS NULL
       WHERE fr.from_user_id = ?
         AND (fr.status = 'pending'
           OR (fr.status = 'rejected' AND fr.sender_dismissed_at IS NULL))
       ORDER BY fr.created_at DESC
       LIMIT 200`,
      [req.user.userId],
    );
    return res.json(rows);
  } catch (err) {
    console.error('[friends/requests/outbound]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Pending requests are cancelled without deleting their identity. A declined
// request is dismissed only for its sender and otherwise remains durable.
router.delete('/requests/:id', async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id' });
    const [result] = await pool.execute(
      `UPDATE friend_requests
          SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
              resolved_at = CASE
                WHEN status = 'pending' THEN UTC_TIMESTAMP(3) ELSE resolved_at END,
              sender_dismissed_at = CASE
                WHEN status = 'rejected' THEN UTC_TIMESTAMP(3) ELSE sender_dismissed_at END
        WHERE id = ? AND from_user_id = ? AND status IN ('pending','rejected')`,
      [requestId, req.user.userId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Request not found' });
    return res.json({ message: 'Request removed from sent history' });
  } catch (err) {
    console.error('[friends/requests/cancel]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// O18 FRI-block: my blocklist (who I've blocked). Registered before
// /:id/* routes so Express matches "blocked" correctly.
router.get('/blocked', async (req, res) => {
  try {
    // Sprint 6 R74: cap at 1000. Same rationale as friend list.
    const [rows] = await pool.execute(
      `SELECT b.blocked_id AS id, u.name, u.email, b.reason, b.created_at
       FROM blocked_users b
       LEFT JOIN users u ON u.id = b.blocked_id
       WHERE b.blocker_id = ?
       ORDER BY b.created_at DESC
       LIMIT 1000`,
      [req.user.userId],
    );
    const cleaned = rows.map(r => ({
      ...r,
      name: r.name ?? 'Deleted user',
      email: r.email ?? null,
    }));
    return res.json(cleaned);
  } catch (err) {
    console.error('[friends/blocked]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── Remove friend ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  if (!Number.isInteger(Number(req.params.id))) {
    return res.status(400).json({ error: 'Invalid friend id' });
  }
  // Sprint 6 R90 BUG-1: self-guard for symmetry with /block, and to
  // prevent a client bug from turning a stray own-id delete into a
  // silent 200 (see affectedRows guard below).
  if (String(Number(req.params.id)) === String(req.user.userId)) {
    return res.status(400).json({ error: 'Cannot unfriend yourself' });
  }
  try {
    const friendId = req.params.id;
    // Sprint 6 R90 BUG-1: check affectedRows. Pre-fix, DELETE returned
    // 200 "Friend removed" even when no row was touched (already
    // unfriended, non-existent friendship, wrong id). This diverges from
    // sibling endpoints (/reject, /requests/:id, /:id/profile all 404
    // on missing row) and causes phantom-success in the client UI: the
    // client marks the friend as removed locally, then rehydrates and
    // sees the row still present. Also serves as a weak existence oracle
    // via response-timing correlated with UNIQUE key lookup.
    const conn = await pool.getConnection();
    let removed = false;
    try {
      await conn.beginTransaction();
      const lockIds = [Number(req.user.userId), Number(friendId)].sort((a, b) => a - b);
      await conn.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [lockIds]);
      await closeFriendshipEpisode(conn, req.user.userId, friendId, 'unfriended');
      const [result] = await conn.execute(
        'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
        [req.user.userId, friendId, friendId, req.user.userId],
      );
      removed = result.affectedRows > 0;
      if (!removed) await conn.rollback();
      else await conn.commit();
    } catch (error) {
      try { await conn.rollback(); } catch { /* noop */ }
      throw error;
    } finally {
      conn.release();
    }
    if (!removed) return res.status(404).json({ error: 'Friendship not found' });
    res.json({ message: 'Friend removed' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// O18 PROF-03: minimal profile card for a friend. Only accessible if the
// requester + target are actually friends (privacy — non-friends see
// nothing beyond name/email). Returns friend-count + hike-count so the
// UI can render a light "Hiker Bio" card.
router.get('/:id/profile', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });
    // Sprint 6 review M9: collapse "not friends" and "user gone" to the
    // SAME 404 body so the caller can't tell whether a friend has
    // soft-deleted their account (privacy leak via 403 vs 404).
    const [friends] = await pool.execute(
      'SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? LIMIT 1',
      [req.user.userId, targetId],
    );
    if (friends.length === 0) return res.status(404).json({ error: 'Profile not available' });

    const [users] = await pool.execute(
      'SELECT id, name, email, created_at FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      [targetId],
    );
    if (users.length === 0) return res.status(404).json({ error: 'Profile not available' });

    const [cairnsRows] = await pool.execute(
      `SELECT COUNT(*) AS n
         FROM friend_cairn_encounters encounter
         JOIN markers marker ON marker.id = encounter.marker_id
        WHERE encounter.viewer_id = ? AND encounter.author_id = ?
          AND encounter.hidden_at IS NULL AND marker.permission = 'group'`,
      [req.user.userId, targetId],
    );
    const [routesRows] = await pool.execute(
      `SELECT COUNT(*) AS n FROM routes WHERE user_id = ? AND permission = 'friend'`,
      [targetId],
    );
    const memoryGrant = await currentMemoryGrant(pool, targetId, req.user.userId);
    return res.json({
      id: users[0].id,
      name: users[0].name,
      email: users[0].email,
      memberSince: users[0].created_at,
      permittedContent: {
        encounteredCairns: Number(cairnsRows[0]?.n ?? 0),
        sharedRoutes: Number(routesRows[0]?.n ?? 0),
        memoryAvailable: Boolean(memoryGrant),
      },
    });
  } catch (err) {
    console.error('[friends/profile]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// O18 FRI-block: block a user. Side effects:
//   - Deletes any active friendship both directions
//   - Cancels any pending friend request both directions
//   - Blocks future requests both directions (isBlocked check on /request)
// Idempotent — blocking an already-blocked user simply refreshes reason.
router.post('/:id/block', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });
    // Sprint 6 round-45 R45: fix type-coercion self-block bypass.
    // targetId is Number (from Number() cast); req.user.userId is String
    // (JWT payload). Strict `===` between them is always false. Coerce
    // both to String to enforce the "no self-block" guard.
    if (String(targetId) === String(req.user.userId)) return res.status(400).json({ error: 'Cannot block yourself' });
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const lockIds = [Number(req.user.userId), targetId].sort((a, b) => a - b);
      await conn.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [lockIds]);
      // Insert block (idempotent).
      await conn.execute(
        `INSERT INTO blocked_users (blocker_id, blocked_id, reason)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE reason = VALUES(reason)`,
        [req.user.userId, targetId, reason],
      );
      // Remove any existing friendship both directions.
      await conn.execute(
        `DELETE FROM friends
         WHERE (user_id = ? AND friend_id = ?)
            OR (user_id = ? AND friend_id = ?)`,
        [req.user.userId, targetId, targetId, req.user.userId],
      );
      await closeFriendshipEpisode(conn, req.user.userId, targetId, 'blocked');
      // A block is distinct from a recipient decline: it must not appear as a
      // sender-visible Declined outcome or become a re-requestable attempt.
      await conn.execute(
        `UPDATE friend_requests SET status = 'blocked', resolved_at = UTC_TIMESTAMP(3)
         WHERE status = 'pending'
           AND ((from_user_id = ? AND to_user_id = ?)
             OR (from_user_id = ? AND to_user_id = ?))`,
        [req.user.userId, targetId, targetId, req.user.userId],
      );
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      throw err;
    } finally {
      conn.release();
    }
    return res.json({ message: 'User blocked' });
  } catch (err) {
    console.error('[friends/block]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// O18 FRI-block: unblock. Note: does NOT re-friend — user must send a
// new request if they want to reconnect (matches standard block/unblock UX).
router.delete('/:id/block', async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user id' });
    await pool.execute(
      'DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
      [req.user.userId, targetId],
    );
    return res.json({ message: 'User unblocked' });
  } catch (err) {
    console.error('[friends/unblock]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// O18 FRI-block: /blocked route registered earlier (before /:id/* handlers)
// so Express matches the "blocked" segment as a literal, not a user id.

// O1 (2026-07-26): 删 GET /:id/markers 路由。Sprint 67 迁到全局
// /api/circle/markers,client 已停止调用 GET /api/friends/:id/markers。

module.exports = router;
