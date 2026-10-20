'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PushNotification = require('../PushNotification');

test('encounter push is opt-in while legacy push defaults are preserved', () => {
  assert.equal(PushNotification.preferenceAllows('memory_hit', []), false);
  assert.equal(PushNotification.preferenceAllows('memory_hit', [{ enabled: 0 }]), false);
  assert.equal(PushNotification.preferenceAllows('memory_hit', [{ enabled: 1 }]), true);
  assert.equal(PushNotification.preferenceAllows('friend_request', []), true);
});

test('preferences API and migration expose encounter alerts as off by default', () => {
  const pushRoute = fs.readFileSync(path.resolve(__dirname, '../../routes/push.js'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '../../migrations/054_memory_hit_push_explicit_opt_in.sql'), 'utf8');
  assert.match(pushRoute, /memoryHits:\s*false/);
  assert.match(migration, /UPDATE user_push_prefs SET pref_memory_hits=0/);
  assert.match(migration, /pref_memory_hits TINYINT\(1\) NOT NULL DEFAULT 0/);
});

test('push claim retains the durable related group for safe notification navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'PushNotification.js'), 'utf8');
  assert.match(source, /SELECT id, recipient_user_id, kind, related_id, title, body/);
  assert.match(source, /notification_log_id: String\(row\.id\)/);
  assert.match(source, /related_id: row\.related_id == null/);
  assert.match(source, /viewer_id: String\(row\.recipient_user_id\)/);
});
