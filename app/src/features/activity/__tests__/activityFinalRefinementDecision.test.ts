import type { PedestrianFinalRequestResult } from '../../../services/routing/pedestrianFinalRoute';
import {
  decideActivityFinalCandidatePromotion,
  decideRetainedLocalRefinement,
} from '../activityFinalRefinementDecision';

const p = (eastM: number, northM: number) => ({
  lat: -43 + northM / 111_320,
  lng: 170 + eastM / (111_320 * Math.cos(-43 * Math.PI / 180)),
});

describe('Final candidate promotion', () => {
  test('different fallback geometry has no promotion authority without an accepted network match', () => {
    const canonical = [p(0, 0), p(40, 0), p(80, 0), p(40, 1), p(0, 1)];
    const current = [p(0, 0), p(80, 0.5), p(0, 1)];
    const fallback = [p(0, 0), p(40, 4), p(80, 0), p(40, -4), p(0, 1)];
    expect(decideActivityFinalCandidatePromotion({
      canonical, current, candidate: fallback, networkMatched: false,
    })).toMatchObject({ accepted: false, reason: 'no-network-authority' });
  });

  test('provider authority still cannot add an unsupported crossing relative to canonical and current Final', () => {
    const canonical = [p(0, 0), p(40, 0), p(80, 0)];
    const current = canonical;
    const wrong = [p(0, 0), p(80, 20), p(0, 20), p(80, 0)];
    const decision = decideActivityFinalCandidatePromotion({
      canonical, current, candidate: wrong, networkMatched: true,
    });
    expect(decision.accepted).toBe(false);
    expect(decision.candidateCrossings).toBeGreaterThan(decision.currentCrossings);
  });

  test('noisy canonical crossings do not authorize a provider candidate to worsen a clean current Final', () => {
    const canonical = [p(0, 0), p(60, 20), p(0, 20), p(60, 0)];
    const current = [p(0, 0), p(30, 0), p(60, 0)];
    const wrong = [p(0, 0), p(60, 10), p(0, 10), p(60, 0)];
    expect(decideActivityFinalCandidatePromotion({
      canonical, current, candidate: wrong, networkMatched: true,
    })).toMatchObject({ accepted: false, reason: 'invented-crossing' });
  });

  test('a bounded provider-backed improvement with the same endpoints is accepted', () => {
    const canonical = [p(0, 0), p(20, 2), p(40, -2), p(60, 1), p(80, 0)];
    const current = canonical;
    const matched = [p(0, 0), p(40, 0), p(80, 0)];
    expect(decideActivityFinalCandidatePromotion({
      canonical, current, candidate: matched, networkMatched: true,
    })).toMatchObject({ accepted: true, reason: 'accepted-network-improvement' });
  });
});

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
