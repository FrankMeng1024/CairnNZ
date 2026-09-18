'use strict';

const crypto = require('crypto');

const CELL_SIZE_M = 200;
const MASK_RADIUS_M = 250;
const EARTH_RADIUS_M = 6378137;
const GROUND_EARTH_RADIUS_M = 6371008.8;
// Cell edges are at most 200 EPSG:3857 metres. Across the NZ latitude
// range, a local tangent-plane distance over a cell plus a 250 m mask has
// sub-metre spherical approximation error. This explicit margin makes the
// privacy predicate conservative at the numerical boundary.
const MASK_DISTANCE_TOLERANCE_M = 1;

function toMercator(lat, lng) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  return {
    x: EARTH_RADIUS_M * Number(lng) * Math.PI / 180,
    y: EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + clampedLat * Math.PI / 360)),
  };
}

function fromMercator(x, y) {
  return {
    lng: x / EARTH_RADIUS_M * 180 / Math.PI,
    lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI,
  };
}

function cellFor(lat, lng) {
  const p = toMercator(lat, lng);
  const x = Math.floor(p.x / CELL_SIZE_M);
  const y = Math.floor(p.y / CELL_SIZE_M);
  return { id: `${x}:${y}`, x, y };
}

function cellPolygon(cell) {
  const minX = cell.x * CELL_SIZE_M;
  const minY = cell.y * CELL_SIZE_M;
  const maxX = minX + CELL_SIZE_M;
  const maxY = minY + CELL_SIZE_M;
  const sw = fromMercator(minX, minY);
  const se = fromMercator(maxX, minY);
  const ne = fromMercator(maxX, maxY);
  const nw = fromMercator(minX, maxY);
  return [[sw.lng, sw.lat], [se.lng, se.lat], [ne.lng, ne.lat], [nw.lng, nw.lat], [sw.lng, sw.lat]];
}

function normalizedLongitudeDeltaDegrees(lng, originLng) {
  return ((Number(lng) - Number(originLng) + 540) % 360) - 180;
}

/**
 * Minimum ground distance from a point to the cell's geographic rectangle.
 *
 * The grid itself remains EPSG:3857 for stable cell identities. Privacy is
 * different: its promised radius is a ground distance. Each small cell is
 * projected into a local tangent plane centred on the protected point, with
 * wrapped longitude deltas for the antimeridian. We compare the closest point
 * on that rectangle using spherical ground metres, never Mercator metres.
 */
function minimumGroundDistanceToCellMeters(cell, point) {
  const ring = cellPolygon(cell).slice(0, 4);
  const latitudes = ring.map(coordinate => Number(coordinate[1]));
  const longitudeDeltas = ring.map(coordinate => normalizedLongitudeDeltaDegrees(coordinate[0], point.lng));
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLngDelta = Math.min(...longitudeDeltas);
  const maxLngDelta = Math.max(...longitudeDeltas);
  const closestLat = Math.max(minLat, Math.min(maxLat, Number(point.lat)));
  const closestLngDelta = Math.max(minLngDelta, Math.min(maxLngDelta, 0));
  const radians = Math.PI / 180;
  const northM = (closestLat - Number(point.lat)) * radians * GROUND_EARTH_RADIUS_M;
  const eastM = closestLngDelta * radians * GROUND_EARTH_RADIUS_M
    * Math.cos(Number(point.lat) * radians);
  return Math.hypot(eastM, northM);
}

function cellIntersectsMask(cell, mask) {
  const radiusM = Math.max(MASK_RADIUS_M, Number(mask.radius_m || 0));
  return minimumGroundDistanceToCellMeters(cell, mask) <= radiusM + MASK_DISTANCE_TOLERANCE_M;
}

