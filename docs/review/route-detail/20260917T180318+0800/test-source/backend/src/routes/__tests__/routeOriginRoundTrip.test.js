'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modelPath = path.resolve(__dirname, '../../models/Route.js');
const dbPath = path.resolve(__dirname, '../../config/db.js');

function createMemoryPool() {
  const state = {
    nextId: 1,
    sessions: [{
      id: 72,
      user_id: 7,
      client_activity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      finalized_at: '2026-09-17T00:00:00.000Z',
      route_points: [{ lat: -45, lng: 168, alt: 100 }, { lat: -45.001, lng: 168.001, alt: 110 }],
    }, {
      id: 73,
      user_id: 7,
      client_activity_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      finalized_at: null,
      route_points: [],
    }],
    routes: [],
    tombstones: new Set(),
    activityTombstones: new Set(['99999999-9999-4999-8999-999999999999']),
  };

  async function execute(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT id FROM users')) return [[{ id: params[0] }]];
    if (compact.startsWith('SELECT client_route_id FROM route_client_tombstones')) {
      return [[state.tombstones.has(`${params[0]}:${params[1]}`) ? { client_route_id: params[1] } : undefined].filter(Boolean)];
    }
    if (compact.startsWith('SELECT client_activity_id FROM activity_client_tombstones')) {
      return [[state.activityTombstones.has(params[1]) ? { client_activity_id: params[1] } : undefined].filter(Boolean)];
    }
    if (compact.startsWith('SELECT id, client_activity_id, route_points FROM sessions')) {
      const byClient = compact.includes('client_activity_id = ?');
      const found = state.sessions.find(row => row.user_id === params[0]
        && (byClient ? row.client_activity_id === params[1] : row.id === params[1])
        && row.finalized_at);
      return [[found].filter(Boolean)];
    }
    if (compact.startsWith('SELECT user_id, finalized_at FROM sessions')) {
      const byClient = compact.includes('client_activity_id = ?');
      const found = state.sessions.find(row => byClient
        ? row.client_activity_id === params[0]
        : row.id === params[0]);
      return [[found].filter(Boolean)];
    }
    if (compact.startsWith('SELECT id, created_geometry_hash FROM routes')) {
      const found = state.routes.find(row => row.user_id === params[0] && row.client_route_id === params[1]);
      return [[found].filter(Boolean)];
    }
    if (compact.startsWith('INSERT INTO routes')) {
      const [user_id, client_route_id, creation_origin, source_activity_client_id,
        source_session_id, origin_geometry_hash, created_geometry_hash,
        origin_gap_reconnected, name, description, points, waypoints,
        distance_m, elevation_gain_m, permission] = params;
      const row = {
        id: state.nextId++, user_id, client_route_id, creation_origin,
        source_activity_client_id, source_session_id, origin_geometry_hash,
        created_geometry_hash, geometry_edited_since_creation: 0,
        origin_gap_reconnected, name, description, points: JSON.parse(points),
        waypoints: JSON.parse(waypoints), distance_m, elevation_gain_m, permission,
        run_count: 0, last_run_at: null,
        created_at: '2026-09-17T00:01:00.000Z', updated_at: '2026-09-17T00:01:00.000Z',
      };
      state.routes.push(row);
      return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (compact.startsWith('UPDATE routes SET name = ?')) {
      const id = params[params.length - 2];
      const userId = params[params.length - 1];
      const row = state.routes.find(item => item.id === id && item.user_id === userId);
      if (!row) return [{ affectedRows: 0 }];
      [row.name, row.description] = params;
      row.points = JSON.parse(params[2]);
      row.waypoints = JSON.parse(params[3]);
      row.distance_m = params[4];
      row.elevation_gain_m = params[5];
      row.permission = params[6];
      row.geometry_edited_since_creation = Math.max(row.geometry_edited_since_creation, params[7]);
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith('UPDATE routes SET points = ?')) {
      const [points, hash, id, userId] = params;
      const row = state.routes.find(item => item.id === id && item.user_id === userId);
      if (!row) return [{ affectedRows: 0 }];
      row.points = JSON.parse(points);
      if (!row.created_geometry_hash || row.created_geometry_hash !== hash) row.geometry_edited_since_creation = 1;
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith('SELECT id, user_id, client_route_id') && compact.includes('WHERE id = ?')) {
      const found = state.routes.find(row => row.id === Number(params[0]) && row.user_id === params[1]);
      return [[found ? { ...found } : undefined].filter(Boolean)];
    }
    if (compact.startsWith('INSERT INTO route_client_tombstones')) {
      state.tombstones.add(`${params[0]}:${params[1]}`);
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith('DELETE FROM routes WHERE user_id')) {
      const before = state.routes.length;
      state.routes = state.routes.filter(row => !(row.user_id === params[0] && row.client_route_id === params[1]));
      return [{ affectedRows: before - state.routes.length }];
    }
    throw new Error(`Unhandled SQL in memory Route DB: ${compact}`);
  }

  const connection = {
    execute,
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  };
  return { state, execute, getConnection: async () => connection };
}

function loadRouteWithPool(pool) {
  delete require.cache[modelPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  return require(modelPath);
}

test('Activity origin and edit evidence survive create, reload, edit, and source deletion', async () => {
  const pool = createMemoryPool();
  const Route = loadRouteWithPool(pool);
  const sourceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientRouteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const original = [{ lat: -45, lng: 168, alt: 100 }, { lat: -45.001, lng: 168.001, alt: 110 }];

  const id = await Route.create({
    userId: 7, clientRouteId, name: 'Activity Route', points: original,
    waypoints: [], distanceM: 140, elevationGainM: 10,
    sourceActivityClientId: sourceId,
  });
  const firstReload = await Route.findByIdAndUser(id, 7);
  assert.equal(firstReload.client_route_id, clientRouteId);
  assert.equal(firstReload.creation_origin, 'activity');
  assert.equal(firstReload.source_activity_client_id, sourceId);
  assert.equal(firstReload.source_session_id, 72);
  assert.equal(firstReload.geometry_edited_since_creation, 0);
  assert.equal(firstReload.origin_geometry_hash, firstReload.created_geometry_hash);

  const edited = [{ lat: -45, lng: 168, alt: 100 }, { lat: -45.002, lng: 168.003, alt: 115 }];
  await Route.update(id, 7, {
    points: edited,
    // Ordinary updates cannot rewrite these because Route.update ignores them.
    sourceActivityClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });
  const secondReload = await Route.findByIdAndUser(id, 7);
  assert.deepEqual(secondReload.points, edited);
  assert.equal(secondReload.source_activity_client_id, sourceId);
  assert.equal(secondReload.origin_geometry_hash, firstReload.origin_geometry_hash);
  assert.equal(secondReload.created_geometry_hash, firstReload.created_geometry_hash);
  assert.equal(secondReload.geometry_edited_since_creation, 1);

  // ON DELETE SET NULL removes only the live link; the independent Route and
  // historical Activity-origin fact remain.
  pool.state.sessions = [];
  pool.state.routes[0].source_session_id = null;
  const afterSourceDelete = await Route.findByIdAndUser(id, 7);
  assert.equal(afterSourceDelete.creation_origin, 'activity');
  assert.equal(afterSourceDelete.source_activity_client_id, sourceId);
  assert.equal(afterSourceDelete.source_session_id, null);
});

test('client Route identity converges response-loss retries and tombstones win', async () => {
  const pool = createMemoryPool();
  const Route = loadRouteWithPool(pool);
  const clientRouteId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const first = [{ lat: -45, lng: 168 }, { lat: -45.001, lng: 168.001 }];
  const revised = [{ lat: -45, lng: 168 }, { lat: -45.002, lng: 168.004 }];
  const id1 = await Route.create({ userId: 7, clientRouteId, name: 'First', points: first, waypoints: [] });
  const id2 = await Route.create({ userId: 7, clientRouteId, name: 'Revised', points: revised, waypoints: [] });
  assert.equal(id2, id1);
  assert.equal(pool.state.routes.length, 1);
  assert.equal((await Route.findByIdAndUser(id1, 7)).name, 'Revised');
  assert.equal((await Route.findByIdAndUser(id1, 7)).geometry_edited_since_creation, 1);

  await Route.deleteByClientId(clientRouteId, 7);
  assert.equal(pool.state.routes.length, 0);
  await assert.rejects(
    Route.create({ userId: 7, clientRouteId, name: 'Late create', points: first, waypoints: [] }),
    error => error.code === 'ROUTE_TOMBSTONED',
  );
});

test('source Activity must be finalized and owned by the Route owner', async () => {
  const pool = createMemoryPool();
  const Route = loadRouteWithPool(pool);
  const points = [{ lat: -45, lng: 168 }, { lat: -45.001, lng: 168.001 }];
  await assert.rejects(
    Route.create({
      userId: 8,
      clientRouteId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      name: 'Unauthorized', points, waypoints: [],
      sourceActivityClientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }),
    error => error.code === 'SOURCE_ACTIVITY_UNAUTHORIZED',
  );
  await assert.rejects(
    Route.create({
      userId: 7,
      clientRouteId: '11111111-1111-4111-8111-111111111111',
      name: 'Still uploading', points, waypoints: [],
      sourceActivityClientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }),
    error => error.code === 'SOURCE_ACTIVITY_NOT_READY',
  );
  await assert.rejects(
    Route.create({
      userId: 7,
      clientRouteId: '22222222-2222-4222-8222-222222222222',
      name: 'Temporarily missing', points, waypoints: [],
      sourceActivityClientId: '88888888-8888-4888-8888-888888888888',
    }),
    error => error.code === 'SOURCE_ACTIVITY_NOT_FOUND',
  );
  await assert.rejects(
    Route.create({
      userId: 7,
      clientRouteId: '33333333-3333-4333-8333-333333333333',
      name: 'Deleted source', points, waypoints: [],
      sourceActivityClientId: '99999999-9999-4999-8999-999999999999',
    }),
    error => error.code === 'SOURCE_ACTIVITY_DELETED',
  );
});
