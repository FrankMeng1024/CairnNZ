'use strict';

const crypto = require('crypto');

const CELL_SIZE_M = 200;
const MASK_RADIUS_M = 250;
const EARTH_RADIUS_M = 6378137;

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

function cellIntersectsMask(cell, mask) {
  const point = toMercator(mask.lat, mask.lng);
  const minX = cell.x * CELL_SIZE_M;
  const minY = cell.y * CELL_SIZE_M;
  const maxX = minX + CELL_SIZE_M;
  const maxY = minY + CELL_SIZE_M;
  const closestX = Math.max(minX, Math.min(maxX, point.x));
  const closestY = Math.max(minY, Math.min(maxY, point.y));
  return Math.hypot(point.x - closestX, point.y - closestY) <= Math.max(MASK_RADIUS_M, Number(mask.radius_m || 0));
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
    cell_size_m: CELL_SIZE_M,
    cells: sortedCells.map(cell => ({
      id: cell.id,
      polygon: cellPolygon(cell),
    })),
  };
}

module.exports = { CELL_SIZE_M, MASK_RADIUS_M, cellFor, cellPolygon, cellIntersectsMask, deriveFriendProjection };
