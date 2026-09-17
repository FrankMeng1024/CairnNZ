'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CELL_SIZE_M,
  MASK_RADIUS_M,
  cellFor,
  cellPolygon,
  cellIntersectsMask,
  deriveFriendProjection,
} = require('../friendProjection');

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
