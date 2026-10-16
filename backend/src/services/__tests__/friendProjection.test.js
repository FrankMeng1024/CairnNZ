'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CELL_SIZE_M,
  FRIEND_PROJECTION_POLICY_VERSION,
  cellFor,
  cellPolygon,
  deriveFriendProjection,
} = require('../friendProjection');

test('projection cells remain fixed coarse polygons under the full-history policy', () => {
  assert.equal(CELL_SIZE_M, 200);
  assert.equal(FRIEND_PROJECTION_POLICY_VERSION, 2);
  const cell = cellFor(-41.2865, 174.7762);
  const polygon = cellPolygon(cell);
  assert.equal(polygon.length, 5);
  assert.deepEqual(polygon[0], polygon[4]);
});

test('server projection returns every eligible coarse cell and emits no source rows', async () => {
  const rows = [
    { id: 1, lat: -41.2865, lng: 174.7762, ts: 1000, evidence_source: 'activity_real', source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 2, lat: -41.2865, lng: 174.7830, ts: 2000, evidence_source: 'activity_real', source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 3, lat: -41.2865, lng: 174.7900, ts: 3000, evidence_source: 'activity_real', source_activity_client_id: 'activity-a', session_id: 9 },
    { id: 4, lat: -41.2865, lng: 174.7970, ts: 4000, evidence_source: 'activity_real', source_activity_client_id: 'activity-a', session_id: 9 },
  ];
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM memory_points')) return [rows];
      if (sql.includes('FROM JSON_TABLE')) return [[]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const projection = await deriveFriendProjection(db, 7, 8, {
    id: 17,
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
  assert.equal(projection.projection_policy_version, 2);
  assert.equal('mask_radius_ground_m' in projection, false);
  assert.equal(projection.authorization_version, 3);
  assert.match(projection.projection_version, /^[0-9a-f]{64}$/);
  assert.equal(projection.cells.length, new Set(rows.map(row => cellFor(row.lat, row.lng).id)).size);
  assert.equal(JSON.stringify(projection).includes('source_activity_client_id'), false);
  assert.equal(JSON.stringify(projection).includes('ts'), false);
  assert.match(calls[0].sql, /evidence_source = 'activity_real'/);
  assert.match(calls[0].sql, /finalized_at IS NOT NULL/);
  assert.match(calls[0].sql, /horizontal_accuracy_m <= 50/);
  assert.match(calls[0].sql, /FROM memory_presence_witnesses witness/);
  assert.match(calls[0].sql, /witness\.first_observed_at_ms AS ts/);
  assert.match(calls[0].sql, /witness\.observed_at_ms AS ts/);
  assert.match(calls[0].sql, /GREATEST\(FROM_UNIXTIME\(evidence\.ts \/ 1000\), evidence\.received_at\)/);
  assert.match(calls[0].sql, /INTERVAL 1800 SECOND/);
  assert.deepEqual(calls[0].params.slice(0, 4), [7, 7, 7, 7]);
});

test('passive acquisition lifecycles contribute all delayed eligible cells', async () => {
  const rows = [
    { id: 1, lat: -40, lng: 174, ts: 1000, evidence_source: 'passive_real', source_segment_id: 'passive-a' },
    { id: 2, lat: -40, lng: 174.01, ts: 2000, evidence_source: 'passive_real', source_segment_id: 'passive-a' },
    { id: 3, lat: -40, lng: 174.02, ts: 3000, evidence_source: 'passive_real', source_segment_id: 'passive-a' },
    { id: 4, lat: -40.1, lng: 174, ts: 4000, evidence_source: 'passive_real', source_segment_id: 'passive-b' },
    { id: 5, lat: -40.1, lng: 174.01, ts: 5000, evidence_source: 'passive_real', source_segment_id: 'passive-b' },
    { id: 6, lat: -40.1, lng: 174.02, ts: 6000, evidence_source: 'passive_real', source_segment_id: 'passive-b' },
  ];
  const db = {
    async execute(sql) {
      if (sql.includes('FROM memory_points')) return [rows];
      if (sql.includes('FROM JSON_TABLE')) return [[]];
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const projection = await deriveFriendProjection(db, 7, 8, {
    id: 17,
    grant_epoch: 'grant-passive',
    coverage_scope: 'full_history_delayed_v1',
    authorization_version: 1,
    policy_epoch: 0,
  });
  const ids = new Set(projection.cells.map(cell => cell.id));
  assert.equal(ids.size, new Set(rows.map(row => cellFor(row.lat, row.lng).id)).size);
  assert.equal(ids.has(cellFor(-40, 174.01).id), true);
  assert.equal(ids.has(cellFor(-40.1, 174.01).id), true);
  assert.equal(ids.has(cellFor(-40, 174).id), true);
  assert.equal(ids.has(cellFor(-40.1, 174.02).id), true);
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
