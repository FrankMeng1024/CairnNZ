'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const mysql = require('mysql2/promise');

const enabled = process.env.CAIRN_MYSQL_INTEGRATION === '1';
const dbName = process.env.DB_NAME || '';
if (enabled && !/^cairn_route_rev02_[a-z0-9_]+$/.test(dbName)) {
  throw new Error(`refusing Route MySQL integration against non-disposable DB_NAME=${dbName}`);
}

const sourceRoot = path.resolve(__dirname, '../..');
const modulePaths = [
  path.join(sourceRoot, 'config/db.js'),
  path.join(sourceRoot, 'models/Route.js'),
  path.join(sourceRoot, 'models/TokenBlacklist.js'),
  path.join(sourceRoot, 'middleware/authenticate.js'),
  path.join(sourceRoot, 'middleware/idempotency.js'),
  path.resolve(__dirname, '../routes.js'),
];
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const point = (eastM, northM = 0) => ({
  lat: -36.8482 + northM / 111_132,
  lng: 174.7638 + eastM / (111_320 * Math.cos(-36.8482 * Math.PI / 180)),
});
const part = (id, resolution, points) => ({ id, resolution, points });
const orderedDraft = {
  schemaVersion: 1,
  draftId: 'c11a0000-2026-4024-8000-000000000011',
  ownerId: '7',
  origin: 'activity',
  revision: 4,
  parts: [
    part('recorded-prefix', 'recorded', [point(0), point(35)]),
    part('accepted-mapbox-bridge', 'draw-matched', [point(35), point(55, 12), point(80)]),
    part('honest-manual-section', 'draw-manual', [point(80), point(115, 4)]),
    part('recorded-after-unrelated-gap', 'recorded', [point(155, 4), point(205, 4)]),
  ],
  gaps: [{ id: 'unrelated-activity-gap', afterPartId: 'honest-manual-section', reason: 'activity-gap' }],
};
const flatten = draft => draft.parts.flatMap((value, partIndex) => value.points.filter((candidate, pointIndex) => {
  if (!partIndex || pointIndex) return true;
  const prior = draft.parts[partIndex - 1].points.at(-1);
  return Math.hypot(candidate.lat - prior.lat, candidate.lng - prior.lng) > 1e-8;
}));
const points = flatten(orderedDraft);
const clientRouteId = 'c11b0000-2026-4024-8000-000000000011';
const sourceActivityClientId = 'c11c0000-2026-4024-8000-000000000011';
const idempotencyKey = 'c11d0000-2026-4024-8000-000000000011';

function connectionConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: dbName,
  };
}

async function closeBackendContext() {
  const dbPath = path.join(sourceRoot, 'config/db.js');
  const pool = require.cache[dbPath]?.exports;
  if (pool?.end) await pool.end();
  for (const modulePath of modulePaths) delete require.cache[modulePath];
}

