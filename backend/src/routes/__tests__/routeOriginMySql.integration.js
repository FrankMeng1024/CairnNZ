'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const enabled = process.env.CAIRN_MYSQL_INTEGRATION === '1';
const dbName = process.env.DB_NAME || '';
if (enabled && !/^cairn_route_rev02_[a-z0-9_]+$/.test(dbName)) {
  throw new Error(`refusing Route MySQL integration against non-disposable DB_NAME=${dbName}`);
}

const dbPath = path.resolve(__dirname, '../../config/db.js');
const modelPath = path.resolve(__dirname, '../../models/Route.js');
const routerPath = path.resolve(__dirname, '../routes.js');
const authPath = path.resolve(__dirname, '../../middleware/authenticate.js');
const idempotencyPath = path.resolve(__dirname, '../../middleware/idempotency.js');

function points(offset = 0) {
  return [
    { lat: -45 + offset, lng: 168, alt: 100 },
    { lat: -45.001 + offset, lng: 168.001, alt: 110 },
  ];
}

function connectionConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
    multipleStatements: true,
  };
}

async function closeModelPool() {
  const cached = require.cache[dbPath]?.exports;
  if (cached?.end) await cached.end();
  delete require.cache[modelPath];
  delete require.cache[dbPath];
}

function loadModel() {
  delete require.cache[modelPath];
  return require(modelPath);
}

