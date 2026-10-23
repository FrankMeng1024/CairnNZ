'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { locationPolicyVersion } = require('../../src/services/publicLocationPolicy');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
if (!baseUrl || !jwtSecret) throw new Error('HARNESS_API_URL and JWT_SECRET are required');

const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: 'Z',
};

const result = {
  schema: 'cairnnz.o90-dual-track-api-mysql.v1',
  started_at: new Date().toISOString(),
  assertions: [],
  performance: {},
};

function pass(id, detail) {
  result.assertions.push({ id, result: 'PASS', detail });
}

function tokenFor(id, label) {
  return jwt.sign({
    userId: String(id),
    token_version: 0,
    jti: `o90-dual-${label}-${crypto.randomUUID()}`,
  }, jwtSecret, { expiresIn: '2h' });
}

async function api(actor, path, { method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return { payload, response };
}

async function actor(db, label, { operator = false } = {}) {
  const [insert] = await db.execute(
    `INSERT INTO users
       (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
     VALUES (?,?,?,?,?,'isolated_qa')`,
    [`O90 ${label}`, `o90-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.invalid`,
      'synthetic-no-login', '1990-01-01', operator ? 1 : 0],
  );
  return { id: String(insert.insertId), label, token: tokenFor(insert.insertId, label) };
}

function snapshotHash({ text, lat, lng }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: 'cairn', text, lat: Number(lat), lng: Number(lng), approximate: true,
  })).digest('hex');
}

async function seedPublicCairn(db, owner, operator, { lat, lng, text }) {
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision,public_intent,public_state,publication_epoch,public_state_changed_at)
     VALUES (?,'cairn',?,?,?,'public',1,'healthy',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),1,1,'published',1,
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [owner.id, text, lat, lng],
  );
  const [publication] = await db.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_sha256,snapshot_location_policy_version,state,decided_at,decided_by,published_at)
     VALUES (?,?,1,1,'cairn',?,?,?,1,?,?,'published',
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),?,
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [marker.insertId, owner.id, text, lat, lng,
      snapshotHash({ text, lat, lng }), locationPolicyVersion(), operator.id],
  );
  return { markerId: String(marker.insertId), publicationId: String(publication.insertId) };
}

