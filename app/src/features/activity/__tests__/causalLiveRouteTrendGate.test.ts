import {
  appendCausalLivePoint,
  appendCausalLiveReplayPoint,
  buildCausalLiveRoute,
  causalLiveReplayResult,
  createCausalLiveReplayCheckpoint,
} from '../causalLiveRoute';
import { projectActivityJournal } from '../activityJournalProjection';
import {
  acceptRealGpsObservation,
  createRealGpsContinuityState,
  evaluateRealGpsObservation,
  type RealGpsObservation,
} from '../realGpsContinuity';
import type { CanonicalJournalPoint } from '../../../services/hikeTrackWriter';
import type { TrackPoint } from '../../../store/useSessionStore';
import { haversineM } from '../../../utils/geo';

const LAT = -41.28;
const METRES_PER_DEGREE = 111_320;
const LNG_SCALE = METRES_PER_DEGREE * Math.cos(LAT * Math.PI / 180);

function point(eastM: number, northM: number, t: number, segmentId = 'gate-a'): TrackPoint {
  return {
    lat: LAT + northM / METRES_PER_DEGREE,
    lng: 174.77 + eastM / LNG_SCALE,
    t,
    accuracy: 8,
    speed: 1.4,
    segmentId,
  };
}

const eastM = (sample: Pick<TrackPoint, 'lng'>) => (sample.lng - 174.77) * LNG_SCALE;
const northM = (sample: Pick<TrackPoint, 'lat'>) => (sample.lat - LAT) * METRES_PER_DEGREE;
const maximumLateralM = (route: TrackPoint[]) => Math.max(
  0,
  ...route.map(sample => Math.abs(eastM(sample))),
);

function straightWithTransientDrift(dtMs: number): TrackPoint[] {
  const speedMps = 1.4;
  const samples: TrackPoint[] = [];
  for (let t = 0; t <= 40_000; t += dtMs) {
    samples.push(point(t === 20_000 ? 5 : 0, speedMps * t / 1_000, t));
  }
  return samples;
}

function shortContinuousGpsExcursion(dtMs: number): TrackPoint[] {
  const speedMps = 1.4;
  const samples: TrackPoint[] = [];
  for (let t = 0; t <= 60_000; t += dtMs) {
    // One continuous physical excursion resampled at each cadence. This is
    // intentionally distinct from the isolated-fix fixture above: denser
    // delivery must not turn the same short-lived movement into frozen Live.
    const east = t >= 18_000 && t <= 22_000
      ? 6 * (1 - Math.abs(t - 20_000) / 2_000)
      : 0;
    samples.push(point(east, speedMps * t / 1_000, t));
  }
  return samples;
}

function incrementalFrames(canonical: TrackPoint[]): TrackPoint[][] {
  const history: TrackPoint[] = [];
  let live: TrackPoint[] = [];
  return canonical.map(sample => {
    history.push(sample);
    live = appendCausalLivePoint(live, sample, history);
    return live;
  });
}

function sustainedTurn(dtMs: number): TrackPoint[] {
  const samples: TrackPoint[] = [];
  for (let t = 0; t <= 20_000; t += dtMs) {
    const travelledM = 1.4 * t / 1_000;
    samples.push(travelledM <= 14
      ? point(0, travelledM, t)
      : point(travelledM - 14, 14, t));
  }
  return samples;
}

function sustainedUTurn(dtMs: number): TrackPoint[] {
  const samples: TrackPoint[] = [];
  for (let t = 0; t <= 40_000; t += dtMs) {
    const travelledM = 1.4 * t / 1_000;
    const east = travelledM <= 28 ? travelledM : 56 - travelledM;
    samples.push(point(east, travelledM <= 28 ? 0 : 3, t));
  }
  return samples;
}

function ingestQualified(
  inputs: Array<{ east: number; north: number; t: number; speed?: number }>,
): { accepted: RealGpsObservation[]; decisions: string[] } {
  let state = createRealGpsContinuityState();
  const accepted: RealGpsObservation[] = [];
  const decisions: string[] = [];
  inputs.forEach((input, index) => {
    const observation: RealGpsObservation = {
      lat: LAT + input.north / METRES_PER_DEGREE,
      lng: 174.77 + input.east / LNG_SCALE,
      t: input.t,
      accuracy: 6,
      speed: input.speed ?? 1.4,
      source: 'foreground',
      observationId: `continuity:${index}`,
      rawOrdinal: index + 1,
    };
    const decision = evaluateRealGpsObservation(state, observation, 'hiking', observation.t);
    decisions.push(`${decision.kind}:${decision.reason}`);
    state = decision.state;
    if (decision.kind !== 'ACCEPT') return;
    for (const candidate of [...(decision.confirmedCandidates ?? []), observation]) {
      state = acceptRealGpsObservation(state, candidate, 'gate-a').state;
      accepted.push(candidate);
    }
  });
  return { accepted, decisions };
}

