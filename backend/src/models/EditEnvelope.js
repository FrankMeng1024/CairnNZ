/**
 * EditEnvelope DB model — Cairn v224.
 *
 * Server-precomputed junction graph cache per route, populated by
 * mvtEnvelopeBuilder at save time. Schema in migration 013.
 *
 * @module models/EditEnvelope
 */
const pool = require('../config/db');

/**
 * Find the envelope row for a route. Returns parsed JSON envelope shape
 * compatible with app/src/services/routing/editEnvelopeTypes.ts.
 */
async function findByRouteId(routeId) {
  const [rows] = await pool.execute(
    `SELECT route_id, version, bbox_west, bbox_south, bbox_east, bbox_north,
            pad_km, source, ways_json, junctions_json, diagnostics,
            generated_at, generator_v
       FROM route_edit_envelopes WHERE route_id = ?`,
    [routeId],
  );
  if (!rows.length) return null;
  const r = rows[0];
  let ways = [];
  let junctions = [];
  let diagnostics = null;
  try {
    ways = JSON.parse(r.ways_json);
  } catch {}
  try {
    junctions = JSON.parse(r.junctions_json);
  } catch {}
  if (r.diagnostics) {
    try {
      diagnostics = JSON.parse(r.diagnostics);
    } catch {}
  }
  return {
    version: r.version,
    routeId: String(r.route_id),
    bbox: {
      west: r.bbox_west,
      south: r.bbox_south,
      east: r.bbox_east,
      north: r.bbox_north,
    },
    padKm: r.pad_km,
    source: r.source,
    generatedAt: Number(r.generated_at),
    generatorV: r.generator_v,
    ways,
    junctions,
    diagnostics,
  };
}

/**
 * Insert or update the envelope for a route. Idempotent.
 */
async function upsert(routeId, env) {
  const waysJson = JSON.stringify(env.ways || []);
  const junctionsJson = JSON.stringify(env.junctions || []);
  const diagnostics = env.diagnostics ? JSON.stringify(env.diagnostics) : null;
  await pool.execute(
    `INSERT INTO route_edit_envelopes
       (route_id, version, bbox_west, bbox_south, bbox_east, bbox_north,
        pad_km, source, ways_json, junctions_json, diagnostics,
        generated_at, generator_v)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       version = VALUES(version),
       bbox_west = VALUES(bbox_west),
       bbox_south = VALUES(bbox_south),
       bbox_east = VALUES(bbox_east),
       bbox_north = VALUES(bbox_north),
       pad_km = VALUES(pad_km),
       source = VALUES(source),
       ways_json = VALUES(ways_json),
       junctions_json = VALUES(junctions_json),
       diagnostics = VALUES(diagnostics),
       generated_at = VALUES(generated_at),
       generator_v = VALUES(generator_v)`,
    [
      routeId,
      env.version || 1,
      env.bbox.west,
      env.bbox.south,
      env.bbox.east,
      env.bbox.north,
      env.padKm,
      env.source,
      waysJson,
      junctionsJson,
      diagnostics,
      env.generatedAt,
      env.generatorV || 1,
    ],
  );
}

async function deleteByRouteId(routeId) {
  await pool.execute(`DELETE FROM route_edit_envelopes WHERE route_id = ?`, [
    routeId,
  ]);
}

module.exports = { findByRouteId, upsert, deleteByRouteId };
