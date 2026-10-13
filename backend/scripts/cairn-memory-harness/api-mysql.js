'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
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
};

const result = {
  schema: 'cairnnz.memory-friends-cairn-api-mysql.v1',
  started_at: new Date().toISOString(),
  assertions: [],
  counts: {},
};

function pass(id, detail) {
  result.assertions.push({ id, result: 'PASS', detail });
}

function tokenFor(id, label) {
  return jwt.sign({
    userId: String(id), token_version: 0,
    jti: `memory-cairn-${label}-${crypto.randomUUID()}`,
  }, jwtSecret, { expiresIn: '2h' });
}

async function api(actor, path, { method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

async function actor(db, label, { operator = false } = {}) {
  const [insert] = await db.execute(
    `INSERT INTO users
       (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
     VALUES (?,?,?,?,?,'isolated_qa')`,
    [`Memory ${label}`, `memory-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`,
      'synthetic-no-login', '1990-01-01', operator ? 1 : 0],
  );
  return { id: String(insert.insertId), label, token: tokenFor(insert.insertId, label) };
}

function snapshotHash({ type = 'cairn', text, lat, lng, approximate = true }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type, text, lat: Number(lat), lng: Number(lng), approximate: Boolean(approximate),
  })).digest('hex');
}

async function seedPublicCairn(db, owner, operator, {
  lat, lng, text, revision = 1, epoch = 1, eligibleNow = false,
}) {
  const eligibleAtSql = eligibleNow
    ? 'UTC_TIMESTAMP(3)'
    : 'DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)';
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision,public_intent,public_state,publication_epoch,public_state_changed_at)
     VALUES (?,'cairn',?,?,?,'public',1,'healthy',${eligibleAtSql},${eligibleAtSql},
             ?,1,'published',?,${eligibleAtSql})`,
    [owner.id, text, lat, lng, revision, epoch],
  );
  const hash = snapshotHash({ text, lat, lng });
  const [publication] = await db.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_sha256,snapshot_location_policy_version,state,decided_at,decided_by,published_at)
     VALUES (?,?,?,?,'cairn',?,?,?,1,?,?,'published',${eligibleAtSql},?,${eligibleAtSql})`,
    [marker.insertId, owner.id, epoch, revision, text, lat, lng, hash,
      locationPolicyVersion(), operator.id],
  );
  return { markerId: String(marker.insertId), publicationId: String(publication.insertId) };
}

async function seedFriendCairn(db, owner, {
  lat, lng, text, revision = 1, eligibleNow = false,
}) {
  const eligibleAtSql = eligibleNow
    ? 'UTC_TIMESTAMP(3)'
    : 'DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)';
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision,content_changed_at)
     VALUES (?,'cairn',?,?,?,'group',1,'healthy',${eligibleAtSql},${eligibleAtSql},?,${eligibleAtSql})`,
    [owner.id, text, lat, lng, revision],
  );
  await db.execute(
    `INSERT INTO marker_audience_epochs
       (marker_id,owner_id,audience_epoch,visibility,starts_at)
     SELECT id,user_id,audience_epoch,'group',created_at
       FROM markers WHERE id=?`,
    [marker.insertId],
  );
  return { markerId: String(marker.insertId) };
}

async function makeFriends(db, first, second, { startsNow = false } = {}) {
  const startedAtSql = startsNow
    ? 'UTC_TIMESTAMP(3)'
    : 'DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE)';
  await db.execute(
    `INSERT INTO friends (user_id,friend_id,created_at)
     VALUES (?,?,${startedAtSql}),(?,?,${startedAtSql})`,
    [first.id, second.id, second.id, first.id],
  );
  await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,LEAST(?,?),GREATEST(?,?),${startedAtSql})`,
    [crypto.randomUUID(), first.id, second.id, first.id, second.id],
  );
}

