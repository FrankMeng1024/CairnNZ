'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

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
  contract: 'O84 Friends/Memory isolated API-to-render-input integration',
  started_at: new Date().toISOString(),
  assertions: [], actors: {}, lifecycle: {}, memory: {},
};
function pass(id, detail, measurement) {
  evidence.assertions.push({ id, result: 'PASS', detail, ...(measurement ? { measurement } : {}) });
}
function tokenFor(id, label) {
  return jwt.sign(
    { userId: String(id), token_version: 0, jti: `o84-${label}-${crypto.randomUUID()}` },
    jwtSecret,
    { expiresIn: '2h' },
  );
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
async function pendingFrom(recipient, requesterId) {
  const result = await api(recipient, '/api/friends/requests', { expected: 200 });
  const row = result.body.find(item => String(item.from_user_id) === String(requesterId));
  assert.ok(row, `pending request from ${requesterId}`);
  return row;
}
async function becomeFriends(requester, recipient) {
  await api(requester, '/api/friends/request', {
    method: 'POST', body: { email: recipient.email, shareMemory: false }, expected: 201,
  });
  const request = await pendingFrom(recipient, requester.id);
  await api(recipient, '/api/friends/accept', {
    method: 'POST', body: { requestId: Number(request.id), shareMemory: false }, expected: 200,
  });
  return request;
}
function projectionFor(payload, ownerId) {
  return payload.projections.find(item => String(item.source_friend_id) === String(ownerId));
}
async function uploadDistinctCoverage(actor, lat, lng) {
  const now = Date.now() - 2 * 60 * 60 * 1000;
  const points = Array.from({ length: 7 }, (_, index) => ({
    lat,
    lng: lng + index * 0.006,
    ts: now + index * 1000,
    cid: crypto.randomUUID(),
    evidence_source: 'passive_real',
    source_segment_id: `${actor.label}-o84-segment`,
    horizontal_accuracy_m: 8,
    continuity_state: 'accepted',
  }));
  const uploaded = await api(actor, '/api/memory/points', {
    method: 'POST', body: { points }, expected: 200,
  });
  assert.equal(uploaded.body.points.length, points.length);
  return points;
}

async function main() {
  const db = await mysql.createConnection(dbConfig);
  try {
    const definitions = [
      ['A', 'frankmengwork2'],
      ['B', 'frankmeng920313'],
      ['C', 'concurrency-one'],
      ['D', 'concurrency-two'],
      ['E', 'memory-friend-two'],
    ];
    const actors = {};
    for (const [label, alias] of definitions) {
      const email = `${alias}-${process.env.HARNESS_RUN_ID}@example.org`;
      const [insert] = await db.execute(
        `INSERT INTO users (name,email,password_hash,date_of_birth,activity_source_realm)
         VALUES (?,?,?,?,'isolated_qa')`,
        [alias, email, 'synthetic-no-login', '1990-01-01'],
      );
      actors[label] = { label, alias, email, id: String(insert.insertId) };
      actors[label].token = tokenFor(actors[label].id, label);
      evidence.actors[label] = { id: actors[label].id, alias, email_domain: 'example.org' };
    }

    const sent = await api(actors.A, '/api/friends/request', {
      method: 'POST', body: { email: actors.B.email, shareMemory: true }, expected: 201,
    });
    assert.equal(sent.body.request.status, 'pending');
    const original = await pendingFrom(actors.B, actors.A.id);
    await api(actors.B, '/api/friends/reject', {
      method: 'POST', body: { requestId: Number(original.id) }, expected: 200,
    });
    const declined = await api(actors.A, '/api/friends/requests/outbound', { expected: 200 });
    assert.equal(declined.body.find(item => Number(item.id) === Number(original.id))?.status, 'declined');
    actors.A.token = tokenFor(actors.A.id, 'A-relogin');
    const afterRelogin = await api(actors.A, '/api/friends/requests/outbound', { expected: 200 });
    assert.equal(afterRelogin.body.find(item => Number(item.id) === Number(original.id))?.status, 'declined');

    const reverseSent = await api(actors.B, '/api/friends/request', {
      method: 'POST', body: { email: actors.A.email, shareMemory: false }, expected: 201,
    });
    assert.notEqual(Number(reverseSent.body.request.id), Number(original.id));
    const reverse = await pendingFrom(actors.A, actors.B.id);
    const accepted = await api(actors.A, '/api/friends/accept', {
      method: 'POST', body: { requestId: Number(reverse.id), shareMemory: false }, expected: 200,
    });
    assert.equal(accepted.body.already_resolved, false);
    const acceptedRetry = await api(actors.A, '/api/friends/accept', {
      method: 'POST', body: { requestId: Number(reverse.id), shareMemory: true }, expected: 200,
    });
    assert.equal(acceptedRetry.body.already_resolved, true);
    const staleAccept = await api(actors.B, '/api/friends/accept', {
      method: 'POST', body: { requestId: Number(original.id), shareMemory: true },
    });
    assert.equal(staleAccept.status, 404);
    const [[pair]] = await db.execute(
      `SELECT COUNT(*) AS friendship_rows,
              (SELECT COUNT(*) FROM friendship_episodes
                WHERE user_low_id=LEAST(?,?) AND user_high_id=GREATEST(?,?) AND ended_at IS NULL) AS episodes
         FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`,
      [actors.A.id, actors.B.id, actors.A.id, actors.B.id,
        actors.A.id, actors.B.id, actors.B.id, actors.A.id],
    );
    assert.equal(Number(pair.friendship_rows), 2);
    assert.equal(Number(pair.episodes), 1);
    let grantsA = await api(actors.A, '/api/friend-sharing/grants', { expected: 200 });
    let grantsB = await api(actors.B, '/api/friend-sharing/grants', { expected: 200 });
    assert.equal(grantsA.body.grants.find(item => item.friend_id === actors.B.id)?.enabled, false);
    assert.equal(grantsB.body.grants.find(item => item.friend_id === actors.A.id)?.enabled, false);
    await api(actors.A, `/api/friends/requests/${original.id}`, { method: 'DELETE', expected: 200 });
    const dismissed = await api(actors.A, '/api/friends/requests/outbound', { expected: 200 });
    assert.equal(dismissed.body.some(item => Number(item.id) === Number(original.id)), false);
    evidence.lifecycle = {
      declined_request_id: Number(original.id),
      reverse_request_id: Number(reverse.id),
      friendship_rows: Number(pair.friendship_rows),
      active_episodes: Number(pair.episodes),
      directional_grants_after_accept: { A_to_B: false, B_to_A: false },
    };
    pass('F4-F5.lifecycle', 'decline persisted across a new token; reverse invitation used a new identity; stale accept failed; retry accept was idempotent; dismissal was viewer-local');

    const opposite = await Promise.all([
      api(actors.C, '/api/friends/request', { method: 'POST', body: { email: actors.D.email } }),
      api(actors.D, '/api/friends/request', { method: 'POST', body: { email: actors.C.email } }),
    ]);
    assert.deepEqual(opposite.map(result => result.status).sort(), [201, 400]);
    const winner = opposite[0].status === 201 ? actors.C : actors.D;
    const recipient = winner === actors.C ? actors.D : actors.C;
    const concurrentRequest = await pendingFrom(recipient, winner.id);
    const doubleAccept = await Promise.all([
      api(recipient, '/api/friends/accept', { method: 'POST', body: { requestId: Number(concurrentRequest.id) } }),
      api(recipient, '/api/friends/accept', { method: 'POST', body: { requestId: Number(concurrentRequest.id) } }),
    ]);
    assert.deepEqual(doubleAccept.map(result => result.status), [200, 200]);
    const [[concurrentPair]] = await db.execute(
      `SELECT COUNT(*) AS n FROM friends
        WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)`,
      [actors.C.id, actors.D.id, actors.D.id, actors.C.id],
    );
    assert.equal(Number(concurrentPair.n), 2);
    pass('F5.concurrency', 'opposite sends produced one active request and parallel accepts converged to one bidirectional friendship');

    await becomeFriends(actors.E, actors.B);
    const coverageA = await uploadDistinctCoverage(actors.A, -41.2865, 174.70);
    const coverageE = await uploadDistinctCoverage(actors.E, -45.031, 168.60);
    const viewerCoverage = await uploadDistinctCoverage(actors.B, -36.85, 174.70);
    await api(actors.A, `/api/friend-sharing/grants/${actors.B.id}`, {
      method: 'PUT', body: { enabled: true }, expected: 200,
    });
    await api(actors.E, `/api/friend-sharing/grants/${actors.B.id}`, {
      method: 'PUT', body: { enabled: true }, expected: 200,
    });
    await api(actors.B, '/api/memory-subscriptions', {
      method: 'POST', body: { friend_id: Number(actors.A.id) }, expected: 201,
    });
    await api(actors.B, '/api/memory-subscriptions', {
      method: 'POST', body: { friend_id: Number(actors.E.id) }, expected: 201,
    });
    const beforeDelay = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id), Number(actors.E.id)] }, expected: 200,
    });
    assert.equal(projectionFor(beforeDelay.body, actors.A.id)?.cells.length, 0);
    assert.equal(projectionFor(beforeDelay.body, actors.E.id)?.cells.length, 0);
    await db.execute(
      `UPDATE memory_points SET received_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 31 MINUTE)
        WHERE user_id IN (?, ?, ?)`,
      [actors.A.id, actors.B.id, actors.E.id],
    );
    const sources = await api(actors.B, '/api/friend-sharing/sources', { expected: 200 });
    const selectedSources = sources.body.sources.filter(item => item.selected).map(item => item.friend_id).sort();
    assert.deepEqual(selectedSources, [actors.A.id, actors.E.id].sort());
    const afterDelay = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id), Number(actors.E.id)] }, expected: 200,
    });
    const projectionA = projectionFor(afterDelay.body, actors.A.id);
    const projectionE = projectionFor(afterDelay.body, actors.E.id);
    assert.ok(projectionA.cells.length > 0);
    assert.ok(projectionE.cells.length > 0);
    assert.equal(projectionA.cells.some(a => projectionE.cells.some(e => e.id === a.id)), false);
    const unauthorized = await api(actors.D, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id), Number(actors.E.id)] }, expected: 200,
    });
    assert.deepEqual(unauthorized.body.projections, []);
    assert.deepEqual(unauthorized.body.revoked_friend_ids.sort(), [actors.A.id, actors.E.id].sort());

    await api(actors.A, `/api/friend-sharing/grants/${actors.B.id}`, {
      method: 'PUT', body: { enabled: false }, expected: 200,
    });
    const afterRevoke = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.A.id), Number(actors.E.id)] }, expected: 200,
    });
    assert.ok(projectionFor(afterRevoke.body, actors.E.id)?.cells.length > 0);
    assert.ok(afterRevoke.body.revoked_friend_ids.includes(actors.A.id));
    await api(actors.B, `/api/memory-subscriptions/${actors.E.id}`, { method: 'DELETE', expected: 200 });
    const afterDeselect = await api(actors.B, '/api/friend-sharing/projections', {
      method: 'POST', body: { friend_ids: [Number(actors.E.id)] }, expected: 200,
    });
    assert.deepEqual(afterDeselect.body.projections, []);
    evidence.memory = {
      delay_seconds: 1800,
      before_delay_cells: { A: 0, E: 0 },
      after_delay_cells: { A: projectionA.cells.length, E: projectionE.cells.length },
      projection_versions: { A: projectionA.projection_version, E: projectionE.projection_version },
      source_ids: selectedSources,
      account_isolation_revoked_ids: unauthorized.body.revoked_friend_ids,
      post_revoke_remaining_friend_cells: projectionFor(afterRevoke.body, actors.E.id).cells.length,
      deselected_projection_count: afterDeselect.body.projections.length,
    };
    // Portable synthetic output from the real authorization/projection API.
    // The client render proof consumes these exact cells; it never substitutes
    // hand-authored polygons after the server boundary.
    evidence.render_fixture = {
      viewer_id: actors.B.id,
      viewer_points: viewerCoverage,
      owners: [
        { alias: actors.A.alias, projection: projectionA, uploaded_point_count: coverageA.length },
        { alias: actors.E.alias, projection: projectionE, uploaded_point_count: coverageE.length },
      ],
    };
    pass('M4.api-to-render-input', 'two explicitly authorized, selected owners produced distinct delayed cell geometries; another account saw none; revocation and deselection purged only the affected source', evidence.memory);

    const [[activeDuplicates]] = await db.execute(
      `SELECT COUNT(*) AS n FROM (
         SELECT pair_key,COUNT(*) AS c
           FROM friend_requests WHERE status='pending'
          GROUP BY pair_key HAVING c > 1
       ) duplicates`,
    );
    assert.equal(Number(activeDuplicates.n), 0);
    pass('F5.db-invariant', 'trigger-maintained unordered pair key allows history while enforcing at most one pending request');
    evidence.finished_at = new Date().toISOString();
    evidence.result = 'PASS';
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  evidence.finished_at = new Date().toISOString();
  evidence.result = 'FAIL';
  evidence.failure = { message: error.message, stack: error.stack };
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.exitCode = 1;
});
