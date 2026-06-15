/**
 * Session routes:
 *   POST   /api/sessions                      (authenticated) — save a session (legacy: all-in-one)
 *   POST   /api/sessions/start                (authenticated) — create empty row, return id (incremental flow)
 *   PATCH  /api/sessions/:id/append-points    (authenticated) — append GPS points to active session
 *   PATCH  /api/sessions/:id                  (authenticated) — finalize a session (end_time, distance, name)
 *   GET    /api/sessions                      (authenticated) — list user's sessions
 *   GET    /api/sessions/:id                  (authenticated) — get session with route_points + flags
 *   DELETE /api/sessions/:id                  (authenticated) — delete a session
 */
const express = require('express');
const Session = require('../models/Session');
const authenticate = require('../middleware/authenticate');
const idempotency = require('../middleware/idempotency');

const router = express.Router();

// ── POST /api/sessions ─────────────────────────────────────────────────────
router.post('/', authenticate, idempotency, async (req, res) => {
  const { type, start_time, end_time, distance_m, duration_s, route_points, route_points_raw, flags, route_id, name } = req.body;

  if (!type || !['hiking', 'running'].includes(type)) {
    return res.status(400).json({ error: 'type must be "hiking" or "running".' });
  }
  if (!start_time || isNaN(Date.parse(start_time))) {
    return res.status(400).json({ error: 'start_time must be a valid ISO date.' });
  }
  if (!end_time || isNaN(Date.parse(end_time))) {
    return res.status(400).json({ error: 'end_time must be a valid ISO date.' });
  }
  if (distance_m !== undefined && (typeof distance_m !== 'number' || distance_m < 0)) {
    return res.status(400).json({ error: 'distance_m must be a non-negative number.' });
  }
  // Reject sessions with no drawable path — "too short to record".
  // < 2 points means we cannot draw a line; there is nothing useful to store.
  const pts = route_points ?? [];
  if (!Array.isArray(pts) || pts.length < 2) {
    return res.status(422).json({ error: 'Session has no drawable path (fewer than 2 GPS points). Not saved.' });
  }

  try {
    const id = await Session.create({
      userId: req.user.userId,
      routeId: route_id ?? null,
      type,
      startTime: new Date(start_time),
      endTime: new Date(end_time),
      distanceM: distance_m ?? 0,
      durationS: duration_s ?? 0,
      routePoints: route_points ?? null,
      routePointsRaw: route_points_raw ?? null,
      flags: flags ?? null,
      name: name ?? null,
    });

    const session = await Session.findByIdAndUser(id, req.user.userId);
    return res.status(201).json({ session });
  } catch (err) {
    console.error('[sessions/post]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── GET /api/sessions ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const sessions = await Session.findByUser(req.user.userId);
    return res.json({ sessions });
  } catch (err) {
    console.error('[sessions/list]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/sessions/start ───────────────────────────────────────────────
// Begin an active session — creates an empty row, returns its id.
// Client uses the returned id for subsequent /append-points and final
// PATCH calls. This decouples "start tracking" from "finish tracking" so
// crashes mid-session don't lose data.
router.post('/start', authenticate, idempotency, async (req, res) => {
  const { type, start_time } = req.body;
  if (!type || !['hiking', 'running'].includes(type)) {
    return res.status(400).json({ error: 'type must be "hiking" or "running".' });
  }
  if (!start_time || isNaN(Date.parse(start_time))) {
    return res.status(400).json({ error: 'start_time must be a valid ISO date.' });
  }
  try {
    const id = await Session.createEmpty({
      userId: req.user.userId,
      type,
      startTime: new Date(start_time),
    });
    return res.status(201).json({ id });
  } catch (err) {
    console.error('[sessions/start]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/sessions/:id/append-points ──────────────────────────────────
// Append a batch of GPS points to an active session. Used by the 60-second
// incremental backup interval during tracking.
router.patch('/:id/append-points', authenticate, idempotency, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const { points } = req.body;
  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'points must be an array.' });
  }
  if (points.length === 0) {
    return res.status(200).json({ ok: true, appended: 0 });
  }
  try {
    const ok = await Session.appendPoints(id, req.user.userId, points);
    if (!ok) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json({ ok: true, appended: points.length });
  } catch (err) {
    console.error('[sessions/append-points]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/sessions/:id ────────────────────────────────────────────────
// Finalize a session at stop time: write end_time, distance_m, duration_s,
// and (optional) name. Called from stopTracking after final point flush.
router.patch('/:id', authenticate, idempotency, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const { end_time, distance_m, duration_s, name, route_points, route_points_raw } = req.body;
  const fields = {};
  if (end_time !== undefined) {
    if (isNaN(Date.parse(end_time))) {
      return res.status(400).json({ error: 'end_time must be a valid ISO date.' });
    }
    fields.endTime = new Date(end_time);
  }
  if (distance_m !== undefined) {
    if (typeof distance_m !== 'number' || distance_m < 0) {
      return res.status(400).json({ error: 'distance_m must be a non-negative number.' });
    }
    fields.distanceM = distance_m;
  }
  if (duration_s !== undefined) {
    if (typeof duration_s !== 'number' || duration_s < 0) {
      return res.status(400).json({ error: 'duration_s must be a non-negative number.' });
    }
    fields.durationS = duration_s;
  }
  if (name !== undefined) fields.name = name;
  // v77: optional raw audit track. Sent once at session finalize (not in
  // 60s flushes since it's debug-only). Accept null to clear.
  if (route_points_raw !== undefined) {
    if (route_points_raw !== null && !Array.isArray(route_points_raw)) {
      return res.status(400).json({ error: 'route_points_raw must be an array or null.' });
    }
    fields.routePointsRaw = route_points_raw;
  }
  // v6.4: optional snapped polyline. Client computes Mapbox /matching on
  // the raw GPS at stop time and ships the cleaned polyline here so cross-
  // device loads, fresh installs, and brush-edit baselines all see the
  // same clean geometry. The raw audit track stays in route_points_raw
  // forever as a backup. Accept null to clear / fall back to raw.
  if (route_points !== undefined) {
    if (route_points !== null && !Array.isArray(route_points)) {
      return res.status(400).json({ error: 'route_points must be an array or null.' });
    }
    fields.routePoints = route_points;
  }
  try {
    // Reject finalization if the session has no drawable path.
    // The incremental flow (start → append-points → finalize) may result in
    // zero or one GPS points if the user started and immediately stopped.
    const existing = await Session.findByIdAndUser(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Session not found.' });
    const pointCount = Array.isArray(existing.route_points) ? existing.route_points.length : 0;
    if (pointCount < 2) {
      // Delete the empty/too-short session — no reason to keep it on disk.
      await Session.deleteByIdAndUser(id, req.user.userId);
      return res.status(422).json({ error: 'Session has no drawable path (fewer than 2 GPS points). Not saved.' });
    }

    const ok = await Session.finalize(id, req.user.userId, fields);
    if (!ok) return res.status(404).json({ error: 'Session not found or no changes.' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sessions/finalize]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/sessions/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    const session = await Session.findByIdAndUser(id, req.user.userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.json({ session });
  } catch (err) {
    console.error('[sessions/get]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/sessions/:id ───────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    const deleted = await Session.deleteByIdAndUser(id, req.user.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sessions/delete]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