async function publishRevision(db, cairn, owner, operator, { text, revision, epoch }) {
  const [[position]] = await db.execute('SELECT lat,lng FROM markers WHERE id=?', [cairn.markerId]);
  await db.execute(
    `UPDATE public_cairn_publications SET state='withdrawn',withdrawn_at=UTC_TIMESTAMP(3)
      WHERE marker_id=? AND state='published'`,
    [cairn.markerId],
  );
  await db.execute(
    `UPDATE markers SET text=?,content_revision=?,publication_epoch=?,
            public_state='published',updated_at=UTC_TIMESTAMP(3)
      WHERE id=? AND user_id=?`,
    [text, revision, epoch, cairn.markerId, owner.id],
  );
  const hash = snapshotHash({ text, lat: position.lat, lng: position.lng });
  const [publication] = await db.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_sha256,snapshot_location_policy_version,state,decided_at,decided_by,published_at)
     VALUES (?,?,?,?,'cairn',?,?,?,1,?,?,'published',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))`,
    [cairn.markerId, owner.id, epoch, revision, text,
      position.lat, position.lng, hash, locationPolicyVersion(), operator.id],
  );
  return String(publication.insertId);
}

async function acceptedPresence(viewer, lat, lng, observedAt = Date.now()) {
  const cid = crypto.randomUUID();
  const firstObservedAt = observedAt - 15_000;
  const body = await api(viewer, '/api/memory/points', {
    method: 'POST',
    body: {
      presence_witnesses: [{
        cid,
        first_lat: lat,
        first_lng: lng,
        first_observed_at_ms: firstObservedAt,
        lat: lat + 0.000005,
        lng: lng + 0.000005,
        observed_at_ms: observedAt,
        evidence_source: 'passive_real',
        source_activity_client_id: null,
        source_segment_id: null,
        horizontal_accuracy_m: 9,
        continuity_state: 'accepted',
      }],
    },
  });
  assert.deepEqual(body.presence_witnesses.map(item => item.cid), [cid]);
  return cid;
}

async function acceptedActivityPresence(viewer, canonical, witness, observedAt = Date.now()) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const timestamps = [observedAt - 15_000, observedAt];
  const canonicalPoints = timestamps.map((t, index) => ({
    lat: canonical.lat + index * 0.000005,
    lng: canonical.lng + index * 0.000005,
    t,
    acc: 9,
    segment_id: sourceSegmentId,
  }));
  const started = await api(viewer, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: {
      client_activity_id: clientActivityId,
      type: 'hiking',
      start_time: new Date(timestamps[0]).toISOString(),
    },
  });
  await api(viewer, `/api/sessions/${started.id}/save`, {
    method: 'PATCH',
    body: {
      client_activity_id: clientActivityId,
      end_time: new Date(timestamps[1]).toISOString(),
      distance_m: 20,
      duration_s: 15,
      name: 'Isolated canonical-evidence adversary',
      route_points: canonicalPoints,
      route_points_raw: canonicalPoints,
      route_points_canonical: canonicalPoints,
      memory_points: canonicalPoints.map(point => ({
        lat: point.lat, lng: point.lng, ts: point.t,
        cid: crypto.randomUUID(), evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 9, continuity_state: 'accepted',
      })),
    },
  });
  await api(viewer, '/api/memory/points', {
    method: 'POST',
    body: {
      presence_witnesses: timestamps.map((t, index) => ({
        cid: crypto.randomUUID(),
        first_lat: witness.lat + index * 0.000005,
        first_lng: witness.lng + index * 0.000005,
        first_observed_at_ms: t,
        lat: witness.lat + index * 0.000005,
        lng: witness.lng + index * 0.000005,
        observed_at_ms: t,
        evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 9,
        continuity_state: 'accepted',
      })),
    },
  });
  return { clientActivityId, canonicalPoints };
}

async function acceptedActiveActivityPresence(viewer, location, observedAt = Date.now()) {
  const clientActivityId = crypto.randomUUID();
  const sourceSegmentId = `${clientActivityId}:segment-1`;
  const timestamps = [observedAt - 15_000, observedAt];
  const canonicalPoints = timestamps.map((t, index) => ({
    lat: location.lat + index * 0.000005,
    lng: location.lng + index * 0.000005,
    t,
    acc: 9,
    segment_id: sourceSegmentId,
  }));
  const started = await api(viewer, '/api/sessions/start', {
    method: 'POST', expected: 201,
    body: {
      client_activity_id: clientActivityId,
      type: 'hiking',
      start_time: new Date(timestamps[0]).toISOString(),
    },
  });
  await api(viewer, `/api/sessions/${started.id}/append-points`, {
    method: 'PATCH',
    body: { points: canonicalPoints, client_op_id: crypto.randomUUID() },
  });
  await api(viewer, '/api/memory/points', {
    method: 'POST',
    body: {
      presence_witnesses: timestamps.map((t, index) => ({
        cid: crypto.randomUUID(),
        first_lat: canonicalPoints[index].lat,
        first_lng: canonicalPoints[index].lng,
        first_observed_at_ms: t,
        lat: canonicalPoints[index].lat,
        lng: canonicalPoints[index].lng,
        observed_at_ms: t,
        evidence_source: 'activity_real',
        source_activity_client_id: clientActivityId,
        source_segment_id: sourceSegmentId,
        horizontal_accuracy_m: 9,
        continuity_state: 'accepted',
      })),
    },
  });
  return { clientActivityId, canonicalPoints };
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  try {
    const owner = await actor(db, 'Owner');
    const viewer = await actor(db, 'Viewer');
    const operator = await actor(db, 'Operator', { operator: true });
    const placeA = { lat: -41.2867, lng: 174.7763 };
    const placeB = { lat: -41.2847, lng: 174.7763 }; // ~222 m north.

    const dense = [];
    for (let index = 0; index < 200; index += 1) {
      dense.push(await seedPublicCairn(db, owner, operator, {
        ...placeA,
        text: `Dense locality Cairn ${index}`,
      }));
    }
    await acceptedPresence(viewer, placeA.lat, placeA.lng);
    const first = await api(viewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.equal(first.acquired.length, 3);
    assert.equal(first.local_visit_limit, 3);
    assert.equal(first.locality_exit_distance_m, 120);
    assert.equal(first.same_locality_revisit_minutes, 15);
    assert.equal(first.presentation_merge_window_seconds, 20);
    assert.equal(first.haptic_min_interval_seconds, 180);
    const stationaryRetry = await api(viewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(stationaryRetry.acquired, []);
    assert.equal(stationaryRetry.reason, 'local_visit_limit');
    const found = await api(viewer, '/api/cairn-memory/library?section=found');
    assert.equal(found.cairns.length, 3);
    assert.equal(found.unread_count, 3);
    assert.ok(found.cairns.every(item => item.author_name == null));
    assert.equal(new Set(first.acquired.map(item => item.presentation_group_id)).size, 1);
    pass('DISC-PROD-01.dense-locality', 'real API/MySQL discovery selected exactly 3 of 200, retries added none, and unread counted three Cairn groups');

    // The first foreground cue is available immediately; the 20-second
    // window merges later events into it rather than delaying persistence or
    // initial presentation.
    const pending = await api(viewer, '/api/cairn-memory/presentation/pending');
    assert.equal(pending.groups.length, 1);
    assert.equal(Number(pending.groups[0].cairn_count), 3);
    assert.equal(Number(pending.groups[0].unannounced_event_count), 3);
    const presentationGroupId = String(pending.groups[0].id);
    await api(viewer, `/api/cairn-memory/presentation/${presentationGroupId}/announced`, {
      method: 'POST', body: { event_through_id: pending.groups[0].event_through_id },
    });
    const stillMerging = await api(viewer, '/api/cairn-memory/presentation/pending');
    assert.equal(stillMerging.groups.length, 1);
    assert.equal(Number(stillMerging.groups[0].unannounced_event_count), 0);
    await db.execute(
      `UPDATE cairn_presentation_groups SET merge_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)
        WHERE viewer_id=?`,
      [viewer.id],
    );
    assert.deepEqual((await api(viewer, '/api/cairn-memory/presentation/pending')).groups, []);
    const [[presentationState]] = await db.execute(
      `SELECT COUNT(DISTINCT presentation_group_id) AS groups_n,
              SUM(announced_at IS NOT NULL) AS announced_events
         FROM cairn_acquisition_events WHERE viewer_id=?`,
      [viewer.id],
    );
    assert.deepEqual(
      [Number(presentationState.groups_n), Number(presentationState.announced_events)],
      [1, 3],
    );
    const activeExpired = await api(
      viewer,
      `/api/cairn-memory/presentation/pending?active_group_ids=${presentationGroupId}`,
    );
    assert.equal(activeExpired.groups.length, 1);
    assert.equal(String(activeExpired.groups[0].id), presentationGroupId);
    assert.equal(Number(activeExpired.groups[0].cairn_count), 3);

    await api(viewer, `/api/cairn-memory/cairns/${found.cairns[0].marker_id}/collection`, {
      method: 'PUT', body: { action: 'remove' },
    });
    const partiallyRemoved = await api(
      viewer,
      `/api/cairn-memory/presentation/pending?active_group_ids=${presentationGroupId}`,
    );
    assert.equal(partiallyRemoved.groups.length, 1);
    assert.equal(Number(partiallyRemoved.groups[0].cairn_count), 2);
    assert.deepEqual(partiallyRemoved.withdrawn_group_ids, []);

    for (const cairn of found.cairns.slice(1)) {
      await api(viewer, `/api/cairn-memory/cairns/${cairn.marker_id}/collection`, {
        method: 'PUT', body: { action: 'remove' },
      });
    }
    const explicitlyWithdrawn = await api(
      viewer,
      `/api/cairn-memory/presentation/pending?active_group_ids=${presentationGroupId}`,
    );
    assert.deepEqual(explicitlyWithdrawn.groups, []);
    assert.deepEqual(explicitlyWithdrawn.withdrawn_group_ids, [presentationGroupId]);
    assert.equal(explicitlyWithdrawn.acquired_cairn_count, 0);
    assert.equal(explicitlyWithdrawn.unread_count, 0);
    pass('DISC-PROD-02.presentation', 'three durable acquisitions surfaced immediately in one mergeable group; exact event watermark acknowledgement remained independent of per-revision read state');
    pass('DISC-PROD-02b.active-group-authority', 'an acknowledged expired active group remained queryable with its authoritative count; one explicit removal reduced it from three to two without withdrawing the group');
    pass('DISC-PROD-02c.explicit-withdrawal', 'explicit removal of every eligible Cairn returned no active group and named the group in withdrawn_group_ids');

    const friendOwner = await actor(db, 'FriendOwner');
    const friendViewer = await actor(db, 'FriendViewer');
    await makeFriends(db, friendOwner, friendViewer);
    const friendPlace = { lat: -40.9006, lng: 174.8860 };
    const guaranteedFriends = [];
    for (let index = 0; index < 5; index += 1) {
      guaranteedFriends.push(await seedFriendCairn(db, friendOwner, {
        ...friendPlace, text: `Guaranteed friend Cairn ${index}`,
      }));
    }
    for (let index = 0; index < 200; index += 1) {
      await seedPublicCairn(db, owner, operator, {
        ...friendPlace, text: `Competing Public Cairn ${index}`,
      });
    }
    await acceptedPresence(friendViewer, friendPlace.lat, friendPlace.lng, Date.now() + 500);
    const friendOverflow = await api(friendViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.equal(friendOverflow.acquired.length, 5);
    assert.ok(friendOverflow.acquired.every(item => item.category === 'friend'));
    assert.deepEqual(
      new Set(friendOverflow.acquired.map(item => item.marker_id)),
      new Set(guaranteedFriends.map(item => item.markerId)),
    );
    assert.equal(new Set(friendOverflow.acquired.map(item => item.presentation_group_id)).size, 1);
    await db.execute('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)',
      [friendOwner.id, friendViewer.id, friendViewer.id, friendOwner.id]);
    await db.execute(
      `UPDATE friendship_episodes SET ended_at=UTC_TIMESTAMP(3),ended_reason='unfriended'
        WHERE user_low_id=LEAST(?,?) AND user_high_id=GREATEST(?,?) AND ended_at IS NULL`,
      [friendOwner.id, friendViewer.id, friendOwner.id, friendViewer.id],
    );
    const historyAfterUnfriend = await api(friendViewer, '/api/cairn-memory/library?section=found');
    assert.equal(historyAfterUnfriend.cairns.length, 5);
    assert.ok(historyAfterUnfriend.cairns.every(item => item.author_name === 'Memory FriendOwner'));
    const postUnfriendPlace = { lat: friendPlace.lat + 0.002, lng: friendPlace.lng };
    await seedFriendCairn(db, friendOwner, { ...postUnfriendPlace, text: 'Not eligible after unfriend' });
    await acceptedPresence(friendViewer, postUnfriendPlace.lat, postUnfriendPlace.lng, Date.now() + 1_000);
    const afterUnfriend = await api(friendViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(afterUnfriend.acquired, []);
    pass('DISC-PROD-02a.friend-guarantee', 'five eligible Friend Cairns beat the normal cap and two hundred Public candidates, shared one presentation group, and stayed as acquired history after unfriend while future Friend-only eligibility ended');

    const overflowTimings = {};
    for (const total of [20, 100]) {
      const loadViewer = await actor(db, `FriendLoad${total}`);
      await makeFriends(db, friendOwner, loadViewer);
      const loadPlace = { lat: -40.1000 - total * 0.0001, lng: 175.1000 };
      for (let index = 0; index < total; index += 1) {
        await seedFriendCairn(db, friendOwner, {
          ...loadPlace, text: `Guaranteed Friend load ${total} / ${index}`,
        });
      }
      await acceptedPresence(loadViewer, loadPlace.lat, loadPlace.lng, Date.now() + total * 20);
      const startedAt = Date.now();
      const draw = await api(loadViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
      overflowTimings[total] = Date.now() - startedAt;
      assert.equal(draw.acquired.length, total);
      assert.equal(new Set(draw.acquired.map(item => item.presentation_group_id)).size, 1);
      const loadLibrary = await api(loadViewer, '/api/cairn-memory/library?section=found');
      assert.equal(loadLibrary.cairns.length, total);
      assert.equal(loadLibrary.unread_count, total);
    }
    pass('DISC-PROD-02aa.friend-overflow-load', `20 and 100 same-author Friend Cairns were all acquired into one presentation group; API timings ${JSON.stringify(overflowTimings)} ms`);

    const publicFriendViewer = await actor(db, 'PublicFriendViewer');
    await makeFriends(db, friendOwner, publicFriendViewer);
    const publicFriendPlace = { lat: -39.4902, lng: 176.9179 };
    const currentFriendPublic = await seedPublicCairn(db, friendOwner, operator, {
      ...publicFriendPlace, text: 'Current friend Public Cairn',
    });
    for (let index = 0; index < 200; index += 1) {
      await seedPublicCairn(db, owner, operator, {
        ...publicFriendPlace, text: `Ordinary Public competition ${index}`,
      });
    }
    await acceptedPresence(publicFriendViewer, publicFriendPlace.lat, publicFriendPlace.lng, Date.now() + 1_500);
    const publicFriendDraw = await api(publicFriendViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.equal(publicFriendDraw.acquired.length, 3);
    assert.ok(publicFriendDraw.acquired.some(item => (
      item.marker_id === currentFriendPublic.markerId && item.category === 'friend'
    )));
    pass('DISC-PROD-02b.friend-public-priority', 'a current friend Public Cairn was guaranteed ahead of two hundred ordinary Public candidates while the ordinary visit target remained three');

    const canonicalViewer = await actor(db, 'CanonicalViewer');
    const canonicalTarget = { lat: -37.7870, lng: 175.2793 };
    const canonicalElsewhere = { lat: -37.7970, lng: 175.2793 };
    await seedPublicCairn(db, owner, operator, {
      ...canonicalTarget, text: 'Must match canonical Activity evidence',
    });
    await acceptedActivityPresence(
      canonicalViewer,
      canonicalElsewhere,
      canonicalTarget,
      Date.now() + 1_800,
    );
    const mismatchedActivity = await api(canonicalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(mismatchedActivity.acquired, []);
    assert.equal(mismatchedActivity.reason, 'fresh_continuous_presence_required');
    pass('DISC-PROD-02c.canonical-proof', 'an activity_real witness near a Cairn was rejected when its timestamp/coordinate/segment did not exist in the Activity canonical geometry');

    const canonicalPositiveViewer = await actor(db, 'CanonicalPositiveViewer');
    const canonicalPositiveTarget = { lat: -37.6868, lng: 176.1667 };
    const canonicalPositiveCairn = await seedPublicCairn(db, owner, operator, {
      ...canonicalPositiveTarget, text: 'Matches final canonical Activity evidence',
    });
    await acceptedActivityPresence(
      canonicalPositiveViewer,
      canonicalPositiveTarget,
      canonicalPositiveTarget,
      Date.now() + 2_000,
    );
    const matchedActivity = await api(canonicalPositiveViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(
      matchedActivity.acquired.map(item => item.marker_id),
      [canonicalPositiveCairn.markerId],
    );
    pass('DISC-PROD-02d.canonical-positive', 'activity_real evidence was accepted when both observations matched the finalized canonical timestamp, coordinate and segment identity');

    const activeCanonicalViewer = await actor(db, 'ActiveCanonicalViewer');
    const activeCanonicalTarget = { lat: -39.0556, lng: 174.0752 };
    const activeCanonicalCairn = await seedPublicCairn(db, owner, operator, {
      ...activeCanonicalTarget, text: 'Matches an active Activity route prefix',
    });
    await acceptedActiveActivityPresence(
      activeCanonicalViewer,
      activeCanonicalTarget,
      Date.now() + 2_500,
    );
    const activeMatched = await api(activeCanonicalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(
      activeMatched.acquired.map(item => item.marker_id),
      [activeCanonicalCairn.markerId],
    );
    pass('DISC-PROD-02e.active-canonical-positive', 'activity_real evidence from an unfinished Hike was accepted only after its exact ordered route prefix was durably acknowledged by the server');

    const distant = await seedPublicCairn(db, owner, operator, {
      ...placeB, text: 'Different locality without global cooldown',
    });
    await acceptedPresence(viewer, placeB.lat, placeB.lng, Date.now() + 1_000);
    const elsewhere = await api(viewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.equal(elsewhere.acquired.length, 1);
    assert.equal(elsewhere.acquired[0].marker_id, distant.markerId);
    assert.notEqual(elsewhere.visit_id, first.visit_id);
    pass('DISC-PROD-03.no-global-cooldown', 'fresh accepted evidence in a genuinely different locality acquired immediately despite the first visit reaching its cap');

    const temporalViewer = await actor(db, 'TemporalViewer');
    const temporalPlace = { lat: -46.4132, lng: 168.3538 };
    await acceptedPresence(temporalViewer, temporalPlace.lat, temporalPlace.lng, Date.now() + 2_000);
    const emptyArrival = await api(temporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(emptyArrival.acquired, []);
    const publishedWhileStanding = await seedPublicCairn(db, owner, operator, {
      ...temporalPlace, text: 'Published after arrival', eligibleNow: true,
    });
    await acceptedPresence(temporalViewer, temporalPlace.lat, temporalPlace.lng, Date.now() + 2_500);
    const noStationaryFeed = await api(temporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(noStationaryFeed.acquired, []);
    const temporalDeparture = { lat: temporalPlace.lat + 0.002, lng: temporalPlace.lng };
    await acceptedPresence(temporalViewer, temporalDeparture.lat, temporalDeparture.lng, Date.now() + 3_000);
    await api(temporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [temporalViewer.id, temporalPlace.lat - 0.0001, temporalPlace.lat + 0.0001],
    );
    await acceptedPresence(temporalViewer, temporalPlace.lat, temporalPlace.lng, Date.now() + 30_000);
    const laterArrival = await api(temporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(laterArrival.acquired.map(item => item.marker_id), [publishedWhileStanding.markerId]);
    pass('DISC-PROD-03b.temporal-eligibility', 'publication after visit entry did not create a stationary feed; genuine departure, elapsed revisit gate and fresh arrival acquired it later');

    const friendshipTemporalViewer = await actor(db, 'FriendshipTemporalViewer');
    const friendshipTemporalOwner = await actor(db, 'FriendshipTemporalOwner');
    const friendshipTemporalPlace = { lat: -35.7251, lng: 174.3237 };
    const beforeFriendship = await seedFriendCairn(db, friendshipTemporalOwner, {
      ...friendshipTemporalPlace, text: 'Friendship starts after arrival',
    });
    await acceptedPresence(
      friendshipTemporalViewer,
      friendshipTemporalPlace.lat,
      friendshipTemporalPlace.lng,
      Date.now() + 4_000,
    );
    assert.deepEqual((await api(friendshipTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    await makeFriends(db, friendshipTemporalOwner, friendshipTemporalViewer, { startsNow: true });
    await acceptedPresence(
      friendshipTemporalViewer,
      friendshipTemporalPlace.lat,
      friendshipTemporalPlace.lng,
      Date.now() + 4_500,
    );
    assert.deepEqual((await api(friendshipTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    const friendshipDeparture = {
      lat: friendshipTemporalPlace.lat + 0.002,
      lng: friendshipTemporalPlace.lng,
    };
    await acceptedPresence(friendshipTemporalViewer, friendshipDeparture.lat, friendshipDeparture.lng, Date.now() + 5_000);
    await api(friendshipTemporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [friendshipTemporalViewer.id, friendshipTemporalPlace.lat - 0.0001, friendshipTemporalPlace.lat + 0.0001],
    );
    await acceptedPresence(
      friendshipTemporalViewer,
      friendshipTemporalPlace.lat,
      friendshipTemporalPlace.lng,
      Date.now() + 31_000,
    );
    const friendshipReturn = await api(friendshipTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(friendshipReturn.acquired.map(item => item.marker_id), [beforeFriendship.markerId]);
    pass('DISC-PROD-03c.friendship-boundary', 'a friendship beginning after visit entry did not retroactively unlock a stationary Friend Cairn; a genuine later visit did');

    const audienceTemporalViewer = await actor(db, 'AudienceTemporalViewer');
    const audienceTemporalOwner = await actor(db, 'AudienceTemporalOwner');
    await makeFriends(db, audienceTemporalOwner, audienceTemporalViewer);
    const audienceTemporalPlace = { lat: -36.8485, lng: 174.7633 };
    const [privateMarker] = await db.execute(
      `INSERT INTO markers
         (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
          content_revision,audience_epoch)
       VALUES (?,'cairn','Audience starts after arrival',?,?,'personal',1,'healthy',
               UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),1,1)`,
      [audienceTemporalOwner.id, audienceTemporalPlace.lat, audienceTemporalPlace.lng],
    );
    await db.execute(
      `INSERT INTO marker_audience_epochs
         (marker_id,owner_id,audience_epoch,visibility,starts_at)
       VALUES (?,?,1,'personal',UTC_TIMESTAMP(3))`,
      [privateMarker.insertId, audienceTemporalOwner.id],
    );
    await acceptedPresence(
      audienceTemporalViewer,
      audienceTemporalPlace.lat,
      audienceTemporalPlace.lng,
      Date.now() + 6_000,
    );
    assert.deepEqual((await api(audienceTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    await db.execute(
      `UPDATE marker_audience_epochs SET ends_at=UTC_TIMESTAMP(3)
        WHERE marker_id=? AND audience_epoch=1`,
      [privateMarker.insertId],
    );
    await db.execute(
      `UPDATE markers SET permission='group',audience_epoch=2,
              audience_changed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
        WHERE id=?`,
      [privateMarker.insertId],
    );
    await db.execute(
      `INSERT INTO marker_audience_epochs
         (marker_id,owner_id,audience_epoch,visibility,starts_at)
       VALUES (?,?,2,'group',UTC_TIMESTAMP(3))`,
      [privateMarker.insertId, audienceTemporalOwner.id],
    );
    await acceptedPresence(
      audienceTemporalViewer,
      audienceTemporalPlace.lat,
      audienceTemporalPlace.lng,
      Date.now() + 6_500,
    );
    assert.deepEqual((await api(audienceTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    const audienceDeparture = {
      lat: audienceTemporalPlace.lat + 0.002,
      lng: audienceTemporalPlace.lng,
    };
    await acceptedPresence(audienceTemporalViewer, audienceDeparture.lat, audienceDeparture.lng, Date.now() + 7_000);
    await api(audienceTemporalViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [audienceTemporalViewer.id, audienceTemporalPlace.lat - 0.0001, audienceTemporalPlace.lat + 0.0001],
    );
    await acceptedPresence(
      audienceTemporalViewer,
      audienceTemporalPlace.lat,
      audienceTemporalPlace.lng,
      Date.now() + 32_000,
    );
    const audienceReturn = await api(audienceTemporalViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(
      audienceReturn.acquired.map(item => item.marker_id),
      [String(privateMarker.insertId)],
    );
    pass('DISC-PROD-03d.audience-boundary', 'a Friends audience epoch beginning after visit entry did not retroactively unlock a stationary Cairn; a genuine later visit did');

    const friendRevisionOwner = await actor(db, 'FriendRevisionOwner');
    const friendRevisionViewer = await actor(db, 'FriendRevisionViewer');
    await makeFriends(db, friendRevisionOwner, friendRevisionViewer);
    const friendRevisionPlace = { lat: -36.8648, lng: 174.7775 };
    const friendRevisionCairn = await seedFriendCairn(db, friendRevisionOwner, {
      ...friendRevisionPlace, text: 'Friend revision one', revision: 1,
    });
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionPlace.lat,
      friendRevisionPlace.lng,
      Date.now() + 8_000,
    );
    const friendRevisionFirst = await api(friendRevisionViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(friendRevisionFirst.acquired.map(item => item.content_revision), [1]);

    // End the v1 visit and establish a genuinely new visit before the edit.
    // This distinguishes the revision temporal frontier from the same-visit
    // marker guard: v5 must not become eligible merely because its evidence is
    // newer than the edit while this second visit remains open.
    const friendRevisionDeparture = {
      lat: friendRevisionPlace.lat + 0.002,
      lng: friendRevisionPlace.lng,
    };
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionDeparture.lat,
      friendRevisionDeparture.lng,
      Date.now() + 9_000,
    );
    await api(friendRevisionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [friendRevisionViewer.id, friendRevisionPlace.lat - 0.0001, friendRevisionPlace.lat + 0.0001],
    );
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionPlace.lat,
      friendRevisionPlace.lng,
      Date.now() + 25_000,
    );
    assert.deepEqual((await api(friendRevisionViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    const [[friendRevisionOpenVisit]] = await db.execute(
      `SELECT id,UNIX_TIMESTAMP(entered_at)*1000 AS entered_at_ms
         FROM cairn_local_visits
        WHERE viewer_id=? AND departed_at IS NULL
        ORDER BY entered_at DESC,id DESC LIMIT 1`,
      [friendRevisionViewer.id],
    );
    assert.ok(friendRevisionOpenVisit, 'the second visit must exist before editing');
    for (const revision of [2, 3, 4, 5]) {
      const updated = await api(
        friendRevisionOwner,
        `/api/markers/${friendRevisionCairn.markerId}`,
        { method: 'PUT', body: { text: `Friend revision ${revision}` } },
      );
      assert.equal(Number(updated.content_revision), revision);
    }
    const [[friendRevisionFrontier]] = await db.execute(
      `SELECT content_revision,
              UNIX_TIMESTAMP(content_changed_at)*1000 AS content_changed_at_ms
         FROM markers WHERE id=?`,
      [friendRevisionCairn.markerId],
    );
    assert.equal(Number(friendRevisionFrontier.content_revision), 5);
    assert.ok(
      Number(friendRevisionFrontier.content_changed_at_ms)
        > Number(friendRevisionOpenVisit.entered_at_ms),
      'the authenticated content frontier must be strictly after the open visit',
    );
    // Force the otherwise sub-millisecond race boundary exactly equal. The
    // production predicate must fail closed rather than treating equality as
    // proof that content existed before entry.
    await db.execute(
      `UPDATE cairn_local_visits visit
         JOIN markers marker ON marker.id=?
          SET visit.entered_at=marker.content_changed_at
        WHERE visit.id=? AND visit.viewer_id=?`,
      [friendRevisionCairn.markerId, friendRevisionOpenVisit.id, friendRevisionViewer.id],
    );
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionPlace.lat,
      friendRevisionPlace.lng,
      Date.now() + 8_500,
    );
    assert.deepEqual((await api(friendRevisionViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    })).acquired, []);
    pass('DISC-PROD-03e.content-frontier', 'authenticated Friend edits use a millisecond content frontier strictly after the already-open visit; exact equality also fails closed and remains ineligible while stationary');
    // MySQL timestamps are millisecond-granular. Ensure the next server-side
    // visit entry is observably after the edit rather than equal to it.
    await new Promise(resolve => setTimeout(resolve, 20));
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionDeparture.lat,
      friendRevisionDeparture.lng,
      Date.now() + 9_000,
    );
    await api(friendRevisionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [friendRevisionViewer.id, friendRevisionPlace.lat - 0.0001, friendRevisionPlace.lat + 0.0001],
    );
    await acceptedPresence(
      friendRevisionViewer,
      friendRevisionPlace.lat,
      friendRevisionPlace.lng,
      Date.now() + 40_000,
    );
    const friendRevisionReturn = await api(friendRevisionViewer, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(friendRevisionReturn.acquired.map(item => item.content_revision), [5]);
    const friendRevisionHistory = await api(
      friendRevisionViewer,
      `/api/cairn-memory/cairns/${friendRevisionCairn.markerId}/history`,
    );
    assert.deepEqual(friendRevisionHistory.revisions.map(item => Number(item.content_revision)), [5, 1]);
    pass('DISC-PROD-03e.friend-revision-boundary', 'a Friends-only v5 edit after a later visit began did not create a stationary acquisition; only another genuine post-edit visit acquired v5 and retained v1');

    const cadenceViewer = await actor(db, 'CadenceViewer');
    const cadenceMarkers = [];
    for (let index = 0; index < 10; index += 1) {
      const location = { lat: -38.0000 + index * 0.0020, lng: 175.0000 };
      cadenceMarkers.push({
        ...location,
        cairn: await seedPublicCairn(db, owner, operator, {
          ...location, text: `Presentation cadence ${index}`,
        }),
      });
    }
    const cadenceAcquisitions = [];
    for (const [index, item] of cadenceMarkers.entries()) {
      await acceptedPresence(cadenceViewer, item.lat, item.lng, Date.now() + 20_000 + index * 1_000);
      const draw = await api(cadenceViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
      cadenceAcquisitions.push(...draw.acquired);
    }
    assert.equal(cadenceAcquisitions.length, 10);
    assert.equal(new Set(cadenceAcquisitions.map(item => item.presentation_group_id)).size, 1);
    await db.execute(
      `UPDATE cairn_presentation_groups SET merge_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)
        WHERE viewer_id=?`,
      [cadenceViewer.id],
    );
    const cadencePending = await api(cadenceViewer, '/api/cairn-memory/presentation/pending');
    assert.equal(cadencePending.groups.length, 1);
    assert.equal(Number(cadencePending.groups[0].cairn_count), 10);
    const cadenceLibrary = await api(cadenceViewer, '/api/cairn-memory/library?section=found');
    assert.equal(cadenceLibrary.unread_count, 10);
    pass('DISC-PROD-03a.presentation-10', 'ten acquisitions across genuine localities inside twenty seconds persisted as ten unread Cairn groups but one durable presentation group, with no global discovery cooldown');

    // Use a separate isolated locality so the revision contract is not made
    // deterministic by weakening the production weighted selector.
    const versionViewer = await actor(db, 'VersionViewer');
    const versionPlace = { lat: -43.5321, lng: 172.6362 };
    const versionOnly = await seedPublicCairn(db, owner, operator, {
      ...versionPlace, text: 'Version one', revision: 1, epoch: 1,
    });
    await acceptedPresence(versionViewer, versionPlace.lat, versionPlace.lng, Date.now() + 3_000);
    const versionFirst = await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(versionFirst.acquired.map(item => item.content_revision), [1]);
    const versionFivePublicationId = await publishRevision(
      db,
      versionOnly,
      owner,
      operator,
      { text: 'Version five', revision: 5, epoch: 2 },
    );
    const stationaryV5 = await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(stationaryV5.acquired, []);

    const departure = { lat: versionPlace.lat + 0.002, lng: versionPlace.lng };
    await acceptedPresence(versionViewer, departure.lat, departure.lng, Date.now() + 4_000);
    await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await acceptedPresence(versionViewer, versionPlace.lat, versionPlace.lng, Date.now() + 5_000);
    const earlyReturn = await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(earlyReturn.acquired, []);

    await acceptedPresence(versionViewer, departure.lat, departure.lng, Date.now() + 6_000);
    await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [versionViewer.id, versionPlace.lat - 0.0001, versionPlace.lat + 0.0001],
    );
    await acceptedPresence(versionViewer, versionPlace.lat, versionPlace.lng, Date.now() + 35_000);
    const returned = await api(versionViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(returned.acquired.map(item => item.content_revision), [5]);
    const history = await api(versionViewer, `/api/cairn-memory/cairns/${versionOnly.markerId}/history`);
    assert.deepEqual(history.revisions.map(item => Number(item.content_revision)), [5, 1]);
    const latest = history.revisions[0];
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {}, expected: 404,
    });
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/read`, {
      method: 'POST', body: {},
    });
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {},
    });
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {},
    });
    const [[readState]] = await db.execute(
      `SELECT opened_at,thanked_at FROM cairn_acquisitions
        WHERE viewer_id=? AND cairn_revision_id=?`,
      [versionViewer.id, latest.revision_id],
    );
    assert.ok(readState.opened_at);
    assert.ok(readState.thanked_at);
    const ownerLibraryAfterThanks = await api(owner, '/api/markers/library?limit=100');
    const thankedOwnerCairn = ownerLibraryAfterThanks.markers
      .find(item => String(item.id) === versionOnly.markerId);
    assert.equal(Number(thankedOwnerCairn.thanks_count), 1);
    const [selfAcquisition] = await db.execute(
      `INSERT INTO cairn_acquisitions
         (viewer_id,marker_id,cairn_revision_id,content_revision,acquired_via,evidence_kind,evidence_id,
          evidence_observed_at,opened_at)
       VALUES (?,?,?,5,'public','legacy_coverage',999999,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [owner.id, versionOnly.markerId, latest.revision_id],
    );
    await api(owner, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {}, expected: 404,
    });
    const [[selfThanksState]] = await db.execute(
      'SELECT thanked_at FROM cairn_acquisitions WHERE id=?',
      [selfAcquisition.insertId],
    );
    assert.equal(selfThanksState.thanked_at, null);
    assert.equal(
      Number((await api(owner, '/api/markers/library?limit=100')).markers
        .find(item => String(item.id) === versionOnly.markerId).thanks_count),
      1,
    );
    pass('DISC-PROD-04a.thanks-privacy', 'Thanks was idempotent, owner detail received only a private aggregate count, and a synthetic self-acquisition could not create self-Thanks');
    pass('DISC-PROD-04.revisit-revision', 'stationary publication and early return did not award v5; departure, 15-minute gate and fresh proximity created one later v5 entitlement while retaining v1');

    const foundBeforeFriend = await api(versionViewer, '/api/cairn-memory/library?section=found');
    assert.equal(foundBeforeFriend.cairns.find(item => String(item.marker_id) === versionOnly.markerId).author_name, null);
    await db.execute(
      `INSERT INTO friends (user_id,friend_id,created_at)
       VALUES (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))`,
      [versionViewer.id, owner.id, owner.id, versionViewer.id],
    );
    await db.execute(
      `INSERT INTO friendship_episodes
         (episode_id,user_low_id,user_high_id,started_at)
       VALUES (?,LEAST(?,?),GREATEST(?,?),UTC_TIMESTAMP(3))`,
      [crypto.randomUUID(), versionViewer.id, owner.id, versionViewer.id, owner.id],
    );
    const foundAsFriend = await api(versionViewer, '/api/cairn-memory/library?section=found');
    assert.equal(
      foundAsFriend.cairns.find(item => String(item.marker_id) === versionOnly.markerId).author_name,
      'Memory Owner',
    );
    pass('DISC-PROD-05.public-identity', 'Public acquired history omitted author identity for a stranger and exposed it only after a current server-authorized friendship');

    const removedViewer = await actor(db, 'RemovedViewer');
    const removedPlace = { lat: -45.0312, lng: 168.6626 };
    const removedOnly = await seedPublicCairn(db, owner, operator, {
      ...removedPlace, text: 'Reader removal version one', revision: 1, epoch: 1,
    });
    await acceptedPresence(removedViewer, removedPlace.lat, removedPlace.lng, Date.now() + 8_000);
    const removedFirst = await api(removedViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(removedFirst.acquired.map(item => item.marker_id), [removedOnly.markerId]);
    const removedHistoryBefore = await api(removedViewer, `/api/cairn-memory/cairns/${removedOnly.markerId}/history`);
    const removedRevisionId = removedHistoryBefore.revisions[0].revision_id;
    await api(removedViewer, `/api/cairn-memory/cairns/${removedOnly.markerId}/collection`, {
      method: 'PUT', body: { action: 'remove' },
    });
    await api(removedViewer, `/api/cairn-memory/cairns/${removedOnly.markerId}/history`, { expected: 404 });
    await api(removedViewer, `/api/cairn-memory/revisions/${removedRevisionId}/read`, {
      method: 'POST', body: {}, expected: 404,
    });
    await api(removedViewer, `/api/cairn-memory/revisions/${removedRevisionId}/thanks`, {
      method: 'POST', body: {}, expected: 404,
    });
    await publishRevision(db, removedOnly, owner, operator, {
      text: 'Reader removal version two', revision: 2, epoch: 2,
    });
    const removedDeparture = { lat: removedPlace.lat + 0.002, lng: removedPlace.lng };
    await acceptedPresence(removedViewer, removedDeparture.lat, removedDeparture.lng, Date.now() + 9_000);
    await api(removedViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    await db.execute(
      `UPDATE cairn_local_visits SET departed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 16 MINUTE)
        WHERE viewer_id=? AND anchor_lat BETWEEN ? AND ?`,
      [removedViewer.id, removedPlace.lat - 0.0001, removedPlace.lat + 0.0001],
    );
    await acceptedPresence(removedViewer, removedPlace.lat, removedPlace.lng, Date.now() + 36_000);
    const removedReturn = await api(removedViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(removedReturn.acquired, []);
    assert.equal((await api(removedViewer, '/api/cairn-memory/library?section=found')).cairns.length, 0);
    pass('DISC-PROD-06.reader-removal', 'reader removal immediately blocked history/read/Thanks, persisted across a newer source revision and genuine later visit, and did not resurrect on refresh or discovery');

    const [friendSnapshot] = await db.execute(
      `INSERT INTO cairn_revisions
         (marker_id,owner_id,content_revision,content_type,content_text,lat,lng,
          approximate,content_sha256,source_audience,audience_epoch,identity_policy,
          friend_author_name_snapshot)
       SELECT marker_id,owner_id,content_revision,content_type,content_text,lat,lng,
              approximate,content_sha256,'friends',999999,'friends_acquired',?
         FROM cairn_revisions
        WHERE marker_id=? AND content_revision=5 AND source_audience='public'
        ORDER BY id DESC LIMIT 1`,
      ['Memory Owner', versionOnly.markerId],
    );
    const crossAudienceFriendViewer = await actor(db, 'CrossAudienceFriendViewer');
    await makeFriends(db, owner, crossAudienceFriendViewer);
    await db.execute(
      `INSERT INTO cairn_collections (viewer_id,marker_id,relationship)
       VALUES (?,?,'found')`,
      [crossAudienceFriendViewer.id, versionOnly.markerId],
    );
    await db.execute(
      `INSERT INTO cairn_acquisitions
         (viewer_id,marker_id,cairn_revision_id,content_revision,acquired_via,evidence_kind,evidence_id,
          evidence_observed_at,opened_at)
       VALUES (?,?,?,5,'friends','legacy_coverage',999998,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
      [crossAudienceFriendViewer.id, versionOnly.markerId, friendSnapshot.insertId],
    );
    await db.execute(
      `INSERT INTO public_cairn_encounters
         (viewer_id,author_id,marker_id,publication_id,publication_epoch,content_revision,
          evidence_witness_id,source_activity_client_id,observed_at)
       VALUES (?,?,?,?,2,5,NULL,?,UTC_TIMESTAMP(3))`,
      [versionViewer.id, owner.id, versionOnly.markerId, versionFivePublicationId, crypto.randomUUID()],
    );
    const currentRevisionCase = await api(
      versionViewer,
      `/api/cairn-memory/revisions/${latest.revision_id}/cases`,
      {
        method: 'POST', expected: 201,
        body: {
          client_submission_id: crypto.randomUUID(), case_type: 'report',
          category: 'privacy', detail: 'Synthetic cross-audience current revision review.',
        },
      },
    );
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'reviewed', content_state: 'under_review',
        decision_scope: 'revision', reason: 'synthetic_cross_audience_review',
      },
    });
    const [frozenCurrentSnapshots] = await db.execute(
      `SELECT source_audience,availability FROM cairn_revisions
        WHERE marker_id=? AND content_revision=5 ORDER BY source_audience`,
      [versionOnly.markerId],
    );
    assert.equal(frozenCurrentSnapshots.length, 2);
    assert.ok(frozenCurrentSnapshots.every(item => item.availability === 'under_review'));
    const currentOwnerProjection = (await api(owner, '/api/markers'))
      .find(item => String(item.id) === versionOnly.markerId);
    assert.equal(currentOwnerProjection.content_state, 'under_review');
    assert.equal(currentOwnerProjection.text, '');
    await api(crossAudienceFriendViewer, `/api/friend-content/cairns/${versionOnly.markerId}`, { expected: 404 });
    await api(versionViewer, `/api/public-cairns/cairns/${versionOnly.markerId}`, { expected: 404 });
    assert.equal(
      (await api(crossAudienceFriendViewer, '/api/circle/markers')).markers
        .some(item => String(item.id) === versionOnly.markerId),
      false,
    );
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'reviewed', content_state: 'under_review',
        decision_scope: 'source', reason: 'synthetic_source_review_over_revision',
      },
    });
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'source', reason: 'synthetic_source_restore_preserves_revision',
      },
    });
    const [stillFrozenAfterSourceRestore] = await db.execute(
      `SELECT availability FROM cairn_revisions
        WHERE marker_id=? AND content_revision=5`,
      [versionOnly.markerId],
    );
    assert.ok(stillFrozenAfterSourceRestore.every(item => item.availability === 'under_review'));
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'revision', reason: 'synthetic_cross_audience_restore',
      },
    });

    // Reverse the ordering: restore the revision while a source freeze remains.
    // Effective readers must continue to fail closed until the independent
    // source state itself is restored.
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'reviewed', content_state: 'under_review',
        decision_scope: 'revision', reason: 'synthetic_revision_review_before_source_overlay',
      },
    });
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'reviewed', content_state: 'under_review',
        decision_scope: 'source', reason: 'synthetic_source_overlay',
      },
    });
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'revision', reason: 'synthetic_revision_restore_under_source_overlay',
      },
    });
    const [[independentModerationState]] = await db.execute(
      `SELECT moderation.state AS source_state,
              MIN(revision.availability='available') AS all_revision_snapshots_available
         FROM cairn_source_moderation moderation
         JOIN cairn_revisions revision ON revision.marker_id=moderation.marker_id
        WHERE moderation.marker_id=? AND revision.content_revision=5
        GROUP BY moderation.state`,
      [versionOnly.markerId],
    );
    assert.equal(independentModerationState.source_state, 'under_review');
    assert.equal(Number(independentModerationState.all_revision_snapshots_available), 1);
    const sourceOverlayLibrary = await api(versionViewer, '/api/cairn-memory/library?section=found');
    const sourceOverlayCairn = sourceOverlayLibrary.cairns
      .find(item => String(item.marker_id) === versionOnly.markerId);
    assert.equal(sourceOverlayCairn.availability, 'under_review');
    assert.equal(sourceOverlayCairn.text, null);
    const sourceOverlayHistory = await api(
      versionViewer,
      `/api/cairn-memory/cairns/${versionOnly.markerId}/history`,
    );
    const sourceOverlayLatest = sourceOverlayHistory.revisions
      .find(item => Number(item.content_revision) === 5);
    assert.equal(sourceOverlayLatest.availability, 'under_review');
    assert.equal(sourceOverlayLatest.text, null);
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/read`, {
      method: 'POST', body: {}, expected: 404,
    });
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {}, expected: 404,
    });
    await api(operator, `/api/cairn-memory/operator/cases/${currentRevisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'source', reason: 'synthetic_source_overlay_restore',
      },
    });
    assert.equal(
      (await api(crossAudienceFriendViewer, `/api/friend-content/cairns/${versionOnly.markerId}`)).cairn.text,
      'Version five',
    );
    assert.equal(
      (await api(versionViewer, `/api/public-cairns/cairns/${versionOnly.markerId}`)).cairn.text,
      'Version five',
    );
    pass('DISC-PROD-06c.cross-audience-moderation', 'logical revision moderation covered every Friends/Public snapshot; source freeze/restore preserved revision state, revision restore could not bypass a source freeze, and all read paths reopened only after the controlling scope was restored');

    const oldRevision = history.revisions[1];
    const revisionCase = await api(versionViewer, `/api/cairn-memory/revisions/${oldRevision.revision_id}/cases`, {
      method: 'POST', expected: 201,
      body: {
        client_submission_id: crypto.randomUUID(), case_type: 'report',
        category: 'privacy', detail: 'Synthetic revision-only review.',
      },
    });
    await api(operator, `/api/cairn-memory/operator/cases/${revisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'reviewed', content_state: 'under_review',
        decision_scope: 'revision', reason: 'synthetic_revision_review',
      },
    });
    const revisionFrozenHistory = await api(versionViewer, `/api/cairn-memory/cairns/${versionOnly.markerId}/history`);
    assert.equal(
      revisionFrozenHistory.revisions.find(item => String(item.revision_id) === String(oldRevision.revision_id)).availability,
      'under_review',
    );
    assert.equal(
      revisionFrozenHistory.revisions.find(item => String(item.revision_id) === String(latest.revision_id)).availability,
      'available',
    );
    assert.equal(
      (await api(versionViewer, '/api/cairn-memory/library?section=found')).cairns
        .find(item => String(item.marker_id) === versionOnly.markerId).availability,
      'available',
    );
    await api(operator, `/api/cairn-memory/operator/cases/${revisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'revision', reason: 'synthetic_revision_restore',
      },
    });
    const revisionRestoredHistory = await api(versionViewer, `/api/cairn-memory/cairns/${versionOnly.markerId}/history`);
    assert.equal(
      revisionRestoredHistory.revisions.find(item => String(item.revision_id) === String(oldRevision.revision_id)).availability,
      'available',
    );
    pass('DISC-PROD-06a.revision-moderation', 'revision-only freeze hid v1 without hiding v5; restore changed safety state without creating an acquisition or collection');
    await api(operator, `/api/cairn-memory/operator/cases/${revisionCase.case_id}/decision`, {
      method: 'POST',
      body: {
        case_state: 'actioned', content_state: 'removed',
        decision_scope: 'revision', reason: 'synthetic_revision_removal',
      },
    });
    const afterRevisionRemoval = await api(versionViewer, `/api/cairn-memory/cairns/${versionOnly.markerId}/history`);
    assert.deepEqual(afterRevisionRemoval.revisions.map(item => Number(item.content_revision)), [5]);
    assert.equal(
      (await api(versionViewer, '/api/cairn-memory/library?section=found')).cairns
        .find(item => String(item.marker_id) === versionOnly.markerId).availability,
      'available',
    );
    const revisionRestoreRejected = await api(operator, `/api/cairn-memory/operator/cases/${revisionCase.case_id}/decision`, {
      method: 'POST', expected: 409,
      body: {
        case_state: 'dismissed', content_state: 'available',
        decision_scope: 'revision', reason: 'must_not_restore_removed_revision',
      },
    });
    assert.match(revisionRestoreRejected.error, /cannot be restored/i);
    pass('DISC-PROD-06b.revision-removal', 'confirmed revision-only removal purged v1 without removing v5 or the source and could not be restored');

    const reportId = crypto.randomUUID();
    const report = await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/cases`, {
      method: 'POST', expected: 201,
      body: { client_submission_id: reportId, case_type: 'report', category: 'privacy', detail: 'Synthetic privacy review.' },
    });
    const reportRetry = await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/cases`, {
      method: 'POST', expected: 201,
      body: { client_submission_id: reportId, case_type: 'report', category: 'privacy', detail: 'Synthetic privacy review.' },
    });
    assert.equal(report.case_id, reportRetry.case_id);
    const unauthorized = await api(viewer, `/api/cairn-memory/operator/cases/${report.case_id}/decision`, {
      method: 'POST', expected: 403,
      body: { case_state: 'reviewed', content_state: 'under_review', decision_scope: 'source', reason: 'unauthorized' },
    });
    assert.equal(unauthorized.error, 'Operator access required');
    await api(operator, `/api/cairn-memory/operator/cases/${report.case_id}/decision`, {
      method: 'POST',
      body: { case_state: 'reviewed', content_state: 'under_review', decision_scope: 'source', reason: 'synthetic_review' },
    });
    const frozen = await api(versionViewer, '/api/cairn-memory/library?section=found');
    const frozenCairn = frozen.cairns.find(item => String(item.marker_id) === versionOnly.markerId);
    assert.equal(frozenCairn.availability, 'under_review');
    assert.equal(frozenCairn.text, null);
    assert.equal(frozen.unread_count, 0);
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/read`, {
      method: 'POST', body: {}, expected: 404,
    });
    await api(versionViewer, `/api/cairn-memory/revisions/${latest.revision_id}/thanks`, {
      method: 'POST', body: {}, expected: 404,
    });
    const ownerMarkers = await api(owner, '/api/markers');
    const frozenOwnerMarker = ownerMarkers.find(item => String(item.id) === versionOnly.markerId);
    assert.equal(frozenOwnerMarker.content_state, 'under_review');
    assert.equal(frozenOwnerMarker.text, '');
    const frozenEdit = await api(owner, `/api/markers/${versionOnly.markerId}`, {
      method: 'PUT', expected: 409, body: { text: 'Attempted review bypass' },
    });
    assert.equal(frozenEdit.code, 'CAIRN_SOURCE_FROZEN');
    const appeal = await api(owner, `/api/cairn-memory/revisions/${latest.revision_id}/cases`, {
      method: 'POST', expected: 201,
      body: { client_submission_id: crypto.randomUUID(), case_type: 'appeal', category: 'other', detail: 'Synthetic author appeal.' },
    });
    assert.equal(appeal.state, 'pending');
    const ownerCases = await api(owner, '/api/cairn-memory/review-cases/mine');
    assert.equal(ownerCases.affected_revisions.some(item => String(item.marker_id) === versionOnly.markerId), true);
    assert.equal(ownerCases.cases.some(item => item.case_type === 'appeal'), true);
    pass('DISC-PROD-07.moderation', 'reports deduplicated, non-operators were denied, source freeze hid owner/reader previews and unread work, blocked read/Thanks/revision bypass, and exposed a scoped author appeal state');

    await api(operator, `/api/cairn-memory/operator/cases/${report.case_id}/decision`, {
      method: 'POST',
      body: { case_state: 'actioned', content_state: 'removed', decision_scope: 'source', reason: 'synthetic_confirmed_removal' },
    });
    assert.equal(
      (await api(versionViewer, '/api/cairn-memory/library?section=found')).cairns
        .some(item => String(item.marker_id) === versionOnly.markerId),
      false,
    );
    const markerAfterRemoval = (await api(owner, '/api/markers'))
      .find(item => String(item.id) === versionOnly.markerId);
    assert.equal(markerAfterRemoval.text, '');
    assert.equal(markerAfterRemoval.content_state, 'removed');
    const [purgedRevisions] = await db.execute(
      `SELECT availability,content_text,lat,lng,friend_author_name_snapshot,
              publication_id,content_sha256
         FROM cairn_revisions WHERE marker_id=?`,
      [versionOnly.markerId],
    );
    assert.ok(purgedRevisions.length >= 2);
    assert.ok(purgedRevisions.every(revision => revision.availability === 'removed'
      && revision.content_text == null && Number(revision.lat) === 0 && Number(revision.lng) === 0
      && revision.friend_author_name_snapshot == null && revision.publication_id == null
      && revision.content_sha256 === '0'.repeat(64)));
    const [purgedPublications] = await db.execute(
      `SELECT state,snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_sha256
         FROM public_cairn_publications WHERE marker_id=?`,
      [versionOnly.markerId],
    );
    assert.ok(purgedPublications.every(publication => publication.state === 'withdrawn'
      && publication.snapshot_type == null && publication.snapshot_text == null
      && publication.snapshot_lat == null && publication.snapshot_lng == null
      && publication.snapshot_sha256 == null));
    const [[purgedMarker]] = await db.execute(
      `SELECT text,lat,lng,voice_memo_url,public_snapshot,permission,public_state
         FROM markers WHERE id=?`,
      [versionOnly.markerId],
    );
    assert.deepEqual(
      [purgedMarker.text, Number(purgedMarker.lat), Number(purgedMarker.lng),
        purgedMarker.voice_memo_url, purgedMarker.public_snapshot,
        purgedMarker.permission, purgedMarker.public_state],
      ['', 0, 0, null, null, 'personal', 'withdrawn'],
    );
    const [[auditState]] = await db.execute(
      `SELECT COUNT(*) AS audit_count FROM cairn_review_audit
        WHERE marker_id=? AND event_type='case_decision'`,
      [versionOnly.markerId],
    );
    assert.ok(Number(auditState.audit_count) >= 2);
    pass('DISC-PROD-08.confirmed-removal', 'confirmed removal transaction purged revision/source/public snapshots and exact coordinates, hid linked collections, and retained metadata-only review audit rows');

    result.counts = {
      dense_candidates: dense.length,
      first_visit_acquisitions: first.acquired.length,
      different_locality_acquisitions: elsewhere.acquired.length,
      cadence_acquisitions: cadenceAcquisitions.length,
      version_history_pages: history.revisions.length,
      presentation_groups: Number(presentationState.groups_n),
      guaranteed_friend_overflow: friendOverflow.acquired.length,
    };
    result.finished_at = new Date().toISOString();
    result.summary = { passed: result.assertions.length, failed: 0 };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  result.finished_at = new Date().toISOString();
  result.summary = { passed: result.assertions.length, failed: 1 };
  result.failure = { name: error.name, message: error.message, stack: error.stack };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
});
