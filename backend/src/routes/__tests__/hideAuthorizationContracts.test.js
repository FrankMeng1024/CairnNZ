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
  assert.match(statement, /FROM cairn_acquisitions acquisition/);
  assert.match(statement, /JOIN cairn_revisions revision ON revision\.id=acquisition\.cairn_revision_id/);
  assert.match(statement, /JOIN cairn_collections collection/);
  assert.match(statement, /friend\.user_id=acquisition\.viewer_id AND friend\.friend_id=revision\.owner_id/);
  assert.match(statement, /owner\.id=revision\.owner_id AND owner\.deleted_at IS NULL/);
  assert.match(statement, /acquisition\.viewer_id=\? AND acquisition\.marker_id=\?/);
  assert.match(statement, /acquisition\.acquired_via='friends'/);
  assert.match(statement, /acquisition\.removed_at IS NULL AND collection\.removed_at IS NULL/);
  assert.match(statement, /revision\.availability='available'/);
  assert.match(statement, /COALESCE\(moderation\.state,'available'\)='available'/);
  assert.match(statement, /b\.blocker_id=acquisition\.viewer_id AND b\.blocked_id=revision\.owner_id/);
  assert.match(statement, /b\.blocker_id=revision\.owner_id AND b\.blocked_id=acquisition\.viewer_id/);
  assert.doesNotMatch(statement, /hidden\.user_id IS NULL/);
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
    && fixture.acquired === true
    && fixture.acquiredVia === 'friends'
    && fixture.collectionRemoved !== true
    && fixture.acquisitionRemoved !== true
    && fixture.revisionAvailable !== false
    && fixture.sourceAvailable !== false
    && fixture.currentFriend === true
    && fixture.blocked !== true
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
  { name: 'current acquired Friend Cairn snapshot', kind: 'mark', id: 41, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, allow: true },
  { name: 'unacquired Friend Cairn', kind: 'mark', id: 42, ownerId: 9, acquired: false, acquiredVia: 'friends', currentFriend: true },
  { name: 'Public acquisition cannot use Friend hide authority', kind: 'mark', id: 43, ownerId: 9, acquired: true, acquiredVia: 'public', currentFriend: true },
  { name: 'unfriended acquired Cairn stays in history but not Friend projection', kind: 'mark', id: 44, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: false },
  { name: 'blocked acquired Friend Cairn', kind: 'mark', id: 45, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, blocked: true },
  { name: 'owner Cairn', kind: 'mark', id: 46, ownerId: 7, acquired: true, acquiredVia: 'friends', currentFriend: false },
  { name: 'removed acquisition', kind: 'mark', id: 47, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, acquisitionRemoved: true },
  { name: 'removed collection', kind: 'mark', id: 48, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, collectionRemoved: true },
  { name: 'revision under review', kind: 'mark', id: 49, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, revisionAvailable: false },
  { name: 'source under review', kind: 'mark', id: 50, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, sourceAvailable: false },
  { name: 'missing/non-authorized Cairn id', kind: 'mark', id: 51, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, exists: false },
  { name: 'deleted-owner Friend Cairn', kind: 'mark', id: 52, ownerId: 9, acquired: true, acquiredVia: 'friends', currentFriend: true, ownerDeleted: true },
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
    if (statement.includes('FROM cairn_acquisitions acquisition')) {
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
