'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CELL_SIZE_M,
  MASK_RADIUS_M,
  MASK_DISTANCE_TOLERANCE_M,
  cellFor,
  cellPolygon,
  cellIntersectsMask,
  deriveFriendProjection,
} = require('../friendProjection');

const TEST_EARTH_RADIUS_M = 6371008.8;

// Independent spherical oracle used only by the test. It deliberately does
// not reuse friendProjection's coordinate helpers.
function haversineMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians((((b.lng - a.lng) + 540) % 360) - 180);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * TEST_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pointDueEast(origin, metres) {
  return {
    lat: origin.lat,
    lng: origin.lng + metres / (TEST_EARTH_RADIUS_M * Math.cos(origin.lat * Math.PI / 180)) * 180 / Math.PI,
  };
}

function pointAtBearing(origin, metres, bearingDegrees) {
  const radians = value => value * Math.PI / 180;
  const degrees = value => value * 180 / Math.PI;
  const angular = metres / TEST_EARTH_RADIUS_M;
  const bearing = radians(bearingDegrees);
  const lat1 = radians(origin.lat);
  const lng1 = radians(origin.lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular)
      + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
    Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
  );
  return { lat: degrees(lat2), lng: ((degrees(lng2) + 540) % 360) - 180 };
}

test('projection cells are fixed coarse polygons and a 250 m mask removes intersecting cells', () => {
  assert.equal(CELL_SIZE_M, 200);
  assert.equal(MASK_RADIUS_M, 250);
  const cell = cellFor(-41.2865, 174.7762);
  const polygon = cellPolygon(cell);
  assert.equal(polygon.length, 5);
  assert.deepEqual(polygon[0], polygon[4]);
  assert.equal(cellIntersectsMask(cell, { lat: -41.2865, lng: 174.7762, radius_m: 250 }), true);
  assert.equal(cellIntersectsMask(cell, { lat: -41.0, lng: 174.0, radius_m: 250 }), false);
});

test('privacy mask radius is ground distance at representative NZ latitudes', () => {
  for (const lat of [-35, -41, -45, -47]) {
    const cell = cellFor(lat, 174.75);
    const ring = cellPolygon(cell);
    const eastEdge = {
      lng: Math.max(...ring.slice(0, 4).map(coordinate => coordinate[0])),
      lat: (ring[1][1] + ring[2][1]) / 2,
    };
    const inside = pointDueEast(eastEdge, 249);
    const onBoundary = pointDueEast(eastEdge, 250);
    const outside = pointDueEast(eastEdge, 252);
    assert.ok(haversineMeters(eastEdge, inside) > 248.5);
    assert.ok(haversineMeters(eastEdge, inside) < 249.5);
    assert.equal(cellIntersectsMask(cell, { ...inside, radius_m: 250 }), true, `inside at ${lat}`);
    assert.equal(cellIntersectsMask(cell, { ...onBoundary, radius_m: 250 }), true, `on boundary at ${lat}`);
    assert.equal(cellIntersectsMask(cell, { ...outside, radius_m: 250 }), false, `outside at ${lat}`);
  }
});

test('privacy predicate measures nearest cell corner rather than only centre or edges', () => {
  const cell = cellFor(-45, 170.5);
  const ring = cellPolygon(cell);
  const southWest = { lng: ring[0][0], lat: ring[0][1] };
  const justInside = pointAtBearing(southWest, 249, 225);
  const justOutside = pointAtBearing(southWest, 252, 225);
  assert.ok(haversineMeters(southWest, justInside) > 248.5);
  assert.equal(cellIntersectsMask(cell, { ...justInside, radius_m: 250 }), true);
  assert.equal(cellIntersectsMask(cell, { ...justOutside, radius_m: 250 }), false);
});

test('privacy mask handles an NZ-adjacent antimeridian wrap conservatively', () => {
  const cell = cellFor(-47, 179.999);
  const ring = cellPolygon(cell);
  const eastEdge = {
    lng: Math.max(...ring.slice(0, 4).map(coordinate => coordinate[0])),
    lat: (ring[1][1] + ring[2][1]) / 2,
  };
  const wrappedMask = { lat: eastEdge.lat, lng: -179.999, radius_m: 250 };
  assert.ok(haversineMeters(eastEdge, wrappedMask) < 250);
  assert.equal(cellIntersectsMask(cell, wrappedMask), true);
});

test('server projection excludes whole endpoint/private cells and emits no source rows', async () => {
  const rows = [
    { id: 1, lat: -41.2865, lng: 174.7762, ts: 1000, source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 2, lat: -41.2865, lng: 174.7830, ts: 2000, source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 3, lat: -41.2865, lng: 174.7900, ts: 3000, source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 4, lat: -41.2865, lng: 174.7970, ts: 4000, source_activity_client_id: 'activity-a', session_id: 9 },
  ];
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM memory_points')) return [rows];
      if (sql.includes('FROM memory_private_places')) {
        return [[{ lat: -41.2865, lng: 174.7900, radius_m: 250, version: 4 }]];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const projection = await deriveFriendProjection(db, 7, 8, {
    grant_epoch: 'grant-a',
    authorization_version: 3,
    policy_epoch: 2,
    effective_at: '2026-09-17T00:00:00.000Z',
    friendship_started_at: '2026-09-16T00:00:00.000Z',
  });
  assert.equal(projection.source_friend_id, '7');
  assert.equal(projection.cell_size_m, 200);
  assert.equal(projection.grid_cell_size_mercator_m, 200);
  assert.equal(projection.cell_size_basis, 'EPSG:3857_projected_grid');
  assert.equal(projection.mask_radius_ground_m, 250);
  assert.equal(projection.mask_distance_tolerance_m, MASK_DISTANCE_TOLERANCE_M);
  assert.equal(projection.mask_distance_model, 'local_tangent_ground_distance');
  assert.equal(projection.authorization_version, 3);
  assert.match(projection.projection_version, /^[0-9a-f]{64}$/);
  assert.ok(projection.cells.length < new Set(rows.map(row => cellFor(row.lat, row.lng).id)).size);
  assert.equal(JSON.stringify(projection).includes('source_activity_client_id'), false);
  assert.equal(JSON.stringify(projection).includes('ts'), false);
  assert.match(calls[0].sql, /evidence_source = 'activity_real'/);
  assert.match(calls[0].sql, /finalized_at IS NOT NULL/);
  assert.match(calls[0].sql, /horizontal_accuracy_m <= 50/);
});

test('friendship active uniqueness does not derive a generated column from cascading FK inputs', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../migrations/037_personal_friends_v1.sql'),
    'utf8',
  );
  assert.match(migration, /active_pair_slot TINYINT[\s\S]*CASE WHEN ended_at IS NULL THEN 1 ELSE NULL END/);
  assert.match(migration, /uk_friendship_active_pair \(user_low_id, user_high_id, active_pair_slot\)/);
  assert.doesNotMatch(migration, /GENERATED[\s\S]{0,160}CONCAT\(user_low_id/);
  assert.match(
    migration,
    /source_activity_client_id CHAR\(36\) CHARACTER SET utf8mb4\s+COLLATE utf8mb4_unicode_ci/,
  );
});
