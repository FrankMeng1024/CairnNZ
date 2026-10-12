'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Friend revision eligibility starts after the trusted mutable revision frontier', () => {
  const source = read('routes/cairn-memory.js');
  const markerSource = read('routes/markers.js');
  const migration = read('migrations/045_memory_friends_cairn_contract.sql');
  const candidates = source.slice(
    source.indexOf('async function loadDiscoveryCandidates'),
    source.indexOf("router.post('/discover'"),
  );
  const revisionFrontiers = candidates.match(
    /GREATEST\([\s\S]*?episode\.started_at,marker\.created_at,marker\.content_changed_at,audience\.starts_at[\s\S]*?\)/g,
  ) || [];
  assert.ok(revisionFrontiers.length >= 2, 'both evidence and visit-entry frontiers include marker.content_changed_at');
  assert.match(migration, /content_changed_at DATETIME\(3\) NOT NULL/);
  assert.match(markerSource, /content_changed_at = CASE WHEN \? = 1 THEN UTC_TIMESTAMP\(3\)/);
  assert.match(markerSource, /content_changed_at = UTC_TIMESTAMP\(3\)/);
  assert.match(candidates, /moderated_revision\.content_revision=marker\.content_revision/);
  assert.doesNotMatch(candidates, /moderated_revision\.source_audience='friends'/);
});

test('Public discovery checks the authenticated viewer before loading any Public category', () => {
  const source = read('routes/cairn-memory.js');
  const candidates = source.slice(
    source.indexOf('async function loadDiscoveryCandidates'),
    source.indexOf("router.post('/discover'"),
  );
  const viewerGate = candidates.indexOf('if (!publicPilotAuthorized(viewerId))');
  const publicQuery = candidates.indexOf('const [publicRows]');
  assert.ok(viewerGate > 0 && publicQuery > viewerGate);
  assert.match(candidates.slice(viewerGate, publicQuery), /updated: \[\], public: \[\]/);
});

test('logical revision moderation spans every audience snapshot and matching delivery', () => {
  const source = read('routes/cairn-memory.js');
  const decision = source.slice(source.indexOf("router.post('/operator/cases/:case_id/decision'"));
  assert.match(decision, /WHERE marker_id=\? AND content_revision=\? FOR UPDATE/);
  assert.match(decision, /WHERE marker_id=\? AND content_revision=\? AND availability<>'removed'/);
  assert.match(decision, /publication\.marker_id=\? AND publication\.content_revision=\?/);
  assert.match(decision, /JOIN cairn_revisions revision ON revision\.id=acquisition\.cairn_revision_id/);

  const publicSource = read('routes/public-cairns.js');
  assert.ok((publicSource.match(/moderated_revision\.content_revision=marker\.content_revision/g) || []).length >= 3);
  assert.ok((publicSource.match(/moderated_revision\.availability<>'available'/g) || []).length >= 3);
});

test('source moderation overlays rather than overwrites independent revision state', () => {
  const source = read('routes/cairn-memory.js');
  const decision = source.slice(source.indexOf("router.post('/operator/cases/:case_id/decision'"));
  assert.doesNotMatch(
    decision,
    /decisionScope === 'source'[\s\S]{0,300}UPDATE cairn_revisions SET availability=\?/,
  );
  assert.match(decision, /else if \(decisionScope === 'revision'\)/);

  const history = source.slice(
    source.indexOf("router.get('/cairns/:marker_id/history'"),
    source.indexOf("router.put('/cairns/:marker_id/collection'"),
  );
  assert.ok((history.match(/LEFT JOIN cairn_source_moderation moderation/g) || []).length >= 3);
  assert.ok((history.match(/COALESCE\(moderation\.state,'available'\)='available'/g) || []).length >= 3);
});

test('legacy screen-load verifier is fail-closed and cannot create a second entitlement', () => {
  const source = read('routes/friend-content.js');
  const route = source.slice(
    source.indexOf("router.post('/encounters/verify'"),
    source.indexOf('async function legacyFriendEncounterVerifier'),
  );
  assert.match(route, /status\(410\)/);
  assert.match(route, /CAIRN_MEMORY_DISCOVERY_REQUIRED/);
  assert.match(route, /encountered_marker_ids: \[\]/);
});

test('Thanks rejects self-acknowledgement even if an invalid acquisition row exists', () => {
  const source = read('routes/cairn-memory.js');
  const thanks = source.slice(
    source.indexOf("router.post('/revisions/:revision_id/thanks'"),
    source.indexOf("router.put('/cairns/:marker_id/collection'"),
  );
  assert.match(thanks, /revision\.owner_id<>\?/);
  assert.match(thanks, /acquisition\.opened_at IS NOT NULL/);
  assert.match(thanks, /thanked_at=COALESCE\(thanked_at,UTC_TIMESTAMP\(3\)\)/);
  for (const relative of ['routes/cairn-memory.js', 'routes/markers.js', 'services/ownedCairnLibrary.js']) {
    assert.match(read(relative), /thanked\.viewer_id<>marker\.user_id/);
  }
});

test('acquisition idempotency is keyed by viewer, Cairn and logical content revision', () => {
  const migration = read('migrations/045_memory_friends_cairn_contract.sql');
  const history = read('services/cairnHistory.js');
  assert.match(migration, /content_revision BIGINT UNSIGNED NOT NULL/);
  assert.match(migration, /uk_cairn_acquisition_logical_revision[\s\S]*\(viewer_id, marker_id, content_revision\)/);
  assert.match(history, /WHERE viewer_id=\? AND marker_id=\? AND content_revision=\?/);
  assert.match(history, /cairn_revision_id,content_revision,acquired_via/);
});
