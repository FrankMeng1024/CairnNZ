/**
 * Edit-envelope HTTP routes — Cairn v224.
 *
 *   GET  /api/routes/:id/edit-envelope        → 200 EditEnvelope | 202 building | 404 unavailable
 *   POST /api/routes/:id/edit-envelope/regenerate → 202 building (admin/owner)
 *
 * Auth: same as /api/routes (bearer + ownership).
 */
const express = require('express');
const router = express.Router();
const Route = require('../models/Route');
const EditEnvelope = require('../models/EditEnvelope');
const { buildEnvelope } = require('../services/mvtEnvelopeBuilder');

// Note: authentication is applied by the parent router (routes.js)

// In-process build queue. v1 — simple keyed promises. Restart-tolerant
// because saves are idempotent and the GET path can re-trigger.
const inflight = new Map(); // routeId(string) → Promise

async function runBuild(routeId, points) {
  const env = await buildEnvelope({ routeId, routePoints: points });
  await EditEnvelope.upsert(routeId, env);
  return env;
}

/**
 * Schedule (or join) a build for a route. Returns the in-flight promise.
 */
function enqueueBuild(routeId, points) {
  const key = String(routeId);
  if (inflight.has(key)) return inflight.get(key);
  const p = runBuild(routeId, points)
    .catch(err => {
      console.error(`[edit-envelope:${routeId}] build failed`, err.message);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

// GET — return the envelope or 202 if a build is in flight.
router.get('/:id/edit-envelope', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid route ID.' });
  }
  try {
    // Verify ownership
    const route = await Route.findByIdAndUser(id, req.user.userId);
    if (!route) return res.status(404).json({ error: 'Route not found.' });

    const env = await EditEnvelope.findByRouteId(id);
    if (env) return res.json({ envelope: env });

    // Not built yet — start one if not in flight, return 202
    const points = Array.isArray(route.points) ? route.points : null;
    if (!points || points.length < 2) {
      return res
        .status(409)
        .json({ error: 'route has fewer than 2 points; cannot build envelope' });
    }
    enqueueBuild(id, points);
    return res.status(202).json({ status: 'building' });
  } catch (err) {
    console.error('[edit-envelope/get]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// POST — force regeneration.
router.post('/:id/edit-envelope/regenerate', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid route ID.' });
  }
  try {
    const route = await Route.findByIdAndUser(id, req.user.userId);
    if (!route) return res.status(404).json({ error: 'Route not found.' });
    const points = Array.isArray(route.points) ? route.points : null;
    if (!points || points.length < 2) {
      return res.status(409).json({ error: 'route has fewer than 2 points' });
    }
    enqueueBuild(id, points);
    return res.status(202).json({ status: 'building' });
  } catch (err) {
    console.error('[edit-envelope/regenerate]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// Hook used by routes.js POST/PUT — exported for in-process trigger.
module.exports = router;
module.exports.enqueueBuild = enqueueBuild;
