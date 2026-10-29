'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = process.env.CAIRN_CONTRACT_ROOT
  ? path.resolve(process.env.CAIRN_CONTRACT_ROOT)
  : path.resolve(__dirname, '../../../..');
const read = relative => fs.readFileSync(path.join(repoRoot, relative), 'utf8');

test('stable Base upload is released before optional refinement dispatch', () => {
  const tracking = read('app/src/store/useTrackingStore.ts');
  const start = tracking.indexOf('await enqueueActivityFinalRefinement({');
  const ready = tracking.indexOf('await pendingSyncStore.markPendingUploadReady(s.sessionId);', start);
  const notify = tracking.indexOf('notifyLocalCommit(s.sessionId);', ready);
  const refinement = tracking.indexOf('void resumeActivityFinalRefinement(ownerUserId, s.sessionId)', notify);
  assert.ok(start >= 0 && ready > start, 'Base outbox is not released after durable enqueue');
  assert.ok(notify > ready, 'local commit wake must follow verified ready write');
  assert.ok(refinement > notify, 'optional Mapbox refinement must be asynchronous after upload wake');
});
test('registry-committed recovery cannot busy-loop on a missing optional artifact', () => {
  const daemon = read('app/src/services/syncDaemon.ts');
  const start = daemon.indexOf('export async function recoverPreparingActivityCompletion');
  const end = daemon.indexOf('/**\n * 触发一次 drain', start);
  const recovery = daemon.slice(start, end);
  assert.match(recovery, /preparationPhase === 'registry_committed'[\s\S]*markPendingUploadReady/);
  assert.doesNotMatch(recovery, /loadActivityFinalArtifact|resumeActivityFinalRefinement/);
});

test('server owns versioned Final CAS, fingerprint verification and cold readback', () => {
  const routes = read('backend/src/routes/sessions.js');
  const model = read('backend/src/models/Session.js');
  const migration = read('backend/src/migrations/059_activity_final_geometry_revision.sql');
  assert.match(routes, /router\.patch\('\/client\/:clientActivityId\/final-geometry'/);
  assert.match(routes, /router\.get\('\/client\/:clientActivityId\/final-geometry'/);
  assert.match(routes, /activityGeometryFingerprint\(req\.body\.route_points\)/);
  assert.match(model, /FOR UPDATE[\s\S]*currentRevision !== expectedRevision/);
  assert.match(model, /route_points_canonical[\s\S]*canonical-fingerprint-mismatch/);
  assert.match(migration, /final_geometry_revision[\s\S]*final_geometry_canonical_fingerprint/);
});
