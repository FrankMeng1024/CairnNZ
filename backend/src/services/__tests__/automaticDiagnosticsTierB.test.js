'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAutomaticDiagnosticBatch } = require('../automaticDiagnostics');

function preciseBatch() {
  return {
    schema: 'cairn-auto-diagnostics-batch',
    version: 1,
    batchId: 'precise-batch-1',
    batchSequence: 1,
    requiredPolicyTier: 'tier_b',
    stream: {
      streamId: 'activity:precise',
      ownerEpoch: 'owner-epoch-a',
      sourceType: 'activity',
      clientActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      activityMode: 'hiking',
    },
    droppedCount: 0,
    events: [{
      eventId: 'precise-event-1',
      eventSequence: 1,
      eventCode: 'ACTIVITY_REPLAY_RAW_OBSERVATION',
      sourceModule: 'activityDiagnosticReplay',
      severity: 'info',
      eventAt: 1_700_000_000_000,
      monotonicMs: 100,
      details: {
        replayKind: 'raw-observation',
        lat: -41.28664,
        lng: 174.77557,
        accessToken: 'must-not-survive',
        note: 'free text must not survive',
      },
    }],
  };
}

test('Tier A cannot authorize a client-requested precise diagnostic batch', () => {
  assert.throws(
    () => normalizeAutomaticDiagnosticBatch(preciseBatch(), { policyTier: 'tier_a' }),
    error => error?.status === 403 && error?.code === 'DIAGNOSTIC_TIER_REQUIRED',
  );
});

test('Tier B keeps numeric replay coordinates but still removes secrets/free text', () => {
  const normalized = normalizeAutomaticDiagnosticBatch(preciseBatch(), { policyTier: 'tier_b' });
  assert.equal(normalized.requiredPolicyTier, 'tier_b');
  assert.equal(normalized.events[0].details.lat, -41.28664);
  assert.equal(normalized.events[0].details.lng, 174.77557);
  assert.equal(Object.hasOwn(normalized.events[0].details, 'accessToken'), false);
  assert.equal(Object.hasOwn(normalized.events[0].details, 'note'), false);
});

test('ordinary Tier A events remain coordinate-free', () => {
  const input = preciseBatch();
  delete input.requiredPolicyTier;
  const normalized = normalizeAutomaticDiagnosticBatch(input, { policyTier: 'tier_a' });
  assert.equal(normalized.requiredPolicyTier, 'tier_a');
  assert.equal(Object.hasOwn(normalized.events[0].details, 'lat'), false);
  assert.equal(Object.hasOwn(normalized.events[0].details, 'lng'), false);
});
