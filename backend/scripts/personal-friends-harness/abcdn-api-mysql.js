'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const baseUrl = process.env.HARNESS_API_URL;
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
const jwtSecret = process.env.JWT_SECRET;

if (!baseUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');

const evidence = { started_at: new Date().toISOString(), assertions: [], actors: {}, connection_ids: {} };
function pass(id, detail) { evidence.assertions.push({ id, result: 'PASS', detail }); }

async function api(actor, path, { method = 'GET', body, expected } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { status: response.status, body: payload, headers: response.headers };
}

function tokenFor(id, label) {
  return jwt.sign({ userId: String(id), token_version: 0, jti: `pf-${label}-${crypto.randomUUID()}` }, jwtSecret, { expiresIn: '2h' });
}

async function becomeFriends(requester, recipient) {
  await api(requester, '/api/friends/request', { method: 'POST', body: { email: recipient.email }, expected: 201 });
  const requests = await api(recipient, '/api/friends/requests', { expected: 200 });
  const request = requests.body.find(row => String(row.from_user_id) === String(requester.id));
  assert.ok(request, `pending request ${requester.label}->${recipient.label}`);
  await api(recipient, '/api/friends/accept', { method: 'POST', body: { requestId: Number(request.id) }, expected: 200 });
}

async function completeActivity(actor, { lat, lng, mode = 'hiking', pointCount = 7 }) {
  const clientActivityId = crypto.randomUUID();
  const startedAt = Date.now() + 1000;
  const points = Array.from({ length: pointCount }, (_, index) => ({
    lat,
    lng: lng + index * 0.003,
    t: startedAt + index * 30_000,
    acc: 8,
  }));
  const start = await api(actor, '/api/sessions/start', {
    method: 'POST',
    body: { client_activity_id: clientActivityId, type: mode, start_time: new Date(startedAt).toISOString() },
    expected: 201,
  });
  const memory = points.map((point) => ({
    lat: point.lat, lng: point.lng, ts: point.t, cid: crypto.randomUUID(),
    evidence_source: 'activity_real', source_activity_client_id: clientActivityId,
    horizontal_accuracy_m: 8, continuity_state: 'accepted',
  }));
  const save = await api(actor, `/api/sessions/${start.body.id}/save`, {
    method: 'PATCH',
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(points[points.length - 1].t).toISOString(),
      distance_m: (pointCount - 1) * 245,
      duration_s: (pointCount - 1) * 30,
      name: `${actor.label} synthetic ${mode}`,
      route_points: points,
      route_points_raw: points,
      memory_points: memory,
    },
    expected: 200,
  });
  assert.equal(save.body.memory.accepted, pointCount);
  return { clientActivityId, sessionId: Number(start.body.id), points };
}