async function startApi() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/routes', require(path.resolve(__dirname, '../routes.js')));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}/api/routes`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function api(base, token, method, suffix = '', body, extraHeaders = {}) {
  const response = await fetch(`${base}${suffix}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, body: await response.json() };
}

function createPayload(draft = orderedDraft, routePoints = points) {
  return {
    client_route_id: clientRouteId,
    name: 'Cairn 11 isolated gap persistence',
    points: routePoints,
    ordered_draft: draft,
    resolution_state: draft.gaps.length ? 'unresolved_gaps' : 'continuous',
    waypoints: [],
    distance_m: 999999,
    elevation_gain_m: 0,
    permission: 'personal',
    source_activity_client_id: sourceActivityClientId,
    origin_gap_reconnected: true,
  };
}

test('real Express/auth/MySQL preserves ordered bridge provenance and unrelated gaps across fresh processes', {
  skip: !enabled,
}, async t => {
  const direct = await mysql.createConnection(connectionConfig());
  const servers = [];
  t.after(async () => {
    for (const server of servers.reverse()) {
      try { await server.close(); } catch {}
    }
    try { await closeBackendContext(); } catch {}
    try { await direct.end(); } catch {}
  });

  const [[serverInfo]] = await direct.query('SELECT VERSION() version, DATABASE() database_name, @@hostname hostname');
  assert.equal(serverInfo.database_name, dbName);
  await direct.query(
    `INSERT INTO users (id,name,email,password_hash,token_version) VALUES
      (7,'Route Owner','cairn11-route-owner@example.invalid','test-only',0),
      (8,'Other Owner','cairn11-other-owner@example.invalid','test-only',0)`,
  );
  await direct.query(
    `INSERT INTO sessions
      (id,user_id,client_activity_id,source_provenance,type,start_time,end_time,finalized_at,distance_m,duration_s,route_points,route_points_raw,route_points_canonical)
     VALUES (711,7,?,'isolated_qa','hiking',NOW(),NOW(),NOW(),205,600,CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON))`,
    [sourceActivityClientId, JSON.stringify([point(0), point(35), point(155, 4), point(205, 4)]),
      JSON.stringify([point(0), point(35), point(155, 4), point(205, 4)]),
      JSON.stringify([point(0), point(35), point(155, 4), point(205, 4)])],
  );

  const { signToken } = require(path.join(sourceRoot, 'config/jwt.js'));
  const ownerToken = signToken({ userId: 7, email: 'cairn11-route-owner@example.invalid', token_version: 0 });
  const otherToken = signToken({ userId: 8, email: 'cairn11-other-owner@example.invalid', token_version: 0 });

  let server = await startApi();
  servers.push(server);
  const created = await api(server.base, ownerToken, 'POST', '', createPayload(), { 'X-Idempotency-Key': idempotencyKey });
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  const routeId = Number(created.body.route.id);
  assert.ok(routeId > 0);
  assert.deepEqual(created.body.route.ordered_draft, orderedDraft);
  assert.deepEqual(created.body.route.points, points);
  assert.equal(created.body.route.resolution_state, 'unresolved_gaps');
  assert.ok(Number(created.body.route.distance_m) < 300, 'server must recompute distance and exclude the gap chord');

  const [[row]] = await direct.query(
    `SELECT id,user_id,points,ordered_draft,resolution_state,distance_m,content_revision,
            source_activity_client_id,origin_gap_reconnected
       FROM routes WHERE id=?`, [routeId],
  );
  const dbDraft = typeof row.ordered_draft === 'string' ? JSON.parse(row.ordered_draft) : row.ordered_draft;
  const dbPoints = typeof row.points === 'string' ? JSON.parse(row.points) : row.points;
  assert.deepEqual(dbDraft, orderedDraft);
  assert.deepEqual(dbPoints, points);
  assert.equal(row.source_activity_client_id, sourceActivityClientId);
  assert.equal(Number(row.origin_gap_reconnected), 1);

  await server.close();
  servers.pop();
  await closeBackendContext();
  server = await startApi();
  servers.push(server);
  const reopened = await api(server.base, ownerToken, 'GET', `/${routeId}`);
  assert.equal(reopened.response.status, 200);
  assert.deepEqual(reopened.body.route.ordered_draft, orderedDraft);
  assert.deepEqual(reopened.body.route.points, points);

  const unauthorizedGet = await api(server.base, otherToken, 'GET', `/${routeId}`);
  assert.equal(unauthorizedGet.response.status, 404);
  const unauthorizedPut = await api(server.base, otherToken, 'PUT', `/${routeId}`, { name: 'forbidden' });
  assert.equal(unauthorizedPut.response.status, 404);

  const omitted = points.slice(1);
  const omittedResult = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points: omitted, ordered_draft: orderedDraft, resolution_state: 'unresolved_gaps',
  });
  assert.equal(omittedResult.response.status, 400);
  assert.equal(omittedResult.body.code, 'ROUTE_POINTS_MISMATCH');

  const reordered = [...points].reverse();
  const reorderedResult = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points: reordered, ordered_draft: orderedDraft, resolution_state: 'unresolved_gaps',
  });
  assert.equal(reorderedResult.response.status, 400);
  assert.equal(reorderedResult.body.code, 'ROUTE_POINTS_MISMATCH');

  const duplicated = [...points.slice(0, 2), ...points];
  const duplicateIntervalResult = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points: duplicated, ordered_draft: orderedDraft, resolution_state: 'unresolved_gaps',
  });
  assert.equal(duplicateIntervalResult.response.status, 400);
  assert.equal(duplicateIntervalResult.body.code, 'ROUTE_POINTS_MISMATCH');

  const falseContinuous = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points, ordered_draft: orderedDraft, resolution_state: 'continuous',
  });
  assert.equal(falseContinuous.response.status, 400);
  assert.equal(falseContinuous.body.code, 'ROUTE_RESOLUTION_MISMATCH');

  const lostProvenance = structuredClone(orderedDraft);
  lostProvenance.parts[1].resolution = 'provider-success';
  const provenanceResult = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points, ordered_draft: lostProvenance, resolution_state: 'unresolved_gaps',
  });
  assert.equal(provenanceResult.response.status, 400);

  const editedDraft = structuredClone(orderedDraft);
  editedDraft.revision += 1;
  editedDraft.parts[2].points.splice(1, 0, point(96, 9));
  const editedPoints = flatten(editedDraft);
  const edited = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points: editedPoints, ordered_draft: editedDraft, resolution_state: 'unresolved_gaps',
  });
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.route.ordered_draft, editedDraft);

  const undoSave = await api(server.base, ownerToken, 'PUT', `/${routeId}`, {
    points, ordered_draft: orderedDraft, resolution_state: 'unresolved_gaps',
  });
  assert.equal(undoSave.response.status, 200, JSON.stringify(undoSave.body));
  assert.deepEqual(undoSave.body.route.ordered_draft, orderedDraft);

  const replay = await api(server.base, ownerToken, 'POST', '', createPayload(), { 'X-Idempotency-Key': idempotencyKey });
  assert.equal(replay.response.status, 201);
  assert.equal(replay.body.idempotent_replay, true);
  const [[rowCount]] = await direct.query('SELECT COUNT(*) count FROM routes WHERE user_id=7 AND client_route_id=?', [clientRouteId]);
  assert.equal(Number(rowCount.count), 1);

  await server.close();
  servers.pop();
  await closeBackendContext();
  server = await startApi();
  servers.push(server);
  const finalReopen = await api(server.base, ownerToken, 'GET', `/${routeId}`);
  assert.equal(finalReopen.response.status, 200);
  assert.deepEqual(finalReopen.body.route.ordered_draft, orderedDraft);
  assert.deepEqual(finalReopen.body.route.points, points);

  const receipt = {
    database: { engine: 'MySQL', version: serverInfo.version, disposableDatabase: dbName },
    api: { framework: 'Express', realAuthenticateMiddleware: true, realRouteRouter: true, realRouteModel: true },
    source: { provenance: 'isolated_qa', productionRecordsTouched: false },
    route: {
      routeId,
      clientRouteIdSha256: sha(clientRouteId),
      orderedDraftSha256: sha(orderedDraft),
      pointsSha256: sha(points),
      partResolutions: orderedDraft.parts.map(value => value.resolution),
      remainingGapCount: orderedDraft.gaps.length,
      distanceM: Number(finalReopen.body.route.distance_m),
      resolutionState: finalReopen.body.route.resolution_state,
    },
    assertions: {
      realPostCommitted: true,
      directDatabaseRowMatched: true,
      freshServerAndClientGetMatched: true,
      orderedGeometryAndProvenancePreserved: true,
      unrelatedGapPreserved: true,
      gapChordExcludedFromDistance: true,
      editUndoSaveRestartParity: true,
      unauthorizedReadWriteRejected: true,
      omittedDuplicatedReorderedRejected: true,
      lostProvenanceRejected: true,
      falseContinuousGapRejected: true,
      duplicateLateSaveConverged: true,
    },
  };
  const output = process.env.CAIRN11_MYSQL_RECEIPT;
  if (output) fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
});
