'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', '..', relative), 'utf8');

test('Friends Memory authority is explicit per friend and legacy writes are retired', () => {
  const sharing = read('src/routes/friend-sharing.js');
  const authorization = read('src/services/friendAuthorization.js');
  const subscriptions = read('src/routes/memory-subscriptions.js');
  const migration = read('src/migrations/049_retire_legacy_memory_sharing.sql');
  assert.match(sharing, /router\.put\('\/policy'[\s\S]{0,300}status\(410\)/);
  assert.match(sharing, /router\.put\('\/grants'[\s\S]{0,300}status\(410\)/);
  assert.match(authorization, /g\.coverage_scope = 'full_history_delayed_v1'/);
  assert.doesNotMatch(authorization, /coverage_scope = 'full_history_delayed_v1' OR/);
  assert.doesNotMatch(subscriptions, /coverage_scope = 'full_history_delayed_v1' OR/);
  assert.match(migration, /legacy_contract_retired/);
  assert.match(migration, /ENUM\([\s\S]*'legacy_contract_retired'/);
  assert.match(migration, /NOT EXISTS \([\s\S]*coverage_scope = 'full_history_delayed_v1'/);
});

test('Public Cairn remains anonymous while server-side block resolves its real author', () => {
  const source = read('src/routes/public-cairns.js');
  assert.match(source, /author: \{ id: 'anonymous', name: 'Anonymous explorer' \}/);
  assert.match(source, /router\.post\('\/cairns\/:id\/block-author'/);
  assert.match(source, /const authorId = Number\(initial\.author_id\)/);
  assert.doesNotMatch(source, /author: \{ id: String\(row\.author_id\), name: row\.author_name \}/);
});

test('declined history does not invent a resend policy and passive server promotion is enforced', () => {
  const friends = read('src/routes/friends.js');
  const memory = read('src/routes/memory.js');
  assert.match(friends, /Historical accepted\/declined\/cancelled attempts are audit/);
  assert.doesNotMatch(friends, /INTERVAL 30 DAY/);
  assert.match(memory, /if \(evidenceSource === 'passive_real'\) continuityState = 'unknown'/);
  assert.match(memory, /durationMs >= 15_000 && plausibleSpeedMps <= 15/);
  assert.match(memory, /UPDATE memory_points point[\s\S]*memory_presence_witnesses witness/);
});

test('Friends source status and projection both include server-accepted passive witnesses', () => {
  const projection = read('src/services/friendProjection.js');
  const sharing = read('src/routes/friend-sharing.js');
  const coverage = read('src/services/memoryCoverage.js');
  const migration = read('src/migrations/051_memory_coverage_read_model.sql');
  assert.equal((projection.match(/witness\.evidence_source IN \('activity_real','passive_real'\)/g) ?? []).length, 2);
  assert.match(sharing, /FROM memory_coverage_evidence evidence[\s\S]*share_ready_at<=UTC_TIMESTAMP/);
  assert.match(coverage, /mp\.evidence_source='passive_real' OR EXISTS/);
  assert.match(migration, /mp\.evidence_source = 'passive_real'[\s\S]*OR EXISTS/);
});