async function startApi(userId) {
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: (req, _res, next) => { req.user = { userId }; next(); },
  };
  require.cache[idempotencyPath] = {
    id: idempotencyPath,
    filename: idempotencyPath,
    loaded: true,
    exports: (_req, _res, next) => next(),
  };
  delete require.cache[routerPath];
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/routes', require(routerPath));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}/api/routes`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('migration 036 and Route origin/delete transactions survive real MySQL round trips', {
  skip: !enabled,
}, async (t) => {
  const direct = await mysql.createConnection(connectionConfig());
  t.after(async () => {
    try { await direct.end(); } catch {}
    try { await closeModelPool(); } catch {}
  });

  const [[serverInfo]] = await direct.query(
    'SELECT VERSION() AS version, DATABASE() AS database_name, @@hostname AS hostname',
  );
  assert.equal(serverInfo.database_name, dbName);

  await direct.query(
    `INSERT INTO users (id, name, email, password_hash) VALUES
      (7, 'Route Owner', 'route-owner@example.invalid', 'test-only'),
      (8, 'Other Owner', 'other-owner@example.invalid', 'test-only')`,
  );
  await direct.query(
    `INSERT INTO sessions
      (id, user_id, client_activity_id, type, start_time, end_time, finalized_at,
       distance_m, duration_s, route_points)
     VALUES
      (72, 7, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hiking', NOW(), NOW(), NOW(), 140, 60, CAST(? AS JSON)),
      (73, 7, 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'hiking', NOW(), NOW(), NULL, 0, 0, CAST(? AS JSON)),
      (74, 8, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'hiking', NOW(), NOW(), NOW(), 140, 60, CAST(? AS JSON))`,
    [JSON.stringify(points()), JSON.stringify([]), JSON.stringify(points(0.01))],
  );

  let Route = loadModel();
  const sourceClientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const clientRouteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const g0 = points();
  const routeId = await Route.create({
    userId: 7,
    clientRouteId,
    name: 'Activity Route',
    points: g0,
    waypoints: [],
    distanceM: 140,
    elevationGainM: 10,
    sourceActivityClientId: sourceClientId,
    originGapReconnected: true,
  });

  // Close the model pool and create a fresh model/pool context before reload.
  await closeModelPool();
  Route = loadModel();
  const firstReload = await Route.findByIdAndUser(routeId, 7);
  assert.equal(firstReload.client_route_id, clientRouteId);
  assert.equal(firstReload.creation_origin, 'activity');
  assert.equal(firstReload.source_activity_client_id, sourceClientId);
  assert.equal(firstReload.source_session_id, 72);
  assert.equal(firstReload.origin_gap_reconnected, 1);
  assert.equal(firstReload.geometry_edited_since_creation, 0);
  assert.equal(firstReload.origin_geometry_hash, firstReload.created_geometry_hash);

  const g1 = points(0.002);
  await Route.update(routeId, 7, {
    name: 'Edited Route',
    points: g1,
    distanceM: 240,
    sourceActivityClientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });
  await closeModelPool();
  Route = loadModel();
  const editedReload = await Route.findByIdAndUser(routeId, 7);
  assert.equal(editedReload.name, 'Edited Route');
  assert.deepEqual(editedReload.points, g1);
  assert.equal(editedReload.source_activity_client_id, sourceClientId);
  assert.equal(editedReload.origin_geometry_hash, firstReload.origin_geometry_hash);
  assert.equal(editedReload.created_geometry_hash, firstReload.created_geometry_hash);
  assert.equal(editedReload.geometry_edited_since_creation, 1);

  await assert.rejects(Route.create({
    userId: 8,
    clientRouteId: '11111111-1111-4111-8111-111111111111',
    name: 'Unauthorized', points: g0, waypoints: [],
    sourceActivityClientId: sourceClientId,
  }), error => error.code === 'SOURCE_ACTIVITY_UNAUTHORIZED');
  await assert.rejects(Route.create({
    userId: 7,
    clientRouteId: '22222222-2222-4222-8222-222222222222',
    name: 'Not finalized', points: g0, waypoints: [],
    sourceActivityClientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  }), error => error.code === 'SOURCE_ACTIVITY_NOT_READY');

  // Same-owner replay converges to one row; the same client id is valid for a
  // different owner because uniqueness is owner-scoped.
  const replayId = await Route.create({
    userId: 7, clientRouteId, name: 'Replay', points: g1, waypoints: [],
  });
  assert.equal(replayId, routeId);
  const otherOwnerId = await Route.create({
    userId: 8, clientRouteId, name: 'Other owner Route', points: points(0.01), waypoints: [],
  });
  assert.notEqual(otherOwnerId, routeId);
  const [[identityCount]] = await direct.query(
    'SELECT COUNT(*) AS count FROM routes WHERE client_route_id = ?', [clientRouteId],
  );
  assert.equal(identityCount.count, 2);

  // Actual ON DELETE SET NULL behavior: the Route and historical origin fact
  // survive while the dead navigable session link is removed.
  await direct.execute('DELETE FROM sessions WHERE id = 72 AND user_id = 7');
  const afterSourceDelete = await Route.findByIdAndUser(routeId, 7);
  assert.equal(afterSourceDelete.source_session_id, null);
  assert.equal(afterSourceDelete.creation_origin, 'activity');
  assert.equal(afterSourceDelete.source_activity_client_id, sourceClientId);

  // Force an error after tombstone insertion but before delete completion.
  const rollbackClientId = '33333333-3333-4333-8333-333333333333';
  const rollbackRouteId = await Route.create({
    userId: 7, clientRouteId: rollbackClientId, name: 'Rollback route', points: g0, waypoints: [],
  });
  await direct.query(
    `CREATE TRIGGER route_rev02_force_delete_failure BEFORE DELETE ON routes
     FOR EACH ROW BEGIN
       IF OLD.client_route_id = '${rollbackClientId}' THEN
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced delete failure';
       END IF;
     END`,
  );
  await assert.rejects(Route.deleteByClientId(rollbackClientId, 7), /forced delete failure/);
  const [[rollbackRows]] = await direct.query(
    'SELECT COUNT(*) AS route_count FROM routes WHERE id = ?', [rollbackRouteId],
  );
  const [[rollbackTombstones]] = await direct.query(
    'SELECT COUNT(*) AS tombstone_count FROM route_client_tombstones WHERE user_id = 7 AND client_route_id = ?',
    [rollbackClientId],
  );
  assert.equal(rollbackRows.route_count, 1);
  assert.equal(rollbackTombstones.tombstone_count, 0);
  await direct.query('DROP TRIGGER route_rev02_force_delete_failure');

  // Bounded create/delete race using a separate real connection. Holding the
  // owner row lets deletion intent commit before the model's create proceeds.
  const raceClientId = '44444444-4444-4444-8444-444444444444';
  const raceConn = await mysql.createConnection(connectionConfig());
  await raceConn.beginTransaction();
  await raceConn.execute('SELECT id FROM users WHERE id = 7 FOR UPDATE');
  const lateCreate = Route.create({
    userId: 7, clientRouteId: raceClientId, name: 'Late create', points: g0, waypoints: [],
  });
  await new Promise(resolve => setTimeout(resolve, 75));
  await raceConn.execute(
    'INSERT INTO route_client_tombstones (user_id, client_route_id) VALUES (7, ?)',
    [raceClientId],
  );
  await raceConn.commit();
  await raceConn.end();
  await assert.rejects(lateCreate, error => error.code === 'ROUTE_TOMBSTONED');
  const [[raceRows]] = await direct.query(
    'SELECT COUNT(*) AS count FROM routes WHERE user_id = 7 AND client_route_id = ?', [raceClientId],
  );
  assert.equal(raceRows.count, 0);

  // Actual HTTP handlers, with authentication/idempotency boundaries replaced
  // only by deterministic local test middleware.
  const api = await startApi(7);
  try {
    const apiClientId = '55555555-5555-4555-8555-555555555555';
    const createdResponse = await fetch(api.base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'API Route', points: g0, client_route_id: apiClientId }),
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).route;
    assert.equal(created.client_route_id, apiClientId);

    const detailResponse = await fetch(`${api.base}/${created.id}`);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).route.creation_origin, 'manual');

    const updateResponse = await fetch(`${api.base}/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'API Route edited', points: g1 }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).route.geometry_edited_since_creation, 1);

    const deleteResponse = await fetch(`${api.base}/client/${apiClientId}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(await deleteResponse.json(), {
      ok: true, deleted: true, code: 'ROUTE_DELETED', client_route_id: apiClientId,
    });
    const replayDelete = await fetch(`${api.base}/client/${apiClientId}`, { method: 'DELETE' });
    assert.equal(replayDelete.status, 200);
    assert.deepEqual(await replayDelete.json(), {
      ok: true, deleted: false, code: 'ROUTE_ALREADY_ABSENT', client_route_id: apiClientId,
    });
    const numericMissing = await fetch(`${api.base}/${created.id}`, { method: 'DELETE' });
    assert.equal(numericMissing.status, 404);
    assert.deepEqual(await numericMissing.json(), {
      error: 'Route not found.', code: 'ROUTE_NOT_FOUND', route_id: created.id,
    });

    await assert.rejects(Route.create({
      userId: 7, clientRouteId: apiClientId, name: 'Replay after delete', points: g0, waypoints: [],
    }), error => error.code === 'ROUTE_TOMBSTONED');
  } finally {
    await api.close();
  }

  t.diagnostic(JSON.stringify({
    engine: serverInfo.version,
    database: serverInfo.database_name,
    host: serverInfo.hostname,
    assertions: {
      model_reload: 'PASS',
      immutable_origin: 'PASS',
      owner_and_finalized_source: 'PASS',
      source_delete_fk: 'PASS',
      owner_scoped_uniqueness: 'PASS',
      replay_convergence: 'PASS',
      transaction_rollback: 'PASS',
      create_delete_race: 'PASS',
      api_handlers: 'PASS',
    },
  }));
});
