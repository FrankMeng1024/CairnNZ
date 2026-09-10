import {
  REAL_GPS_CANDIDATE_MAX_AGE_MS,
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';

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
});
