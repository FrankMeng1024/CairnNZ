import {
  REAL_GPS_CANDIDATE_MAX_AGE_MS,
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  restoreRealGpsContinuityState,
  type RealGpsObservation,
} from '../realGpsContinuity';
import { haversineM } from '../../../utils/geo';

const metresNorth = (metres: number) => metres / 111_320;
const metresEast = (metres: number) => metres / 111_320;

function observation(
  northM: number,
  eastM: number,
  t: number,
  extra: Partial<RealGpsObservation> = {},
): RealGpsObservation {
  return {
    lat: metresNorth(northM),
    lng: metresEast(eastM),
    t,
    accuracy: 6,
    speed: 1.2,
    source: 'foreground',
    observationId: `o-${t}`,
    ...extra,
  };
}

function accept(
  state: ReturnType<typeof createRealGpsContinuityState>,
  point: RealGpsObservation,
) {
  const result = acceptRealGpsObservation(state, point, 'segment-a');
  return result.state;
}

function ingest(
  state: ReturnType<typeof createRealGpsContinuityState>,
  point: RealGpsObservation,
  segmentId = 'segment-a',
) {
  const decision = evaluateRealGpsObservation(state, point, 'hiking', point.t);
  let next = decision.state;
  const accepted: RealGpsObservation[] = [];
  if (decision.kind === 'ACCEPT') {
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    for (const candidate of promoted) {
      next = acceptRealGpsObservation(next, candidate, segmentId).state;
      accepted.push(candidate);
    }
    next = acceptRealGpsObservation(next, point, segmentId).state;
    accepted.push(point);
  }
  return { decision, state: next, accepted };
}

