'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const nonceUtil = require('../../src/utils/nonce');

const baseUrl = process.env.HARNESS_API_URL;
const jwtSecret = process.env.JWT_SECRET;
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

if (!baseUrl || !jwtSecret) {
  throw new Error('HARNESS_API_URL and JWT_SECRET are required');
}

const evidence = {
  schema: 'cairnnz.public-cairn-disabled-api-mysql.v1',
  started_at: new Date().toISOString(),
  environment: {
    api: baseUrl,
    public_enabled: false,
    database: process.env.DB_NAME,
  },
  actors: {},
  objects: {},
  assertions: [],
};

function pass(id, detail, trace = {}) {
  evidence.assertions.push({ id, result: 'PASS', detail, trace });
}

function tokenFor(id, label) {
  return jwt.sign({
    userId: String(id),
    token_version: 0,
    jti: `public-disabled-${label}-${crypto.randomUUID()}`,
  }, jwtSecret, { expiresIn: '2h' });
}

async function api(actor, requestPath, { method = 'GET', body, expected } = {}) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  if (expected !== undefined) {
    assert.equal(response.status, expected, `${method} ${requestPath}: ${JSON.stringify(payload)}`);
  }
  return { status: response.status, body: payload };
}

async function main() {
  const { calculateV1SourceFingerprint } = await import('../v1-source-fingerprint.mjs');
  const fingerprint = calculateV1SourceFingerprint();
  assert.equal(fingerprint.algorithm, 'sha256');
  assert.match(fingerprint.digest, /^[0-9a-f]{64}$/);
  assert.ok(Number.isInteger(fingerprint.fileCount) && fingerprint.fileCount > 0);
  evidence.candidate_fingerprint = {
    algorithm: fingerprint.algorithm,
    digest: fingerprint.digest,
    file_count: fingerprint.fileCount,
  };
  const db = await mysql.createConnection(dbConfig);
  try {
    const actors = {};
    for (const [label, operator] of [['A', false], ['B', false], ['C', true]]) {
      const email = `public-disabled-${label.toLowerCase()}-${process.env.HARNESS_RUN_ID}@example.org`;
      const [inserted] = await db.execute(
        `INSERT INTO users
           (name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,'isolated_qa')`,
        [`Public Disabled Actor ${label}`, email, 'synthetic-no-login', '1990-01-01', operator ? 1 : 0],
      );
      actors[label] = {
        label,
        id: String(inserted.insertId),
        email,
        token: tokenFor(inserted.insertId, label),
      };
      evidence.actors[label] = {
        id: String(inserted.insertId),
        role: operator ? 'operator' : label === 'A' ? 'owner' : 'viewer',
      };
    }

    const [[operatorRow]] = await db.execute(
      'SELECT public_cairn_operator FROM users WHERE id=?',
      [actors.C.id],
    );
    assert.equal(Boolean(operatorRow.public_cairn_operator), true);

    const capabilities = await api(actors.B, '/api/public-cairns/capabilities', { expected: 200 });
    assert.equal(capabilities.body.enabled, false);
    assert.equal(capabilities.body.scope, 'cairns_text_only');
    pass('PUB-OFF-01.capability', 'authenticated capability is explicitly disabled');

    const publicClientId = crypto.randomUUID();
    const createdPublic = await api(actors.A, '/api/markers', {
      method: 'POST',
      expected: 201,
      body: {
        client_cairn_id: publicClientId,
        type: 'cairn',
        text: 'Feature-off owner text',
        lat: -41.2867,
        lng: 174.7763,
        alt: 20,
        permission: 'public',
        approximate: false,
      },
    });
    const publicMarkerId = String(createdPublic.body.id);
    assert.equal(createdPublic.body.client_cairn_id, publicClientId);
    assert.equal(createdPublic.body.public_intent, true);
    assert.equal(createdPublic.body.public_state, 'not_public');
    assert.deepEqual(createdPublic.body.public_submission, {
      state: 'not_public',
      code: 'PUBLIC_PILOT_DISABLED',
    });

    const updatedPublic = await api(actors.A, `/api/markers/${publicMarkerId}`, {
      method: 'PUT',
      expected: 200,
      body: {
        text: 'Feature-off owner text updated',
        permission: 'public',
      },
    });
    assert.equal(String(updatedPublic.body.id), publicMarkerId);
    assert.equal(updatedPublic.body.public_state, 'not_public');
    assert.deepEqual(updatedPublic.body.public_submission, {
      state: 'not_public',
      code: 'PUBLIC_PILOT_DISABLED',
    });

    const [[storedPublic]] = await db.execute(
      `SELECT id,user_id,client_cairn_id,text,lat,lng,permission,public_intent,
              public_state,publication_epoch,content_revision
         FROM markers WHERE id=?`,
      [publicMarkerId],
    );
    assert.equal(String(storedPublic.user_id), actors.A.id);
    assert.equal(storedPublic.client_cairn_id, publicClientId);
    assert.equal(storedPublic.text, 'Feature-off owner text updated');
    assert.equal(storedPublic.permission, 'public');
    assert.equal(Boolean(storedPublic.public_intent), true);
    assert.equal(storedPublic.public_state, 'not_public');
    assert.equal(Number(storedPublic.publication_epoch), 0);
    assert.equal(Number(storedPublic.content_revision), 2);
    evidence.objects.owner_public_intent = {
      marker_id: publicMarkerId,
      client_cairn_id: publicClientId,
      public_state: storedPublic.public_state,
      publication_epoch: Number(storedPublic.publication_epoch),
      content_revision: Number(storedPublic.content_revision),
    };
    pass(
      'PUB-OFF-01.owner-save',
      'old-client Public intent remains durably owner-saved and editable while publication stays disabled',
      evidence.objects.owner_public_intent,
    );

    const disabledEndpoints = [
      {
        id: 'encounter-verify', actor: actors.B, method: 'POST',
        path: '/api/public-cairns/encounters/verify',
        body: { source_activity_client_id: crypto.randomUUID() },
      },
      { id: 'scene', actor: actors.B, method: 'GET', path: '/api/public-cairns/scene' },
      { id: 'detail', actor: actors.B, method: 'GET', path: `/api/public-cairns/cairns/${publicMarkerId}` },
      { id: 'present', actor: actors.B, method: 'POST', path: `/api/public-cairns/cairns/${publicMarkerId}/present`, body: {} },
      { id: 'thanks', actor: actors.B, method: 'POST', path: `/api/public-cairns/cairns/${publicMarkerId}/thanks`, body: {} },
      { id: 'hide', actor: actors.B, method: 'POST', path: `/api/public-cairns/cairns/${publicMarkerId}/hide`, body: {} },
      {
        id: 'report', actor: actors.B, method: 'POST',
        path: `/api/public-cairns/cairns/${publicMarkerId}/report`,
        body: { client_submission_id: crypto.randomUUID(), category: 'other', detail: 'disabled harness' },
      },
    ];

    for (const endpoint of disabledEndpoints) {
      const result = await api(endpoint.actor, endpoint.path, {
        method: endpoint.method,
        body: endpoint.body,
        expected: 404,
      });
      assert.equal(result.body.code, 'PUBLIC_PILOT_DISABLED', endpoint.id);
      pass(
        `PUB-OFF-01.endpoint.${endpoint.id}`,
        `${endpoint.method} ${endpoint.path} is denied by the server feature gate`,
      );
    }

    const operatorSubmissions = await api(
      actors.C,
      '/api/public-cairns/operator/submissions?state=pending&limit=25',
      { expected: 200 },
    );
    assert.deepEqual(operatorSubmissions.body.submissions, []);
    const operatorReports = await api(
      actors.C,
      '/api/public-cairns/operator/reports?state=pending&limit=25',
      { expected: 200 },
    );
    assert.deepEqual(operatorReports.body.reports, []);
    const operatorAudit = await api(
      actors.C,
      '/api/public-cairns/operator/audit?limit=25',
      { expected: 200 },
    );
    assert.deepEqual(operatorAudit.body.events, []);
    await api(actors.C, '/api/public-cairns/operator/submissions/1/decision', {
      method: 'POST', expected: 404,
      body: { action: 'approve', reason: 'disabled harness' },
    });
    await api(actors.C, '/api/public-cairns/operator/reports/1/disposition', {
      method: 'POST', expected: 404,
      body: { state: 'reviewed', note: 'disabled harness' },
    });
    const unauthorizedAudit = await api(actors.B, '/api/public-cairns/operator/audit', { expected: 403 });
    assert.equal(unauthorizedAudit.body.code, 'OPERATOR_REQUIRED');
    pass(
      'PUB-OFF-01.operator-continuity',
      'the exposure kill-switch leaves authenticated operator queues and metadata audit reachable while consumer endpoints remain closed',
    );

    const legacyPublic = await api(
      actors.B,
      '/api/markers/public?bbox=-42,173,-40,176',
      { expected: 410 },
    );
    assert.equal(legacyPublic.body.code, 'PUBLIC_DISCOVERY_DEFERRED');
    await api(actors.B, `/api/markers/${publicMarkerId}/community-state`, { expected: 404 });
    await api(actors.B, `/api/markers/${publicMarkerId}/interact-nonce`, { expected: 404 });
    const legacyVoteNonce = nonceUtil.issue(actors.B.id, publicMarkerId).nonce;
    await api(actors.B, `/api/markers/${publicMarkerId}/vote`, {
      method: 'POST',
      expected: 404,
      body: {
        type: 'like',
        lat: Number(storedPublic.lat),
        lng: Number(storedPublic.lng),
        accuracy: 10,
        client_ts: Date.now(),
        nonce: legacyVoteNonce,
        client_op_id: crypto.randomUUID(),
      },
    });
    const genericPublicHide = await api(actors.B, '/api/hide', {
      method: 'POST',
      expected: 404,
      body: { item_type: 'mark', item_id: Number(publicMarkerId) },
    });
    assert.equal(genericPublicHide.body.code, 'CONTENT_UNAVAILABLE');
    pass(
      'PUB-OFF-01.legacy',
      'legacy bbox, community, nonce, vote and generic Hide paths cannot discover or mutate a Public-intent Cairn',
    );

    const personalClientId = crypto.randomUUID();
    const createdPersonal = await api(actors.A, '/api/markers', {
      method: 'POST',
      expected: 201,
      body: {
        client_cairn_id: personalClientId,
        type: 'cairn',
        text: 'Personal still works',
        lat: -41.287,
        lng: 174.777,
        permission: 'personal',
        approximate: false,
      },
    });
    const ownedMarkers = await api(actors.A, '/api/markers', { expected: 200 });
    assert.ok(ownedMarkers.body.some(row => String(row.id) === String(createdPersonal.body.id)));
    assert.ok(ownedMarkers.body.some(row => String(row.id) === publicMarkerId));
    pass('PUB-OFF-01.personal', 'Personal owner save and reload remain available');

    await api(actors.A, '/api/friends/request', {
      method: 'POST',
      expected: 201,
      body: { email: actors.B.email },
    });
    const inbound = await api(actors.B, '/api/friends/requests', { expected: 200 });
    const request = inbound.body.find(row => String(row.from_user_id) === actors.A.id);
    assert.ok(request, 'A-to-B friend request');
    await api(actors.B, '/api/friends/accept', {
      method: 'POST',
      expected: 200,
      body: { requestId: Number(request.id) },
    });
    const friendsA = await api(actors.A, '/api/friends', { expected: 200 });
    const friendsB = await api(actors.B, '/api/friends', { expected: 200 });
    assert.ok(friendsA.body.some(row => String(row.id) === actors.B.id));
    assert.ok(friendsB.body.some(row => String(row.id) === actors.A.id));
    pass('PUB-OFF-01.friends', 'friend request, acceptance and symmetric reload remain available');

    // Scope zero-side-effect evidence to this run's newly inserted actors.
    // The runner also provisions a fresh disposable database, but these
    // predicates prevent unrelated retained rows from creating a false fail.
    const [[publicCounts]] = await db.execute(
      `SELECT
         (SELECT COUNT(*) FROM public_cairn_publications
           WHERE owner_id IN (?,?,?)) AS publications,
         (SELECT COUNT(*) FROM public_cairn_encounters
           WHERE viewer_id IN (?,?,?) OR author_id IN (?,?,?)) AS encounters,
         (SELECT COUNT(*) FROM public_cairn_thanks
           WHERE viewer_id IN (?,?,?) OR author_id IN (?,?,?)) AS thanks_rows,
         (SELECT COUNT(*) FROM public_cairn_reports
           WHERE viewer_id IN (?,?,?) OR author_id IN (?,?,?)) AS reports,
         (SELECT COUNT(*) FROM marker_votes
           WHERE user_id IN (?,?,?) AND marker_id=?) AS legacy_votes,
         (SELECT COUNT(*) FROM hidden_items
           WHERE user_id IN (?,?,?)) AS hidden_rows`,
      [
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id,
        actors.A.id, actors.B.id, actors.C.id, publicMarkerId,
        actors.A.id, actors.B.id, actors.C.id,
      ],
    );
    evidence.database_counts = Object.fromEntries(
      Object.entries(publicCounts).map(([key, value]) => [key, Number(value)]),
    );
    assert.deepEqual(evidence.database_counts, {
      publications: 0,
      encounters: 0,
      thanks_rows: 0,
      reports: 0,
      legacy_votes: 0,
      hidden_rows: 0,
    });
    pass('PUB-OFF-01.no-side-effects', 'disabled Public calls create no publication, encounter, action or moderation rows');

    evidence.finished_at = new Date().toISOString();
    evidence.summary = { passed: evidence.assertions.length, failed: 0 };
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
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
