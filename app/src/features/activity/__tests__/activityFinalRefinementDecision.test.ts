import type { PedestrianFinalRequestResult } from '../../../services/routing/pedestrianFinalRoute';
import { decideRetainedLocalRefinement } from '../activityFinalRefinementDecision';

function request(patch: Partial<PedestrianFinalRequestResult> = {}): PedestrianFinalRequestResult {
  return {
    requestId: 'request-1',
    kind: 'map-matching',
    sourceStart: 0,
    sourceEnd: 10,
    inputPointCount: 11,
    sourceIndexMap: [0, 10],
    durationMs: 25,
    result: 'network-error',
    httpStatus: null,
    responseCode: null,
    matchingCount: 0,
    tracepointCount: null,
    nullTracepointCount: null,
    acceptedCandidateCount: 0,
    rejectedCandidateCount: 0,
    profile: 'walking',
    matcherTidy: false,
    invoked: true,
    governorReason: null,
    responseBytes: 0,
    ...patch,
  };
}

describe('shared Activity Final refinement decision authority', () => {
  test('keeps an offline Local Final usable and pending network', () => {
    expect(decideRetainedLocalRefinement({
      networkState: 'offline',
      deadlineReached: false,
      requestResults: [],
      resultReasons: [],
      governorAuthorized: null,
      networkAttemptCount: 0,
    })).toMatchObject({
      runResult: 'pending-network',
      jobStatus: 'queued',
      jobOutcome: 'pending',
      roadEnhancementState: 'pending-network',
      roadRefinementPending: true,
      technicalOutcome: 'offline',
    });
  });

  test('keeps a transient provider failure pending for the bounded retry', () => {
    expect(decideRetainedLocalRefinement({
      networkState: 'online',
      deadlineReached: false,
      requestResults: [request()],
      resultReasons: ['no_input'],
      governorAuthorized: true,
      networkAttemptCount: 1,
    })).toMatchObject({
      runResult: 'pending-retry',
      jobStatus: 'queued',
      jobOutcome: 'pending',
      roadEnhancementState: 'pending-retry',
      roadRefinementPending: true,
      technicalOutcome: 'network-failure',
      requestHttpCategory: 'network',
      nextRetryDelayMs: 5_000,
    });
  });

  test('terminalizes the same failure after the bounded attempt cap', () => {
    expect(decideRetainedLocalRefinement({
      networkState: 'online',
      deadlineReached: false,
      requestResults: [request()],
      resultReasons: ['no_input'],
      governorAuthorized: true,
      networkAttemptCount: 3,
    })).toMatchObject({
      runResult: 'complete',
      jobStatus: 'complete',
      jobOutcome: 'base-retained',
      roadEnhancementState: 'terminal-local',
      roadRefinementPending: false,
      technicalOutcome: 'network-failure',
    });
  });
});