describe('real GPS physical continuity', () => {
  test('normal coherent walking is accepted immediately without a confirmation queue', () => {
    let state = createRealGpsContinuityState();
    const points = [
      observation(0, 0, 1_000),
      observation(0, 5, 5_000),
      observation(0, 10, 9_000),
      observation(0, 15, 13_000),
    ];
    for (const point of points) {
      const decision = evaluateRealGpsObservation(state, point, 'hiking', point.t);
      expect(decision.kind).toBe('ACCEPT');
      state = accept(decision.state, point);
    }
    expect(state.pending).toBeNull();
  });

  test('uncertain scalar speed cannot veto coherent metre-cadence progression', () => {
    let state = createRealGpsContinuityState();
    const decisions = [];
    for (let index = 0; index < 4; index += 1) {
      const result = ingest(state, observation(0, index, 1_000 + index * 1_000, {
        speed: 0,
        speedAccuracy: 2,
      }));
      decisions.push(result.decision.kind);
      state = result.state;
    }
    expect(decisions).toEqual(['ACCEPT', 'QUARANTINE', 'QUARANTINE', 'ACCEPT']);
    expect(state.traversalAnchor).toMatchObject({ lng: metresEast(3) });
    expect(state.pending).toBeNull();
  });

  test('accuracy-adjusted physically impossible motion is rejected immediately', () => {
    let state = createRealGpsContinuityState();
    const first = observation(0, 0, 1_000, { accuracy: 3 });
    state = accept(state, first);
    const jump = observation(0, 120, 3_000, { accuracy: 3, speed: null });
    const decision = evaluateRealGpsObservation(state, jump, 'hiking', jump.t);
    expect(decision).toMatchObject({
      kind: 'REJECT',
      reason: 'impossible-accuracy-adjusted-speed',
    });
  });

  test('a physically impossible edge after callback loss can quarantine for an honest gap instead of freezing', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000, { accuracy: 4 }));
    state = accept(state, observation(0, 8, 5_000, { accuracy: 4 }));
    const reacquired = observation(0, 300, 35_000, { accuracy: 6 });
    const pending = evaluateRealGpsObservation(state, reacquired, 'hiking', reacquired.t);
    expect(pending).toMatchObject({
      kind: 'QUARANTINE',
      reason: 'possible-gap-reacquisition',
      candidateEvent: { type: 'candidate_created' },
    });
    const corroborating = observation(0, 306, 39_000, { accuracy: 5 });
    const confirmed = evaluateRealGpsObservation(pending.state, corroborating, 'hiking', corroborating.t);
    expect(confirmed).toMatchObject({
      kind: 'ACCEPT',
      reason: 'candidate-new-direction-confirmed',
      candidateEvent: { type: 'candidate_confirmed' },
    });
    expect(confirmed.confirmedCandidate).toEqual(reacquired);
  });

  test('a long but physically plausible relocation still requires a corroborated gap', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000, { accuracy: 5, speed: null }));
    const reacquired = observation(0, 1_110, 601_000, { accuracy: 5, speed: null });
    const pending = evaluateRealGpsObservation(state, reacquired, 'hiking', reacquired.t);
    expect(pending).toMatchObject({
      kind: 'QUARANTINE',
      reason: 'possible-gap-reacquisition',
    });
    const corroborating = observation(0, 1_115, 605_000, { accuracy: 5, speed: null });
    const confirmed = evaluateRealGpsObservation(pending.state, corroborating, 'hiking', corroborating.t);
    expect(confirmed).toMatchObject({
      kind: 'ACCEPT',
      reason: 'candidate-new-direction-confirmed',
    });
    expect(confirmed.confirmedCandidates).toEqual([reacquired]);
  });

  test('a long-interval apparent relocation is rejected when the next fix rejoins the trusted corridor', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000, { accuracy: 4 }));
    state = accept(state, observation(0, 8, 5_000, { accuracy: 4 }));
    const excursion = observation(0, 300, 35_000, { accuracy: 6 });
    const pending = evaluateRealGpsObservation(state, excursion, 'hiking', excursion.t);
    const rejoined = observation(0, 16, 39_000, { accuracy: 5 });
    const resolved = evaluateRealGpsObservation(pending.state, rejoined, 'hiking', rejoined.t);
    expect(resolved).toMatchObject({
      kind: 'ACCEPT',
      reason: 'candidate-rejoined-trusted-corridor',
      candidateEvent: { type: 'candidate_rejected' },
    });
  });

  test('an invalid native horizontal-accuracy fix is rejected immediately', () => {
    const point = observation(0, 0, 1_000, { accuracy: -1 });
    expect(evaluateRealGpsObservation(createRealGpsContinuityState(), point, 'hiking', point.t))
      .toMatchObject({ kind: 'REJECT', reason: 'poor-horizontal-accuracy' });
  });

  test('wrong-like broad-accuracy excursion is quarantined then rejected on corridor rejoin', () => {
    let state = createRealGpsContinuityState();
    const a = observation(0, 0, 1_000);
    const b = observation(0, 10, 5_000);
    const c = observation(0, 20, 9_000);
    state = accept(accept(accept(state, a), b), c);

    const excursion = observation(-28, 5, 16_636, { accuracy: 24.68, speed: 1.1 });
    const quarantined = evaluateRealGpsObservation(state, excursion, 'hiking', excursion.t);
    expect(quarantined).toMatchObject({
      kind: 'QUARANTINE',
      candidateEvent: { type: 'candidate_created' },
    });

    const rejoined = observation(0, 30, 18_635, { accuracy: 11.92 });
    const resolved = evaluateRealGpsObservation(quarantined.state, rejoined, 'hiking', rejoined.t);
    expect(resolved).toMatchObject({
      kind: 'ACCEPT',
      reason: 'candidate-rejoined-trusted-corridor',
      candidateEvent: { type: 'candidate_rejected' },
    });
  });

  test('a coherent new direction confirms within one following fix', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000));
    state = accept(state, observation(0, 10, 5_000));
    state = accept(state, observation(0, 20, 9_000));
    const turn = observation(20, 20, 13_000, { accuracy: 12 });
    const pending = evaluateRealGpsObservation(state, turn, 'hiking', turn.t);
    expect(pending.kind).toBe('QUARANTINE');
    const continued = observation(30, 20, 17_000, { accuracy: 8 });
    const confirmed = evaluateRealGpsObservation(pending.state, continued, 'hiking', continued.t);
    expect(confirmed.candidateEvent?.type).toBe('candidate_confirmed');
    expect(confirmed.kind).toBe('ACCEPT');
    expect(confirmed.confirmedCandidate).toEqual(turn);
    const withTurn = acceptRealGpsObservation(confirmed.state, confirmed.confirmedCandidate!, 'segment-a');
    const withCorroboration = acceptRealGpsObservation(withTurn.state, continued, 'segment-a');
    expect(withCorroboration.state.previousTrusted?.observationId).toBe(turn.observationId);
    expect(withCorroboration.state.lastTrusted?.observationId).toBe(continued.observationId);
  });

  test('STATIONARY_GPS_JITTER_SPAGHETTI: low-speed V/Z centres never become trusted traversal', () => {
    let state = createRealGpsContinuityState();
    const acceptedIds: string[] = [];
    for (const point of [
      observation(0, 0, 1_000),
      observation(0, 5, 5_000),
      observation(0, 10, 9_000),
    ]) {
      const decision = evaluateRealGpsObservation(state, point, 'hiking', point.t);
      expect(decision.kind).toBe('ACCEPT');
      state = accept(decision.state, point);
      acceptedIds.push(point.observationId);
    }

    const jitter = [
      observation(7, 15, 11_000, { speed: 0.08, accuracy: 7 }),
      observation(-4, 7, 13_000, { speed: 0.04, accuracy: 8 }),
      observation(6, 12, 15_000, { speed: 0.12, accuracy: 6 }),
      observation(-5, 14, 17_000, { speed: 0.03, accuracy: 9 }),
      observation(3, 5, 19_000, { speed: 0.09, accuracy: 7 }),
      observation(-6, 9, 21_000, { speed: 0.05, accuracy: 8 }),
    ];
    const decisions: string[] = [];
    for (const point of jitter) {
      const decision = evaluateRealGpsObservation(state, point, 'hiking', point.t);
      decisions.push(`${decision.kind}:${decision.reason}`);
      state = decision.state;
      if (decision.kind === 'ACCEPT') {
        state = acceptRealGpsObservation(state, point, 'segment-a').state;
        acceptedIds.push(point.observationId);
      }
    }

    expect(acceptedIds).toEqual(['o-1000', 'o-5000', 'o-9000']);
    expect(decisions).toContain('QUARANTINE:possible-stationary-jitter');
    expect(decisions.some(value => (
      value === 'REFINE:stationary-cluster-refined'
      || value === 'REFINE:candidate-unresolved'
    ))).toBe(true);
    expect(state.lastTrusted?.observationId).toBe('o-9000');
  });

  test('coherent slow walking is confirmed promptly instead of becoming a distance deadband', () => {
    let state = createRealGpsContinuityState();
    const origin = observation(0, 0, 1_000, { speed: 0.2 });
    state = accept(state, origin);
    const slow1 = observation(0, 5, 3_000, { speed: 0.3, accuracy: 6 });
    const pending = evaluateRealGpsObservation(state, slow1, 'hiking', slow1.t);
    expect(pending).toMatchObject({ kind: 'QUARANTINE', reason: 'possible-stationary-jitter' });
    const slow2 = observation(0, 10, 5_000, { speed: 0.35, accuracy: 6 });
    const confirmed = evaluateRealGpsObservation(pending.state, slow2, 'hiking', slow2.t);
    expect(confirmed).toMatchObject({
      kind: 'ACCEPT',
      reason: 'candidate-new-direction-confirmed',
      candidateEvent: { type: 'candidate_confirmed', delayMs: 2_000 },
    });
    expect(confirmed.confirmedCandidate).toEqual(slow1);
  });

  test('a rejected older callback advances neither trusted continuity anchor nor route truth', () => {
    let state = createRealGpsContinuityState();
    const first = observation(0, 0, 5_000);
    state = accept(state, first);
    const stale = observation(0, 5, 4_000);
    const decision = evaluateRealGpsObservation(state, stale, 'hiking', 6_000);
    expect(decision).toMatchObject({ kind: 'REJECT', reason: 'non-monotonic-observation' });
    expect(decision.state.lastTrusted?.observationId).toBe(first.observationId);
  });

  test('an unresolved candidate times out at the fixed bound', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000));
    state = accept(state, observation(0, 10, 5_000));
    state = accept(state, observation(0, 20, 9_000));
    const turn = observation(20, 20, 13_000, { accuracy: 12 });
    const pending = evaluateRealGpsObservation(state, turn, 'hiking', turn.t);
    const later = observation(5, 25, 13_000 + REAL_GPS_CANDIDATE_MAX_AGE_MS + 1);
    const timedOut = evaluateRealGpsObservation(pending.state, later, 'hiking', later.t);
    expect(timedOut.candidateEvent?.type).toBe('candidate_timeout');
  });

  test('bounded live smoothing stays close and resets at a segment boundary', () => {
    let state = createRealGpsContinuityState();
    const first = observation(0, 0, 1_000, { accuracy: 6 });
    state = accept(state, first);
    const second = observation(0, 10, 5_000, { accuracy: 6 });
    const next = acceptRealGpsObservation(state, second, 'segment-a');
    expect(next.liveCoordinate.lng).toBeLessThan(second.lng);
    expect(next.liveCoordinate.lng).toBeGreaterThan(0);
    const reset = acceptRealGpsObservation(next.state, observation(1_000, 1_000, 9_000), 'segment-b');
    expect(reset.liveCoordinate).toEqual({ lat: metresNorth(1_000), lng: metresEast(1_000) });
  });

  test('NORMAL_1M_COHERENT_MOVEMENT: normal one-metre fixes stay on the immediate path', () => {
    let state = createRealGpsContinuityState();
    const decisions: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const point = observation(0, index * 1.15, 1_000 + index * 1_000, { speed: 1.15, accuracy: 5 });
      const result = ingest(state, point);
      state = result.state;
      decisions.push(result.decision.kind);
    }
    expect(decisions).not.toContain('REJECT');
    expect(state.lastTrusted?.observationId).toBe('o-12000');
    expect(state.pending).toBeNull();
  });

  test('FALSE_REPORTED_SPEED_BACKTRACK and U_TURN_IS_NORMAL: coherent return is not frozen by scalar speed', () => {
    let state = createRealGpsContinuityState();
    const canonical: RealGpsObservation[] = [];
    const eastings = [0, 1.2, 2.4, 3.6, 4.8, 6, 4.8, 3.6, 2.4, 1.2, 0];
    eastings.forEach((eastM, index) => {
      const returning = index >= 6;
      const point = observation(0, eastM, 1_000 + index * 1_000, {
        speed: returning ? 0.09 : 1.2,
        accuracy: 5,
      });
      const result = ingest(state, point);
      state = result.state;
      canonical.push(...result.accepted);
      expect(result.decision.kind).not.toBe('REJECT');
    });
    expect(state.lastTrusted?.lng).toBeCloseTo(0, 8);
    expect(state.pending).toBeNull();
    expect(canonical[canonical.length - 1]?.observationId).toBe('o-11000');
  });

  test.each([
    ['REPEATED_SEGMENT_THREE_PASSES', [0, 2, 4, 6, 8, 10, 8, 6, 4, 2, 0, 2, 4, 6, 8, 10]],
    ['DELIBERATE_Z_CORRIDOR', [0, 2, 4, 6, 4, 2, 0, 2, 4, 6]],
  ])('%s preserves ordered physically plausible traversal', (_name, eastings) => {
    let state = createRealGpsContinuityState();
    const accepted: RealGpsObservation[] = [];
    eastings.forEach((eastM, index) => {
      const point = observation(index >= 4 ? (index - 3) * 0.8 : 0, eastM, 1_000 + index * 1_000, {
        speed: index % 3 === 0 ? 0.1 : 1.3,
        accuracy: 4,
      });
      const result = ingest(state, point);
      state = result.state;
      accepted.push(...result.accepted);
      expect(result.decision.kind).not.toBe('REJECT');
    });
    expect(accepted[accepted.length - 1]?.observationId).toBe(`o-${eastings.length * 1_000}`);
  });

  test('SWITCHBACKS, circle, diagonal and off-road turns have no forward-direction prior', () => {
    let state = createRealGpsContinuityState();
    const path: Array<[number, number]> = [
      [0, 0], [1, 1], [2, 2], [3, 1], [4, 0], [5, 1], [6, 2],
      [7, 1], [8, 0], [8, -1], [7, -2], [6, -1], [6, 0],
    ];
    path.forEach(([northM, eastM], index) => {
      const result = ingest(state, observation(northM, eastM, 1_000 + index * 1_000, {
        speed: index > 7 ? 0.08 : 1.2,
        accuracy: 4,
      }));
      state = result.state;
      expect(result.decision.kind).not.toBe('REJECT');
    });
    expect(state.lastTrusted?.observationId).toBe(`o-${path.length * 1_000}`);
  });

  test('SLOW_CUMULATIVE_PROGRESS confirms one-metre evidence without a two-metre single-step requirement', () => {
    let state = createRealGpsContinuityState();
    const accepted: RealGpsObservation[] = [];
    for (let index = 0; index < 8; index += 1) {
      const result = ingest(state, observation(0, index * 1.05, 1_000 + index * 1_000, {
        speed: 0.08,
        accuracy: 5,
      }));
      state = result.state;
      accepted.push(...result.accepted);
      expect(result.decision.kind).not.toBe('REJECT');
    }
    expect(accepted.length).toBeGreaterThanOrEqual(6);
    expect(state.lastTrusted?.observationId).toBe('o-8000');
    expect(state.pending).toBeNull();
  });

  test('STOP_START_RECOVERY resumes within three short coherent fixes', () => {
    let state = createRealGpsContinuityState();
    for (let index = 0; index < 6; index += 1) {
      state = ingest(state, observation(0, index * 1.2, 1_000 + index * 1_000, { accuracy: 5 })).state;
    }
    const stoppedAt = state.lastTrusted!;
    const jitter = [[0.5, 0.2], [-0.4, -0.1], [0.3, -0.3], [-0.2, 0.4], [0.1, -0.2]];
    jitter.forEach(([north, east], index) => {
      state = ingest(state, observation(north, 6 + east, 7_000 + index * 1_000, {
        speed: 0.03,
        accuracy: 6,
      })).state;
    });
    const resumeResults = [1, 2, 3].map((step, index) => {
      const result = ingest(state, observation(0, 6 + step * 1.1, 12_000 + index * 1_000, {
        speed: 0.08,
        accuracy: 5,
      }));
      state = result.state;
      return result;
    });
    expect(resumeResults.some(result => result.decision.kind === 'ACCEPT')).toBe(true);
    expect(state.lastTrusted?.t).toBeGreaterThan(stoppedAt.t);
  });

  test('STATIONARY_GPS_JITTER_SPAGHETTI: dense good-accuracy orbit adds at most bounded traversal', () => {
    let state = createRealGpsContinuityState();
    const canonical: RealGpsObservation[] = [];
    for (const [index, east] of [0, 1.2, 2.4, 3.6, 4.8].entries()) {
      const result = ingest(state, observation(0, east, 1_000 + index * 1_000, { speed: 1.2, accuracy: 5 }));
      state = result.state;
      canonical.push(...result.accepted);
    }
    const anchor = canonical[canonical.length - 1];
    const orbit: Array<[number, number]> = [
      [2.5, 2], [-2.8, -1.5], [2.2, -2.4], [-2.5, 2.1],
      [1.8, 2.8], [-2.2, -2.6], [2.7, -1.2], [-1.9, 2.5],
      [1.1, -2.8], [-1.2, 2.1],
    ];
    orbit.forEach(([north, east], index) => {
      const result = ingest(state, observation(north, 4.8 + east, 6_000 + index * 1_000, {
        speed: index % 2 === 0 ? 0.04 : null,
        accuracy: 5,
      }));
      state = result.state;
      canonical.push(...result.accepted);
    });
    let stationaryDistanceM = 0;
    let previous = anchor;
    for (const point of canonical.filter(point => point.t > anchor.t)) {
      stationaryDistanceM += haversineM(previous, point);
      previous = point;
    }
    expect(stationaryDistanceM).toBeLessThanOrEqual(5);
    expect(['probably-stationary', 'uncertain']).toContain(state.motionState);
  });

  test('a real out-and-back is preserved while an isolated lateral V is rejected', () => {
    let state = createRealGpsContinuityState();
    for (let index = 0; index < 5; index += 1) {
      state = ingest(state, observation(0, index * 2, 1_000 + index * 1_000, { accuracy: 4 })).state;
    }
    const anchorId = state.lastTrusted?.observationId;
    const spike = observation(28, 8, 6_000, { accuracy: 4, speed: null });
    const rejected = ingest(state, spike);
    expect(rejected.decision.kind).toBe('REJECT');
    expect(rejected.state.lastTrusted?.observationId).toBe(anchorId);

    for (let index = 0; index < 6; index += 1) {
      const eastM = 8 - index * 1.4;
      const result = ingest(state, observation(0, eastM, 7_000 + index * 1_000, {
        accuracy: 4,
        speed: 0.09,
      }));
      state = result.state;
      expect(result.decision.kind).not.toBe('REJECT');
    }
    expect(state.lastTrusted?.t).toBe(12_000);
  });

  test('candidate evidence is bounded and confirms cumulative one-metre progression', () => {
    let state = createRealGpsContinuityState();
    state = ingest(state, observation(0, 0, 1_000, { speed: 0.05 })).state;
    const first = ingest(state, observation(0, 1.1, 2_000, { speed: 0.05 }));
    state = first.state;
    const second = ingest(state, observation(0, 2.3, 3_000, { speed: 0.05 }));
    state = second.state;
    const third = ingest(state, observation(0, 3.5, 4_000, { speed: 0.05 }));
    state = third.state;
    expect([first, second, third].some(result => result.decision.candidateEvent?.type === 'candidate_confirmed'))
      .toBe(true);
    expect(state.pending).toBeNull();
  });

  test('v1 checkpoint restores without trusting a pending candidate', () => {
    const point = observation(0, 0, 1_000);
    const legacy = {
      version: 1,
      previousTrusted: null,
      lastTrusted: { ...point, segmentId: 'segment-a' },
      pending: {
        id: 'legacy-candidate', observation: observation(0, 8, 2_000),
        createdAtMs: 2_000, evidenceCount: 1, reason: 'possible-stationary-jitter',
      },
      liveCoordinate: { lat: point.lat, lng: point.lng },
      liveSegmentId: 'segment-a',
      latestObservationTimestamp: 2_000,
    };
    const restored = restoreRealGpsContinuityState(legacy, [{ ...point, segmentId: 'segment-a' }]);
    expect(restored.version).toBe(3);
    expect(restored.pending).toBeNull();
    expect(restored.lastTrusted?.observationId).toBe(point.observationId);
  });

  test('v2 checkpoint also reconstructs from canonical journal truth', () => {
    const point = { ...observation(0, 0, 1_000), segmentId: 'segment-a' };
    const restored = restoreRealGpsContinuityState({
      version: 2,
      lastTrusted: point,
      pending: {
        id: 'v2-pending',
        observation: observation(0, 6, 2_000),
        createdAtMs: 2_000,
        evidenceCount: 1,
        reason: 'possible-stationary-jitter',
      },
      latestObservationTimestamp: 2_000,
    }, [point]);
    expect(restored).toMatchObject({ version: 3, pending: null });
    expect(restored.lastTrusted?.observationId).toBe(point.observationId);
  });

  test('v3 checkpoint preserves a bounded pending Candidate across process recovery', () => {
    let state = createRealGpsContinuityState();
    state = accept(state, observation(0, 0, 1_000, { speed: 1 }));
    const pending = evaluateRealGpsObservation(
      state,
      observation(0, 3.2, 2_000, { speed: 0.05 }),
      'hiking',
      2_000,
    );
    expect(pending.kind).toBe('QUARANTINE');
    const restored = restoreRealGpsContinuityState(JSON.parse(JSON.stringify(pending.state)));
    expect(restored.pending?.observations).toHaveLength(1);
    expect(restored.recentEligibleRaw.length).toBeLessThanOrEqual(6);
    const confirmed = evaluateRealGpsObservation(
      restored,
      observation(0, 5.4, 3_000, { speed: 0.05 }),
      'hiking',
      3_000,
    );
    expect(confirmed.candidateEvent?.type).toBe('candidate_confirmed');
  });

  test('10,000 observations keep reducer and Candidate evidence bounded', () => {
    let state = createRealGpsContinuityState();
    const startedAt = Date.now();
    let maxRecent = 0;
    let maxCandidate = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const north = index % 17 === 0 ? 0.4 : 0;
      const point = observation(north, index * 1.05, 1_000 + index * 1_000, {
        accuracy: 5,
        speed: index % 19 === 0 ? 0.09 : 1.05,
      });
      state = ingest(state, point).state;
      maxRecent = Math.max(maxRecent, state.recentEligibleRaw.length);
      maxCandidate = Math.max(maxCandidate, state.pending?.observations.length ?? 0);
    }
    expect(maxRecent).toBeLessThanOrEqual(6);
    expect(maxCandidate).toBeLessThanOrEqual(4);
    // Babel/Jest instrumentation can be heavily CPU-contended when the routed
    // gate runs suites in parallel. Keep this as a runaway guard; the direct
    // replay artifact records the stricter isolated wall time.
    expect(Date.now() - startedAt).toBeLessThan(30_000);
    expect(state.lastTrusted?.t).toBe(10_000_000);
  });

  test('ALMOST_DONE_START_PATTERN: low-speed fast innovation cannot promote stationary drift', () => {
    let state = ingest(
      createRealGpsContinuityState(),
      observation(0, 0, 1_000, { speed: 0.12, accuracy: 6.8 }),
    ).state;
    const anchor = state.traversalAnchor;
    const accepted: RealGpsObservation[] = [];
    const drift = [
      observation(0.2, 5.46, 2_001, { speed: 0.19, accuracy: 6.78 }),
      observation(0.4, 7.0, 3_001, { speed: 0.16, accuracy: 6.5 }),
      observation(0.1, 8.4, 4_001, { speed: 0.11, accuracy: 6.4 }),
      observation(-0.2, 9.5, 5_001, { speed: 0.08, accuracy: 6.2 }),
    ];
    for (const point of drift) {
      const result = ingest(state, point);
      state = result.state;
      accepted.push(...result.accepted);
    }
    expect(accepted).toHaveLength(0);
    expect(state.traversalAnchor?.observationId).toBe(anchor?.observationId);
    expect(state.lastTrusted?.observationId).toBe(anchor?.observationId);
    expect(state.positionEstimate).not.toEqual({ lat: anchor?.lat, lng: anchor?.lng, t: anchor?.t });
  });

  test('ALMOST_DONE_SECOND_STOP_PATTERN: moving state cannot authorize low-speed long-interval drift', () => {
    let state = createRealGpsContinuityState();
    for (let index = 0; index < 5; index += 1) {
      state = ingest(state, observation(0, index * 1.2, 1_000 + index * 1_000, {
        speed: 1.2,
        accuracy: 8,
      })).state;
    }
    const anchor = state.traversalAnchor!;
    const stopped = [
      observation(0.2, 5.9, 8_000, { speed: 0.1, accuracy: 14.25 }),
      observation(-0.3, 8.0, 31_000, { speed: 0.07, accuracy: 14.25 }),
      observation(0.4, 9.4, 49_000, { speed: 0.05, accuracy: 14.25 }),
    ];
    const decisions = stopped.map(point => {
      const result = ingest(state, point);
      state = result.state;
      return result.decision;
    });
    expect(decisions.every(decision => decision.kind !== 'ACCEPT')).toBe(true);
    expect(state.traversalAnchor?.observationId).toBe(anchor.observationId);
  });

  test('a delayed moving fix does not retroactively promote a low-speed stationary tail', () => {
    let state = acceptRealGpsObservation(
      createRealGpsContinuityState(),
      observation(0, 0, 1_000, { speed: 0.05, accuracy: 14 }),
      'segment-a',
    ).state;
    const stationaryTail = observation(0.2, 8, 12_000, { speed: 0.05, accuracy: 14 });
    let result = ingest(state, stationaryTail);
    state = result.state;
    result = ingest(state, observation(0.1, 9, 14_000, { speed: 0.08, accuracy: 14 }));
    state = result.state;
    const departure = observation(0, 12, 16_000, { speed: 1.1, accuracy: 14 });
    result = ingest(state, departure);
    expect(result.decision.kind).toBe('ACCEPT');
    expect(result.decision.confirmedCandidates).toEqual([]);
    expect(result.accepted).toEqual([departure]);
  });

  test('bounded temporal presentation stays close and does not reshape a real turn', () => {
    let state = createRealGpsContinuityState();
    for (const [index, eastM] of [0, 2, 4].entries()) {
      const point = observation(0, eastM, 1_000 + index * 1_000, { accuracy: 8 });
      state = acceptRealGpsObservation(state, point, 'segment-a').state;
    }
    const wobble = observation(1.1, 6, 4_000, { accuracy: 8 });
    const damped = acceptRealGpsObservation(state, wobble, 'segment-a');
    expect(haversineM(damped.liveCoordinate, wobble)).toBeLessThanOrEqual(2);
    expect(damped.liveCoordinate.lat).toBeLessThan(wobble.lat);

    const turn = observation(4.1, 6, 5_000, { accuracy: 8 });
    const released = acceptRealGpsObservation(damped.state, turn, 'segment-a');
    expect(haversineM(released.liveCoordinate, turn)).toBeLessThanOrEqual(2);
  });
});
