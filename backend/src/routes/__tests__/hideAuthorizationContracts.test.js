'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../../config/db');

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

function compact(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

function assertCairnAuthoritySql(sql, binds, fixture) {
  const statement = compact(sql);
  assert.match(statement, /FROM friend_cairn_encounters encounter/);
  assert.match(statement, /JOIN markers m ON m\.id = encounter\.marker_id/);
  assert.match(statement, /m\.user_id = encounter\.author_id/);
  assert.match(statement, /m\.permission = 'group'/);
  assert.match(statement, /m\.audience_epoch = encounter\.audience_epoch/);
  assert.match(statement, /m\.status <> 'hidden'/);
  assert.match(statement, /JOIN friends f ON f\.user_id = encounter\.viewer_id AND f\.friend_id = encounter\.author_id/);
  assert.match(statement, /episode\.id = encounter\.friendship_episode_id AND episode\.ended_at IS NULL/);
  assert.match(statement, /u\.id = encounter\.author_id AND u\.deleted_at IS NULL/);
  assert.match(statement, /encounter\.viewer_id = \? AND encounter\.marker_id = \?/);
  assert.match(statement, /b\.blocker_id = encounter\.viewer_id AND b\.blocked_id = encounter\.author_id/);
  assert.match(statement, /b\.blocker_id = encounter\.author_id AND b\.blocked_id = encounter\.viewer_id/);
  assert.doesNotMatch(statement, /encounter\.hidden_at IS NULL/);
  assert.deepEqual(binds, ['7', fixture.id]);
}

function assertRouteAuthoritySql(sql, binds, fixture) {
  const statement = compact(sql);
  assert.match(statement, /FROM routes r/);
  assert.match(statement, /JOIN friends f ON f\.user_id = \? AND f\.friend_id = r\.user_id/);
  assert.match(statement, /episode\.user_low_id = LEAST\(f\.user_id, f\.friend_id\)/);
  assert.match(statement, /episode\.user_high_id = GREATEST\(f\.user_id, f\.friend_id\)/);
  assert.match(statement, /episode\.ended_at IS NULL/);
  assert.match(statement, /u\.id = r\.user_id AND u\.deleted_at IS NULL/);
  assert.match(statement, /r\.id = \? AND r\.permission = 'friend'/);
  assert.match(statement, /b\.blocker_id = \? AND b\.blocked_id = r\.user_id/);
  assert.match(statement, /b\.blocker_id = r\.user_id AND b\.blocked_id = \?/);
  assert.doesNotMatch(statement, /hidden\.user_id IS NULL/);
  assert.deepEqual(binds, ['7', '7', fixture.id, '7', '7']);
}

function cairnQualifies(fixture) {
  return fixture.exists !== false
    && fixture.kind === 'mark'
    && fixture.ownerId !== 7
    && fixture.permission === 'group'
    && fixture.encounter === true
    && fixture.audienceCurrent === true
    && fixture.currentFriend === true
    && fixture.currentEpisode === true
    && fixture.blocked !== true
    && fixture.status !== 'hidden'
    && fixture.ownerDeleted !== true;
}

function routeQualifies(fixture) {
  return fixture.exists !== false
    && fixture.kind === 'route'
    && fixture.ownerId !== 7
    && fixture.permission === 'friend'
    && fixture.currentFriend === true
    && fixture.currentEpisode === true
    && fixture.blocked !== true
    && fixture.ownerDeleted !== true;
}

const scenarios = [
  { name: 'current Friend Cairn with current encounter and audience', kind: 'mark', id: 41, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, allow: true },
  { name: 'unencountered Friend Cairn', kind: 'mark', id: 42, ownerId: 9, permission: 'group', encounter: false, audienceCurrent: true, currentFriend: true, currentEpisode: true },
  { name: 'stale-audience Friend Cairn encounter', kind: 'mark', id: 43, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: false, currentFriend: true, currentEpisode: true },
  { name: 'revoked Friend Cairn episode', kind: 'mark', id: 44, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: false, currentEpisode: false },
  { name: 'blocked Friend Cairn', kind: 'mark', id: 45, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, blocked: true },
  { name: 'owner Cairn', kind: 'mark', id: 46, ownerId: 7, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: false, currentEpisode: false },
  { name: 'Public Cairn while feature disabled', kind: 'mark', id: 47, ownerId: 9, permission: 'public', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, publicEnabled: false },
  { name: 'Public Cairn alternate path while feature enabled', kind: 'mark', id: 48, ownerId: 9, permission: 'public', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, publicEnabled: true },
  { name: 'Personal Cairn', kind: 'mark', id: 49, ownerId: 9, permission: 'personal', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true },
  { name: 'hidden source Friend Cairn', kind: 'mark', id: 50, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, status: 'hidden' },
  { name: 'missing/non-authorized Cairn id', kind: 'mark', id: 51, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, exists: false },
  { name: 'deleted-owner Friend Cairn', kind: 'mark', id: 52, ownerId: 9, permission: 'group', encounter: true, audienceCurrent: true, currentFriend: true, currentEpisode: true, ownerDeleted: true },
  { name: 'current Friend Route', kind: 'route', id: 61, ownerId: 9, permission: 'friend', currentFriend: true, currentEpisode: true, allow: true, duplicate: true },
  { name: 'revoked Friend Route', kind: 'route', id: 62, ownerId: 9, permission: 'friend', currentFriend: false, currentEpisode: false },
  { name: 'blocked Friend Route', kind: 'route', id: 63, ownerId: 9, permission: 'friend', currentFriend: true, currentEpisode: true, blocked: true },
  { name: 'owner Route', kind: 'route', id: 64, ownerId: 7, permission: 'friend', currentFriend: false, currentEpisode: false },
  { name: 'Public Route', kind: 'route', id: 65, ownerId: 9, permission: 'public', currentFriend: true, currentEpisode: true },
  { name: 'Personal Route', kind: 'route', id: 66, ownerId: 9, permission: 'personal', currentFriend: true, currentEpisode: true },
  { name: 'missing/non-authorized Route id', kind: 'route', id: 67, ownerId: 9, permission: 'friend', currentFriend: true, currentEpisode: true, exists: false },
  { name: 'deleted-owner Friend Route', kind: 'route', id: 68, ownerId: 9, permission: 'friend', currentFriend: true, currentEpisode: true, ownerDeleted: true },
];

test('legacy generic Hide calls real Friend helpers and contract-inspects emitted SQL decisions without MySQL', async t => {
  const originalExecute = pool.execute;
  let activeFixture = null;
  let selectCount = 0;
  let insertCount = 0;

  // This deterministic pool observes the real helpers' SQL/binds and returns
  // fixture rows. It is a unit contract, not a claim that MySQL executed SQL.
  pool.execute = async (sql, binds) => {
    const statement = compact(sql);
    if (statement.includes('FROM friend_cairn_encounters encounter')) {
      selectCount += 1;
      assertCairnAuthoritySql(sql, binds, activeFixture);
      return [cairnQualifies(activeFixture) ? [{ id: activeFixture.id, user_id: activeFixture.ownerId }] : []];
    }
    if (statement.includes('FROM routes r')) {
      selectCount += 1;
      assertRouteAuthoritySql(sql, binds, activeFixture);
      return [routeQualifies(activeFixture) ? [{ id: activeFixture.id, user_id: activeFixture.ownerId }] : []];
    }
    if (statement.includes('INSERT INTO hidden_items')) {
      insertCount += 1;
      assert.equal(activeFixture.allow, true, `${activeFixture.name} reached hidden_items`);
      assert.deepEqual(binds, ['7', activeFixture.kind, activeFixture.id]);
      return [{ affectedRows: activeFixture.duplicate ? 0 : 1 }];
    }
    throw new Error(`unexpected SQL: ${statement}`);
  };

  delete require.cache[require.resolve('../hide')];
  const router = require('../hide');
  const route = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post);
  const handler = route.route.stack[route.route.stack.length - 1].handle;

  try {
    for (const fixture of scenarios) {
      await t.test(fixture.name, async () => {
        activeFixture = fixture;
        selectCount = 0;
        insertCount = 0;
        assert.equal(
          fixture.kind === 'mark' ? cairnQualifies(fixture) : routeQualifies(fixture),
          fixture.allow === true,
          'fixture expectation must match the production SQL authority contract',
        );
        const res = responseRecorder();
        await handler({ user: { userId: '7' }, body: { item_type: fixture.kind, item_id: fixture.id } }, res);

        assert.equal(selectCount, 1, 'actual authorization helper must issue exactly one authority query');
        if (fixture.allow) {
          assert.equal(insertCount, 1);
          assert.equal(res.statusCode, fixture.duplicate ? 200 : 201);
          assert.deepEqual(res.body, {
            hidden: true,
            item_type: fixture.kind,
            item_id: fixture.id,
            already_hidden: fixture.duplicate === true,
          });
        } else {
          assert.equal(insertCount, 0, 'denial must not write hidden_items');
          assert.equal(res.statusCode, 404);
          assert.deepEqual(res.body, { error: 'Content unavailable.', code: 'CONTENT_UNAVAILABLE' });
        }
      });
    }
  } finally {
    pool.execute = originalExecute;
    delete require.cache[require.resolve('../hide')];
  }
});