function ingestQualifiedPresentation(canonical: TrackPoint[]): TrackPoint[] {
  let state = createRealGpsContinuityState();
  const presented: TrackPoint[] = [];
  canonical.forEach((sample, index) => {
    const observation: RealGpsObservation = {
      ...sample,
      accuracy: sample.accuracy ?? null,
      source: 'foreground',
      observationId: `presentation:${index}`,
      rawOrdinal: index + 1,
    };
    const decision = evaluateRealGpsObservation(
      state,
      observation,
      'hiking',
      observation.t + 200,
    );
    state = decision.state;
    if (decision.kind !== 'ACCEPT') return;
    for (const candidate of [
      ...(decision.confirmedCandidates ?? []),
      observation,
    ]) {
      const accepted = acceptRealGpsObservation(state, candidate, 'gate-a');
      state = accepted.state;
      presented.push({
        ...candidate,
        lat: accepted.liveCoordinate.lat,
        lng: accepted.liveCoordinate.lng,
        segmentId: 'gate-a',
      });
    }
  });
  return presented;
}

const presentation = (route: TrackPoint[]) => route.map(sample => ({
  lat: sample.lat,
  lng: sample.lng,
  t: sample.t,
  rawOrdinal: sample.rawOrdinal,
  segmentId: sample.segmentId,
}));

