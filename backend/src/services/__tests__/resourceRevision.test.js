'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHARED_CACHE_TTL_MS,
  resourceRevision,
  sharedContentMetadata,
} = require('../resourceRevision');

test('material revisions differ even when legacy timestamps are identical', () => {
  const common = { id: 42, updated_at: '2026-09-18 16:20:36', audience_epoch: 7 };
  const first = resourceRevision('cairn', { ...common, content_revision: 11 });
  const second = resourceRevision('cairn', { ...common, content_revision: 12 });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(first, second);
});

test('resource and authorization revisions are independent authorities', () => {
  const issuedAt = new Date('2026-09-18T00:00:00.000Z');
  const base = {
    id: 8,
    content_revision: 3,
    friendship_episode_id: 19,
    audience_epoch: 4,
  };
  const first = sharedContentMetadata('route', base, issuedAt);
  const authorizationChange = sharedContentMetadata(
    'route',
    { ...base, friendship_episode_id: 20, audience_epoch: 5 },
    issuedAt,
  );
  assert.equal(first.resource_revision, authorizationChange.resource_revision);
  assert.notEqual(first.authorization_revision, authorizationChange.authorization_revision);
  assert.equal(
    new Date(first.authorization_expires_at).getTime() - new Date(first.authorization_issued_at).getTime(),
    SHARED_CACHE_TTL_MS,
  );
});

test('missing persisted content revision fails closed', () => {
  assert.throws(
    () => resourceRevision('cairn', { id: 1, updated_at: new Date() }),
    /Missing cairn content revision/,
  );
});
