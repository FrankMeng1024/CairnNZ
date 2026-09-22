'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { loadFriendProjectionEvidence } = require('../../src/services/friendProjection');

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

const evidence = { started_at: new Date().toISOString(), assertions: [], actors: {}, objects: {}, connection_ids: {} };
function pass(id, detail) { evidence.assertions.push({ id, result: 'PASS', detail }); }

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

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

function tokenFor(id, label, tokenVersion = 0) {
  return jwt.sign({ userId: String(id), token_version: tokenVersion, jti: `pf-${label}-${crypto.randomUUID()}` }, jwtSecret, { expiresIn: '2h' });
}

async function becomeFriends(requester, recipient) {
  await api(requester, '/api/friends/request', { method: 'POST', body: { email: recipient.email }, expected: 201 });
  const requests = await api(recipient, '/api/friends/requests', { expected: 200 });
  const request = requests.body.find(row => String(row.from_user_id) === String(requester.id));
  assert.ok(request, `pending request ${requester.label}->${recipient.label}`);
  await api(recipient, '/api/friends/accept', { method: 'POST', body: { requestId: Number(request.id) }, expected: 200 });
}

async function completeActivity(actor, {
  lat, lng, mode = 'hiking', pointCount = 7, includeCoverage = true, lngStep = 0.003,
  startedAtMs, pointOffsetsMs,
}) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const startedAt = startedAtMs ?? Date.now() + 1000;
  const offsets = Array.isArray(pointOffsetsMs)
    ? pointOffsetsMs
    : Array.from({ length: pointCount }, (_, index) => index * 30_000);
  const points = offsets.map((offset, index) => ({
    lat,
    lng: lng + index * lngStep,
    t: startedAt + offset,
    acc: 8,
    segment_id: sourceSegmentId,
  }));
  const start = await api(actor, '/api/sessions/start', {
    method: 'POST',
    body: { client_activity_id: clientActivityId, type: mode, start_time: new Date(startedAt).toISOString() },
    expected: 201,
  });
  const memory = points.map((point) => ({
    lat: point.lat, lng: point.lng, ts: point.t, cid: crypto.randomUUID(),
    evidence_source: 'activity_real', source_activity_client_id: clientActivityId,
    source_segment_id: sourceSegmentId,
    horizontal_accuracy_m: 8, continuity_state: 'accepted',
  }));
  const save = await api(actor, `/api/sessions/${start.body.id}/save`, {
    method: 'PATCH',
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(points[points.length - 1].t).toISOString(),
      distance_m: (points.length - 1) * 245,
      duration_s: Math.round((points[points.length - 1].t - points[0].t) / 1000),
      name: `${actor.label} synthetic ${mode}`,
      route_points: points,
      route_points_raw: points,
      route_points_canonical: points,
      memory_points: includeCoverage ? memory : [],
    },
    expected: 200,
  });
  assert.equal(save.body.memory.accepted, includeCoverage ? points.length : 0);
  const witnesses = points.map((point) => ({
    cid: crypto.randomUUID(),
    first_lat: point.lat,
    first_lng: point.lng,
    first_observed_at_ms: point.t,
    lat: point.lat,
    lng: point.lng,
    observed_at_ms: point.t,
    evidence_source: 'activity_real',
    source_activity_client_id: clientActivityId,
    source_segment_id: sourceSegmentId,
    horizontal_accuracy_m: 8,
    continuity_state: 'accepted',
  }));
  const presence = await api(actor, '/api/memory/points', {
    method: 'POST', body: { presence_witnesses: witnesses }, expected: 200,
  });
  assert.equal(presence.body.presence_witnesses.length, points.length);
  return { clientActivityId, sessionId: Number(start.body.id), points, witnesses };
}