describe('O98 mandatory movement-trend correctness gate', () => {
  test('T01 straight walking stays calm while every newest tail point is responsive', () => {
    const canonical = Array.from({ length: 31 }, (_, index) => point(0, index * 1.4, index * 1_000));
    const frames = incrementalFrames(canonical);
    frames.forEach((frame, index) => {
      expect(frame.at(-1)).toMatchObject({
        lat: canonical[index].lat,
        lng: canonical[index].lng,
        t: canonical[index].t,
      });
      expect(maximumLateralM(frame)).toBeLessThan(0.05);
    });
  });

  test('T02 a contradicted lateral deviation never reappears or freezes after it settles', () => {
    const canonical = straightWithTransientDrift(1_000);
    const frames = incrementalFrames(canonical);
    const afterDeviation = frames.slice(canonical.findIndex(sample => sample.t === 20_000) + 1);
    const settledAt = afterDeviation.findIndex(route => maximumLateralM(route) <= 0.5);

    expect(settledAt).toBeGreaterThanOrEqual(0);
    afterDeviation.slice(settledAt).forEach(route => {
      expect(maximumLateralM(route)).toBeLessThanOrEqual(0.5);
    });
    expect(maximumLateralM(buildCausalLiveRoute(canonical))).toBeLessThanOrEqual(0.5);
  });

  test('sampling density does not turn the same short disturbance into confirmed history', () => {
    const residuals = [100, 500, 1_000, 2_000, 5_000].map(dtMs => (
      maximumLateralM(buildCausalLiveRoute(shortContinuousGpsExcursion(dtMs)))
    ));

    expect(Math.max(...residuals)).toBeLessThanOrEqual(1);
    expect(Math.max(...residuals) - Math.min(...residuals)).toBeLessThanOrEqual(1);
  });

  test('continuous transient drift is suppressed after the production continuity chain', () => {
    const residuals = [100, 500, 1_000, 2_000, 5_000].map(dtMs => {
      const presented = ingestQualifiedPresentation(shortContinuousGpsExcursion(dtMs));
      return maximumLateralM(buildCausalLiveRoute(presented));
    });

    expect(Math.max(...residuals)).toBeLessThanOrEqual(1);
    expect(Math.max(...residuals) - Math.min(...residuals)).toBeLessThanOrEqual(1);
  });

  test('T03 several uncertain deviations settle without becoming a confirmed turn', () => {
    const canonical = Array.from({ length: 41 }, (_, index) => point(
      index >= 18 && index <= 21 ? 5 : 0,
      index * 1.4,
      index * 1_000,
    ));
    const frames = incrementalFrames(canonical);
    expect(maximumLateralM(frames[20])).toBeGreaterThan(4);
    expect(maximumLateralM(frames.at(-1)!)).toBeLessThanOrEqual(0.5);
    expect(frames.at(-1)!.some(sample => sample.liveTrendConfirmed && Math.abs(eastM(sample)) > 1))
      .toBe(false);
  });

  test('T04/T05/T07 retain a real 90-degree turn, U-turn and switchback', () => {
    const turn = [
      ...Array.from({ length: 9 }, (_, index) => point(0, index * 4, index * 1_000)),
      ...Array.from({ length: 9 }, (_, index) => point(index * 4, 32, (index + 8) * 1_000)).slice(1),
    ];
    const uTurn = [
      ...Array.from({ length: 9 }, (_, index) => point(index * 4, 0, index * 1_000)),
      ...Array.from({ length: 9 }, (_, index) => point(32 - index * 4, 2, (index + 8) * 1_000)).slice(1),
    ];
    const switchback = [
      ...Array.from({ length: 7 }, (_, index) => point(index * 4, 0, index * 1_000)),
      ...Array.from({ length: 7 }, (_, index) => point(24 - index * 4, 8, (index + 6) * 1_000)).slice(1),
      ...Array.from({ length: 7 }, (_, index) => point(index * 4, 16, (index + 12) * 1_000)).slice(1),
    ];

    const liveTurn = buildCausalLiveRoute(turn);
    expect(liveTurn.some(sample => Math.abs(eastM(sample)) < 0.2
      && Math.abs((sample.lat - LAT) * METRES_PER_DEGREE - 32) < 0.2)).toBe(true);
    expect(maximumLateralM(buildCausalLiveRoute(uTurn))).toBeGreaterThan(30);
    const liveSwitchback = buildCausalLiveRoute(switchback);
    expect(liveSwitchback.some(sample => eastM(sample) > 22)).toBe(true);
    // Display-only stabilization may move the apex inside the 8 m evidence
    // envelope, but the reversal must remain unmistakably present.
    expect(liveSwitchback.some(sample => eastM(sample) < 5
      && (sample.lat - LAT) * METRES_PER_DEGREE > 6)).toBe(true);
  });

  test('T06 simplifies an uncertainty-sized detour but preserves a meaningful one', () => {
    const minor = [
      point(0, 0, 0), point(0, 6, 2_000), point(5, 12, 4_000),
      point(6, 18, 6_000), point(5, 24, 8_000), point(0, 30, 10_000),
      point(0, 36, 12_000),
    ].map(sample => ({ ...sample, accuracy: 14 }));
    const meaningful = [
      point(0, 0, 0), point(0, 6, 2_000), point(0, 12, 4_000),
      point(14, 18, 6_000), point(16, 26, 8_000), point(14, 34, 10_000),
      point(0, 40, 12_000), point(0, 46, 14_000), point(0, 52, 16_000),
    ].map(sample => ({ ...sample, accuracy: 14 }));

    expect(maximumLateralM(buildCausalLiveRoute(minor))).toBeLessThan(5);
    expect(maximumLateralM(buildCausalLiveRoute(meaningful))).toBeGreaterThan(12);
  });

  test('T08 stationary oscillation remains audit evidence without route or distance authority', () => {
    const result = ingestQualified([
      { east: 0, north: 0, t: 1_000, speed: 0.1 },
      { east: -1, north: 1, t: 2_000, speed: 0.1 },
      { east: 1, north: -1, t: 3_000, speed: 0.1 },
      { east: -0.5, north: 0.5, t: 4_000, speed: 0.1 },
      { east: 0.5, north: -0.5, t: 5_000, speed: 0.1 },
      { east: 0, north: 0, t: 6_000, speed: 0.1 },
    ]);
    expect(result.decisions.some(value => value.startsWith('QUARANTINE:'))).toBe(true);
    expect(result.accepted).toHaveLength(1);
    expect(buildCausalLiveRoute(result.accepted.map(sample => ({ ...sample, segmentId: 'gate-a' }))))
      .toHaveLength(1);
  });

  test('T09 an impossible jump is rejected before Live, distance or Memory authority', () => {
    const result = ingestQualified([
      { east: 0, north: 0, t: 1_000 },
      { east: 0, north: 5, t: 2_000 },
      { east: 0, north: 500, t: 3_000 },
      { east: 0, north: 10, t: 4_000 },
      { east: 0, north: 15, t: 5_000 },
    ]);
    expect(result.decisions[2]).toMatch(/^REJECT:/);
    expect(result.accepted.some(sample => sample.observationId === 'continuity:2')).toBe(false);
    expect(result.accepted.slice(1).every((sample, index) => (
      haversineM(result.accepted[index], sample) < 8
    ))).toBe(true);
  });

  test('T10 uncertain initial evidence yields when continued movement establishes a real turn', () => {
    const canonical = [
      point(0, 0, 0), point(0, 5, 1_000), point(0, 10, 2_000),
      point(4, 14, 3_000), point(8, 14, 4_000), point(12, 14, 5_000),
      point(16, 14, 6_000), point(20, 14, 7_000),
    ];
    const live = buildCausalLiveRoute(canonical);
    expect(live.some(sample => eastM(sample) < 5 && northM(sample) > 11)).toBe(true);
    expect(eastM(live.at(-1)!)).toBeGreaterThan(19);
  });

  test('a sparse supported turn is confirmed before its presentation window expires', () => {
    const canonical = [
      point(0, 0, 0),
      point(0, 20, 10_000),
      point(0, 40, 20_000),
      point(20, 40, 30_000),
      point(40, 40, 40_000),
      point(60, 40, 50_000),
      point(80, 40, 60_000),
    ].map((sample, index) => ({
      ...sample,
      accuracy: 8,
      speed: 2,
      observationId: `sparse-turn:${index}`,
      rawOrdinal: index + 1,
    }));
    const live = buildCausalLiveRoute(canonical);
    const corner = live.find(sample => sample.observationId === 'sparse-turn:2');

    expect(corner).toBeDefined();
    expect(haversineM(corner!, canonical[2])).toBeLessThan(1);
    expect(corner!.liveTrendConfirmed).toBe(true);
    expect(corner!.livePresentationSettled).not.toBe(true);
  });

  test('silence and segment boundaries preserve the accepted endpoint instead of predicting it', () => {
    const prefix = Array.from({ length: 11 }, (_, index) => point(
      0,
      index * 7,
      index * 5_000,
      'boundary-a',
    ));
    const turnEndpoint = point(7, 70, 55_000, 'boundary-a');
    const afterSilence = [
      point(14, 70, 70_000, 'boundary-a'),
      point(21, 70, 75_000, 'boundary-a'),
      point(28, 70, 80_000, 'boundary-a'),
    ];
    const afterSegment = [
      point(14, 70, 60_000, 'boundary-b'),
      point(21, 70, 65_000, 'boundary-b'),
      point(28, 70, 70_000, 'boundary-b'),
    ];
    for (const route of [
      buildCausalLiveRoute([...prefix, turnEndpoint, ...afterSilence]),
      buildCausalLiveRoute([...prefix, turnEndpoint, ...afterSegment]),
    ]) {
      const endpoint = route.find(sample => sample.t === turnEndpoint.t);
      expect(endpoint).toBeDefined();
      expect(haversineM(endpoint!, turnEndpoint)).toBeLessThan(0.25);
      expect(endpoint!.livePresentationSettled).toBe(true);
    }
  });

  test('a drift immediately before silence or segment change is never trend-confirmed or extrapolated', () => {
    const prefix = Array.from({ length: 11 }, (_, index) => point(
      0,
      index * 1.4,
      index * 1_000,
      'before-gap',
    ));
    const drift = point(5, 15.4, 11_000, 'before-gap');
    const afterSilence = [
      point(0, 18.2, 24_000, 'before-gap'),
      point(0, 19.6, 25_000, 'before-gap'),
      point(0, 21, 26_000, 'before-gap'),
      point(0, 22.4, 27_000, 'before-gap'),
    ];
    const silenceLive = buildCausalLiveRoute([...prefix, drift, ...afterSilence]);
    const silenceBoundary = silenceLive.find(sample => sample.t === drift.t);
    expect(silenceBoundary).toBeDefined();
    expect(haversineM(silenceBoundary!, drift)).toBeLessThan(0.25);
    expect(silenceLive.some(sample => (
      sample.t === drift.t && sample.liveTrendConfirmed
    ))).toBe(false);

    const nextSegment = [
      point(0, 18.2, 12_000, 'after-resume'),
      point(0, 19.6, 13_000, 'after-resume'),
      point(0, 21, 14_000, 'after-resume'),
    ];
    const segmentLive = buildCausalLiveRoute([...prefix, drift, ...nextSegment]);
    const segmentBoundary = segmentLive.find(sample => sample.t === drift.t);
    expect(segmentBoundary).toBeDefined();
    expect(haversineM(segmentBoundary!, drift)).toBeLessThan(0.25);
    expect(segmentLive.some(sample => (
      sample.t === drift.t && sample.liveTrendConfirmed
    ))).toBe(false);
  });

  test('every visible vertex outside the mutable time/distance frontier is immutable thereafter', () => {
    const canonical = Array.from({ length: 90 }, (_, index) => point(
      5 * Math.sin(index / 7),
      index * 1.6,
      index * 1_000,
      'frontier',
    ));
    const checkpoint = createCausalLiveReplayCheckpoint();
    const immutable = new Map<number, { lat: number; lng: number }>();
    canonical.forEach((sample, canonicalIndex) => {
      appendCausalLiveReplayPoint(checkpoint, sample);
      const route = causalLiveReplayResult(checkpoint);
      for (const candidate of route) {
        const sourceIndex = canonical.findIndex(source => source.t === candidate.t);
        const travelledM = sourceIndex < 0
          ? Number.POSITIVE_INFINITY
          : canonical.slice(sourceIndex, canonicalIndex + 1).slice(1)
            .reduce((sum, source, index) => (
              sum + haversineM(canonical[sourceIndex + index], source)
            ), 0);
        const outside = sample.t - candidate.t > 15_000 || travelledM > 18;
        if (!outside) continue;
        expect(
          candidate.t === canonical[0].t
          || candidate.liveTrendConfirmed
          || candidate.livePresentationSettled,
        ).toBe(true);
        const value = { lat: candidate.lat, lng: candidate.lng };
        expect(value).toEqual(immutable.get(candidate.t) ?? value);
        immutable.set(candidate.t, value);
      }
      for (const [timestamp, value] of immutable) {
        expect(route.find(candidate => candidate.t === timestamp)).toMatchObject(value);
      }
    });
    expect(immutable.size).toBeGreaterThan(5);
  });

  test('a denser sampling superset retains an off-phase real corner', () => {
    const cornerAt = 10_400;
    const position = (t: number) => {
      const travelledM = 10 * t / 1_000;
      const cornerM = 10 * cornerAt / 1_000;
      return travelledM <= cornerM
        ? point(0, travelledM, t, 'phase-turn')
        : point(travelledM - cornerM, cornerM, t, 'phase-turn');
    };
    // Both schedules contain the exact 10.4 s apex. The 10 Hz input is a
    // strict superset of the 1 Hz offset-400 ms input, so density alone must
    // not erase the real corner.
    const lowTimes = Array.from({ length: 21 }, (_, index) => 400 + index * 1_000);
    const highTimes = Array.from({ length: 201 }, (_, index) => 400 + index * 100);
    const low = buildCausalLiveRoute(lowTimes.map(position));
    const high = buildCausalLiveRoute(highTimes.map(position));
    const corner = position(cornerAt);
    const nearest = (route: TrackPoint[]) => route.reduce((best, candidate) => (
      haversineM(candidate, corner) < haversineM(best, corner) ? candidate : best
    ));
    const lowCorner = nearest(low);
    const highCorner = nearest(high);
    expect(haversineM(lowCorner, corner)).toBeLessThan(1);
    expect(haversineM(highCorner, corner)).toBeLessThan(1);
    expect(haversineM(lowCorner, highCorner)).toBeLessThan(1);
  });

  test('Gate B preserves transient suppression and real turns across five sampling schedules', () => {
    for (const dtMs of [100, 500, 1_000, 2_000, 5_000]) {
      const transient = buildCausalLiveRoute(straightWithTransientDrift(dtMs));
      expect(maximumLateralM(transient)).toBeLessThanOrEqual(0.5);

      const turn = buildCausalLiveRoute(sustainedTurn(dtMs));
      expect(turn.some(sample => Math.abs(eastM(sample)) < 2
        && Math.abs(northM(sample) - 14) < 2)).toBe(true);

      const uTurn = buildCausalLiveRoute(sustainedUTurn(dtMs));
      expect(Math.max(...uTurn.map(eastM))).toBeGreaterThan(26);
      expect(eastM(uTurn.at(-1)!)).toBeLessThan(2);
    }
  });

  test('confirmed and settled history are immutable while the provisional newest point remains responsive', () => {
    const canonical = [
      ...sustainedTurn(500),
      ...Array.from({ length: 20 }, (_, index) => point(
        14 + 1.4 * ((index + 1) * 500) / 1_000,
        14,
        20_000 + (index + 1) * 500,
      )),
    ];
    const checkpoint = createCausalLiveReplayCheckpoint();
    const confirmed = new Map<string, { lat: number; lng: number }>();
    canonical.forEach(sample => {
      appendCausalLiveReplayPoint(checkpoint, sample);
      causalLiveReplayResult(checkpoint).filter(candidate => (
        candidate.liveTrendConfirmed || candidate.livePresentationSettled
      ))
        .forEach(candidate => {
          const key = `${candidate.segmentId}:${candidate.t}`;
          expect({ lat: candidate.lat, lng: candidate.lng })
            .toEqual(confirmed.get(key) ?? { lat: candidate.lat, lng: candidate.lng });
          confirmed.set(key, { lat: candidate.lat, lng: candidate.lng });
        });
      expect(causalLiveReplayResult(checkpoint).at(-1)).toMatchObject({
        lat: sample.lat, lng: sample.lng, t: sample.t,
      });
    });
    expect(confirmed.size).toBeGreaterThan(0);
  });

  test('a long supported route retains bounded presentation continuity without changing canonical evidence', () => {
    const canonical = Array.from({ length: 601 }, (_, index) => point(
      18 * Math.sin(index / 75),
      index * 1.4,
      1_800_000_000_000 + index * 1_000,
      'long-gentle-route',
    )).map((sample, index) => ({
      ...sample,
      rawOrdinal: index + 1,
      observationId: `long:${index + 1}`,
    }));
    const canonicalBefore = canonical.map(sample => ({ ...sample }));
    const live = buildCausalLiveRoute(canonical);

    expect(canonical).toEqual(canonicalBefore);
    expect(live.length).toBeGreaterThan(40);
    live.slice(1).forEach((sample, index) => {
      expect(sample.t - live[index].t).toBeLessThanOrEqual(120_000);
      expect(haversineM(live[index], sample)).toBeLessThan(200);
    });
    const pathLength = (samples: TrackPoint[]) => samples.slice(1).reduce((sum, sample, index) => (
      sum + haversineM(samples[index], sample)
    ), 0);
    expect(pathLength(live) / pathLength(canonical)).toBeGreaterThan(0.9);
    expect(live.at(-1)).toMatchObject({
      t: canonical.at(-1)!.t,
      rawOrdinal: canonical.at(-1)!.rawOrdinal,
      observationId: canonical.at(-1)!.observationId,
    });
  });

  test('delivery batching and the production WAL projection retain one semantic route', () => {
    const canonical = shortContinuousGpsExcursion(500).map((sample, index) => ({
      ...sample,
      rawOrdinal: index + 1,
      observationId: `gate:${index + 1}`,
      clientActivityId: 'gate-activity',
      ownerGeneration: 'gate-generation',
      source: index % 3 === 0 ? 'background' as const : 'foreground' as const,
    }));
    const expected = buildCausalLiveRoute(canonical);
    for (const batchSize of [1, 3, 17, canonical.length]) {
      const checkpoint = createCausalLiveReplayCheckpoint();
      for (let offset = 0; offset < canonical.length; offset += batchSize) {
        canonical.slice(offset, offset + batchSize).forEach(sample => (
          appendCausalLiveReplayPoint(checkpoint, sample)
        ));
      }
      expect(causalLiveReplayResult(checkpoint)).toEqual(expected);
    }
    const projected = projectActivityJournal([], canonical as CanonicalJournalPoint[]);
    expect(presentation(projected.live)).toEqual(presentation(expected));
    expect(projected.canonical.map(sample => sample.rawOrdinal))
      .toEqual(canonical.map(sample => sample.rawOrdinal));
    expect(projected.canonical.every(sample => (
      !sample.liveTrendConfirmed && !sample.livePresentationSettled
    ))).toBe(true);
  });
});
