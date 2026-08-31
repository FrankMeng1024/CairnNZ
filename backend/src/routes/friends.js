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
  keyGenerator: (req, res) => req.user?.userId ? `frireq:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many friend requests. Please wait an hour.' },
});

// O18 FRI-block: helper — returns true if either direction is blocked.
// Called from /request to prevent messaging blocked users.
async function isBlocked(userA, userB) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM blocked_users
     WHERE (blocker_id = ? AND blocked_id = ?)
        OR (blocker_id = ? AND blocked_id = ?)
     LIMIT 1`,
    [userA, userB, userB, userA],
  );
  return rows.length > 0;
}

// ── Send friend request ─────────────────────────────────────────────────────
router.post('/request', friendRequestLimiter, validateBody(schemas.friend.request), async (req, res) => {
  try {
    const { email } = req.body;
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

    // Sprint 6 round-13 R13B3 fix: block check moved INSIDE the tx.
    // Pre-fix, isBlocked check ran outside — a concurrent /block from
    // the target could commit AFTER the check but BEFORE our INSERT,
    // leaving a pending request between blocked users. Now checked
    // under the same connection with the friend_requests FOR UPDATE
    // lock; block insert on the target user must wait for the tx.

    // Check if already friends (outside tx OK — friendship is set once
    // and doesn't race with /request).
    const [existing] = await pool.execute(
      'SELECT id FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [fromUserId, toUser.id, toUser.id, fromUserId]
    );
    if (existing.length > 0) return res.status(400).json({ error: 'Already friends' });

    // Sprint 6 round-7 review R7B4 fix: check + insert in a serialised
    // transaction to prevent TOCTOU on rapid double-tap or two-tab
    // sends. Round-13 R13B3: also block-check inside tx.
    const conn = await pool.getConnection();
    let reqResult;
    try {
      await conn.beginTransaction();
      // Block check inside the tx — read after locking so a concurrent
      // /block that commits mid-flight is either visible here or waits
      // for our tx to complete.
      // Sprint 6 round-14 R14B1 fix: FOR SHARE lock on blocked_users so
      // a concurrent /block on the same target holds a matching read
      // lock; the two txs serialise on the blocked_users rows they
      // both touch instead of interleaving.
      const [blocks] = await conn.execute(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_id = ? AND blocked_id = ?)
            OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1
         FOR SHARE`,
        [fromUserId, toUser.id, toUser.id, fromUserId],
      );
      if (blocks.length > 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'User not found' });
      }
      // Lock this user's outgoing-to-this-target row range. Using an
      // explicit user_id lock prevents the check+insert race.
      //
      // Sprint 6 round-36 R36B1+B2:
      //   B1 — also check REVERSE direction. Pre-fix, if target had a
      //        pending request TO me, I could still POST /request → two
      //        pending rows exist (A→B and B→A), producing asymmetric
      //        audit trails and double push notifications on accept.
      //   B2 — reject-cooldown. Pre-fix, once target rejected me, I
      //        could immediately re-request (row flips pending → rejected
      //        but the guard only stopped on pending). Infinite harassment
      //        loop. Now: reject a fresh request if a rejected row exists
      //        in either direction within the last 30 days.
      // Sprint 6 R84 BUG-6: if there's a stale accepted friend_requests row
      // (from A→B previously friends, then A unfriended B — friends row
      // deleted but friend_requests.status stayed 'accepted'), R56's
      // ON DUPLICATE KEY UPDATE below would silently flip accepted→pending,
      // destroying the audit trail of the original acceptance. Detect
      // that case here and DELETE the stale row first so the subsequent
      // INSERT creates a fresh record for the new request.
      const [staleAccepted] = await conn.execute(
        `SELECT id FROM friend_requests
           WHERE from_user_id = ? AND to_user_id = ? AND status = 'accepted'
           FOR UPDATE`,
        [fromUserId, toUser.id]
      );
      if (staleAccepted.length > 0) {
        await conn.execute(
          'DELETE FROM friend_requests WHERE id = ?',
          [staleAccepted[0].id]
        );
      }
      const [pending] = await conn.execute(
        `SELECT id, status FROM friend_requests
           WHERE ((from_user_id = ? AND to_user_id = ?)
               OR (from_user_id = ? AND to_user_id = ?))
             AND (status = 'pending'
                  OR (status = 'rejected'
                      AND resolved_at IS NOT NULL
                      AND resolved_at > DATE_SUB(NOW(), INTERVAL 30 DAY)))
           FOR UPDATE`,
        [fromUserId, toUser.id, toUser.id, fromUserId]
      );
      if (pending.length > 0) {
        await conn.rollback();
        // Uniform 400 message so the client can't distinguish "pending"
        // from "recently rejected" (rejected leaks a signal about the
        // target's intent — better UX + privacy to collapse both).
        return res.status(400).json({ error: 'Request already sent' });
      }
      [reqResult] = await conn.execute(
        // Sprint 6 round-56 R56: use ON DUPLICATE KEY UPDATE. The
        // friend_requests table has UNIQUE(from_user_id, to_user_id) —
        // only one row per (from,to) pair EVER. R36B2's 30-day reject
        // cooldown allows re-request after 30 days, but the raw INSERT
        // would then hit ER_DUP_ENTRY on the historical row and the
        // catch would throw "Server error" to the user. Fix: on
        // duplicate, reset status='pending' + refresh created_at +
        // clear resolved_at so a legitimate re-request after cooldown
        // reuses the historical row instead of failing.
        `INSERT INTO friend_requests (from_user_id, to_user_id, status, created_at)
         VALUES (?, ?, 'pending', NOW())
         ON DUPLICATE KEY UPDATE
           status = 'pending',
           created_at = NOW(),
           resolved_at = NULL,
           id = LAST_INSERT_ID(id)`,
        [fromUserId, toUser.id]
      );
      await conn.commit();
    } catch (txErr) {
      try { await conn.rollback(); } catch (_) {}
      throw txErr;
    } finally {
      conn.release();
    }

    // O18 batch 6.5: notify recipient that they got a new friend request.
    // Fire-and-forget so a push-service outage never blocks request creation.
    try {
      const [meRows] = await pool.execute('SELECT name FROM users WHERE id = ? LIMIT 1', [fromUserId]);
      const myName = meRows[0]?.name || 'A hiker';
      const PushNotification = require('../models/PushNotification');
      PushNotification.enqueue({
        recipientUserId: toUser.id,
        actorUserId: fromUserId,
        kind: 'friend_request',
        relatedId: reqResult.insertId,
        title: `${myName} wants to be your friend`,
        body: 'Tap to review and accept.',
      }).catch(err => console.error('[push] friend_request enqueue failed:', err.message));
    } catch (pushErr) {
      console.error('[push] friend_request trigger failed:', pushErr.message);
    }

    res.status(201).json({ message: 'Friend request sent' });
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
      `SELECT fr.id, fr.from_user_id, u.name as from_name, u.email as from_email, fr.created_at as sent_at
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
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    // Sprint 6 review B2 fix: wrap accept flow in a transaction so a
    // failed second INSERT doesn't leave a half-friendship. Also
    // re-check the request status inside the tx (concurrent double-tap
    // could race between SELECT and INSERT).
    const conn = await pool.getConnection();
    let request;
    try {
      await conn.beginTransaction();
      // Lock the request row so a concurrent accept can't succeed too.
      const [requests] = await conn.execute(
        'SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = "pending" FOR UPDATE',
        [requestId, req.user.userId],
      );
      if (requests.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      request = requests[0];

      // Sprint 6 R84 BUG-5: re-verify from_user still exists + not
      // soft-deleted. Pre-fix, if the requester soft-deleted their
      // account between /request and /accept, INSERT into friends
      // succeeded producing a friendship with a ghost user. authSweep
      // would purge later but /accept created stale rows in the
      // meantime — and the push notification at line 289+ would fire
      // to a doomed recipient.
      const [[fromUser]] = await conn.execute(
        `SELECT 1 AS ok FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [request.from_user_id],
      );
      if (!fromUser) {
        await conn.rollback();
        return res.status(404).json({ error: 'Request not found' });
      }
      // Sprint 6 R84 BUG-2: re-check block state inside the tx. Pre-fix,
      // a concurrent /block from either side would queue behind our
      // friend_requests row lock — /accept commits the friendship
      // first, then /block DELETEs it. Friendship briefly exists +
      // push notification fires to the requester saying "accepted".
      // Now: check blocked_users under FOR SHARE (same pattern as
      // R14B1 in /request path) so /block's INSERT into blocked_users
      // serializes with our check.
      const [blocks] = await conn.execute(
        `SELECT 1 FROM blocked_users
         WHERE (blocker_id = ? AND blocked_id = ?)
            OR (blocker_id = ? AND blocked_id = ?)
         LIMIT 1
         FOR SHARE`,
        [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId],
      );
      if (blocks.length > 0) {
        await conn.rollback();
        // Same 404 as request-not-found to avoid leaking block state.
        return res.status(404).json({ error: 'Request not found' });
      }

      // Bidirectional insert with ON DUPLICATE KEY UPDATE so a re-accept
      // (or a legacy half-friendship) heals instead of erroring.
      await conn.execute(
        `INSERT INTO friends (user_id, friend_id, created_at)
         VALUES (?, ?, NOW()), (?, ?, NOW())
         ON DUPLICATE KEY UPDATE created_at = created_at`,
        [req.user.userId, request.from_user_id, request.from_user_id, req.user.userId],
      );
      await conn.execute(
        // Sprint 6 round-14 R14B7: set resolved_at so authSweep purge
        // uses the actual resolution time, not creation time.
        'UPDATE friend_requests SET status = "accepted", resolved_at = NOW() WHERE id = ?',
        [requestId],
      );
      await conn.commit();
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
    res.json({ message: 'Friend request accepted' });

    // O18 batch 6.5: notify the original requester that their request
    // was accepted. Fire-and-forget — do not block the response.
    (async () => {
      try {
        const [meRows] = await pool.execute('SELECT name FROM users WHERE id = ? LIMIT 1', [req.user.userId]);
        const myName = meRows[0]?.name || 'A friend';
        const PushNotification = require('../models/PushNotification');
        await PushNotification.enqueue({
          recipientUserId: request.from_user_id,
          actorUserId: req.user.userId,
          kind: 'friend_accept',
          relatedId: requestId,
          title: `${myName} accepted your friend request`,
          body: 'You can now see each other\'s cairns and share hikes.',
        });
      } catch (pushErr) {
        console.error('[push] friend_accept post-response enqueue failed:', pushErr.message);
      }
    })();
  } catch (err) {
    console.error('[friends/accept]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Reject friend request ───────────────────────────────────────────────────
router.post('/reject', validateBody(schemas.friend.reject), async (req, res) => {
  try {
    const { requestId } = req.body;
    // Sprint 6 round-29 R29B1: guard on status='pending'. Pre-fix, a
    // recipient could POST /reject with an already-accepted requestId,
    // flipping status back to 'rejected' and rewriting resolved_at to
    // now — while the actual friends table rows from the earlier /accept
    // remained committed. Result: friend_requests audit lied (says
    // rejected), users are still friends, authSweep 90-day purge clock
    // reset on every replay. Now: reject only 'pending' requests; any
    // other status returns 404 so client shows a stale-state error.
    const [result] = await pool.execute(
      'UPDATE friend_requests SET status = "rejected", resolved_at = NOW() WHERE id = ? AND to_user_id = ? AND status = "pending"',
      [requestId, req.user.userId]
    );
    if (result.affectedRows === 0) {
      // Row missing, not owned by caller, or already resolved. Same
      // 404 for all three so we don't leak which request IDs exist.
      return res.status(404).json({ error: 'Request not found or not pending' });
    }
    res.json({ message: 'Request rejected' });
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
              fr.status, fr.created_at AS sent_at
       FROM friend_requests fr
       JOIN users u ON u.id = fr.to_user_id AND u.deleted_at IS NULL
       WHERE fr.from_user_id = ? AND fr.status = 'pending'
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

// O18 FRI-out: cancel a pending outbound request I sent.
router.delete('/requests/:id', async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId)) return res.status(400).json({ error: 'Invalid request id' });
    const [result] = await pool.execute(
      `DELETE FROM friend_requests
       WHERE id = ? AND from_user_id = ? AND status = 'pending'`,
      [requestId, req.user.userId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Request not found' });
    return res.json({ message: 'Request cancelled' });
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
    const [result] = await pool.execute(
      'DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [req.user.userId, friendId, friendId, req.user.userId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }
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

    const [friendCountRows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM friends WHERE user_id = ?',
      [targetId],
    );
    const [hikeCountRows] = await pool.execute(
      // Sprint 6 round-4 review R4B8: use `finalized_at IS NOT NULL` as
      // the source of truth for "completed hike". Pre-fix, an OR'd
      // `distance_m > 0` also counted in-progress unfinalized sessions
      // (e.g. sim-walker rows), inflating a friend's hike count.
      `SELECT COUNT(*) AS n FROM sessions
       WHERE user_id = ?
         AND finalized_at IS NOT NULL`,
      [targetId],
    );
    const [placesRows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM memory_points WHERE user_id = ?',
      [targetId],
    );
    const [cairnsRows] = await pool.execute(
      'SELECT COUNT(*) AS n FROM markers WHERE user_id = ?',
      [targetId],
    );
    return res.json({
      id: users[0].id,
      name: users[0].name,
      email: users[0].email,
      memberSince: users[0].created_at,
      friendCount: friendCountRows[0]?.n ?? 0,
      hikeCount: hikeCountRows[0]?.n ?? 0,
      placesExplored: placesRows[0]?.n ?? 0,
      cairnsPlanted: cairnsRows[0]?.n ?? 0,
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
      // Cancel any pending requests either direction.
      await conn.execute(
        `UPDATE friend_requests SET status = 'rejected', resolved_at = NOW()
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