async function makeFriends(db, first, second) {
  await db.execute(
    `INSERT INTO friends (user_id,friend_id,created_at)
     VALUES (?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)),
            (?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [first.id, second.id, second.id, first.id],
  );
  await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,LEAST(?,?),GREATEST(?,?),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [crypto.randomUUID(), first.id, second.id, first.id, second.id],
  );
}

async function seedFriendCairn(db, owner, { lat, lng, text }) {
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision,content_changed_at)
     VALUES (?,'cairn',?,?,?,'group',1,'healthy',
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE),1,
             DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [owner.id, text, lat, lng],
  );
  await db.execute(
    `INSERT INTO marker_audience_epochs
       (marker_id,owner_id,audience_epoch,visibility,starts_at)
     VALUES (?,?,1,'group',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE))`,
    [marker.insertId, owner.id],
  );
  return { markerId: String(marker.insertId) };
}

function witness({ source, activityId = null, lat, lng, now = Date.now(),
  accuracy = 9, displacement = 0.000012, cid = crypto.randomUUID() }) {
  return {
    cid,
    first_lat: lat,
    first_lng: lng,
    first_observed_at_ms: now - 15_000,
    lat: lat + displacement,
    lng,
    observed_at_ms: now,
    evidence_source: source,
    source_activity_client_id: activityId,
    source_segment_id: activityId ? `${activityId}:segment-1` : `passive-${cid}`,
    horizontal_accuracy_m: accuracy,
    continuity_state: 'accepted',
  };
}

async function seedCanonicalActivity(db, viewer, item) {
  const route = [
    {
      lat: item.first_lat, lng: item.first_lng, t: item.first_observed_at_ms,
      acc: item.horizontal_accuracy_m, segment_id: item.source_segment_id,
    },
    {
      lat: item.lat, lng: item.lng, t: item.observed_at_ms,
      acc: item.horizontal_accuracy_m, segment_id: item.source_segment_id,
    },
  ];
  await db.execute(
    `INSERT INTO sessions
       (user_id,client_activity_id,type,start_time,end_time,finalized_at,
        distance_m,duration_s,route_points,route_points_raw,route_points_canonical,source_provenance)
     VALUES (?,?,'hiking',FROM_UNIXTIME(?/1000),FROM_UNIXTIME(?/1000),UTC_TIMESTAMP(3),
             2,15,CAST(? AS JSON),CAST(? AS JSON),CAST(? AS JSON),'isolated_qa')`,
    [viewer.id, item.source_activity_client_id, item.first_observed_at_ms, item.observed_at_ms,
      JSON.stringify(route), JSON.stringify(route), JSON.stringify(route)],
  );
}

function timingSummary(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50_ms: Number(sorted[Math.floor((sorted.length - 1) * 0.5)].toFixed(2)),
    p95_ms: Number(sorted[Math.ceil((sorted.length - 1) * 0.95)].toFixed(2)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(2)),
    over_50ms: sorted.filter(value => value > 50).length,
  };
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  try {
    await api(null, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [] }, expected: 401,
    });
    pass('AUTH.unauthenticated-rejected', 'walking evidence requires the existing authenticated API boundary');

    const operator = await actor(db, 'Operator', { operator: true });
    const publicAuthor = await actor(db, 'PublicAuthor');
    const friendAuthor = await actor(db, 'FriendAuthor');
    const activityViewer = await actor(db, 'ActivityViewer');
    const passiveViewer = await actor(db, 'PassiveViewer');
    const restartViewer = await actor(db, 'RestartViewer');
    const invalidViewer = await actor(db, 'InvalidViewer');
    await makeFriends(db, passiveViewer, friendAuthor);

    const publicCairn = await seedPublicCairn(db, publicAuthor, operator, {
      lat: -41.0, lng: 174.0, text: 'O90 isolated public dual-track check',
    });
    const friendCairn = await seedFriendCairn(db, friendAuthor, {
      lat: -41.01, lng: 174.01, text: 'O90 isolated friend dual-track check',
    });

    const memoryFailure = await api(activityViewer, '/api/memory/points', {
      method: 'POST', body: { points: 'deliberately-invalid' }, expected: 400,
    });
    assert.ok(memoryFailure.payload?.error);
    const activityId = crypto.randomUUID();
    const activityWitness = witness({
      source: 'activity_real', activityId, lat: -41.0, lng: 174.0,
    });
    await seedCanonicalActivity(db, activityViewer, activityWitness);
    const activityResult = await api(activityViewer, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [activityWitness] },
    });
    assert.deepEqual(activityResult.payload.processed_witness_cids, [activityWitness.cid]);
    assert.equal(activityResult.payload.acquired[0]?.marker_id, publicCairn.markerId);
    const [[memoryCount]] = await db.execute(
      'SELECT COUNT(*) AS n FROM memory_points WHERE user_id=?', [activityViewer.id],
    );
    assert.equal(Number(memoryCount.n), 0);
    pass('INDEPENDENCE.activity-memory-failure', 'Public discovery committed from canonical Activity walking evidence after a rejected Memory request, with zero memory_points rows');

    const replay = await api(activityViewer, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [activityWitness] },
    });
    assert.deepEqual(replay.payload.processed_witness_cids, [activityWitness.cid]);
    assert.equal(replay.payload.acquired.length, 0);
    const [[activityAcquisitions]] = await db.execute(
      'SELECT COUNT(*) AS n FROM cairn_acquisitions WHERE viewer_id=? AND marker_id=?',
      [activityViewer.id, publicCairn.markerId],
    );
    assert.equal(Number(activityAcquisitions.n), 1);
    pass('IDEMPOTENCY.activity-replay', 'repeating the same durable witness ACKed the same CID and did not duplicate acquisition');

    const passiveWitness = witness({
      source: 'passive_real', lat: -41.01, lng: 174.01,
    });
    const passiveResult = await api(passiveViewer, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [passiveWitness] },
    });
    assert.deepEqual(passiveResult.payload.processed_witness_cids, [passiveWitness.cid]);
    assert.equal(passiveResult.payload.acquired[0]?.marker_id, friendCairn.markerId);
    pass('PASSIVE.friend-independent', 'accepted passive walking evidence discovered an authorized Friends Cairn without a Memory upload dependency');

    const restartActivityId = crypto.randomUUID();
    const restartWitness = witness({
      source: 'activity_real', activityId: restartActivityId, lat: -41.0, lng: 174.0,
    });
    const pending = await api(restartViewer, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [restartWitness] },
    });
    assert.deepEqual(pending.payload.processed_witness_cids, []);
    assert.equal(pending.payload.reason, 'activity_route_pending');
    await seedCanonicalActivity(db, restartViewer, restartWitness);
    const reconciled = await api(restartViewer, '/api/cairn-memory/walking-evidence', {
      method: 'POST', body: { witnesses: [restartWitness] },
    });
    assert.deepEqual(reconciled.payload.processed_witness_cids, [restartWitness.cid]);
    assert.equal(reconciled.payload.acquired[0]?.marker_id, publicCairn.markerId);
    pass('RECOVERY.route-ack-order', 'pre-route Activity evidence remained durable and reconciled after canonical route persistence using the same CID');

    for (const [label, invalid] of [
      ['stationary', witness({ source: 'passive_real', lat: -41.02, lng: 174.02, displacement: 0 })],
      ['poor-accuracy', witness({ source: 'passive_real', lat: -41.02, lng: 174.02, accuracy: 80 })],
    ]) {
      const rejected = await api(invalidViewer, '/api/cairn-memory/walking-evidence', {
        method: 'POST', body: { witnesses: [invalid] },
      });
      assert.deepEqual(rejected.payload.processed_witness_cids, []);
      assert.equal(rejected.payload.reason, 'no_valid_walking_evidence');
      pass(`NEGATIVE.${label}`, `${label} evidence did not become discovery authority`);
    }
    const [[invalidCount]] = await db.execute(
      'SELECT COUNT(*) AS n FROM memory_presence_witnesses WHERE user_id=?', [invalidViewer.id],
    );
    assert.equal(Number(invalidCount.n), 0);

    const [[ownerFence]] = await db.execute(
      `SELECT COUNT(*) AS total,
              SUM(user_id=?) AS owned,
              SUM(user_id<>?) AS foreign_rows
         FROM memory_presence_witnesses WHERE client_id=?`,
      [activityViewer.id, activityViewer.id, activityWitness.cid],
    );
    assert.deepEqual(
      [Number(ownerFence.total), Number(ownerFence.owned), Number(ownerFence.foreign_rows)],
      [1, 1, 0],
    );
    pass('ISOLATION.owner-fence', 'the idempotent witness identity remained scoped to its authenticated owner');

    const timings = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const response = await api(activityViewer, '/api/cairn-memory/walking-evidence', {
        method: 'POST', body: { witnesses: [activityWitness] },
      });
      timings.push(performance.now() - started);
      assert.deepEqual(response.payload.processed_witness_cids, [activityWitness.cid]);
    }
    result.performance.idempotent_walking_evidence = timingSummary(timings);
    pass('PERF.bounded-replay', '20 sequential authenticated idempotent API round trips completed with recorded distribution');

    const [[ledger]] = await db.execute(
      `SELECT COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema=DATABASE() AND table_name='diagnostic_streams'`,
    );
    assert.equal(Number(ledger.n), 1);
    pass('MIGRATION.057-present', 'isolated schema includes the accepted automatic diagnostics migration before O90 verification');

    result.finished_at = new Date().toISOString();
    result.summary = { pass: result.assertions.length, fail: 0 };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  result.finished_at = new Date().toISOString();
  result.summary = { pass: result.assertions.length, fail: 1 };
  result.failure = { name: error.name, message: error.message, stack: error.stack };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
