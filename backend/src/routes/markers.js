/**
 * Markers Routes — /api/markers
 *
 * Endpoints:
 * GET    /api/markers          — Get user's markers
 * POST   /api/markers          — Create a marker
 * PUT    /api/markers/:id      — Update a marker (note, permission)
 * DELETE /api/markers/:id      — Delete a marker
 *
 * v199 community endpoints (canon §一-4: 1 user 1 mark 1 vote, mutex,
 * permanent — no DELETE, no UPDATE):
 * GET    /api/markers/:id/community-state — read counts + user's vote
 * GET    /api/markers/:id/interact-nonce  — short-lived HMAC for /vote
 * POST   /api/markers/:id/vote            — submit like or report
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const idempotency = require('../middleware/idempotency');
const { haversineM } = require('../utils/haversine');
const nonceUtil = require('../utils/nonce');
const abuseSignals = require('../utils/abuseSignals');
const { isClientWriteable, PERMISSION } = require('../constants/permission');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

router.use(authenticate);

// ── Server-side gates (per V2.C6) ─────────────────────────────────────
const SERVER_INTERACT_RANGE_M = 50; // 30 client + 20 GPS noise margin
const MAX_GPS_ACCURACY_M = 100;
const MAX_TIMESTAMP_SKEW_MS = 60_000;
const IMPOSSIBLE_TRAVEL_KM = 5;
const IMPOSSIBLE_TRAVEL_WINDOW_MS = 60_000;
const REPORT_HIDE_THRESHOLD = 5;
const VALID_REASONS = new Set(['fake_ad', 'info_mismatch', 'dislike']);
const VALID_TYPES = new Set(['like', 'report']);

// ── Rate limiters (per V2.C5) ─────────────────────────────────────────
// Keyed by req.user.userId, NOT IP, so corporate-NAT users don't share a
// bucket. Skip on idempotent replays so genuine retries aren't penalized.
function userKey(prefix) {
  return (req) => `${prefix}:${req.user?.userId || req.ip}`;
}
function skipReplay(req) {
  return req.get('X-Idempotent-Replay') === '1';
}

const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey('like'),
  skip: skipReplay,
  handler: (req, res) => {
    abuseSignals.log(req, { kind: 'rate_limit', userId: req.user?.userId, payload: { route: 'vote.like' } });
    res.status(429).json({ error: 'Too many like actions. Slow down.' });
  },
});
const reportLimiterMin = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey('reportMin'),
  skip: skipReplay,
  handler: (req, res) => {
    abuseSignals.log(req, { kind: 'rate_limit', userId: req.user?.userId, payload: { route: 'vote.report.min' } });
    res.status(429).json({ error: 'Too many report actions. Slow down.' });
  },
});
const reportLimiterHour = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userKey('reportHour'),
  skip: skipReplay,
  handler: (req, res) => {
    abuseSignals.log(req, { kind: 'rate_limit', userId: req.user?.userId, payload: { route: 'vote.report.hour' } });
    res.status(429).json({ error: 'Hourly report limit reached.' });
  },
});

// Wrap two limiters per request body type ('like' uses likeLimiter,
// 'report' uses both reportLimiterMin + reportLimiterHour).
function voteRateLimit(req, res, next) {
  const t = req.body?.type;
  if (t === 'like') return likeLimiter(req, res, next);
  if (t === 'report') {
    return reportLimiterMin(req, res, (err) => {
      if (err) return next(err);
      return reportLimiterHour(req, res, next);
    });
  }
  // Unknown type — let validation in handler catch it (returns 400)
  return next();
}

// ── Get user's markers ──────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // BUG-001 fix (Sprint 71 post-review): include user_id so the client can
    // populate Marker.authorId with the real owner id instead of the literal
    // 'server' fallback. Without user_id in the response, viewerId vs
    // markUserId comparison in markVisibility/markTier returns 'stranger'
    // for the user's OWN marks, making own Personal marks invisible after
    // backend hydrate.
    const [markers] = await pool.execute(
      `SELECT id, user_id, type, text, lat, lng, alt, permission, approximate, public_snapshot, created_at, updated_at
       FROM markers WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json(markers);
  } catch (err) {
    console.error('[markers/get]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Get Public markers within bbox (strangers' marks for Memory tab) ────────
// v4 §7: GET /api/markers/public?bbox=lat1,lng1,lat2,lng2
//   - returns Public marks from any user (including the viewer's friends —
//     UI filters non-strangers in the Memory tab if needed)
//   - LEFT JOIN hidden_items so the viewer doesn't see ones they hid
//   - ORDER BY created_at DESC LIMIT 50 (per plan §7 line 314)
//   - bbox is two corners: (lat1,lng1) = SW, (lat2,lng2) = NE
//   - Anonymous: author_name is intentionally null even when the row's
//     creator is the viewer's friend — Public marks are always anonymous
//     in v1 (per v4 row Q + §10).
// O1: /public route removed — 0 client callers. Feature was for Memory
// tab stranger marks (v4 §7) but never wired to UI.

// ── Create marker ───────────────────────────────────────────────────────────
router.post('/', validateBody(schemas.marker.create), idempotency, async (req, res) => {
  try {
    const { type, text, lat, lng, alt, permission, approximate } = req.body;

    if (!type || lat == null || lng == null) {
      return res.status(400).json({ error: 'type, lat, lng required' });
    }
    // v300: bumped 50→250 to fit plant-flow title (30) + sep + body (200).
    if (text && text.length > 250) {
      return res.status(400).json({ error: 'Text max 250 characters' });
    }

    // v4 H1: client can never write permission='public'. Only seed scripts do.
    // Accept 'personal' | 'group' (legacy) | 'friend' (modern alias). Map
    // 'friend' → DB 'group' to keep the ENUM stable. Reject anything else.
    if (permission === PERMISSION.PUBLIC) {
      return res.status(400).json({
        error: "permission='public' is not allowed for client writes",
      });
    }
    if (permission !== undefined && !isClientWriteable(permission)) {
      return res.status(400).json({ error: 'Invalid permission' });
    }
    const perm =
      permission === PERMISSION.FRIEND ? PERMISSION.GROUP_LEGACY :
      permission || PERMISSION.PERSONAL;
    const approx = approximate ? 1 : 0;

    // v300 snapshot logic only applied to public — H1 now blocks the public
    // write path at the API layer, so the snapshot branch below is unreachable
    // from client POST. Retained as null for column write consistency.
    let publicSnapshotJson = null;

    const [result] = await pool.execute(
      `INSERT INTO markers (user_id, type, text, lat, lng, alt, permission, approximate, public_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [req.user.userId, type, text || '', lat, lng, alt || null, perm, approx, publicSnapshotJson]
    );

    res.status(201).json({
      id: result.insertId,
      // BUG-006 fix (Sprint 71 post-review round 2): echo user_id so the
      // client addMarker post-sync can populate Marker.authorId with the
      // real owner id instead of preserving the caller-passed 'local' /
      // 'server' literal. Without this, in-session new marks remain
      // tier='stranger' until the next app restart triggers GET (BUG-001).
      user_id: req.user.userId,
      type, text: text || '', lat, lng, alt, permission: perm, approximate: !!approximate,
      public_snapshot: publicSnapshotJson,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[markers/create]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Update marker ───────────────────────────────────────────────────────────
router.put('/:id', validateBody(schemas.marker.update), async (req, res) => {
  try {
    const { text, permission, type } = req.body;
    const markerId = req.params.id;

    // Verify ownership AND fetch current state for snapshot logic.
    const [existing] = await pool.execute(
      'SELECT id, type, lat, lng, text, permission, public_snapshot FROM markers WHERE id = ? AND user_id = ?',
      [markerId, req.user.userId]
    );
    if (existing.length === 0) return res.status(404).json({ error: 'Marker not found' });
    const current = existing[0];

    const updates = [];
    const values = [];

    if (type !== undefined) {
      // v300: valid type list updated to v105 marker types
      // (was the stale ['danger','scenic','supply','junction','free']).
      const validTypes = ['danger', 'junction', 'water', 'hut', 'cairn'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: 'Invalid type' });
      }
      updates.push('type = ?');
      values.push(type);
    }
    if (text !== undefined) {
      if (text.length > 250) return res.status(400).json({ error: 'Text max 250 characters' });
      updates.push('text = ?');
      values.push(text);
    }
    if (permission !== undefined) {
      // v4 H1: client can never set permission='public'.
      if (permission === PERMISSION.PUBLIC) {
        return res.status(400).json({
          error: "permission='public' is not allowed for client writes",
        });
      }
      if (!isClientWriteable(permission)) {
        return res.status(400).json({ error: 'Invalid permission' });
      }
      const dbPerm =
        permission === PERMISSION.FRIEND ? PERMISSION.GROUP_LEGACY : permission;
      updates.push('permission = ?');
      values.push(dbPerm);

      // v300 snapshot branch was: "first transition to public → snapshot".
      // Under v4 H1 this branch is unreachable from a client PATCH because
      // permission='public' is rejected above. Removed to keep the code
      // honest about what client paths can do.
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

    updates.push('updated_at = NOW()');
    values.push(markerId, req.user.userId);

    await pool.execute(
      `UPDATE markers SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    // BUG-006 fix: echo user_id on update too. Updating a mark currently
    // does not refresh client-side authorId — but to keep response shape
    // consistent across POST/PUT/GET, include user_id here as well.
    res.json({ message: 'Marker updated', user_id: req.user.userId, id: Number(markerId) });
  } catch (err) {
    console.error('[markers/update]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Delete marker ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM markers WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Marker not found' });
    res.json({ message: 'Marker deleted' });
  } catch (err) {
    console.error('[markers/delete]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// v199 Community endpoints (canon §一-4)
// ─────────────────────────────────────────────────────────────────────

// GET /api/markers/:id/community-state — read counts + user's existing vote.
router.get('/:id/community-state', async (req, res) => {
  const markerId = Number(req.params.id);
  if (!Number.isInteger(markerId) || markerId <= 0) {
    return res.status(400).json({ error: 'Invalid marker id' });
  }
  try {
    const [[marker]] = await pool.execute(
      `SELECT id, helpful_count, report_count, status, hidden_at
         FROM markers WHERE id = ?`,
      [markerId],
    );
    if (!marker) return res.status(404).json({ error: 'Marker not found' });
    const [voteRows] = await pool.execute(
      `SELECT type, reason FROM marker_votes WHERE marker_id = ? AND user_id = ?`,
      [markerId, req.user.userId],
    );
    const userVote = voteRows[0]
      ? { type: voteRows[0].type, reason: voteRows[0].reason }
      : null;
    res.json({
      marker_id: markerId,
      helpful_count: marker.helpful_count ?? 0,
      report_count: marker.report_count ?? 0,
      status: marker.status || 'healthy',
      hidden_at: marker.hidden_at,
      user_vote: userVote,
    });
  } catch (err) {
    console.error('[markers/community-state]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/markers/:id/interact-nonce — short-lived HMAC nonce for /vote.
router.get('/:id/interact-nonce', async (req, res) => {
  const markerId = Number(req.params.id);
  if (!Number.isInteger(markerId) || markerId <= 0) {
    return res.status(400).json({ error: 'Invalid marker id' });
  }
  const issued = nonceUtil.issue(req.user.userId, markerId);
  res.json({ marker_id: markerId, ...issued });
});

// POST /api/markers/:id/vote — single canon-correct endpoint for like+report.
// Body: { type: 'like'|'report', reason?: string, lat: number, lng: number,
//         accuracy?: number, client_ts?: number, nonce: string,
//         client_op_id?: string (UUIDv4 for idempotency middleware) }
router.post('/:id/vote', voteRateLimit, idempotency, async (req, res) => {
  const markerId = Number(req.params.id);
  const { type, reason, lat, lng, accuracy, client_ts, nonce } = req.body || {};
  const userId = req.user.userId;

  // ── Input validation ──────────────────────────────────────────────
  if (!Number.isInteger(markerId) || markerId <= 0) {
    return res.status(400).json({ error: 'Invalid marker id' });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'type must be like or report' });
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat, lng required as numbers' });
  }
  if (type === 'report') {
    if (!VALID_REASONS.has(reason)) {
      return res.status(400).json({ error: 'reason must be fake_ad, info_mismatch, or dislike' });
    }
  }

  // GPS quality gate
  if (typeof accuracy === 'number' && accuracy > MAX_GPS_ACCURACY_M) {
    abuseSignals.log(req, { kind: 'gps_low_accuracy', userId, markerId, payload: { accuracy } });
    return res.status(400).json({ error: 'GPS accuracy too low' });
  }
  // Clock skew gate
  if (typeof client_ts === 'number') {
    const skew = Math.abs(Date.now() - client_ts);
    if (skew > MAX_TIMESTAMP_SKEW_MS) {
      abuseSignals.log(req, { kind: 'clock_skew', userId, markerId, payload: { skew } });
      return res.status(400).json({ error: 'Clock skew too large' });
    }
  }
  // Nonce gate
  const nonceCheck = nonceUtil.verify(nonce, userId, markerId);
  if (!nonceCheck.valid) {
    abuseSignals.log(req, {
      kind: 'replay_nonce_invalid',
      userId, markerId, payload: { reason: nonceCheck.reason },
    });
    return res.status(401).json({ error: 'Invalid or expired nonce' });
  }

  // ── Transaction: lock marker, insert vote (mutex), increment counter ──
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[marker]] = await conn.execute(
      `SELECT id, lat, lng, helpful_count, report_count, status
         FROM markers WHERE id = ? FOR UPDATE`,
      [markerId],
    );
    if (!marker) {
      await conn.rollback();
      return res.status(404).json({ error: 'Marker not found' });
    }

    // Server-side haversine gate (50m). Authoritative — client gate
    // exists for UX but server is the only enforcement.
    const distM = haversineM(lat, lng, marker.lat, marker.lng);
    if (distM > SERVER_INTERACT_RANGE_M) {
      await conn.rollback();
      abuseSignals.log(req, {
        kind: 'gps_too_far', userId, markerId,
        payload: { dist_m: distM, lat, lng },
      });
      return res.status(403).json({
        error: 'Too far from marker to interact',
        distance_m: Math.round(distM),
      });
    }

    // Impossible-travel: any vote from same user >5km away in <60s = reject
    const [[recent]] = await conn.execute(
      `SELECT reporter_lat, reporter_lng, created_at
         FROM marker_votes
        WHERE user_id = ?
          AND reporter_lat IS NOT NULL
          AND created_at > (NOW() - INTERVAL ? MICROSECOND)
        ORDER BY created_at DESC LIMIT 1`,
      [userId, IMPOSSIBLE_TRAVEL_WINDOW_MS * 1000],
    );
    if (recent) {
      const traveledKm = haversineM(lat, lng, recent.reporter_lat, recent.reporter_lng) / 1000;
      if (traveledKm > IMPOSSIBLE_TRAVEL_KM) {
        await conn.rollback();
        abuseSignals.log(req, {
          kind: 'impossible_travel', userId, markerId,
          payload: { traveled_km: traveledKm },
        });
        return res.status(429).json({ error: 'Impossible travel detected' });
      }
    }

    // Atomic INSERT IGNORE — UNIQUE(user_id, marker_id) enforces canon
    // mutex. affectedRows===1 means a fresh insert; 0 means existing
    // vote (any type) blocks this one.
    const [ins] = await conn.execute(
      `INSERT IGNORE INTO marker_votes
         (user_id, marker_id, type, reason, reporter_lat, reporter_lng, distance_m)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, markerId, type, type === 'report' ? reason : null, lat, lng, distM],
    );

    if (ins.affectedRows === 0) {
      // 409 Conflict — fetch existing vote so client can render correct state
      const [[existing]] = await conn.execute(
        `SELECT type, reason FROM marker_votes WHERE user_id = ? AND marker_id = ?`,
        [userId, markerId],
      );
      await conn.rollback();
      return res.status(409).json({
        error: 'You already voted on this marker',
        existing_vote: existing
          ? { type: existing.type, reason: existing.reason }
          : null,
        helpful_count: marker.helpful_count ?? 0,
        report_count: marker.report_count ?? 0,
        status: marker.status || 'healthy',
      });
    }

    // Increment counter atomically (only when fresh insert succeeded).
    let newStatus = marker.status || 'healthy';
    let hiddenAtSet = false;
    if (type === 'like') {
      await conn.execute(
        `UPDATE markers SET helpful_count = helpful_count + 1 WHERE id = ?`,
        [markerId],
      );
    } else {
      await conn.execute(
        `UPDATE markers SET report_count = report_count + 1 WHERE id = ?`,
        [markerId],
      );
      // Auto-hide threshold
      if ((marker.report_count ?? 0) + 1 >= REPORT_HIDE_THRESHOLD && newStatus !== 'hidden') {
        await conn.execute(
          `UPDATE markers SET status = 'hidden', hidden_at = NOW() WHERE id = ?`,
          [markerId],
        );
        newStatus = 'hidden';
        hiddenAtSet = true;
      }
    }

    // Read final counts in same tx
    const [[counts]] = await conn.execute(
      `SELECT helpful_count, report_count, status, hidden_at FROM markers WHERE id = ?`,
      [markerId],
    );

    await conn.commit();

    return res.status(201).json({
      marker_id: markerId,
      type,
      reason: type === 'report' ? reason : null,
      helpful_count: counts.helpful_count ?? 0,
      report_count: counts.report_count ?? 0,
      status: counts.status || 'healthy',
      hidden_at: counts.hidden_at,
      already_voted: false,
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    console.error('[markers/vote]', err.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

module.exports = router;
