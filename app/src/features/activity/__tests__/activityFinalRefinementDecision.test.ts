import type { PedestrianFinalRequestResult } from '../../../services/routing/pedestrianFinalRoute';
import { evaluateMatchedGeometryQuality } from '../../../services/routing/snapTrack';
import {
  decideActivityFinalCandidatePromotion,
  decideRetainedLocalRefinement,
  selectRoundedActivityFinalCandidate,
  selectRoundedLocalFinalCandidate,
} from '../activityFinalRefinementDecision';
import { roundSavedFinalRoadCorners } from '../savedFinalCornerRounding';
import { roundedFinalP95Counterexample } from './fixtures/roundedFinalP95Counterexample';

const p = (eastM: number, northM: number) => ({
  lat: -43 + northM / 111_320,
  lng: 170 + eastM / (111_320 * Math.cos(-43 * Math.PI / 180)),
});

describe('Final candidate promotion', () => {
  test('local display rounding falls back when the rounded result crosses canonical quality', () => {
    const fixture = roundedFinalP95Counterexample();
    const selected = selectRoundedLocalFinalCandidate({
      canonical: fixture.canonical,
      approvedUnrounded: fixture.approvedUnrounded,
    });
    expect(selected).toMatchObject({
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: true,
      fallbackReason: expect.stringContaining('canonical-quality:'),
      roundedCanonicalQuality: { accepted: false },
    });
    expect(selected.points).toEqual(fixture.approvedUnrounded);
  });

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

  test('Rounding regression: canonical P95 is rechecked and an accepted unrounded road candidate wins', () => {
    const fixture = roundedFinalP95Counterexample();
    const rounded = roundSavedFinalRoadCorners(fixture.approvedUnrounded, {
      eligibleCorners: fixture.eligibleCorners,
    });
    const before = evaluateMatchedGeometryQuality(fixture.canonical, fixture.approvedUnrounded);
    const after = evaluateMatchedGeometryQuality(fixture.canonical, rounded.points);
    process.stderr.write(`rounding-p95-repro=${JSON.stringify({ before: before.p95DeviationM, after: after.p95DeviationM, envelope: after.deviationEnvelopeM })}\n`);
    expect(before).toMatchObject({ accepted: true, reason: 'accepted' });
    expect(before.p95DeviationM).toBeCloseTo(7.989, 3);
    expect(before.p95DeviationM).toBeLessThanOrEqual(before.deviationEnvelopeM);
    expect(after).toMatchObject({ accepted: false, reason: 'raw_deviation' });
    // The more visible fillet moves this counterexample farther outside the
    // same immutable 8 m envelope; the exact displacement is not authority.
    expect(after.p95DeviationM).toBeGreaterThan(8.5);
    expect(after.p95DeviationM).toBeGreaterThan(after.deviationEnvelopeM);

    const selected = selectRoundedActivityFinalCandidate({
      ...fixture,
    });
    expect(selected).toMatchObject({
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: true,
      fallbackReason: 'canonical-quality:raw_deviation',
    });
    expect(selected.points).toEqual(fixture.approvedUnrounded);
  });

  test('post-round current-Final promotion is independently enforced', () => {
    const candidate = [p(0, 0), p(40, 0), p(40, 40)].map((coordinate, index) => ({
      ...coordinate, t: 1_000 + index * 50_000, segmentId: 'road-b',
    }));
    const amplitude = 3.347;
    const samples: Array<[number, number]> = [
      [0, 0], [10, amplitude], [20, -amplitude], [30, amplitude], [40, 0],
      [40 + amplitude, 10], [40 - amplitude, 20], [40 + amplitude, 30], [40, 40],
    ];
    const canonical = samples.map(([east, north], index) => ({
      ...p(east, north), t: 1_000 + index * 12_500, accuracy: 6, segmentId: 'road-b',
    }));
    expect(decideActivityFinalCandidatePromotion({
      canonical, current: canonical, candidate, networkMatched: true,
    })).toMatchObject({ accepted: true, reason: 'accepted-network-improvement' });
    const selected = selectRoundedActivityFinalCandidate({
      canonical, current: canonical, approvedUnrounded: candidate,
      eligibleCorners: [false, true, false],
    });
    expect(selected).toMatchObject({
      usedRoundedCandidate: false,
      fellBackToApprovedUnrounded: true,
      fallbackReason: 'current-final:length-regression',
      roundedCanonicalQuality: { accepted: true },
      roundedPromotion: { accepted: false, reason: 'length-regression' },
    });
    expect(selected.points).toEqual(candidate);
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
