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
//
// v229 fix C2: cap concurrency to MAX_CONCURRENT_BUILDS to prevent
// backend OOM under bursty saves. Each build holds 5-10MB of MVT
// buffers + decoded GeoJSON in flight. 100 concurrent users saving
// would push backend past 600MB+. Cap at 5 — pending builds queue.
const inflight = new Map(); // routeId(string) → Promise
const queue = [];           // [{ routeId, points, resolve, reject }]
let runningCount = 0;
const MAX_CONCURRENT_BUILDS = 5;

async function actualRun(routeId, points) {
  const env = await buildEnvelope({ routeId, routePoints: points });
  await EditEnvelope.upsert(routeId, env);
  return env;
}

function tryDrain() {
  while (runningCount < MAX_CONCURRENT_BUILDS && queue.length > 0) {
    const job = queue.shift();
    runningCount++;
    actualRun(job.routeId, job.points)
      .then(env => job.resolve(env))
      .catch(err => {
        // v230 fix N1: previously `job.resolve(null) && console.error(...)`
        // short-circuited because resolve returns undefined → all build
        // failures were silently swallowed (zero ops visibility into
        // Mapbox token misconfig, fetch errors, decoder crashes).
        // Always log first, then resolve.
        console.error(
          `[edit-envelope:${job.routeId}] build failed:`,
          err && err.message ? err.message : err,
        );
        job.resolve(null);
      })
      .finally(() => {
        runningCount--;
        inflight.delete(String(job.routeId));
        tryDrain();
      });
  }
}

async function runBuild(routeId, points) {
  return new Promise((resolve, reject) => {
    queue.push({ routeId, points, resolve, reject });
    tryDrain();
  });
}

/**
 * Schedule (or join) a build for a route. Returns the in-flight promise.
 */
function enqueueBuild(routeId, points) {
  const key = String(routeId);
  if (inflight.has(key)) return inflight.get(key);
  const p = runBuild(routeId, points).catch(err => {
    console.error(`[edit-envelope:${routeId}] build error`, err && err.message);
    return null;
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