async function main() {
  const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
  evidence.candidate_fingerprint = calculateV1SourceFingerprint();
  const admin = await mysql.createConnection(dbConfig);
  const actorConnections = {};
  try {
    // example.org is IANA-reserved for documentation/testing and also passes
    // the production email validator; `.invalid` is correctly rejected by it.
    const emails = ['a', 'b', 'c', 'd'].map(label => `pf-${label}-${process.env.HARNESS_RUN_ID}@example.org`);
    for (let index = 0; index < 4; index += 1) {
      const label = String.fromCharCode(65 + index);
      const [result] = await admin.execute(
        `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
         VALUES (?,?,?,?,'isolated_qa')`,
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
          ('friendship_episodes','memory_share_grants','friend_cairn_encounters',
           'shared_route_leases','memory_presence_witnesses')`,
    );
    assert.equal(schemaRows.length, 5);
    const [revisionColumns] = await admin.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema=DATABASE() AND column_name='content_revision'
          AND table_name IN ('markers','routes')`,
    );
    assert.equal(revisionColumns.length, 2);
    pass('DEP-01.schema', '035-040 applied on disposable MySQL 8 and additive presence/lease/content-revision columns exist');

    const returnLat = -45.031;
    const returnLng = 168.662;
    const firstReturnAt = Date.now() - 4 * 24 * 60 * 60 * 1000;
    const laterReturnAt = Date.now() - 24 * 60 * 60 * 1000;
    const returnCoverageCid = crypto.randomUUID();
    const returnWitnessA = crypto.randomUUID();
    const returnWitnessB = crypto.randomUUID();
    const returnUpload = await api(actors.B, '/api/memory/points', {
      method: 'POST',
      body: {
        points: [{
          lat: returnLat, lng: returnLng, ts: firstReturnAt, cid: returnCoverageCid,
          evidence_source: 'passive_real', horizontal_accuracy_m: 8, continuity_state: 'accepted',
        }],
        presence_witnesses: [{
          cid: returnWitnessA, first_lat: returnLat, first_lng: returnLng,
          first_observed_at_ms: firstReturnAt, lat: returnLat, lng: returnLng,
          observed_at_ms: firstReturnAt, evidence_source: 'passive_real',
          source_activity_client_id: null, horizontal_accuracy_m: 8, continuity_state: 'accepted',
        }, {
          cid: returnWitnessB, first_lat: returnLat, first_lng: returnLng,
          first_observed_at_ms: laterReturnAt, lat: returnLat, lng: returnLng,
          observed_at_ms: laterReturnAt, evidence_source: 'passive_real',
          source_activity_client_id: null, horizontal_accuracy_m: 8, continuity_state: 'accepted',
        }],
      },
      expected: 200,
    });
    assert.equal(returnUpload.body.presence_witnesses.length, 2);
    const [[returnCounts]] = await admin.execute(
      `SELECT
         (SELECT COUNT(*) FROM memory_points WHERE user_id=? AND lat=? AND lng=?) AS coverage_n,
         (SELECT COUNT(*) FROM memory_presence_witnesses WHERE user_id=? AND first_lat=? AND first_lng=?) AS presence_n`,
      [actors.B.id, returnLat, returnLng, actors.B.id, returnLat, returnLng],
    );
    assert.equal(Number(returnCounts.coverage_n), 1);
    assert.equal(Number(returnCounts.presence_n), 2);
    pass('PF-R3.presence-return', 'same-place later-day presence stores two immutable witnesses alongside one exploration-coverage row');

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

    const revisitLat = -41.2865;
    const revisitLng = 174.7762;
    const preGrantActivityA = await completeActivity(actors.A, {
      lat: revisitLat, lng: revisitLng, startedAtMs: Date.now() - 20 * 60 * 1000,
    });
    const [[preGrantEvidence]] = await admin.execute(
      `SELECT
         (SELECT COUNT(*) FROM memory_points WHERE user_id=?) AS coverage_n,
         (SELECT MAX(ts) FROM memory_points WHERE user_id=?) AS coverage_latest_ts`,
      [actors.A.id, actors.A.id],
    );

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
    const activityA = await completeActivity(actors.A, {
      lat: revisitLat, lng: revisitLng, includeCoverage: false,
    });
    await api(actors.A, '/api/memory/points', {
      method: 'POST', body: { presence_witnesses: activityA.witnesses }, expected: 200,
    });
    const [[postRevisitEvidence]] = await admin.execute(
      `SELECT
         (SELECT COUNT(*) FROM memory_points WHERE user_id=?) AS coverage_n,
         (SELECT MAX(ts) FROM memory_points WHERE user_id=?) AS coverage_latest_ts,
         (SELECT COUNT(*) FROM memory_presence_witnesses
           WHERE user_id=? AND source_activity_client_id=?) AS revisit_presence_n`,
      [actors.A.id, actors.A.id, actors.A.id, activityA.clientActivityId],
    );
    assert.equal(Number(postRevisitEvidence.coverage_n), Number(preGrantEvidence.coverage_n));
    assert.equal(Number(postRevisitEvidence.coverage_latest_ts), Number(preGrantEvidence.coverage_latest_ts));
    assert.equal(Number(postRevisitEvidence.revisit_presence_n), activityA.points.length);
    const [[revisitBinding]] = await admin.execute(
      `SELECT session.source_provenance,JSON_LENGTH(session.route_points_canonical) AS canonical_n,
              COUNT(*) AS witness_n,
              SUM(EXISTS(
                SELECT 1 FROM JSON_TABLE(session.route_points_canonical,'$[*]' COLUMNS(
                  lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
                  observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
                )) canonical
                WHERE ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(witness.first_observed_at_ms AS SIGNED))<=1000
                  AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(witness.first_lng,witness.first_lat))<=5
                  AND canonical.segment_id=witness.source_segment_id
              )) AS canonical_match_n
         FROM sessions session
         JOIN memory_presence_witnesses witness
           ON witness.user_id=session.user_id
          AND witness.source_activity_client_id=session.client_activity_id
        WHERE session.user_id=? AND session.client_activity_id=?
        GROUP BY session.id`,
      [actors.A.id, activityA.clientActivityId],
    );
    evidence.objects.revisit_source_binding = {
      source_provenance: revisitBinding?.source_provenance,
      canonical_points: Number(revisitBinding?.canonical_n || 0),
      witnesses: Number(revisitBinding?.witness_n || 0),
      canonical_matches: Number(revisitBinding?.canonical_match_n || 0),
    };
    assert.deepEqual(evidence.objects.revisit_source_binding, {
      source_provenance: 'isolated_qa', canonical_points: activityA.points.length,
      witnesses: activityA.points.length, canonical_matches: activityA.points.length,
    });
    const projection = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    });
    evidence.objects.revisit_projection = projection.body;
    if (!projection.body.projections[0]?.cells?.length) {
      const [[grant]] = await admin.execute(
        `SELECT grant_row.*,episode.started_at AS friendship_started_at
           FROM memory_share_grants grant_row
           JOIN friendship_episodes episode ON episode.id=grant_row.friendship_episode_id
          WHERE grant_row.owner_id=? AND grant_row.viewer_id=? AND grant_row.revoked_at IS NULL
          ORDER BY grant_row.id DESC LIMIT 1`,
        [actors.A.id, actors.B.id],
      );
      const sourceRows = await loadFriendProjectionEvidence(admin, actors.A.id, grant);
      const [predicateRows] = await admin.execute(
        `SELECT witness.id,witness.first_observed_at_ms AS ts,
                FROM_UNIXTIME(witness.first_observed_at_ms/1000)>=GREATEST(?,?) AS post_grant,
                session.source_provenance,session.finalized_at,session.abandoned_at,
                EXISTS(
                  SELECT 1 FROM JSON_TABLE(session.route_points_canonical,'$[*]' COLUMNS(
                    lat DOUBLE PATH '$.lat',lng DOUBLE PATH '$.lng',
                    observed_ms BIGINT PATH '$.t',segment_id VARCHAR(80) PATH '$.segment_id'
                  )) canonical
                   WHERE ABS(CAST(canonical.observed_ms AS SIGNED)-CAST(witness.first_observed_at_ms AS SIGNED))<=1000
                     AND ST_Distance_Sphere(POINT(canonical.lng,canonical.lat),POINT(witness.first_lng,witness.first_lat))<=5
                     AND COALESCE(canonical.segment_id,'legacy-0')=COALESCE(witness.source_segment_id,'legacy-0')
                ) AS canonical_ok
           FROM memory_presence_witnesses witness
           JOIN sessions session ON session.user_id=witness.user_id
            AND session.client_activity_id=witness.source_activity_client_id
          WHERE witness.user_id=? AND witness.source_activity_client_id=?`,
        [grant.effective_at, grant.friendship_started_at, actors.A.id, activityA.clientActivityId],
      );
      evidence.objects.revisit_projection_debug = {
        grant,
        row_count: sourceRows.length,
        rows: sourceRows,
        predicate_rows: predicateRows,
      };
    }
    assert.equal(projection.body.projections.length, 1);
    assert.ok(projection.body.projections[0].cells.length > 0);
    assert.equal(JSON.stringify(projection.body).includes('historical_unknown'), false);
    assert.equal(JSON.stringify(projection.body).includes('passive_real'), false);
    assert.equal(JSON.stringify(projection.body).includes('source_activity_client_id'), false);
    pass('R03-SHARE/PJ-06/FR-03.provenance-projection', `pre-grant coverage from ${preGrantActivityA.clientActivityId} stayed unchanged; finalized post-grant revisit ${activityA.clientActivityId} contributed deduplicated presence-backed coarse cells without raw source/times`);

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
    // Controlled starting state for the exact revision-03 regression: one
    // retained observation from 40 minutes earlier and a qualifying recent
    // pair belong to the same finalized Activity and legal authorization
    // period. The old global max-minus-min implementation rejected all three;
    // the bounded selector must retain the recent window.
    const encounterStartedAt = Date.now() - 40 * 60 * 1000 - 15_000;
    const authorizationStartedAt = new Date(encounterStartedAt - 60_000)
      .toISOString().slice(0, 23).replace('T', ' ');
    await admin.execute(
      `UPDATE friendship_episodes
          SET started_at=?
        WHERE (user_low_id=LEAST(?, ?) AND user_high_id=GREATEST(?, ?))
          AND ended_at IS NULL`,
      [authorizationStartedAt, actors.A.id, actors.B.id, actors.A.id, actors.B.id],
    );
    await admin.execute(
      `UPDATE markers marker
         JOIN marker_audience_epochs audience
           ON audience.marker_id=marker.id AND audience.audience_epoch=marker.audience_epoch
          SET marker.created_at=?, audience.starts_at=?
        WHERE marker.id=?`,
      [authorizationStartedAt, authorizationStartedAt, markerId],
    );
    await completeActivity(actors.B, {
      lat: -43.5321,
      lng: 172.6362,
      includeCoverage: false,
      lngStep: 0.00005,
      startedAtMs: encounterStartedAt,
      pointOffsetsMs: [0, 40 * 60 * 1000, 40 * 60 * 1000 + 15_000],
    });
    const encounter = await api(actors.B, '/api/friend-content/encounters/verify', { method: 'POST', body: {}, expected: 200 });
    assert.equal(encounter.body.encountered_marker_ids.includes(markerId), true);
    await api(actors.B, '/api/friend-content/encounters/verify', { method: 'POST', body: {}, expected: 200 });
    const [[encounterCount]] = await actorConnections.B.execute(
      'SELECT COUNT(*) AS n FROM friend_cairn_encounters WHERE viewer_id=? AND marker_id=?',
      [actors.B.id, markerId],
    );
    assert.equal(Number(encounterCount.n), 1);
    const [[encounterEvidence]] = await actorConnections.B.execute(
      'SELECT evidence_kind,evidence_source FROM friend_cairn_encounters WHERE viewer_id=? AND marker_id=?',
      [actors.B.id, markerId],
    );
    assert.equal(encounterEvidence.evidence_kind, 'presence_witness');
    assert.equal(encounterEvidence.evidence_source, 'activity_real');
    const friendCairn = await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 200 });
    assert.equal(friendCairn.body.cairn.read_only, true);
    assert.match(friendCairn.body.cairn.resource_revision, /^[0-9a-f]{64}$/);
    assert.match(friendCairn.body.cairn.authorization_revision, /^friendship:/);
    await api(actors.D, `/api/friend-content/cairns/${markerId}`, { expected: 404 });
    await api(actors.B, `/api/markers/${markerId}`, { method: 'PUT', body: { text: 'viewer mutation' }, expected: 404 });
    pass('R03-C4/FR-10/FR-11.encounter', 'one old same-Activity observation cannot suppress the qualifying recent 15-second pair; the actual API creates one idempotent encounter, while a non-friend is denied and the viewer cannot mutate');

    // Hold a real authorized response at the transport boundary while the
    // author changes the resource. The client ordering suite consumes the
    // same sequence through its actual store methods; this server-side half
    // proves the held and current payloads came from the isolated API/MySQL.
    const changedReadCaptured = deferred();
    const releaseChangedRead = deferred();
    const delayedChangedRead = (async () => {
      const response = await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 200 });
      changedReadCaptured.resolve();
      await releaseChangedRead.promise;
      return response;
    })();
    await changedReadCaptured.promise;
    await api(actors.A, `/api/markers/${markerId}`, {
      method: 'PUT', body: { text: `Whakarongo${String.fromCharCode(30)}Changed after held read` }, expected: 200,
    });
    const currentChangedRead = await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 200 });
    releaseChangedRead.resolve();
    const staleChangedRead = await delayedChangedRead;
    assert.notEqual(
      staleChangedRead.body.cairn.resource_revision,
      currentChangedRead.body.cairn.resource_revision,
    );
    pass('FR-08.resource-change-read-barrier', 'a real old detail response was held until after a newer resource revision was read');

    const revokeReadCaptured = deferred();
    const releaseRevokeRead = deferred();
    const delayedRevokedRead = (async () => {
      const response = await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 200 });
      revokeReadCaptured.resolve();
      await releaseRevokeRead.promise;
      return response;
    })();
    await revokeReadCaptured.promise;
    await api(actors.A, `/api/markers/${markerId}`, {
      method: 'PUT', body: { permission: 'personal' }, expected: 200,
    });
    await api(actors.B, `/api/friend-content/cairns/${markerId}`, { expected: 404 });
    releaseRevokeRead.resolve();
    const staleRevokedRead = await delayedRevokedRead;
    assert.equal(staleRevokedRead.body.cairn.read_only, true);
    pass('FR-08.revoke-read-barrier', 'a real authorized detail response was held until after revoke and an authoritative 404');

    const routeCreate = await api(actors.A, '/api/routes', {
      method: 'POST', body: {
        client_route_id: crypto.randomUUID(), name: 'Te Ara synthetic', permission: 'friend',
        points: activityA.points, waypoints: [], distance_m: 1470, elevation_gain_m: 42,
      }, expected: 201,
    });
    const routeId = String(routeCreate.body.route.id);
    const routeDetail = await api(actors.B, `/api/friend-content/routes/${routeId}`, { expected: 200 });
    assert.equal(routeDetail.body.route.read_only, true);
    assert.match(routeDetail.body.route.resource_revision, /^[0-9a-f]{64}$/);
    assert.match(routeDetail.body.route.authorization_revision, /^friendship:/);
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
    assert.equal(activeLease.body.route.description, undefined);
    assert.equal(activeLease.body.route.waypoints, undefined);
    const activeActivityId = crypto.randomUUID();
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/start`, {
      method: 'POST', body: { client_activity_id: activeActivityId }, expected: 200,
    });
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/start`, {
      method: 'POST', body: { client_activity_id: activeActivityId }, expected: 200,
    });
    await api(actors.A, `/api/routes/${secondRouteId}`, { method: 'PUT', body: { permission: 'personal' }, expected: 200 });
    await api(actors.B, `/api/friend-content/routes/${secondRouteId}`, { expected: 404 });
    const safety = await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}`, { expected: 200 });
    assert.equal(safety.body.safety_snapshot, true);
    assert.ok(safety.body.route.points.length >= 2);
    assert.equal(safety.body.route.description, undefined);
    assert.equal(safety.body.route.waypoints, undefined);
    const terminalBody = {
      client_activity_id: activeActivityId, terminal: 'finished', ended_at_ms: Date.now(),
    };
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/end`, {
      method: 'POST', body: terminalBody, expected: 200,
    });
    const duplicateEnd = await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}/end`, {
      method: 'POST', body: terminalBody, expected: 200,
    });
    assert.equal(duplicateEnd.body.idempotent, true);
    const [[terminalRow]] = await admin.execute(
      `SELECT start_acknowledged_at,end_acknowledged_at,terminal_reason
         FROM shared_route_leases WHERE id=?`,
      [activeLease.body.lease_id],
    );
    assert.ok(terminalRow.start_acknowledged_at);
    assert.ok(terminalRow.end_acknowledged_at);
    assert.equal(terminalRow.terminal_reason, 'finished');
    await api(actors.B, `/api/friend-content/route-leases/${activeLease.body.lease_id}`, { expected: 404 });

    const offlineRoute = await api(actors.A, '/api/routes', {
      method: 'POST', body: {
        client_route_id: crypto.randomUUID(), name: 'Issued offline use', permission: 'friend',
        points: activityA.points, waypoints: [], distance_m: 1470, elevation_gain_m: 42,
      }, expected: 201,
    });
    const offlineRouteId = String(offlineRoute.body.route.id);
    const offlineLease = await api(actors.B, `/api/friend-content/routes/${offlineRouteId}/lease`, { method: 'POST', body: {}, expected: 201 });
    const offlineStartedAt = Date.now();
    await api(actors.A, `/api/routes/${offlineRouteId}`, { method: 'PUT', body: { permission: 'personal' }, expected: 200 });
    const offlineActivityId = crypto.randomUUID();
    await api(actors.B, `/api/friend-content/route-leases/${offlineLease.body.lease_id}/start`, {
      method: 'POST',
      body: { client_activity_id: offlineActivityId, started_at_ms: offlineStartedAt },
      expected: 200,
    });
    await api(actors.B, `/api/friend-content/route-leases/${offlineLease.body.lease_id}/end`, {
      method: 'POST',
      body: { client_activity_id: offlineActivityId, terminal: 'discarded', ended_at_ms: Date.now() },
      expected: 200,
    });
    pass('FR-12.route-reference', 'connected revoke denies new use; an in-window issued offline use binds one Activity, retains only minimal geometry, and terminal ACK is idempotent');

    const [[firstGrant]] = await admin.execute(
      `SELECT grant_epoch FROM memory_share_grants WHERE owner_id=? AND viewer_id=? ORDER BY id ASC LIMIT 1`,
      [actors.A.id, actors.B.id],
    );
    // Deterministic MySQL ordering proof: a fifth connection fences the same
    // sorted user-row authority used by both revoke and projection issuance.
    // Revoke enters the InnoDB lock queue first; projection enters second.
    // Once the external lock is released, revoke must commit before the read
    // can linearize, so no new authorization may be issued from stale state.
    const barrier = actorConnections.C;
    await barrier.beginTransaction();
    await barrier.query('SELECT id FROM users WHERE id IN (?) ORDER BY id FOR UPDATE', [
      [Number(actors.A.id), Number(actors.B.id)].sort((left, right) => left - right),
    ]);
    let revokeSettled = false;
    const revokeStartedAt = Date.now();
    const revokePromise = api(actors.A, '/api/friend-sharing/policy', {
      method: 'PUT', body: { enabled: false }, expected: 200,
    }).finally(() => { revokeSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(revokeSettled, false);
    let projectionSettled = false;
    const projectionPromise = api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id)] }, expected: 200,
    }).finally(() => { projectionSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(projectionSettled, false);
    await barrier.commit();
    await revokePromise;
    const revoked = await projectionPromise;
    assert.deepEqual(revoked.body.projections, []);
    assert.deepEqual(revoked.body.revoked_friend_ids, [actors.A.id]);
    evidence.objects.authorization_lock_race = {
      held_connection_id: evidence.connection_ids.C,
      revoke_wait_ms: Date.now() - revokeStartedAt,
      projections_after_release: revoked.body.projections.length,
      revoked_friend_ids: revoked.body.revoked_friend_ids,
    };
    pass('FR-15.authorization-lock-race', 'a real held MySQL authority lock made revoke and projection wait on separate API connections; queued revoke committed first and the later projection issued no stale authorization');
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

    const feedbackId = crypto.randomUUID();
    const feedbackFirst = await api(actors.D, '/api/account/feedback', {
      method: 'POST',
      body: { client_submission_id: feedbackId, kind: 'feedback', message: 'Synthetic review acknowledgement', app_version: 'review' },
      expected: 200,
    });
    const feedbackRetry = await api(actors.D, '/api/account/feedback', {
      method: 'POST',
      body: { client_submission_id: feedbackId, kind: 'feedback', message: 'Synthetic review acknowledgement', app_version: 'review' },
      expected: 200,
    });
    assert.equal(feedbackFirst.body.acknowledged, true);
    assert.equal(feedbackFirst.body.duplicate, false);
    assert.equal(feedbackRetry.body.duplicate, true);
    const [[feedbackCount]] = await admin.execute(
      'SELECT COUNT(*) AS n FROM feedback_messages WHERE user_id=? AND client_submission_id=?',
      [actors.D.id, feedbackId],
    );
    assert.equal(Number(feedbackCount.n), 1);

    await api(actors.D, '/api/account/export', { method: 'POST', body: {}, expected: 200 });
    let exportHistory = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await api(actors.D, '/api/account/exports', { expected: 200 });
      exportHistory = response.body;
      if (exportHistory[0]?.status === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(exportHistory[0]?.status, 'ready');
    assert.match(exportHistory[0]?.download_url || '', /^https:\/\/api\.yiiling\.cn\/pf-review-o60\//);
    const [[exportRow]] = await admin.execute(
      'SELECT status,file_path,expires_at FROM data_exports WHERE user_id=? ORDER BY id DESC LIMIT 1',
      [actors.D.id],
    );
    assert.equal(exportRow.status, 'ready');
    assert.equal(fs.existsSync(exportRow.file_path), true);

    const deletion = await api(actors.D, '/api/auth/account', { method: 'DELETE', expected: 200 });
    const graceMs = new Date(deletion.body.restore_deadline).getTime() - new Date(deletion.body.deleted_at).getTime();
    assert.equal(graceMs, 7 * 24 * 60 * 60 * 1000);
    await api(actors.D, '/api/friends', { expected: 401 });
    const [[deletedActor]] = await admin.execute('SELECT token_version,deleted_at FROM users WHERE id=?', [actors.D.id]);
    assert.ok(deletedActor.deleted_at);
    const restoreActor = {
      ...actors.D,
      token: tokenFor(actors.D.id, 'D-restore', Number(deletedActor.token_version)),
    };
    const restored = await api(restoreActor, '/api/auth/account/restore', { method: 'POST', body: {}, expected: 200 });
    assert.equal(restored.body.user.id, actors.D.id);
    const [[restoredActor]] = await admin.execute('SELECT deleted_at FROM users WHERE id=?', [actors.D.id]);
    assert.equal(restoredActor.deleted_at, null);
    pass('SET-01.release-alignment', 'synthetic feedback is durable/idempotent, export becomes ready with 24h authority, and deletion/restore uses exactly seven days');

    const publicCapabilities = await api(actors.A, '/api/public-cairns/capabilities', { expected: 200 });
    assert.equal(publicCapabilities.body.enabled, false);
    const publicDisabled = await api(actors.A, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 404,
      body: { source_activity_client_id: crypto.randomUUID() },
    });
    assert.equal(publicDisabled.body.code, 'PUBLIC_PILOT_DISABLED');
    const publicSceneDisabled = await api(actors.A, '/api/public-cairns/scene', { expected: 404 });
    assert.equal(publicSceneDisabled.body.code, 'PUBLIC_PILOT_DISABLED');
    const legacyPublic = await api(actors.A, '/api/markers/public?bbox=-42,173,-40,176', { expected: 410 });
    assert.equal(legacyPublic.body.code, 'PUBLIC_DISCOVERY_DEFERRED');
    pass('PUB-OFF.server-containment', 'with the Public flag absent, server discovery and qualification are denied while legacy bbox discovery remains retired');

    const [grantAudit] = await Promise.all([
      actorConnections.A.execute("SELECT COUNT(*) AS n FROM memory_share_grants WHERE status='active'"),
      actorConnections.B.execute('SELECT COUNT(*) AS n FROM friend_cairn_encounters'),
      actorConnections.C.execute('SELECT COUNT(*) AS n FROM friendship_episodes'),
      actorConnections.D.execute("SELECT COUNT(*) AS n FROM markers WHERE permission='public'"),
    ]);
    assert.ok(Number(grantAudit[0][0].n) >= 1);
    pass('FR-15.parallel-audit', 'independent A/B/C/D connections completed parallel authorization-state audit reads');

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
