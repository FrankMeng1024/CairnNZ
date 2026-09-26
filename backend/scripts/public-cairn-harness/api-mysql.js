'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const { selectQualifyingEncounterEvidence } = require('../../src/services/encounterPolicy');
const { loadEligiblePublicationOriginEvidence } = require('../../src/services/publicPublication');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};
if (!baseUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');

const evidence = {
  schema: 'cairnnz.public-cairn-api-mysql.v1',
  started_at: new Date().toISOString(),
  environment: { api: baseUrl, public_enabled: true, database: process.env.DB_NAME },
  actors: {},
  objects: {},
  assertions: [],
};

function pass(id, detail, trace = {}) {
  evidence.assertions.push({ id, result: 'PASS', detail, trace });
}

function tokenFor(id, label) {
  return jwt.sign({
    userId: String(id), token_version: 0,
    jti: `public-${label}-${crypto.randomUUID()}`,
  }, jwtSecret, { expiresIn: '2h' });
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
  if (expected !== undefined) {
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, body: payload };
}

async function completeActivity(
  actor, lat, lng, startedAtMs = Date.now() - 60_000,
  pointOffsets = [0, 15_000, 30_000],
) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const points = pointOffsets.map((offset, index) => ({
    lat: lat + index * 0.00001,
    lng: lng + index * 0.00001,
    t: startedAtMs + offset,
    acc: 8,
    segment_id: sourceSegmentId,
  }));
  const started = await api(actor, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: {
      client_activity_id: clientActivityId,
      type: 'hiking',
      start_time: new Date(startedAtMs).toISOString(),
    },
  });
  await api(actor, `/api/sessions/${started.body.id}/save`, {
    method: 'PATCH', expected: 200,
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(points[points.length - 1].t).toISOString(),
      distance_m: 35,
      duration_s: Math.ceil(pointOffsets[pointOffsets.length - 1] / 1000),
      name: `${actor.label} public harness Activity`,
      route_points: points,
      route_points_raw: points,
      route_points_canonical: points,
      memory_points: points.map(point => ({
        lat: point.lat, lng: point.lng, ts: point.t,
        cid: crypto.randomUUID(), evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
  const witnessResponse = await api(actor, '/api/memory/points', {
    method: 'POST', expected: 200,
    body: {
      presence_witnesses: points.map(point => ({
        cid: crypto.randomUUID(), first_lat: point.lat, first_lng: point.lng,
        first_observed_at_ms: point.t, lat: point.lat, lng: point.lng,
        observed_at_ms: point.t, evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
  assert.equal(witnessResponse.body.presence_witnesses.length, 3);
  return { clientActivityId, sessionId: String(started.body.id), points };
}

async function startActiveActivity(
  actor, lat, lng, startedAtMs = Date.now() - 20_000,
  pointOffsets = [0, 10_000, 20_000],
) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const points = pointOffsets.map((offset, index) => ({
    lat: lat + index * 0.00001,
    lng: lng + index * 0.00001,
    t: startedAtMs + offset,
    acc: 8,
    segment_id: sourceSegmentId,
  }));
  const started = await api(actor, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: {
      client_activity_id: clientActivityId,
      type: 'hiking',
      start_time: new Date(startedAtMs).toISOString(),
    },
  });
  await api(actor, `/api/sessions/${started.body.id}/append-points`, {
    method: 'PATCH', expected: 200,
    body: { client_op_id: crypto.randomUUID(), points },
  });
  const witnessResponse = await api(actor, '/api/memory/points', {
    method: 'POST', expected: 200,
    body: {
      presence_witnesses: points.map(point => ({
        cid: crypto.randomUUID(), first_lat: point.lat, first_lng: point.lng,
        first_observed_at_ms: point.t, lat: point.lat, lng: point.lng,
        observed_at_ms: point.t, evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
  assert.equal(witnessResponse.body.presence_witnesses.length, points.length);
  return { clientActivityId, sessionId: String(started.body.id), points };
}

async function finishActiveActivity(actor, activity, options = {}) {
  const lastPoint = activity.points[activity.points.length - 1];
  const canonicalPoints = options.canonicalPoints ?? activity.points;
  await api(actor, `/api/sessions/${activity.sessionId}/save`, {
    method: 'PATCH', expected: 200,
    body: {
      client_activity_id: activity.clientActivityId,
      end_time: new Date(lastPoint.t).toISOString(),
      distance_m: 35,
      duration_s: Math.ceil((lastPoint.t - activity.points[0].t) / 1000),
      name: `${actor.label} active Public harness Activity`,
      route_points: activity.points,
      route_points_raw: activity.points,
      route_points_canonical: canonicalPoints,
      memory_points: activity.points.map(point => ({
        lat: point.lat, lng: point.lng, ts: point.t,
        cid: crypto.randomUUID(), evidence_source: 'activity_real',
        source_activity_client_id: activity.clientActivityId,
        source_segment_id: point.segment_id,
        horizontal_accuracy_m: 8, continuity_state: 'accepted',
      })),
    },
  });
}

async function createPublicCairn(owner, activity, lat, lng, text) {
  const response = await api(owner, '/api/markers', {
    method: 'POST', expected: 201,
    body: {
      client_cairn_id: crypto.randomUUID(),
      origin_activity_client_id: activity.clientActivityId,
      type: 'cairn', text, lat, lng, alt: 20,
      permission: 'public', approximate: false,
    },
  });
  return { id: String(response.body.id), submission: response.body.public_submission };
}

async function pendingSubmission(operator, markerId, timeoutMs = 3_000) {
  // Finish commits the Activity first, then schedules the independently
  // moderated Public projection. Poll that observable projection instead of
  // racing Node's setImmediate callback on a fast loopback connection. The
  // old missing-reconciliation defect still fails deterministically at the
  // bounded deadline; no unrelated user action is used to wake it.
  const deadline = Date.now() + timeoutMs;
  do {
    const queue = await api(operator, '/api/public-cairns/operator/submissions?state=pending&limit=50', { expected: 200 });
    const item = queue.body.submissions.find(row => String(row.marker_id) === String(markerId));
    if (item) return item;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.fail(`pending publication for marker ${markerId} did not appear within ${timeoutMs}ms`);
}

async function decide(operator, publicationId, action, expected = 200) {
  return api(operator, `/api/public-cairns/operator/submissions/${publicationId}/decision`, {
    method: 'POST', expected, body: { action, reason: `harness_${action}` },
  });
}

function operatorCommand(actor, args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [
    path.resolve(__dirname, '../public-cairn-operator.js'), ...args,
  ], {
    encoding: 'utf8',
    env: { ...process.env, CAIRN_OPERATOR_API_URL: baseUrl, CAIRN_OPERATOR_TOKEN: actor.token },
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return result.stdout ? JSON.parse(result.stdout) : null;
}

async function main() {
  const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
  evidence.candidate_fingerprint = calculateV1SourceFingerprint();
  const db = await mysql.createConnection(dbConfig);
  const heldConnection = await mysql.createConnection(dbConfig);
  try {
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const actors = {};
    for (const label of labels) {
      const [inserted] = await db.execute(
        `INSERT INTO users
           (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,'isolated_qa')`,
        [`Public Actor ${label}`, `public-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`,
          'synthetic-no-login', '1990-01-01', label === 'C' ? 1 : 0],
      );
      actors[label] = {
        label,
        id: String(inserted.insertId),
        token: tokenFor(inserted.insertId, label),
      };
      evidence.actors[label] = { id: String(inserted.insertId), role: label === 'C' ? 'operator' : 'pilot_user' };
    }
    const [[dbVersion]] = await db.query('SELECT @@version AS version, CONNECTION_ID() AS connection_id');
    const [[heldVersion]] = await heldConnection.query('SELECT CONNECTION_ID() AS connection_id');
    evidence.mysql_version = dbVersion.version;
    evidence.connection_ids = [Number(dbVersion.connection_id), Number(heldVersion.connection_id)];
    assert.notEqual(evidence.connection_ids[0], evidence.connection_ids[1]);

    const capabilities = await api(actors.B, '/api/public-cairns/capabilities', { expected: 200 });
    assert.equal(capabilities.body.enabled, true);
    assert.deepEqual(
      [capabilities.body.scene_limit, capabilities.body.scene_author_limit, capabilities.body.new_card_limit],
      [3, 1, 1],
    );
    pass('PUB-01.capability', 'review API exposes the centrally bounded text-Cairn pilot only');

    const place = { lat: -41.2867, lng: 174.7763 };
    // Old failure: a Public Cairn planted from an active Activity was assessed
    // before finalization and never reconsidered unless the owner edited it.
    // Finish and duplicate Finish must now reconcile the same immutable UUID.
    const deferredPlace = { lat: place.lat + 0.001, lng: place.lng + 0.001 };
    const deferredActivity = await startActiveActivity(
      actors.A,
      deferredPlace.lat,
      deferredPlace.lng,
      Date.now() - 260_000,
    );
    const deferredMarker = await createPublicCairn(
      actors.A,
      deferredActivity,
      deferredPlace.lat,
      deferredPlace.lng,
      'Pending only after durable Finish',
    );
    assert.equal(deferredMarker.submission.code, 'PUBLIC_ELIGIBLE_ACTIVITY_REQUIRED');
    await finishActiveActivity(actors.A, deferredActivity);
    const deferredSubmission = await pendingSubmission(actors.C, deferredMarker.id);
    await finishActiveActivity(actors.A, deferredActivity);
    const [[deferredCounts]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM public_cairn_publications WHERE marker_id=?) AS publication_n,
         (SELECT COUNT(*) FROM public_cairn_moderation_audit
           WHERE marker_id=? AND event_type='publication_submitted') AS audit_n`,
      [deferredMarker.id, deferredMarker.id],
    );
    assert.deepEqual(
      [Number(deferredCounts.publication_n), Number(deferredCounts.audit_n)],
      [1, 1],
    );
    await decide(actors.C, deferredSubmission.id, 'reject');
    const unchangedRejected = await api(actors.A, `/api/markers/${deferredMarker.id}`, {
      method: 'PUT', expected: 200,
      body: { text: 'Pending only after durable Finish' },
    });
    assert.equal(unchangedRejected.body.public_state, 'rejected');
    const [[rejectedCounts]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM public_cairn_publications WHERE marker_id=?) AS publication_n,
         (SELECT COUNT(*) FROM public_cairn_moderation_audit
           WHERE marker_id=? AND event_type='publication_submitted') AS audit_n`,
      [deferredMarker.id, deferredMarker.id],
    );
    assert.deepEqual(
      [Number(rejectedCounts.publication_n), Number(rejectedCounts.audit_n)],
      [1, 1],
    );
    const revisedRejected = await api(actors.A, `/api/markers/${deferredMarker.id}`, {
      method: 'PUT', expected: 200,
      body: { text: 'Materially revised after rejection' },
    });
    assert.equal(revisedRejected.body.public_state, 'pending');
    const deferredV2 = await pendingSubmission(actors.C, deferredMarker.id);
    await decide(actors.C, deferredV2.id, 'approve');
    pass(
      'PUB-01a.finish-reconcile',
      'an active-Activity Cairn stayed private until Finish, then reconciled once; Finish replay and unchanged rejected retry created no duplicate, while a material revision re-entered review',
    );

    const ownerActivity = await completeActivity(actors.A, place.lat, place.lng, Date.now() - 180_000);
    const [[ownerSourceBinding]] = await db.execute(
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
      [actors.A.id, ownerActivity.clientActivityId],
    );
    evidence.objects.owner_source_binding = {
      source_provenance: ownerSourceBinding?.source_provenance,
      canonical_points: Number(ownerSourceBinding?.canonical_n || 0),
      witnesses: Number(ownerSourceBinding?.witness_n || 0),
      canonical_matches: Number(ownerSourceBinding?.canonical_match_n || 0),
    };
    assert.deepEqual(evidence.objects.owner_source_binding, {
      source_provenance: 'isolated_qa', canonical_points: 3, witnesses: 3, canonical_matches: 3,
    });
    const primaryV1Text = `He wāhi mārie ${String.fromCharCode(30)} <script>alert('not executable')</script>`;
    const marker = await createPublicCairn(
      actors.A, ownerActivity, place.lat, place.lng,
      primaryV1Text,
    );
    evidence.objects.primary_submission = marker.submission;
    evidence.objects.primary_marker_id = marker.id;
    evidence.objects.owner_activity_id = ownerActivity.clientActivityId;
    if (marker.submission.state !== 'pending') {
      const [[storedMarker]] = await db.execute('SELECT * FROM markers WHERE id=?', [marker.id]);
      const filteredOriginRows = await loadEligiblePublicationOriginEvidence(db, storedMarker);
      const [originPredicateRows] = await db.execute(
        `SELECT witness.id,session.source_provenance,session.finalized_at,session.abandoned_at,
                witness.evidence_source,witness.continuity_state,witness.horizontal_accuracy_m,
                ST_Distance_Sphere(POINT(witness.first_lng,witness.first_lat),
                  POINT(marker.lng,marker.lat))<=50 AS distance_ok,
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
           JOIN markers marker ON marker.id=?
          WHERE witness.user_id=? AND witness.source_activity_client_id=?`,
        [marker.id, actors.A.id, ownerActivity.clientActivityId],
      );
      const [originRows] = await db.execute(
        `SELECT witness.id,witness.first_lat AS lat,witness.first_lng AS lng,
                witness.first_observed_at_ms AS ts,witness.evidence_source,
                witness.source_activity_client_id,witness.source_segment_id,
                witness.horizontal_accuracy_m,witness.continuity_state,
                ST_Distance_Sphere(POINT(witness.first_lng,witness.first_lat),
                  POINT(marker.lng,marker.lat)) AS marker_distance_m
           FROM memory_presence_witnesses witness
           JOIN markers marker ON marker.id=?
          WHERE witness.user_id=? AND witness.source_activity_client_id=?
          ORDER BY witness.first_observed_at_ms`,
        [marker.id, actors.A.id, ownerActivity.clientActivityId],
      );
      evidence.objects.origin_debug = {
        rows: originRows.map(row => ({
          ...row,
          ts: Number(row.ts),
          marker_distance_m: Number(row.marker_distance_m),
        })),
        selected: selectQualifyingEncounterEvidence(originRows),
        filtered_rows: filteredOriginRows,
        filtered_selected: selectQualifyingEncounterEvidence(filteredOriginRows),
        predicate_rows: originPredicateRows,
      };
    }
    assert.equal(marker.submission.state, 'pending', JSON.stringify(evidence.objects.origin_debug ?? marker.submission));

    const [[coarsenedSnapshot]] = await db.execute(
      `SELECT snapshot_lat,snapshot_lng,snapshot_approximate
         FROM public_cairn_publications WHERE marker_id=?`,
      [marker.id],
    );
    assert.equal(Boolean(coarsenedSnapshot.snapshot_approximate), true);
    assert.ok(Number(coarsenedSnapshot.snapshot_lat) !== place.lat
      || Number(coarsenedSnapshot.snapshot_lng) !== place.lng);
    pass('PUB-01b.location-policy', 'the review snapshot stores a server-coarsened cell, never the exact owner pin');

    const unauthorizedQueue = await api(actors.D, '/api/public-cairns/operator/submissions', { expected: 403 });
    assert.equal(unauthorizedQueue.body.code, 'OPERATOR_REQUIRED');
    const unauthorizedAudit = await api(actors.D, '/api/public-cairns/operator/audit', { expected: 403 });
    assert.equal(unauthorizedAudit.body.code, 'OPERATOR_REQUIRED');
    const unauthorizedCli = spawnSync(process.execPath, [
      path.resolve(__dirname, '../public-cairn-operator.js'), 'submissions', 'pending',
    ], {
      encoding: 'utf8',
      env: { ...process.env, CAIRN_OPERATOR_API_URL: baseUrl, CAIRN_OPERATOR_TOKEN: actors.D.token },
    });
    assert.equal(unauthorizedCli.status, 1);
    assert.match(unauthorizedCli.stderr, /403 OPERATOR_REQUIRED/);
    const publication = await pendingSubmission(actors.C, marker.id);
    evidence.objects.primary_publication_id = String(publication.id);
    assert.equal(String(publication.text).includes('<script>'), true);
    const cliQueue = operatorCommand(actors.C, ['submissions', 'pending']);
    assert.ok(cliQueue.submissions.some(item => String(item.id) === String(publication.id)));
    const approved = operatorCommand(actors.C, ['decide', String(publication.id), 'approve', 'exact revision reviewed']);
    assert.equal(approved.state, 'published');
    const approvedRetry = operatorCommand(actors.C, ['decide', String(publication.id), 'approve', 'exact revision reviewed']);
    assert.equal(approvedRetry.idempotent_replay, true);
    const invalidDirectRestore = await decide(actors.C, publication.id, 'restore', 409);
    assert.equal(invalidDirectRestore.body.code, 'PUBLIC_STATE_CONFLICT');
    const suspended = await decide(actors.C, publication.id, 'suspend');
    assert.equal(suspended.body.state, 'suspended');
    const [[beforeSuspendedReplay]] = await db.execute(
      'SELECT COUNT(*) AS n FROM public_cairn_publications WHERE marker_id=?',
      [marker.id],
    );
    const suspendedOwnerReplay = await api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 200, body: { text: primaryV1Text },
    });
    assert.equal(suspendedOwnerReplay.body.public_state, 'suspended');
    const suspendedEdit = await api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 409, body: { text: `${primaryV1Text} changed while suspended` },
    });
    assert.equal(suspendedEdit.body.code, 'PUBLIC_SUSPENDED_EDIT_BLOCKED');
    const suspendRetry = await decide(actors.C, publication.id, 'suspend');
    assert.equal(suspendRetry.body.idempotent_replay, true);
    const restored = await decide(actors.C, publication.id, 'restore');
    assert.equal(restored.body.state, 'published');
    const restoreRetry = await decide(actors.C, publication.id, 'restore');
    assert.equal(restoreRetry.body.idempotent_replay, true);
    const [[afterSuspendedReplay]] = await db.execute(
      'SELECT COUNT(*) AS n FROM public_cairn_publications WHERE marker_id=?',
      [marker.id],
    );
    assert.equal(Number(afterSuspendedReplay.n), Number(beforeSuspendedReplay.n));
    pass('PUB-02.submit-approve', 'owner Public save created a pending exact revision; only the server-authorized operator approved it', {
      marker_id: marker.id, publication_id: String(publication.id), content_revision: Number(publication.content_revision),
    });
    const replayBody = { text: primaryV1Text };
    const replayFirst = await api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 200, body: replayBody,
    });
    const replaySecond = await api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 200, body: replayBody,
    });
    assert.equal(replayFirst.body.content_revision, 1);
    assert.equal(replaySecond.body.content_revision, 1);
    assert.equal(replaySecond.body.public_state, 'published');
    const [[replayCount]] = await db.execute(
      'SELECT COUNT(*) AS n FROM public_cairn_publications WHERE marker_id=?', [marker.id],
    );
    assert.equal(Number(replayCount.n), 1);
    pass('PUB-02a.unknown-commit-retry', 'replaying an already committed identical owner edit retained the approved content revision and publication episode');
    await api(actors.A, '/api/markers', {
      method: 'POST', expected: 400,
      body: {
        client_cairn_id: crypto.randomUUID(), origin_activity_client_id: ownerActivity.clientActivityId,
        type: 'cairn', text: 'x'.repeat(251), lat: place.lat, lng: place.lng,
        permission: 'public', approximate: false,
      },
    });
    const [[parameterizedText]] = await db.execute(
      'SELECT text FROM markers WHERE id=? AND user_id=?', [marker.id, actors.A.id],
    );
    assert.equal(parameterizedText.text.includes("<script>alert('not executable')</script>"), true);
    pass('PUB-02b.text-contract', 'bounded Unicode and markup-like input round-tripped as parameterized plain text; overlength input was rejected');

    // Candidate locality must be applied before the bounded scan. These are
    // explicit pre-existing fixture publications, not manufactured encounter
    // output: the API still has to find the older local Cairn from real
    // finalized source-bound evidence below.
    const distantFixtureIds = [];
    for (let index = 0; index < 60; index += 1) {
      const text = `Distant fixture ${index}`;
      const [insertedMarker] = await db.execute(
        `INSERT INTO markers
           (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
            content_revision,public_intent,public_state,publication_epoch,public_state_changed_at)
         VALUES (?,'cairn',?, -45.031,170.141,'public',0,'healthy',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
                 1,1,'published',1,UTC_TIMESTAMP(3))`,
        [actors.E.id, text],
      );
      const hash = crypto.createHash('sha256').update(JSON.stringify({
        type: 'cairn', text, lat: -45.031, lng: 170.141, approximate: false,
      })).digest('hex');
      await db.execute(
        `INSERT INTO public_cairn_publications
           (marker_id,owner_id,publication_epoch,content_revision,
            snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
            snapshot_sha256,state,decided_at,decided_by,published_at)
         VALUES (?,?,1,1,'cairn',?,-45.031,170.141,0,?,'published',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))`,
        [insertedMarker.insertId, actors.E.id, text, hash, actors.C.id],
      );
      distantFixtureIds.push(String(insertedMarker.insertId));
    }
    evidence.objects.distant_candidate_fixtures = {
      count: distantFixtureIds.length,
      first_marker_id: distantFixtureIds[0],
      last_marker_id: distantFixtureIds[distantFixtureIds.length - 1],
    };

    // Evidence recorded before publication is retained but cannot qualify.
    const prePublication = await completeActivity(actors.B, place.lat, place.lng, Date.now() - 120_000);
    const preVerify = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: prePublication.clientActivityId },
    });
    assert.deepEqual(preVerify.body.encountered_marker_ids, []);
    await db.execute(
      `INSERT INTO memory_points
         (user_id,lat,lng,ts,client_id,evidence_source,horizontal_accuracy_m,continuity_state)
       VALUES (?,?,?,?,?,'historical_unknown',8,'unknown')`,
      [actors.B.id, place.lat, place.lng, Date.now(), crypto.randomUUID()],
    );
    const futureSource = crypto.randomUUID();
    const fakeSource = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 409, body: { source_activity_client_id: futureSource },
    });
    assert.equal(fakeSource.body.code, 'PUBLIC_ACTIVITY_NOT_ELIGIBLE');
    pass('PUB-03.prepublication-negative', 'pre-publication observations and an arbitrary/simulator-like source identity cannot create an encounter');

    const viewerActivity = await startActiveActivity(actors.B, place.lat, place.lng, Date.now() - 20_000);
    evidence.objects.viewer_activity_id = viewerActivity.clientActivityId;
    const [[activeBeforeVerify]] = await db.execute(
      `SELECT finalized_at,abandoned_at,JSON_LENGTH(route_points) AS route_n
         FROM sessions WHERE user_id=? AND client_activity_id=?`,
      [actors.B.id, viewerActivity.clientActivityId],
    );
    assert.equal(activeBeforeVerify.finalized_at, null);
    assert.equal(activeBeforeVerify.abandoned_at, null);
    assert.equal(Number(activeBeforeVerify.route_n), viewerActivity.points.length);
    const verify = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: viewerActivity.clientActivityId },
    });
    assert.deepEqual(verify.body.encountered_marker_ids, [marker.id]);
    const retryVerify = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: viewerActivity.clientActivityId },
    });
    assert.deepEqual(retryVerify.body.encountered_marker_ids, [marker.id]);
    const [[encounterCount]] = await db.execute(
      'SELECT COUNT(*) AS n FROM public_cairn_encounters WHERE viewer_id=? AND marker_id=?',
      [actors.B.id, marker.id],
    );
    assert.equal(Number(encounterCount.n), 1);
    await finishActiveActivity(actors.B, viewerActivity);
    pass('PUB-04.encounter', 'post-publication REAL evidence created one idempotent encounter through the API/MySQL path while the Activity was still active', {
      marker_id: marker.id, source_activity_client_id: viewerActivity.clientActivityId,
      active_route_points: Number(activeBeforeVerify.route_n),
    });
    pass('PUB-04b.locality-before-limit', 'the older local publication remained eligible despite sixty newer distant publications because locality precedes the bounded candidate limit', {
      marker_id: marker.id, newer_distant_publications: distantFixtureIds.length,
    });

    const revokedActivity = await startActiveActivity(
      actors.D,
      place.lat,
      place.lng,
      Date.now() + 2_000,
    );
    const liveEncounter = await api(actors.D, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: revokedActivity.clientActivityId },
    });
    assert.ok(liveEncounter.body.encountered_marker_ids.includes(marker.id));
    const rejectedCanonical = revokedActivity.points.map(point => ({
      ...point,
      lat: point.lat + 0.01,
      lng: point.lng + 0.01,
    }));
    await finishActiveActivity(actors.D, revokedActivity, { canonicalPoints: rejectedCanonical });
    const finalRevalidation = await api(actors.D, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: revokedActivity.clientActivityId },
    });
    assert.equal(finalRevalidation.body.encountered_marker_ids.includes(marker.id), false);
    const revokedDetail = await api(actors.D, `/api/public-cairns/cairns/${marker.id}`, { expected: 404 });
    assert.equal(revokedDetail.body.code, 'PUBLIC_CAIRN_UNAVAILABLE');
    pass(
      'PUB-04c.final-canonical-revalidation',
      'live discovery was revoked when the qualifying mutable point was absent from final canonical truth',
    );

    const scene = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
    assert.equal(scene.body.entries.length, 1);
    assert.equal(scene.body.newly_surfaced.length, 1);
    assert.equal(Object.hasOwn(scene.body.entries[0], 'text'), false);
    await api(actors.B, `/api/public-cairns/cairns/${marker.id}/present`, { method: 'POST', body: {}, expected: 200 });
    const presentedScene = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
    assert.deepEqual(presentedScene.body.newly_surfaced, []);
    const detail = await api(actors.B, `/api/public-cairns/cairns/${marker.id}`, { expected: 200 });
    assert.equal(detail.body.cairn.read_only, true);
    assert.equal(detail.body.cairn.text.includes('<script>'), true);
    assert.equal(typeof detail.body.cairn.text, 'string');
    assert.match(detail.body.cairn.resource_revision, /^[0-9a-f]{64}$/);
    assert.match(detail.body.cairn.authorization_revision, /^public:/);
    const authorizationLifetime = new Date(detail.body.cairn.authorization_expires_at).getTime()
      - new Date(detail.body.cairn.authorization_issued_at).getTime();
    assert.equal(authorizationLifetime, 24 * 60 * 60 * 1000);
    const directUnseen = await api(actors.D, `/api/public-cairns/cairns/${marker.id}`, { expected: 404 });
    assert.equal(directUnseen.body.code, 'PUBLIC_CAIRN_UNAVAILABLE');
    pass('PUB-05.scene-detail', 'scene selection disclosed no text before open; encountered read-only Detail returned plain text and an encounter-bound fixed cache lifetime');

    const selectionMarkers = [];
    for (const [owner, text, offset] of [
      [actors.C, 'One shared duplicate', 0.00003],
      [actors.D, 'One shared duplicate', 0.00004],
      [actors.E, 'Fern and rain at the bend', 0.00005],
      [actors.A, 'A second note by the first author', 0.00006],
    ]) {
      const activity = await completeActivity(owner, place.lat + offset, place.lng, Date.now() - 40_000);
      const candidate = await createPublicCairn(owner, activity, place.lat + offset, place.lng, text);
      const queued = await pendingSubmission(actors.C, candidate.id);
      await decide(actors.C, queued.id, 'approve');
      selectionMarkers.push({ id: candidate.id, authorId: owner.id, text });
    }
    const selectionActivity = await completeActivity(actors.B, place.lat + 0.00004, place.lng, Date.now() + 35_000);
    await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: selectionActivity.clientActivityId },
    });
    const selectedFirst = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
    const selectedSecond = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
    assert.ok(selectedFirst.body.entries.length <= 3);
    assert.ok(selectedFirst.body.newly_surfaced.length <= 1);
    assert.equal(new Set(selectedFirst.body.entries.map(item => item.author.id)).size, selectedFirst.body.entries.length);
    assert.deepEqual(selectedSecond.body.entries.map(item => item.id), selectedFirst.body.entries.map(item => item.id));
    assert.equal(selectedFirst.body.entries.some(item => Object.hasOwn(item, 'text')), false);
    const duplicateIds = selectionMarkers.filter(item => item.text === 'One shared duplicate').map(item => item.id);
    assert.ok(selectedFirst.body.entries.filter(item => duplicateIds.includes(item.id)).length <= 1);
    pass('PUB-05b.bounded-selection', 'a bounded stable scene selected at most three entries, one per author and one normalized content duplicate, while surfacing at most one new card');

    const thanksFirst = await api(actors.B, `/api/public-cairns/cairns/${marker.id}/thanks`, { method: 'POST', body: {}, expected: 200 });
    const thanksRetry = await api(actors.B, `/api/public-cairns/cairns/${marker.id}/thanks`, { method: 'POST', body: {}, expected: 200 });
    assert.equal(thanksFirst.body.thanked, true);
    assert.equal(thanksRetry.body.thanked, true);
    const reportClientId = crypto.randomUUID();
    const reportFirst = await api(actors.B, `/api/public-cairns/cairns/${marker.id}/report`, {
      method: 'POST', expected: 200,
      body: { client_submission_id: reportClientId, category: 'other', detail: 'Synthetic operator review fixture.' },
    });
    const reportRetry = await api(actors.B, `/api/public-cairns/cairns/${marker.id}/report`, {
      method: 'POST', expected: 200,
      body: { client_submission_id: reportClientId, category: 'other', detail: 'Synthetic operator review fixture.' },
    });
    assert.equal(reportFirst.body.report_id, reportRetry.body.report_id);
    const mismatchedReportRetry = await api(actors.B, `/api/public-cairns/cairns/${marker.id}/report`, {
      method: 'POST', expected: 409,
      body: { client_submission_id: reportClientId, category: 'spam', detail: 'Different immutable request.' },
    });
    assert.equal(mismatchedReportRetry.body.code, 'PUBLIC_REPORT_IDENTITY_MISMATCH');
    const [[interactionCounts]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM public_cairn_thanks WHERE viewer_id=? AND marker_id=?) AS thanks_n,
         (SELECT COUNT(*) FROM public_cairn_reports WHERE viewer_id=? AND marker_id=?) AS reports_n,
         (SELECT public_state FROM markers WHERE id=?) AS public_state`,
      [actors.B.id, marker.id, actors.B.id, marker.id, marker.id],
    );
    assert.equal(Number(interactionCounts.thanks_n), 1);
    assert.equal(Number(interactionCounts.reports_n), 1);
    assert.equal(interactionCounts.public_state, 'published');
    const reports = await api(actors.C, '/api/public-cairns/operator/reports', { expected: 200 });
    assert.equal(reports.body.reports.length, 1);
    const v1ReportSnapshot = reports.body.reports[0];
    assert.equal(v1ReportSnapshot.text, primaryV1Text);
    assert.match(v1ReportSnapshot.snapshot_sha256, /^[0-9a-f]{64}$/);
    await api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 200, body: { text: 'Post-report revision two' },
    });
    const primaryV2 = await pendingSubmission(actors.C, marker.id);
    assert.notEqual(String(primaryV2.id), String(publication.id));
    const reportsAfterEdit = await api(actors.C, '/api/public-cairns/operator/reports', { expected: 200 });
    const immutableReport = reportsAfterEdit.body.reports.find(item => String(item.id) === String(reportFirst.body.report_id));
    assert.equal(immutableReport.text, primaryV1Text);
    assert.equal(immutableReport.snapshot_sha256, v1ReportSnapshot.snapshot_sha256);
    const withdrawnSubmissions = await api(actors.C, '/api/public-cairns/operator/submissions?state=withdrawn', { expected: 200 });
    const immutableV1 = withdrawnSubmissions.body.submissions.find(item => String(item.id) === String(publication.id));
    assert.equal(immutableV1.text, primaryV1Text);
    assert.equal(immutableV1.snapshot_sha256, v1ReportSnapshot.snapshot_sha256);
    await decide(actors.C, primaryV2.id, 'approve');
    const cliReports = operatorCommand(actors.C, ['reports', 'pending']);
    assert.ok(cliReports.reports.some(item => String(item.id) === String(reportFirst.body.report_id)));
    const cliDisposition = operatorCommand(actors.C, [
      'dispose', String(reportFirst.body.report_id), 'reviewed', 'Synthetic review complete.',
    ]);
    assert.equal(cliDisposition.state, 'reviewed');
    const cliDispositionRetry = operatorCommand(actors.C, [
      'dispose', String(reportFirst.body.report_id), 'reviewed', 'Synthetic review complete.',
    ]);
    assert.equal(cliDispositionRetry.idempotent_replay, true);
    const mismatchedDisposition = await api(
      actors.C,
      `/api/public-cairns/operator/reports/${reportFirst.body.report_id}/disposition`,
      {
        method: 'POST', expected: 409,
        body: { state: 'reviewed', note: 'Different retry note.' },
      },
    );
    assert.equal(mismatchedDisposition.body.code, 'PUBLIC_REPORT_IDENTITY_MISMATCH');
    const audit = await api(actors.C, '/api/public-cairns/operator/audit?limit=100', { expected: 200 });
    const primaryAudit = audit.body.events.filter(event => String(event.marker_id) === String(marker.id));
    assert.ok(primaryAudit.some(event => event.event_type === 'publication_submitted'));
    assert.ok(primaryAudit.some(event => event.event_type === 'publication_decision'));
    assert.ok(primaryAudit.some(event => event.event_type === 'report_submitted'));
    assert.ok(primaryAudit.some(event => event.event_type === 'report_disposition'));
    assert.ok(primaryAudit.every(event => !JSON.stringify(event.metadata_json ?? '').includes(primaryV1Text)));
    const cliAudit = operatorCommand(actors.C, ['audit']);
    assert.ok(cliAudit.events.some(event => event.event_type === 'report_disposition'));
    pass('PUB-06.interactions', 'Thanks and Report retries converged to one durable row; the v1 report/submission retained exact immutable text and hash after v2 edit, and report did not auto-penalize the author');

    // Exact-revision stale approval: v1 is pending, a material edit creates v2,
    // and the old operator response is rejected transactionally.
    const staleOwnerActivity = await completeActivity(actors.A, place.lat + 0.0001, place.lng, Date.now() - 90_000);
    const staleMarker = await createPublicCairn(actors.A, staleOwnerActivity, place.lat + 0.0001, place.lng, 'Revision one');
    const staleV1 = await pendingSubmission(actors.C, staleMarker.id);
    await api(actors.A, `/api/markers/${staleMarker.id}`, {
      method: 'PUT', expected: 200, body: { text: 'Revision two — current' },
    });
    const staleV2 = await pendingSubmission(actors.C, staleMarker.id);
    assert.notEqual(String(staleV1.id), String(staleV2.id));
    const lateApproval = await decide(actors.C, staleV1.id, 'approve', 409);
    assert.equal(lateApproval.body.code, 'STALE_PUBLICATION_REVISION');
    await decide(actors.C, staleV2.id, 'approve');
    pass('PUB-07.revision-race', 'a late v1 approval could not publish v2; the exact current revision required its own approval', {
      marker_id: staleMarker.id, rejected_publication_id: String(staleV1.id), approved_publication_id: String(staleV2.id),
    });

    // Hold the marker row on one real connection, start withdrawal through
    // the API's separate pool, prove it is genuinely waiting, then release
    // the barrier and verify withdrawal wins before current access is served.
    const viewerDActivity = await completeActivity(actors.D, place.lat, place.lng, Date.now() + 40_000);
    await api(actors.D, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: viewerDActivity.clientActivityId },
    });
    await heldConnection.beginTransaction();
    const [heldRows] = await heldConnection.execute(
      `SELECT marker.text,marker.content_revision,marker.publication_epoch
         FROM public_cairn_encounters encounter
         JOIN markers marker ON marker.id=encounter.marker_id
        WHERE encounter.viewer_id=? AND encounter.marker_id=? FOR UPDATE`,
      [actors.D.id, marker.id],
    );
    assert.equal(heldRows.length, 1);
    let withdrawalSettled = false;
    const withdrawalStartedAt = Date.now();
    const pendingWithdrawal = api(actors.A, `/api/markers/${marker.id}`, {
      method: 'PUT', expected: 200, body: { permission: 'personal' },
    }).finally(() => { withdrawalSettled = true; });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(withdrawalSettled, false, 'withdrawal must wait on the held marker row lock');
    await heldConnection.commit();
    await pendingWithdrawal;
    const withdrawalWaitMs = Date.now() - withdrawalStartedAt;
    assert.ok(withdrawalWaitMs >= 140);
    const withdrawnDetail = await api(actors.D, `/api/public-cairns/cairns/${marker.id}`, { expected: 404 });
    assert.equal(withdrawnDetail.body.code, 'PUBLIC_CAIRN_UNAVAILABLE');
    const [[withdrawn]] = await db.execute(
      `SELECT marker.public_state,publication.state
         FROM markers marker JOIN public_cairn_publications publication
           ON publication.marker_id=marker.id AND publication.publication_epoch=marker.publication_epoch
        WHERE marker.id=?`,
      [marker.id],
    );
    assert.equal(withdrawn.public_state, 'withdrawn');
    assert.equal(withdrawn.state, 'withdrawn');
    pass('PUB-08.withdrawal-race', 'a real marker-row lock held author withdrawal on a separate connection; after release, withdrawal committed before current list/Detail authority could be served', {
      marker_id: marker.id, withdrawal_wait_ms: withdrawalWaitMs,
      held_connection_id: evidence.connection_ids[1],
    });

    // Hide has immediate durable effect. Use the current staleMarker episode.
    const nearStale = await completeActivity(actors.B, place.lat + 0.0001, place.lng, Date.now() + 80_000);
    await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: nearStale.clientActivityId },
    });
    await api(actors.B, `/api/public-cairns/cairns/${staleMarker.id}`, { expected: 200 });
    await api(actors.B, `/api/public-cairns/cairns/${staleMarker.id}/hide`, { method: 'POST', body: {}, expected: 200 });
    await api(actors.B, `/api/public-cairns/cairns/${staleMarker.id}`, { expected: 404 });
    const hiddenScene = await api(actors.B, '/api/public-cairns/scene', { expected: 200 });
    assert.equal(hiddenScene.body.entries.some(item => item.id === staleMarker.id), false);
    pass('PUB-09.hide', 'Hide committed once and removed the Cairn from both scene and Detail authority');

    // Block uses the existing server-side identity authority and Public queries
    // enforce it even though the two users were never friends.
    const ownerEActivity = await completeActivity(actors.E, place.lat + 0.0002, place.lng, Date.now() - 50_000);
    const markerE = await createPublicCairn(actors.E, ownerEActivity, place.lat + 0.0002, place.lng, 'A second author');
    const pubE = await pendingSubmission(actors.C, markerE.id);
    await decide(actors.C, pubE.id, 'approve');
    const seeE = await completeActivity(actors.D, place.lat + 0.0002, place.lng, Date.now() + 120_000);
    await api(actors.D, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200, body: { source_activity_client_id: seeE.clientActivityId },
    });
    await api(actors.D, `/api/public-cairns/cairns/${markerE.id}`, { expected: 200 });
    await api(actors.D, `/api/friends/${actors.E.id}/block`, { method: 'POST', body: {}, expected: 200 });
    await api(actors.D, `/api/public-cairns/cairns/${markerE.id}`, { expected: 404 });
    const sceneAfterBlock = await api(actors.D, '/api/public-cairns/scene', { expected: 200 });
    assert.equal(sceneAfterBlock.body.entries.some(item => item.id === markerE.id), false);
    pass('PUB-10.block', 'the shared block authority removes Public discovery and Detail access for non-friends too');

    const legacyBbox = await api(actors.B, '/api/markers/public?bbox=-42,173,-40,176', { expected: 410 });
    assert.equal(legacyBbox.body.code, 'PUBLIC_DISCOVERY_DEFERRED');
    await api(actors.D, `/api/markers/${staleMarker.id}/community-state`, { expected: 404 });
    await api(actors.D, `/api/markers/${staleMarker.id}/interact-nonce`, { expected: 404 });
    pass('PUB-11.legacy-containment', 'legacy bbox, community and nonce paths cannot enumerate or interact with pilot Public Cairns');

    const suspend = await decide(actors.C, pubE.id, 'suspend');
    assert.equal(suspend.body.state, 'suspended');
    await api(actors.B, `/api/public-cairns/cairns/${markerE.id}`, { expected: 404 });
    const suspensionObservationStart = Date.now() + 100;
    await new Promise(resolve => setTimeout(resolve, 11_000));
    const duringSuspension = await completeActivity(
      actors.B, place.lat + 0.0002, place.lng, suspensionObservationStart,
      [0, 10_000, 10_500],
    );
    const verifyWhileSuspended = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: duringSuspension.clientActivityId },
    });
    assert.equal(verifyWhileSuspended.body.encountered_marker_ids.includes(markerE.id), false);
    const restore = await decide(actors.C, pubE.id, 'restore');
    assert.equal(restore.body.state, 'published');
    const retrySuspendedEvidence = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: duringSuspension.clientActivityId },
    });
    assert.equal(retrySuspendedEvidence.body.encountered_marker_ids.includes(markerE.id), false);
    const afterRestore = await completeActivity(
      actors.B, place.lat + 0.0002, place.lng, Date.now() + 2_000,
    );
    const verifyAfterRestore = await api(actors.B, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: afterRestore.clientActivityId },
    });
    assert.equal(verifyAfterRestore.body.encountered_marker_ids.includes(markerE.id), true);
    pass('PUB-12.operator-state', 'suspension removed access; restoration accepted only evidence observed after the restored eligibility time');

    const emptyActivity = await completeActivity(actors.A, place.lat + 0.0003, place.lng, Date.now() - 20_000);
    const empty = await createPublicCairn(actors.A, emptyActivity, place.lat + 0.0003, place.lng, '');
    assert.equal(empty.submission.code, 'PUBLIC_TEXT_REQUIRED');
    const [[emptyState]] = await db.execute('SELECT public_state FROM markers WHERE id=?', [empty.id]);
    assert.equal(emptyState.public_state, 'not_public');
    pass('PUB-13.empty-save', 'an empty explicitly Public Cairn remained durably owner-saved but did not enter discovery');

    // Audit history is metadata-only and deliberately outlives the content,
    // reporter, owner, and deciding operator rows it describes.
    const deletionPlace = { lat: place.lat + 0.002, lng: place.lng + 0.002 };
    const deletionOwnerActivity = await completeActivity(
      actors.F,
      deletionPlace.lat,
      deletionPlace.lng,
      Date.now() - 80_000,
    );
    const deletionMarker = await createPublicCairn(
      actors.F,
      deletionOwnerActivity,
      deletionPlace.lat,
      deletionPlace.lng,
      'Disposable audit-survival content',
    );
    const deletionPublication = await pendingSubmission(actors.C, deletionMarker.id);
    await decide(actors.C, deletionPublication.id, 'approve');
    const deletionViewerActivity = await completeActivity(
      actors.G,
      deletionPlace.lat,
      deletionPlace.lng,
      Date.now() + 1_000,
    );
    await api(actors.G, '/api/public-cairns/encounters/verify', {
      method: 'POST', expected: 200,
      body: { source_activity_client_id: deletionViewerActivity.clientActivityId },
    });
    await api(actors.G, `/api/public-cairns/cairns/${deletionMarker.id}/report`, {
      method: 'POST', expected: 200,
      body: {
        client_submission_id: crypto.randomUUID(),
        category: 'other',
        detail: 'Disposable report detail must not enter audit metadata.',
      },
    });
    await api(actors.F, `/api/markers/${deletionMarker.id}`, { method: 'DELETE', expected: 200 });
    const [[deletedSubjects]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM markers WHERE id=?) AS markers_n,
         (SELECT COUNT(*) FROM public_cairn_publications WHERE marker_id=?) AS publications_n,
         (SELECT COUNT(*) FROM public_cairn_reports WHERE marker_id=?) AS reports_n,
         (SELECT COUNT(*) FROM public_cairn_moderation_audit WHERE marker_id=?) AS audit_n`,
      [deletionMarker.id, deletionMarker.id, deletionMarker.id, deletionMarker.id],
    );
    assert.deepEqual(
      [Number(deletedSubjects.markers_n), Number(deletedSubjects.publications_n),
        Number(deletedSubjects.reports_n)],
      [0, 0, 0],
    );
    assert.ok(Number(deletedSubjects.audit_n) >= 4);
    const deletedSubjectAudit = await api(actors.C, '/api/public-cairns/operator/audit?limit=100', { expected: 200 });
    assert.ok(deletedSubjectAudit.body.events.some(event => (
      String(event.marker_id) === String(deletionMarker.id)
      && event.event_type === 'publication_withdrawn'
    )));
    await db.execute('DELETE FROM users WHERE id IN (?,?,?)', [actors.F.id, actors.G.id, actors.C.id]);
    const [[survivingAudit]] = await db.execute(
      `SELECT
         COUNT(*) AS audit_n,
         SUM(owner_user_id=? AND event_type='publication_submitted') AS owner_history_n,
         SUM(actor_user_id IS NULL AND event_type='report_submitted') AS reporter_actor_null_n,
         SUM(actor_user_id IS NULL AND event_type='publication_decision') AS operator_actor_null_n
       FROM public_cairn_moderation_audit WHERE marker_id=?`,
      [actors.F.id, deletionMarker.id],
    );
    assert.ok(Number(survivingAudit.audit_n) >= 4);
    assert.ok(Number(survivingAudit.owner_history_n) >= 1);
    assert.ok(Number(survivingAudit.reporter_actor_null_n) >= 1);
    assert.ok(Number(survivingAudit.operator_actor_null_n) >= 1);
    pass(
      'PUB-14.audit-survival',
      'marker/publication/report cascades and disposable owner/reporter/operator deletion retained metadata-only audit history with actor references nulled',
    );

    const [[counts]] = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM public_cairn_publications) AS publications,
        (SELECT COUNT(*) FROM public_cairn_encounters) AS encounters,
        (SELECT COUNT(*) FROM public_cairn_thanks) AS thanks_rows,
        (SELECT COUNT(*) FROM public_cairn_reports) AS reports`,
    );
    evidence.database_counts = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value)]));
    evidence.finished_at = new Date().toISOString();
    evidence.summary = { passed: evidence.assertions.length, failed: 0 };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await heldConnection.end().catch(() => {});
    await db.end().catch(() => {});
  }
}

main().catch(error => {
  evidence.finished_at = new Date().toISOString();
  evidence.summary = { passed: evidence.assertions.length, failed: 1 };
  evidence.failure = { name: error.name, message: error.message, stack: error.stack };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exitCode = 1;
});
