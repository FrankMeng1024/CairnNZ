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

const OWNER_ID = 1001;
const UNAUTHORIZED_VIEWER_ID = 1002;
const OPERATOR_ID = 1003;
const AUTHORIZED_VIEWER_ID = 1004;

function tokenFor(userId) {
  return jwt.sign({
    userId: String(userId), token_version: 0, jti: `production-gate-${crypto.randomUUID()}`,
  }, jwtSecret, { expiresIn: '30m' });
}

async function api(userId, path, { method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenFor(userId)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

function snapshotHash({ text, lat, lng }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    type: 'cairn', text, lat: Number(lat), lng: Number(lng), approximate: true,
  })).digest('hex');
}

async function insertPresence(db, viewerId, lat, lng) {
  const now = Date.now();
  await db.execute(
    `INSERT INTO memory_presence_witnesses
       (user_id,client_id,first_lat,first_lng,first_observed_at_ms,
        lat,lng,observed_at_ms,evidence_source,source_activity_client_id,
        source_segment_id,horizontal_accuracy_m,continuity_state,received_at)
     VALUES (?,?,?,?,?,?,?,?, 'passive_real',NULL,NULL,9,'accepted',UTC_TIMESTAMP(3))`,
    [viewerId, crypto.randomUUID(), lat, lng, now - 15_000, lat + 0.000005, lng + 0.000005, now],
  );
}

async function main() {
  assert.equal(process.env.NODE_ENV, 'production');
  assert.equal(process.env.CAIRN_REALM, 'production');
  assert.equal(process.env.ALLOW_ISOLATED_QA_SOURCE_CONTRACT, '0');
  assert.equal(process.env.PUBLIC_CAIRN_PILOT_USER_IDS, `${OWNER_ID},${AUTHORIZED_VIEWER_ID}`);

  const db = await mysql.createConnection(dbConfig);
  try {
    for (const [id, label, operator] of [
      [OWNER_ID, 'Owner', 0],
      [UNAUTHORIZED_VIEWER_ID, 'Unauthorized', 0],
      [OPERATOR_ID, 'Operator', 1],
      [AUTHORIZED_VIEWER_ID, 'Authorized', 0],
    ]) {
      await db.execute(
        `INSERT INTO users
           (id,name,email,password_hash,date_of_birth,public_cairn_operator,activity_source_realm)
         VALUES (?,?,?,?,?,?,'standard')`,
        [id, `Production Gate ${label}`, `production-gate-${id}@example.org`,
          'synthetic-no-login', '1990-01-01', operator],
      );
    }

    await db.execute(
      `INSERT INTO friends (user_id,friend_id,created_at)
       VALUES (?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE)),
              (?,?,DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE))`,
      [OWNER_ID, UNAUTHORIZED_VIEWER_ID, UNAUTHORIZED_VIEWER_ID, OWNER_ID],
    );
    await db.execute(
      `INSERT INTO friendship_episodes
         (episode_id,user_low_id,user_high_id,started_at)
       VALUES (?,LEAST(?,?),GREATEST(?,?),DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE))`,
      [crypto.randomUUID(), OWNER_ID, UNAUTHORIZED_VIEWER_ID, OWNER_ID, UNAUTHORIZED_VIEWER_ID],
    );

    const place = { lat: -41.2867, lng: 174.7763 };
    const [friendMarker] = await db.execute(
      `INSERT INTO markers
         (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,content_revision)
       VALUES (?,'cairn','Friend-only survives Public viewer gate',?,?,'group',1,'healthy',
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),1)`,
      [OWNER_ID, place.lat, place.lng],
    );
    await db.execute(
      `INSERT INTO marker_audience_epochs
         (marker_id,owner_id,audience_epoch,visibility,starts_at)
       SELECT id,user_id,audience_epoch,'group',DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE)
         FROM markers WHERE id=?`,
      [friendMarker.insertId],
    );

    const publicText = 'Public requires an authorized viewer';
    const [publicMarker] = await db.execute(
      `INSERT INTO markers
         (user_id,type,text,lat,lng,permission,approximate,status,created_at,updated_at,
          content_revision,public_intent,public_state,publication_epoch,public_state_changed_at)
       VALUES (?,'cairn',?,?,?,'public',1,'healthy',
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),1,1,'published',1,
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE))`,
      [OWNER_ID, publicText, place.lat, place.lng],
    );
    await db.execute(
      `INSERT INTO public_cairn_publications
         (marker_id,owner_id,publication_epoch,content_revision,
          snapshot_type,snapshot_text,snapshot_lat,snapshot_lng,snapshot_approximate,
          snapshot_sha256,snapshot_location_policy_version,state,decided_at,decided_by,published_at)
       VALUES (?,?,1,1,'cairn',?,?,?,1,?,?,'published',
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE),?,
               DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE))`,
      [publicMarker.insertId, OWNER_ID, publicText, place.lat, place.lng,
        snapshotHash({ text: publicText, ...place }), locationPolicyVersion(), OPERATOR_ID],
    );

    await insertPresence(db, UNAUTHORIZED_VIEWER_ID, place.lat, place.lng);
    const unauthorized = await api(UNAUTHORIZED_VIEWER_ID, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(unauthorized.acquired.map(item => item.marker_id), [String(friendMarker.insertId)]);
    assert.deepEqual(unauthorized.acquired.map(item => item.category), ['friend']);

    await insertPresence(db, AUTHORIZED_VIEWER_ID, place.lat, place.lng);
    const authorized = await api(AUTHORIZED_VIEWER_ID, '/api/cairn-memory/discover', {
      method: 'POST', body: {},
    });
    assert.deepEqual(authorized.acquired.map(item => item.marker_id), [String(publicMarker.insertId)]);

    const result = {
      schema: 'cairnnz.memory-public-viewer-gate.production-path.v1',
      runtime: { node_env: process.env.NODE_ENV, realm: process.env.CAIRN_REALM },
      assertions: [
        {
          id: 'DISC-PROD-09.public-viewer-gate', result: 'PASS',
          detail: 'non-allowlisted viewer acquired eligible Friend-only Cairn but no Public Cairn',
        },
        {
          id: 'DISC-PROD-09a.authorized-viewer', result: 'PASS',
          detail: 'explicitly allowlisted viewer acquired the same eligible Public publication through the production gate',
        },
      ],
      summary: { passed: 2, failed: 0 },
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await db.end();
  }
}

main().catch(error => {
  process.stdout.write(`${JSON.stringify({
    schema: 'cairnnz.memory-public-viewer-gate.production-path.v1',
    summary: { passed: 0, failed: 1 },
    failure: { name: error.name, message: error.message, stack: error.stack },
  }, null, 2)}\n`);
  process.exitCode = 1;
});
