'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendRoot = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(backendRoot, relative), 'utf8');

test('start schema accepts immutable client Activity identity for either mode', () => {
  const schema = read('src/middleware/schemas.js');
  assert.match(schema, /const sessionStart = Joi\.object\([\s\S]*client_activity_id: clientUuid/);
  assert.match(schema, /type: Joi\.string\(\)\.valid\('hiking', 'running'\)/);
});

test('save accepts the canonical segmented foreground/background point contract and stable Memory ID', () => {
  const schema = read('src/middleware/schemas.js');
  assert.match(schema, /segment_id: Joi\.string\(\)\.min\(1\)\.max\(80\)/);
  assert.match(schema, /'process-recovery'/);
  assert.match(schema, /const memoryPointObjInline[\s\S]*cid: Joi\.string/);
  assert.match(schema, /const sessionSave[\s\S]*client_activity_id: clientUuid/);
});

test('bounded historical accelerated Activity payload traverses Start, append, Finish and Memory validation', () => {
  const schemas = require('../../middleware/schemas');
  const wallNow = Date.now();
  const startedAt = wallNow - 12 * 60 * 60 * 1000 - 60 * 1000;
  const first = { lat: -45.0312, lng: 168.6626, alt: 100, acc: 5, t: startedAt, segment_id: 'segment-a', segment_start_reason: 'start' };
  const second = { lat: -45.0237, lng: 168.6626, alt: 110, acc: 5, t: startedAt + 10 * 60 * 1000, segment_id: 'segment-a' };
  const memory = [
    { lat: first.lat, lng: first.lng, ts: first.t, cid: '11111111-1111-4111-8111-111111111111' },
    { lat: second.lat, lng: second.lng, ts: second.t, cid: '22222222-2222-4222-8222-222222222222' },
  ];

  assert.equal(schemas.session.start.validate({
    client_activity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    client_op_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'hiking',
    start_time: new Date(startedAt).toISOString(),
  }).error, undefined);
  assert.equal(schemas.session.appendPoints.validate({
    client_op_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    points: [first, second],
  }).error, undefined);
  assert.equal(schemas.session.save.validate({
    client_activity_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    client_op_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    end_time: new Date(second.t).toISOString(),
    distance_m: 833,
    duration_s: 600,
    name: 'Accelerated QA',
    route_points: [first, second],
    route_points_raw: [first, second],
    memory_points: memory,
  }).error, undefined);
  assert.equal(schemas.memory.points.validate({ points: memory }).error, undefined);
  assert.ok(startedAt < first.t + 1);
  assert.ok(second.t < wallNow);
});

test('legacy malformed background points are not silently reinterpreted by the server contract', () => {
  const schema = read('src/middleware/schemas.js');
  const append = schema.slice(schema.indexOf('const sessionAppendPoints'), schema.indexOf('const pointObj'));
  assert.match(append, /lat: lat\.required\(\)/);
  assert.match(append, /lng: lng\.required\(\)/);
  assert.match(append, /t: Joi\.number\(\)\.integer\(\)\.min\(0\)\.required\(\)/);
  assert.doesNotMatch(append, /latitude|longitude|timestamp/);
});

test('live and queued session writes accept their idempotency body field', () => {
  const schema = read('src/middleware/schemas.js');
  const append = schema.slice(schema.indexOf('const sessionAppendPoints'), schema.indexOf('const pointObj'));
  const save = schema.slice(schema.indexOf('const sessionSave'), schema.indexOf('const sessionUpdate'));
  const update = schema.slice(schema.indexOf('const sessionUpdate'), schema.indexOf('// ── Routes'));
  assert.match(append, /client_op_id: clientUuid/);
  assert.match(save, /client_op_id: clientUuid/);
  assert.match(update, /client_op_id: clientUuid/);
});

test('Cairn create accepts immutable identity and Activity provenance', () => {
  const schema = read('src/middleware/schemas.js');
  assert.match(schema, /client_cairn_id: clientUuid/);
  assert.match(schema, /origin_activity_client_id: clientUuid\.allow\(null\)/);
});

test('migration defines per-user business uniqueness and resurrection tombstones', () => {
  const sql = read('src/migrations/034_free_activity_client_identity.sql');
  assert.match(sql, /UNIQUE INDEX uk_sessions_user_client_activity\s+ON sessions\(user_id, client_activity_id\)/);
  assert.match(sql, /UNIQUE INDEX uk_markers_user_client_cairn\s+ON markers\(user_id, client_cairn_id\)/);
  assert.match(sql, /CREATE TABLE activity_client_tombstones/);
  assert.match(sql, /CREATE TABLE marker_client_tombstones/);
  assert.ok((sql.match(/COLLATE=utf8mb4_unicode_ci/g) || []).length >= 2);
  assert.match(sql, /ON DELETE SET NULL/);
});

test('singleton schema and migration ledger fail closed', () => {
  const sql = read('src/migrations/034_free_activity_client_identity.sql');
  const model = read('src/models/Session.js');
  const runner = read('../docker/run-pending-migrations.sh');
  assert.match(sql, /GENERATED ALWAYS AS[\s\S]*end_time = start_time[\s\S]*THEN 1/);
  assert.match(sql, /UNIQUE INDEX uk_sessions_user_active_slot\s+ON sessions\(user_id, active_slot\)/);
  assert.match(model, /SELECT id FROM users WHERE id = \? FOR UPDATE/);
  assert.match(model, /UNFINISHED_ACTIVITY_EXISTS/);
  assert.match(runner, /schema already satisfies migration/);
  assert.match(runner, /grep -qE '\^ERROR \[0-9\]\+'/);
  assert.match(runner, /Migration \$mig_file reported one or more statement failures\. Ledger unchanged/);
  const failureBranch = runner.slice(runner.indexOf('if [ "$mig_status" -ne 0 ]'));
  assert.ok(failureBranch.indexOf('exit 1') < failureBranch.indexOf('ledger_next='));
});

test('server reconciliation preserves client identity before acknowledging and cleanup', () => {
  const sessions = read('src/routes/sessions.js');
  const markers = read('src/routes/markers.js');
  const model = read('src/models/Session.js');
  assert.match(sessions, /client_activity_id: rows\[0\]\.client_activity_id/);
  assert.ok(sessions.indexOf('UPDATE sessions SET client_activity_id') < sessions.indexOf('const alreadyFinalized'));
  assert.match(model, /identity migration, not creation/);
  assert.ok(model.indexOf('await conn.commit();', model.indexOf('identity migration, not creation')) < model.indexOf("Another unfinished Activity must be resolved first"));
  assert.match(model, /!clientActivityId && !active\.client_activity_id[\s\S]*active\.type !== type[\s\S]*UNFINISHED_ACTIVITY_EXISTS/);
  assert.match(model, /ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID\(id\)/);
  assert.match(model, /origin_activity_client_id = \? AND origin_session_id IS NULL/);
  assert.match(markers, /client_cairn_id, origin_activity_client_id, origin_session_id/);
  assert.match(markers, /ON DUPLICATE KEY UPDATE\s+id=LAST_INSERT_ID\(id\)/);
});

test('client-identity delete routes persist tombstones before removing matching rows', () => {
  const sessions = read('src/routes/sessions.js');
  const markers = read('src/routes/markers.js');
  const activityDelete = sessions.slice(sessions.indexOf("router.delete('/client/:clientActivityId'"));
  const cairnDelete = markers.slice(markers.indexOf("router.delete('/client/:clientCairnId'"));
  assert.ok(activityDelete.indexOf('INSERT INTO activity_client_tombstones') < activityDelete.indexOf('DELETE FROM sessions'));
  assert.ok(cairnDelete.indexOf('INSERT INTO marker_client_tombstones') < cairnDelete.indexOf('DELETE FROM markers'));
});

test('legacy numeric delete paths tombstone any discovered client identity transactionally', () => {
  const sessions = read('src/models/Session.js');
  const markers = read('src/routes/markers.js');
  const sessionDelete = sessions.slice(sessions.indexOf('async deleteByIdAndUser'), sessions.indexOf('async findByIdAndUser'));
  const markerDelete = markers.slice(markers.indexOf("router.delete('/:id'"), markers.indexOf('// ─────────────────────────────────────────────────────────────────────', markers.indexOf("router.delete('/:id'")));
  for (const source of [sessionDelete, markerDelete]) {
    assert.match(source, /SELECT id FROM users WHERE id = \? FOR UPDATE/);
    assert.match(source, /FOR UPDATE/);
    assert.ok(source.indexOf('tombstones') < source.indexOf('DELETE FROM'));
    assert.match(source, /conn\.commit/);
  }
});

test('completed Activity rename is authenticated, validated and rejects deleted rows', () => {
  const schemas = require('../../middleware/schemas');
  const routes = read('src/routes/sessions.js');
  const model = read('src/models/Session.js');
  assert.equal(schemas.session.rename.validate({ name: 'Hike — corrected' }).error, undefined);
  assert.ok(schemas.session.rename.validate({ name: '   ' }).error);
  assert.match(routes, /router\.patch\('\/:id\/name', authenticate, validateBody\(schemas\.session\.rename\)/);
  assert.match(routes, /ACTIVITY_NOT_FOUND/);
  assert.match(model, /async renameCompleted[\s\S]*finalized_at IS NOT NULL/);
});

test('Activity-derived Route creation is serialized against source deletion', () => {
  const schemas = require('../../middleware/schemas');
  const routeSchema = schemas.route.create.validate({
    name: 'From Activity',
    points: [{ lat: -45, lng: 168 }, { lat: -45.001, lng: 168.001 }],
    source_activity_client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.equal(routeSchema.error, undefined);
  const routes = read('src/routes/routes.js');
  const model = read('src/models/Route.js');
  assert.match(routes, /source_activity_client_id/);
  assert.match(routes, /SOURCE_ACTIVITY_NOT_FOUND/);
  const guardedCreate = model.slice(model.indexOf('if (!sourceActivityClientId'));
  assert.ok(guardedCreate.indexOf('SELECT id FROM users WHERE id = ? FOR UPDATE') < guardedCreate.indexOf('SELECT id FROM sessions'));
  assert.ok(guardedCreate.indexOf('SELECT id FROM sessions') < guardedCreate.indexOf('const [result] = await insert(conn)'));
  assert.match(guardedCreate, /finalized_at IS NOT NULL/);
});
