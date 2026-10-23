'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { authorizedLegacyGroupInteraction } = require('../legacyCairnInteractionAuthorization');

const routeSource = fs.readFileSync(path.resolve(__dirname, '../../routes/markers.js'), 'utf8');
const compact = value => String(value).replace(/\s+/g, ' ').trim();

function qualifies(fixture) {
  return fixture.acquired === true
    && fixture.acquiredVia === 'friends'
    && fixture.sourceAudience === 'friends'
    && fixture.acquiredRevision === fixture.currentRevision
    && !fixture.acquisitionRemoved
    && !fixture.collectionRemoved
    && !fixture.hidden
    && !fixture.blocked
    && !fixture.ownerDeleted
    && fixture.available !== false
    && fixture.sourceAvailable !== false;
}

const scenarios = [
  { name: 'current Friend who acquired the exact revision', currentFriend: true, acquired: true, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 4, currentRevision: 4, allow: true },
  { name: 'revoked Friend retains the exact acquired revision', currentFriend: false, acquired: true, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 4, currentRevision: 4, allow: true },
  { name: 'current Friend without an encounter', currentFriend: true, acquired: false, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 4, currentRevision: 4 },
  { name: 'an earlier acquired revision after author update', currentFriend: true, acquired: true, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 3, currentRevision: 4 },
  { name: 'Public acquisition cannot enter the legacy Friends path', currentFriend: false, acquired: true, acquiredVia: 'public', sourceAudience: 'public', acquiredRevision: 4, currentRevision: 4 },
  { name: 'removed retained copy', acquired: true, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 4, currentRevision: 4, collectionRemoved: true },
  { name: 'blocked relationship after acquisition', acquired: true, acquiredVia: 'friends', sourceAudience: 'friends', acquiredRevision: 4, currentRevision: 4, blocked: true },
];

test('legacy group interaction helper requires the exact retained Friends revision', async t => {
  for (const fixture of scenarios) {
    await t.test(fixture.name, async () => {
      const db = {
        execute: async (sql, binds) => {
          const statement = compact(sql);
          assert.match(statement, /FROM cairn_acquisitions acquisition/);
          assert.match(statement, /revision\.content_revision=\?/);
          assert.match(statement, /revision\.source_audience='friends'/);
          assert.match(statement, /acquisition\.acquired_via='friends'/);
          assert.match(statement, /collection\.relationship='found'/);
          assert.match(statement, /acquisition\.removed_at IS NULL/);
          assert.match(statement, /collection\.removed_at IS NULL/);
          assert.match(statement, /hidden\.user_id IS NULL/);
          assert.match(statement, /blocked_users block/);
          assert.doesNotMatch(statement, /JOIN friends/);
          assert.deepEqual(binds, ['7', 41, 9, fixture.currentRevision]);
          return [qualifies(fixture) ? [{ id: 1, content_revision: fixture.currentRevision }] : []];
        },
      };
      const result = await authorizedLegacyGroupInteraction(db, {
        viewerId: '7', markerId: 41, ownerId: 9, contentRevision: fixture.currentRevision,
      });
      assert.equal(Boolean(result), fixture.allow === true);
    });
  }
});

test('all three legacy marker interaction routes apply the retained-revision gate', () => {
  assert.ok((routeSource.match(/authorizedLegacyGroupInteraction\(/g) || []).length >= 3);
  assert.ok((routeSource.match(/marker\.permission !== 'group'/g) || []).length >= 3);
  assert.match(routeSource, /SELECT id, user_id, permission, content_revision/);
  assert.match(routeSource, /permission, content_revision[\s\S]*FROM markers WHERE id = \? FOR UPDATE/);
  assert.doesNotMatch(routeSource, /marker\.permission === 'group'[\s\S]{0,180}friends/);
});
