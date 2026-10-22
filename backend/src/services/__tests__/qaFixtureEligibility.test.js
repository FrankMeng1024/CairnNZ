'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { qaFixtureEligibleSql, qaFixtureExpirySql } = require('../qaFixtureEligibility');

const src = relative => fs.readFileSync(path.resolve(__dirname, '..', '..', relative), 'utf8');

test('shared fixture predicate fails closed on safety, batch state, TTL, and exact viewer cohort', () => {
  const sql = qaFixtureEligibleSql('revision.marker_id', 'acquisition.viewer_id');
  assert.match(sql, /safety_state<>'field_verified'/);
  assert.match(sql, /qa_batch\.state<>'active'/);
  assert.match(sql, /qa_batch\.expires_at<=UTC_TIMESTAMP\(3\)/);
  assert.match(sql, /qa_reader\.viewer_id=acquisition\.viewer_id/);
  assert.match(qaFixtureExpirySql('revision.marker_id'), /MIN\(qa_expiry_batch\.expires_at\)/);
  assert.throws(() => qaFixtureEligibleSql('revision.marker_id;DROP TABLE users', '?'));
  assert.throws(() => qaFixtureExpirySql('marker.id OR 1=1'));
});

test('legacy, retained, direct, scene, notification, and friend discovery consumers share the gate', () => {
  const required = [
    'routes/public-cairns.js',
    'routes/cairn-memory.js',
    'routes/circle.js',
    'routes/friend-content.js',
    'models/PushNotification.js',
    'services/friendAuthorization.js',
    'services/friendDiscoveryCandidates.js',
    'services/legacyCairnInteractionAuthorization.js',
  ];
  for (const relative of required) {
    assert.match(src(relative), /qaFixtureEligibleSql\(/, `${relative} must enforce fixture eligibility`);
  }
  assert.match(src('routes/public-cairns.js'), /qaFixtureExpirySql\(/);
  assert.match(src('routes/friend-content.js'), /qaFixtureExpirySql\(/);
  assert.match(src('services/friendAuthorization.js'), /qaFixtureExpirySql\(/);
});
