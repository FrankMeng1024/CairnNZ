import { deriveActivityLocationHealth } from '../activityLocationHealth';

describe('Activity source and canonical health', () => {
  test('fresh provider evidence can coexist with degraded canonical evidence', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: true,
      latestSourceTimestamp: 99_000,
      latestCanonicalTimestamp: 60_000,
      pendingCandidate: false,
      latestCanonicalDecisionReason: 'poor-horizontal-accuracy',
      continuityGapOpen: false,
    })).toMatchObject({
      sourceHealth: 'fresh',
      canonicalHealth: 'degraded',
      userFacingIssue: 'sustained-route-unreliable',
      canonicalDegradationReason: 'accuracy-reject',
    });
  });

  test('provider inactivity and candidate uncertainty retain distinct reasons', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: false,
      latestSourceTimestamp: 99_000,
      latestCanonicalTimestamp: 60_000,
      pendingCandidate: false,
      latestCanonicalDecisionReason: null,
      continuityGapOpen: true,
    }).canonicalDegradationReason).toBe('lifecycle-gap');
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: true,
      latestSourceTimestamp: 99_000,
      latestCanonicalTimestamp: 60_000,
      pendingCandidate: true,
      latestCanonicalDecisionReason: 'large-lateral-innovation',
      continuityGapOpen: false,
    }).canonicalDegradationReason).toBe('candidate');
  });

  test('stationary and impossible-motion suppression are canonical continuity degradation', () => {
    for (const reason of ['stationary-cluster-suppressed', 'impossible-accuracy-adjusted-speed']) {
      expect(deriveActivityLocationHealth({
        nowMs: 100_000,
        sourceActive: true,
        latestSourceTimestamp: 99_000,
        latestCanonicalTimestamp: 60_000,
        pendingCandidate: false,
        latestCanonicalDecisionReason: reason,
        continuityGapOpen: false,
      }).canonicalDegradationReason).toBe('continuity-reject');
    }
  });

  test('fresh stationary position evidence does not falsely claim a lost route', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: true,
      latestSourceTimestamp: 99_000,
      latestCanonicalTimestamp: 60_000,
      pendingCandidate: false,
      latestCanonicalDecisionReason: 'stationary-cluster-refined',
      continuityGapOpen: false,
      motionState: 'probably-stationary',
    })).toMatchObject({ sourceHealth: 'fresh', canonicalHealth: 'fresh' });
  });

  test('transient filtering stays internal until route evidence is materially unavailable', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: true,
      latestSourceTimestamp: 99_000,
      latestCanonicalTimestamp: 82_000,
      pendingCandidate: true,
      latestCanonicalDecisionReason: 'possible-stationary-jitter',
      continuityGapOpen: false,
      motionState: 'uncertain',
    })).toMatchObject({
      sourceHealth: 'fresh',
      canonicalHealth: 'degraded',
      canonicalDegradationReason: 'candidate',
      userFacingIssue: 'none',
    });
  });

  test('source loss is user-facing independently from canonical filtering', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 100_000,
      sourceActive: true,
      latestSourceTimestamp: 70_000,
      latestCanonicalTimestamp: 99_000,
      pendingCandidate: false,
      latestCanonicalDecisionReason: null,
      continuityGapOpen: false,
    }).userFacingIssue).toBe('source-unavailable');
  });

  test('stationary position refinement never creates a route warning', () => {
    expect(deriveActivityLocationHealth({
      nowMs: 160_000,
      sourceActive: true,
      latestSourceTimestamp: 159_000,
      latestCanonicalTimestamp: 60_000,
      pendingCandidate: false,
      latestCanonicalDecisionReason: 'stationary-cluster-refined',
      continuityGapOpen: false,
      motionState: 'probably-stationary',
    }).userFacingIssue).toBe('none');
  });
});