async function main() {
  const admin = await mysql.createConnection(dbConfig);
  const actorConnections = {};
  try {
    // example.org is IANA-reserved for documentation/testing and also passes
    // the production email validator; `.invalid` is correctly rejected by it.
    const emails = ['a', 'b', 'c', 'd'].map(label => `pf-${label}-${process.env.HARNESS_RUN_ID}@example.org`);
    for (let index = 0; index < 4; index += 1) {
      const label = String.fromCharCode(65 + index);
      const [result] = await admin.execute(
        'INSERT INTO users (name,email,password_hash,date_of_birth) VALUES (?,?,?,?)',
        [`Actor ${label}`, emails[index], 'synthetic-no-login', '1990-01-01'],
      );
      evidence.actors[label] = { id: String(result.insertId), email_domain: 'example.org' };
    }
    const actors = Object.fromEntries(Object.entries(evidence.actors).map(([label, actor]) => [label, {
      label, id: actor.id, email: emails[label.charCodeAt(0) - 65], token: tokenFor(actor.id, label),
    }]));
    for (const actor of Object.values(actors)) {
      const connection = await mysql.createConnection(dbConfig);
      actorConnections[actor.label] = connection;
      const [[row]] = await connection.query('SELECT CONNECTION_ID() AS id');
      evidence.connection_ids[actor.label] = Number(row.id);
    }
    assert.equal(new Set(Object.values(evidence.connection_ids)).size, 4);
    pass('FR-15.separate-connections', 'A/B/C/D hold four distinct real MySQL connections');

    const [schemaRows] = await admin.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_name IN
          ('friendship_episodes','memory_share_grants','friend_cairn_encounters','shared_route_leases')`,
    );
    assert.equal(schemaRows.length, 4);
    pass('DEP-01.schema', '035/036/037 applied on MySQL 8 and core 037 tables exist');

    const [historicalPublicMarker] = await admin.execute(
      `INSERT INTO markers (user_id,type,text,lat,lng,permission,created_at,updated_at)
       VALUES (?, 'cairn', 'historical public sentinel', -41.28, 174.77, 'public', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [actors.A.id],
    );
    await admin.execute(
      `INSERT INTO marker_audience_epochs
         (marker_id,owner_id,audience_epoch,visibility,starts_at)
       SELECT id,user_id,audience_epoch,'personal',audience_changed_at
         FROM markers WHERE id=?`,
      [historicalPublicMarker.insertId],
    );
    const historicTs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await admin.execute(
      `INSERT INTO memory_points
        (user_id,lat,lng,ts,client_id,evidence_source,horizontal_accuracy_m,continuity_state)
       VALUES (?,?,?,?,?,'historical_unknown',8,'unknown'), (?,?,?,?,?,'passive_real',8,'accepted')`,
      [actors.A.id, -41.2865, 174.7762, historicTs, crypto.randomUUID(),
        actors.A.id, -41.2865, 174.7792, historicTs + 1000, crypto.randomUUID()],
    );

    const noFriendProjection = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.deepEqual(noFriendProjection.body.projections, []);
    assert.deepEqual(noFriendProjection.body.revoked_friend_ids, [actors.A.id]);
    const directDenied = await api(actors.D, '/api/friend-content/routes/999999', { expected: 404 });
    assert.equal(directDenied.body.error, 'Content not available');
    pass('FR-02.default-deny', 'non-friends receive no Memory projection and opaque content denial');

    await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: true }, expected: 200 });
    await becomeFriends(actors.B, actors.A);
    const sourcesB = await api(actors.B, '/api/friend-sharing/sources', { expected: 200 });
    assert.equal(sourcesB.body.sources.length, 1);
    assert.equal(sourcesB.body.sources[0].friend_id, actors.A.id);
    const sourcesA = await api(actors.A, '/api/friend-sharing/sources', { expected: 200 });
    assert.equal(sourcesA.body.sources.length, 0);
    pass('FR-03.author-policy', 'A standing author policy provisions only A→B; no reciprocal grant appears');

    await api(actors.B, '/api/memory-subscriptions', {
      method: 'POST', body: { friend_id: Number(actors.A.id) }, expected: 201,
    });
    const activityA = await completeActivity(actors.A, { lat: -41.2865, lng: 174.7762 });
    const projection = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.equal(projection.body.projections.length, 1);
    assert.ok(projection.body.projections[0].cells.length > 0);
    assert.equal(JSON.stringify(projection.body).includes('historical_unknown'), false);
    assert.equal(JSON.stringify(projection.body).includes('passive_real'), false);
    assert.equal(JSON.stringify(projection.body).includes('source_activity_client_id'), false);
    pass('PJ-06/FR-03.provenance-projection', 'only post-grant finalized activity_real becomes coarse cells; no raw source/times');

    const cellsBeforeMask = projection.body.projections[0].cells.length;
    await api(actors.A, '/api/friend-sharing/private-places', {
      method: 'POST', body: { label: 'Synthetic private place', lat: -41.2865, lng: 174.7852, radius_m: 250 }, expected: 201,
    });
    const masked = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.ok(masked.body.projections[0].cells.length < cellsBeforeMask);
    assert.ok(masked.body.projections[0].authorization_version > projection.body.projections[0].authorization_version);
    pass('SAFE-01.private-mask', 'private-place change bumps authorization version and removes intersecting whole cells');

    const markerCreate = await api(actors.A, '/api/markers', {
      method: 'POST',
      body: {
        client_cairn_id: crypto.randomUUID(), type: 'cairn', text: `Whakarongo${String.fromCharCode(30)}He wāhi roa`,
        lat: -43.5321, lng: 172.6362, alt: 10, permission: 'group', approximate: false,
      },
      expected: 201,
    });
    const markerId = String(markerCreate.body.id);
    const beforeEvidence = await api(actors.B, '/api/friend-content/encounters/verify', { method: 'POST', body: {}, expected: 200 });
    assert.equal(beforeEvidence.body.encountered_marker_ids.includes(markerId), false);
    await completeActivity(actors.B, { lat: -43.5321, lng: 172.6362, pointCount: 3 });
    const encounter = await api(actors.B, '/api/friend-content/encounters/verify', { method: 'POST', body: {}, expected: 200 });
    assert.equal(encounter.body.encountered_marker_ids.includes(markerId), true);
    await api(actors.B, '/api/friend-content/encounters/verify', { method: 'POST', body: {}, expected: 200 });
    const [[encounterCount]] = await actorConnections.B.execute(
      'SELECT COUNT(*) AS n FROM friend_cairn_encounters WHERE viewer_id=? AND marker_id=?',
      [actors.B.id, markerId],
    );
    assert.equal(Number(encounterCount.n), 1);
    const friendCairn = await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 200 });
    assert.equal(friendCairn.body.cairn.read_only, true);
    await api(actors.D, `/api/friend-content/cairns/${markerId}`, { expected: 404 });
    await api(actors.B, `/api/markers/${markerId}`, { method: 'PUT', body: { text: 'viewer mutation' }, expected: 404 });
    pass('FR-10/FR-11.encounter', 'prospective canonical real evidence creates one idempotent encounter; non-friend denied and viewer cannot mutate');

    const routeCreate = await api(actors.A, '/api/routes', {
      method: 'POST', body: {
        client_route_id: crypto.randomUUID(), name: 'Te Ara synthetic', permission: 'friend',
        points: activityA.points, waypoints: [], distance_m: 1470, elevation_gain_m: 42,
      }, expected: 201,
    });
    const routeId = String(routeCreate.body.route.id);
    const routeDetail = await api(actors.B, `/api/friend-content/routes/${routeId}`, { expected: 200 });
    assert.equal(routeDetail.body.route.read_only, true);
    await api(actors.D, `/api/friend-content/routes/${routeId}`, { expected: 404 });
    const lease = await api(actors.B, `/api/friend-content/routes/${routeId}/lease`, { method: 'POST', body: {}, expected: 201 });
    await api(actors.A, `/api/routes/${routeId}`, { method: 'PUT', body: { permission: 'personal' }, expected: 200 });
    await api(actors.B, `/api/friend-content/route-leases/${lease.body.lease_id}/start`, {
      method: 'POST', body: { client_activity_id: crypto.randomUUID() }, expected: 404,
    });

    const secondRoute = await api(actors.A, '/api/routes', {
      method: 'POST', body: {
        client_route_id: crypto.randomUUID(), name: 'Active safety snapshot', permission: 'friend',
        points: activityA.points, waypoints: [], distance_m: 1470, elevation_gain_m: 42,
      }, expected: 201,
    });
    const secondRouteId = String(secondRoute.body.route.id);
    const activeLease = await api(actors.B, `/api/friend-content/routes/${secondRouteId}/lease`, { method: 'POST', body: {}, expected: 201 });
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/start`, {
      method: 'POST', body: { client_activity_id: crypto.randomUUID() }, expected: 200,
    });
    await api(actors.A, `/api/routes/${secondRouteId}`, { method: 'PUT', body: { permission: 'personal' }, expected: 200 });
    await api(actors.B, `/api/friend-content/routes/${secondRouteId}`, { expected: 404 });
    const safety = await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}`, { expected: 200 });
    assert.equal(safety.body.safety_snapshot, true);
    assert.ok(safety.body.route.points.length >= 2);
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/end`, { method: 'POST', body: {}, expected: 200 });
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}`, { expected: 404 });
    pass('FR-12.route-reference', 'pre-start revoke denies use; active immutable geometry survives revoke only until explicit Activity end');

    const [[firstGrant]] = await admin.execute(
      `SELECT grant_epoch FROM memory_share_grants WHERE owner_id=? AND viewer_id=? ORDER BY id ASC LIMIT 1`,
      [actors.A.id, actors.B.id],
    );
    await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: false }, expected: 200 });
    const revoked = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.deepEqual(revoked.body.projections, []);
    const [[subscriptionCount]] = await admin.execute(
      'SELECT COUNT(*) AS n FROM memory_subscriptions WHERE user_id=? AND friend_id=?', [actors.B.id, actors.A.id],
    );
    assert.equal(Number(subscriptionCount.n), 0);
    await api(actors.A, '/api/friend-sharing/policy', { method: 'PUT', body: { enabled: true }, expected: 200 });
    await api(actors.B, `/api/friends/${actors.A.id}`, { method: 'DELETE', expected: 200 });
    await becomeFriends(actors.B, actors.A);
    const [[latestGrant]] = await admin.execute(
      `SELECT grant_epoch,effective_at FROM memory_share_grants
        WHERE owner_id=? AND viewer_id=? AND status='active' ORDER BY id DESC LIMIT 1`,
      [actors.A.id, actors.B.id],
    );
    assert.notEqual(latestGrant.grant_epoch, firstGrant.grant_epoch);
    await api(actors.B, '/api/memory-subscriptions', {
      method: 'POST', body: { friend_id: Number(actors.A.id) }, expected: 201,
    });
    const newEpochProjection = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.equal(newEpochProjection.body.projections[0].cells.length, 0);
    pass('FR-07.re-friend', 'unfriend revokes selection; re-friend under standing policy creates a fresh empty prospective grant epoch');

    await becomeFriends(actors.C, actors.A);
    const sourcesC = await api(actors.C, '/api/friend-sharing/sources', { expected: 200 });
    assert.equal(sourcesC.body.sources[0].friend_id, actors.A.id);
    const transitiveD = await api(actors.D, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    assert.deepEqual(transitiveD.body.projections, []);
    pass('FR-05.non-transitive', 'A→C grant does not expose A to unrelated D');

    await api(actors.A, `/api/friends/${actors.B.id}/block`, { method: 'POST', body: {}, expected: 200 });
    const blockedSources = await api(actors.B, '/api/friend-sharing/sources', { expected: 200 });
    assert.equal(blockedSources.body.sources.length, 0);
    await api(actors.A, `/api/friends/${actors.B.id}/block`, { method: 'DELETE', expected: 200 });
    const afterUnblockFriends = await api(actors.B, '/api/friends', { expected: 200 });
    assert.equal(afterUnblockFriends.body.some(friend => String(friend.id) === actors.A.id), false);
    pass('FR-01.block-unblock', 'block transaction ends access; unblock does not recreate friendship or grants');

    const publicDiscovery = await api(actors.D, '/api/markers/public?bbox=-42,173,-40,176', { expected: 410 });
    assert.equal(publicDiscovery.body.code, 'PUBLIC_DISCOVERY_DEFERRED');
    const [[publicCount]] = await admin.execute(
      "SELECT COUNT(*) AS n FROM markers WHERE id=? AND user_id=? AND permission='public'",
      [historicalPublicMarker.insertId, actors.A.id],
    );
    assert.equal(Number(publicCount.n), 1);
    const rawFog = await api(actors.D, '/api/circle/fog', { expected: 410 });
    assert.equal(rawFog.body.code, 'FRIEND_MEMORY_PROJECTION_REQUIRED');
    pass('SAFE-02/FR-13.legacy-containment', 'historical Public row remains stored while Public discovery and legacy raw fog fail closed');

    const [grantAudit] = await Promise.all([
      actorConnections.A.execute("SELECT COUNT(*) AS n FROM memory_share_grants WHERE status='active'"),
      actorConnections.B.execute('SELECT COUNT(*) AS n FROM friend_cairn_encounters'),
      actorConnections.C.execute('SELECT COUNT(*) AS n FROM friendship_episodes'),
      actorConnections.D.execute("SELECT COUNT(*) AS n FROM markers WHERE permission='public'"),
    ]);
    assert.ok(Number(grantAudit[0][0].n) >= 1);
    pass('FR-15.concurrent-audit', 'independent A/B/C/D connections completed concurrent authorization reads');

    evidence.finished_at = new Date().toISOString();
    evidence.mysql_version = (await admin.query('SELECT @@version AS version'))[0][0].version;
    evidence.summary = { passed: evidence.assertions.length, failed: 0 };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await Promise.all(Object.values(actorConnections).map(connection => connection.end().catch(() => {})));
    await admin.end();
  }
}

main().catch(error => {
  evidence.finished_at = new Date().toISOString();
  evidence.summary = { passed: evidence.assertions.length, failed: 1 };
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exitCode = 1;
});