async function deriveFriendProjection(db, ownerId, viewerId, grant) {
  const [rows] = await db.execute(
    `SELECT mp.id, mp.lat, mp.lng, mp.ts, mp.source_activity_client_id,
            s.id AS session_id
       FROM memory_points mp
       JOIN sessions s
         ON s.user_id = mp.user_id
        AND s.client_activity_id = mp.source_activity_client_id
        AND s.finalized_at IS NOT NULL
        AND s.abandoned_at IS NULL
      WHERE mp.user_id = ?
        AND mp.evidence_source = 'activity_real'
        AND mp.continuity_state = 'accepted'
        AND mp.horizontal_accuracy_m IS NOT NULL
        AND mp.horizontal_accuracy_m <= 50
        AND FROM_UNIXTIME(mp.ts / 1000) >= GREATEST(?, ?)
      ORDER BY mp.source_activity_client_id ASC, mp.ts ASC, mp.id ASC
      LIMIT 20000`,
    [ownerId, grant.effective_at, grant.friendship_started_at],
  );
  const [privatePlaces] = await db.execute(
    `SELECT lat, lng, GREATEST(radius_m, 250) AS radius_m, version
       FROM memory_private_places
      WHERE owner_id = ? AND active = 1
      ORDER BY id ASC`,
    [ownerId],
  );

  const endpoints = [];
  const byActivity = new Map();
  for (const row of rows) {
    const key = row.source_activity_client_id;
    const entry = byActivity.get(key);
    if (!entry) byActivity.set(key, { first: row, last: row });
    else entry.last = row;
  }
  for (const entry of byActivity.values()) {
    endpoints.push({ lat: Number(entry.first.lat), lng: Number(entry.first.lng), radius_m: MASK_RADIUS_M });
    endpoints.push({ lat: Number(entry.last.lat), lng: Number(entry.last.lng), radius_m: MASK_RADIUS_M });
  }
  const masks = [...endpoints, ...privatePlaces.map(place => ({
    lat: Number(place.lat), lng: Number(place.lng), radius_m: Math.max(MASK_RADIUS_M, Number(place.radius_m)),
  }))];

  const cells = new Map();
  for (const row of rows) {
    const cell = cellFor(row.lat, row.lng);
    if (!cells.has(cell.id)) cells.set(cell.id, cell);
  }
  for (const [cellId, cell] of cells) {
    if (masks.some(mask => cellIntersectsMask(cell, mask))) cells.delete(cellId);
  }
  const sortedCells = [...cells.values()].sort((a, b) => a.id.localeCompare(b.id));
  const versionMaterial = JSON.stringify({
    grant: grant.grant_epoch,
    authorization: Number(grant.authorization_version),
    policy: Number(grant.policy_epoch),
    cells: sortedCells.map(cell => cell.id),
    private: privatePlaces.map(place => Number(place.version)),
  });
  const projectionVersion = crypto.createHash('sha256').update(versionMaterial).digest('hex');
  return {
    source_friend_id: String(ownerId),
    authorization_version: Number(grant.authorization_version),
    projection_version: projectionVersion,
    // Kept for older clients. This is the EPSG:3857 grid interval, not a
    // claim that every returned cell edge spans 200 ground metres.
    cell_size_m: CELL_SIZE_M,
    cell_size_basis: 'EPSG:3857_projected_grid',
    grid_cell_size_mercator_m: CELL_SIZE_M,
    mask_radius_ground_m: MASK_RADIUS_M,
    mask_distance_tolerance_m: MASK_DISTANCE_TOLERANCE_M,
    mask_distance_model: 'local_tangent_ground_distance',
    cells: sortedCells.map(cell => ({
      id: cell.id,
      polygon: cellPolygon(cell),
    })),
  };
}

module.exports = {
  CELL_SIZE_M,
  MASK_RADIUS_M,
  MASK_DISTANCE_TOLERANCE_M,
  cellFor,
  cellPolygon,
  minimumGroundDistanceToCellMeters,
  cellIntersectsMask,
  deriveFriendProjection,
};
