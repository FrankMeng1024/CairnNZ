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
const editEnvelopeRouter = require('./edit-envelope');

router.use(authenticate);

// Mount edit-envelope subroutes (already authenticated via its own router.use)
router.use('/', editEnvelopeRouter);

// ── POST /api/routes ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, description, points, waypoints, distance_m, elevation_gain_m } = req.body;

  // v120 debug: dump body shape so we can see exactly why JSON.stringify
  // produces "[object Object],[object Object]" in storage.
  console.log('[routes/create] body keys:', Object.keys(req.body));
  console.log('[routes/create] points isArray:', Array.isArray(points), 'len:', points?.length);
  if (Array.isArray(points) && points[0]) {
    console.log('[routes/create] points[0]:', JSON.stringify(points[0]));
    console.log('[routes/create] points[0] type:', typeof points[0]);
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required.' });
  }
  if (!Array.isArray(points) || points.length === 0) {
    return res.status(400).json({ error: 'points must be a non-empty array.' });
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
    });
    const route = await Route.findByIdAndUser(id, req.user.userId);
    // v224: async edit-envelope build (Mapbox MVT junction extraction).
    // Fire-and-forget; client polls GET /:id/edit-envelope which 202s
    // until ready.
    if (route && Array.isArray(route.points) && route.points.length >= 2) {
      try {
        editEnvelopeRouter.enqueueBuild(id, route.points);
      } catch (e) {
        console.warn('[routes/create] envelope enqueue failed:', e.message);
      }
    }
    return res.status(201).json({ route });
  } catch (err) {
    console.error('[routes/create]', err);
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
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return res.status(400).json({ error: 'Invalid route ID.' });

  const { name, description, points, waypoints, distance_m, elevation_gain_m } = req.body;

  try {
    const affected = await Route.update(id, req.user.userId, {
      name,
      description,
      points,
      waypoints,
      distanceM: distance_m,
      elevationGainM: elevation_gain_m,
    });
    if (affected === 0) return res.status(404).json({ error: 'Route not found.' });

    const route = await Route.findByIdAndUser(id, req.user.userId);
    // v224: regenerate envelope when points change.
    if (
      Array.isArray(points) &&
      route &&
      Array.isArray(route.points) &&
      route.points.length >= 2
    ) {
      try {
        editEnvelopeRouter.enqueueBuild(id, route.points);
      } catch (e) {
        console.warn('[routes/update] envelope enqueue failed:', e.message);
      }
    }
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
    if (affected === 0) return res.status(404).json({ error: 'Route not found.' });
    return res.json({ message: 'Route deleted.' });
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
