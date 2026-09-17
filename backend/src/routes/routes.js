/**
 * Routes API — /api/routes
 *
 * POST   /api/routes           — create route
 * GET    /api/routes           — list user's routes (run_count DESC)
 * GET    /api/routes/:id       — get route with full points
 * PUT    /api/routes/:id       — update route
 * DELETE /api/routes/:id       — delete route
 * PATCH  /api/routes/:id/run   — increment run_count
 */
const express = require('express');
const router = express.Router();
const Route = require('../models/Route');
const authenticate = require('../middleware/authenticate');
const idempotency = require('../middleware/idempotency');
const { isClientWriteable, PERMISSION } = require('../constants/permission');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

router.use(authenticate);

// ── POST /api/routes ────────────────────────────────────────────────────────
router.post('/', validateBody(schemas.route.create), idempotency, async (req, res) => {
  const {
    name, description, points, waypoints, distance_m, elevation_gain_m, permission,
    client_route_id, source_activity_client_id, source_session_id, origin_gap_reconnected,
  } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: 'points must be a non-empty array.' });
  }
  // v4 H1: routes also reject permission='public' on client writes.
  // The Route model currently ignores permission entirely (default 'personal'
  // applied by the DB column default), but we still reject explicit 'public'
  // requests so contract tests pass and future Route.create extension stays
  // correct. 'friend' and 'personal' are accepted but currently no-op until
  // Route.create is taught about permission in a follow-up Story.
  if (permission !== undefined) {
    if (permission === PERMISSION.PUBLIC) {
      return res.status(400).json({
        error: "permission='public' is not allowed for client writes",
      });
    }
    if (!isClientWriteable(permission)) {
      return res.status(400).json({ error: 'Invalid permission' });
    }
  }

  try {
    const id = await Route.create({
      userId: req.user.userId,
      name: name.trim(),
      description: description ?? null,
      points,
      waypoints: waypoints ?? [],
      distanceM: distance_m ?? 0,
      elevationGainM: elevation_gain_m ?? 0,
      permission, // already validated above; Route.create defaults undefined → 'personal'
      clientRouteId: client_route_id,
      sourceActivityClientId: source_activity_client_id,
      sourceSessionId: source_session_id,
      originGapReconnected: origin_gap_reconnected,
    });
    const route = await Route.findByIdAndUser(id, req.user.userId);
    return res.status(201).json({ route });
  } catch (err) {
    if (err.code === 'SOURCE_ACTIVITY_NOT_FOUND' || err.code === 'SOURCE_ACTIVITY_NOT_READY') {
      return res.status(409).json({
        error: 'Source Activity has not completed syncing.',
        code: err.code,
      });
    }
    if (err.code === 'SOURCE_ACTIVITY_DELETED') {
      return res.status(410).json({ error: 'Source Activity no longer exists.', code: err.code });
    }
    if (err.code === 'SOURCE_ACTIVITY_UNAUTHORIZED') {
      return res.status(403).json({ error: 'Source Activity is not available to this account.', code: err.code });
    }
    if (err.code === 'ROUTE_TOMBSTONED') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error('[routes/create]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// Stable client identity lets a durable local delete win over an in-flight or
// response-lost create without relying on a transient server id.
router.delete('/client/:clientRouteId', async (req, res) => {
  const clientRouteId = String(req.params.clientRouteId || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientRouteId)) {
    return res.status(400).json({ error: 'Invalid client Route ID.' });
  }
  try {
    const deleted = await Route.deleteByClientId(clientRouteId, req.user.userId);
    return res.json({
      ok: true,
      deleted: deleted > 0,
      code: deleted > 0 ? 'ROUTE_DELETED' : 'ROUTE_ALREADY_ABSENT',
      client_route_id: clientRouteId,
    });
  } catch (err) {
    console.error('[routes/delete-client]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/routes ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const routes = await Route.findByUser(req.user.userId);
    return res.json({ routes });
  } catch (err) {
    console.error('[routes/list]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/routes/:id ─────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid route ID.' });

  try {
    const route = await Route.findByIdAndUser(id, req.user.userId);
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    return res.json({ route });
  } catch (err) {
    console.error('[routes/get]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PUT /api/routes/:id ─────────────────────────────────────────────────────
router.put('/:id', validateBody(schemas.route.update), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid route ID.' });

  const { name, description, points, waypoints, distance_m, elevation_gain_m, permission } = req.body;

  // v4 H1: client cannot set permission='public'. See POST handler for context.
  if (permission !== undefined) {
    if (permission === PERMISSION.PUBLIC) {
      return res.status(400).json({
        error: "permission='public' is not allowed for client writes",
      });
    }
    if (!isClientWriteable(permission)) {
      return res.status(400).json({ error: 'Invalid permission' });
    }
  }

  try {
    const affected = await Route.update(id, req.user.userId, {
      name,
      description,
      points,
      waypoints,
      distanceM: distance_m,
      elevationGainM: elevation_gain_m,
      permission, // already validated; Route.update ignores undefined
    });
    if (affected === 0) return res.status(404).json({ error: 'Route not found.' });

    const route = await Route.findByIdAndUser(id, req.user.userId);
    return res.json({ route });
  } catch (err) {
    console.error('[routes/update]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/routes/:id ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid route ID.' });

  try {
    const affected = await Route.delete(id, req.user.userId);
    if (affected === 0) {
      return res.status(404).json({
        error: 'Route not found.',
        code: 'ROUTE_NOT_FOUND',
        route_id: id,
      });
    }
    return res.json({ message: 'Route deleted.', code: 'ROUTE_DELETED', route_id: id });
  } catch (err) {
    console.error('[routes/delete]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/routes/:id/run ───────────────────────────────────────────────
router.patch('/:id/run', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid route ID.' });

  try {
    const affected = await Route.incrementRunCount(id, req.user.userId);
    if (affected === 0) return res.status(404).json({ error: 'Route not found.' });
    return res.json({ message: 'Run count updated.' });
  } catch (err) {
    console.error('[routes/run]', err.message);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
