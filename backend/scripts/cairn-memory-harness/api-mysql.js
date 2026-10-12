'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

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

async function seedPublicCairn(db, owner, operator, { lat, lng, text, revision = 1, epoch = 1 }) {
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision,public_intent,public_state,publication_epoch,public_state_changed_at)
     VALUES (?,'cairn',?,?,?,'public',1,'healthy',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),
             ?,1,'published',?,UTC_TIMESTAMP(3))`,
    [owner.id, text, lat, lng, revision, epoch],
  );
  const hash = snapshotHash({ text, lat, lng });
  const [publication] = await db.execute(
    `INSERT INTO public_cairn_publications
       (marker_id,owner_id,publication_epoch,content_revision,
        snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
        snapshot_sha256,state,decided_at,decided_by,published_at)
     VALUES (?,?,?,?,'cairn',?,?,?,1,?,'published',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))`,
    [marker.insertId, owner.id, epoch, revision, text, lat, lng, hash, operator.id],
  );
  return { markerId: String(marker.insertId), publicationId: String(publication.insertId) };
}

async function seedFriendCairn(db, owner, { lat, lng, text, revision = 1 }) {
  const [marker] = await db.execute(
    `INSERT INTO markers
       (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
        content_revision)
     VALUES (?,'cairn',?,?,?,'group',1,'healthy',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?)`,
    [owner.id, text, lat, lng, revision],
  );
  return { markerId: String(marker.insertId) };
}

async function makeFriends(db, first, second) {
  await db.execute(
    `INSERT INTO friends (user_id,friend_id,created_at)
     VALUES (?,?,UTC_TIMESTAMP(3)),(?,?,UTC_TIMESTAMP(3))`,
    [first.id, second.id, second.id, first.id],
  );
  await db.execute(
    `INSERT INTO friendship_episodes
       (episode_id,user_low_id,user_high_id,started_at)
     VALUES (?,LEAST(?,?),GREATEST(?,?),UTC_TIMESTAMP(3))`,
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
        snapshot_sha256,state,decided_at,decided_by,published_at)
     VALUES (?,?,?,?,'cairn',?,?,?,1,?,'published',UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))`,
    [cairn.markerId, owner.id, epoch, revision, text,
      position.lat, position.lng, hash, operator.id],
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

    await db.execute(
      `UPDATE cairn_presentation_groups SET merge_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)
        WHERE viewer_id=?`,
      [viewer.id],
    );
    const pending = await api(viewer, '/api/cairn-memory/presentation/pending');
    assert.equal(pending.groups.length, 1);
    assert.equal(Number(pending.groups[0].cairn_count), 3);
    await api(viewer, `/api/cairn-memory/presentation/${pending.groups[0].id}/announced`, {
      method: 'POST', body: {},
    });
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
    pass('DISC-PROD-02.presentation', 'three durable acquisitions merged into one announcement group; announcement remained independent of per-revision read state');

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

    const distant = await seedPublicCairn(db, owner, operator, {
      ...placeB, text: 'Different locality without global cooldown',
    });
    await acceptedPresence(viewer, placeB.lat, placeB.lng, Date.now() + 1_000);
    const elsewhere = await api(viewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.equal(elsewhere.acquired.length, 1);
    assert.equal(elsewhere.acquired[0].marker_id, distant.markerId);
    assert.notEqual(elsewhere.visit_id, first.visit_id);
    pass('DISC-PROD-03.no-global-cooldown', 'fresh accepted evidence in a genuinely different locality acquired immediately despite the first visit reaching its cap');

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
    await publishRevision(db, versionOnly, owner, operator, { text: 'Version five', revision: 5, epoch: 2 });
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
    await acceptedPresence(versionViewer, versionPlace.lat, versionPlace.lng, Date.now() + 7_000);
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
    await api(removedViewer, `/api/cairn-memory/cairns/${removedOnly.markerId}/collection`, {
      method: 'PUT', body: { action: 'remove' },
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
    await acceptedPresence(removedViewer, removedPlace.lat, removedPlace.lng, Date.now() + 10_000);
    const removedReturn = await api(removedViewer, '/api/cairn-memory/discover', { method: 'POST', body: {} });
    assert.deepEqual(removedReturn.acquired, []);
    assert.equal((await api(removedViewer, '/api/cairn-memory/library?section=found')).cairns.length, 0);
    pass('DISC-PROD-06.reader-removal', 'reader removal persisted across a newer source revision and a genuine later visit; refresh and discovery did not resurrect the collection');

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
      body: { case_state: 'reviewed', content_state: 'under_review', reason: 'unauthorized' },
    });
    assert.equal(unauthorized.error, 'Operator access required');
    await api(operator, `/api/cairn-memory/operator/cases/${report.case_id}/decision`, {
      method: 'POST',
      body: { case_state: 'reviewed', content_state: 'under_review', reason: 'synthetic_review' },
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
      body: { case_state: 'actioned', content_state: 'removed', reason: 'synthetic_confirmed_removal' },
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
