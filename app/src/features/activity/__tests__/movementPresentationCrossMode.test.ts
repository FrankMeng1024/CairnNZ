import {
  buildCausalLiveRoute,
  createCausalLiveReplayCheckpoint,
  appendCausalLiveReplayPoint,
  causalLiveReplayResult,
} from '../causalLiveRoute';
import {
  buildConfirmedRouteSegments,
  createIncrementalRoutePresentation,
  updateIncrementalRoutePresentation,
} from '../confirmedRoutePresentation';
import type { ActivityMode, TrackPoint } from '../../../store/useSessionStore';
import {
  parametricPath,
  pathLengthM,
  presentationMetrics,
  qualifyForLive,
  sampleKnownPath,
} from './movementPresentationFixtures';

const roundPath = (radiusM: number) => parametricPath(progress => {
  const angle = progress * Math.PI * 2;
  return [radiusM * Math.cos(angle), radiusM * Math.sin(angle)];
});

const longBend = (radiusM: number) => parametricPath(progress => {
  const angle = progress * Math.PI * 1.5;
  return [radiusM * Math.sin(angle), radiusM * (1 - Math.cos(angle))];
});

function renderedLength(points: ReadonlyArray<TrackPoint>): number {
  const state = updateIncrementalRoutePresentation(
    createIncrementalRoutePresentation(),
    points,
  );
  return [...state.staticChunks, ...(state.activeHead ? [state.activeHead] : [])]
    .reduce((total, chunk) => total + chunk.coordinates.slice(1)
      .reduce((chunkTotal, [lng, lat], index) => {
        const [previousLng, previousLat] = chunk.coordinates[index];
        const point: TrackPoint = { lat, lng, t: 0 };
        const previous: TrackPoint = { lat: previousLat, lng: previousLng, t: 0 };
        return chunkTotal + pathLengthM([previous, point]);
      }, 0), 0);
}

describe('O98 cross-mode movement presentation closure', () => {
  test.each<ActivityMode>(['hiking', 'running'])(
    'R1 %s preserves a naturally noisy continuous loop without freezing its wobble',
    mode => {
      const sampled = sampleKnownPath(roundPath(27), {
        speedMps: 1.45,
        cadenceSeconds: 2,
        accuracyM: 14,
        noiseModel: 'correlated',
        noiseAmplitudeM: 0.8,
        phase: 2.683,
        rotationRadians: 1.07,
      });
      const accepted = qualifyForLive(sampled.observations, mode);
      const display = buildCausalLiveRoute(accepted);
      const metrics = presentationMetrics(sampled.truth, accepted, display);

      expect(accepted).toHaveLength(sampled.observations.length);
      expect(metrics.acceptedToDisplayP95M).toBeLessThanOrEqual(10);
      expect(metrics.orderedLandmarksCovered).toBeGreaterThanOrEqual(5);
      expect(metrics.displayLengthM / metrics.acceptedLengthM).toBeGreaterThanOrEqual(0.8);
      expect(display.length).toBeLessThan(accepted.length);
    },
  );

  test.each([
    ['hiking' as const, 1.45, 4],
    ['running' as const, 4.5, 1.5],
  ])('R2 %s keeps a continuous gradual bend spatially covered through rendering', (
    mode,
    speedMps,
    cadenceSeconds,
  ) => {
    const sampled = sampleKnownPath(longBend(68), {
      speedMps,
      cadenceSeconds,
      accuracyM: 8,
      noiseModel: 'correlated',
      noiseAmplitudeM: 0.8,
      phase: 2.683,
      rotationRadians: 1.07,
    });
    const accepted = qualifyForLive(sampled.observations, mode);
    const display = buildCausalLiveRoute(accepted);
    const metrics = presentationMetrics(sampled.truth, accepted, display);
    const segments = buildConfirmedRouteSegments(display);

    expect(accepted).toHaveLength(sampled.observations.length);
    expect(metrics.acceptedToDisplayP95M).toBeLessThanOrEqual(12);
    expect(renderedLength(display) / pathLengthM(accepted)).toBeGreaterThanOrEqual(0.8);
    expect(metrics.orderedLandmarksCovered).toBeGreaterThanOrEqual(5);
    expect(segments).toHaveLength(1);
  });

  test('a simplified continuous source span is not reclassified as silence by the renderer', () => {
    const points: TrackPoint[] = [
      { lat: -41.25, lng: 174.75, t: 0, segmentId: 'continuous', observationId: 'a' },
      { lat: -41.249, lng: 174.751, t: 180_000, segmentId: 'continuous', observationId: 'b' },
    ];
    expect(buildConfirmedRouteSegments(points)).toHaveLength(1);
    const rendered = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      points,
    );
    expect(rendered.staticChunks).toHaveLength(0);
    expect(rendered.activeHead?.coordinates).toHaveLength(2);
  });

  test('an explicit source segment boundary remains a genuine rendered gap', () => {
    const points: TrackPoint[] = [
      { lat: -41.25, lng: 174.75, t: 0, segmentId: 'before', observationId: 'a' },
      { lat: -41.249, lng: 174.751, t: 4_000, segmentId: 'after', observationId: 'b' },
    ];
    expect(buildConfirmedRouteSegments(points)).toHaveLength(2);
  });

  test('running accepts a valid sprint that hiking mode treats as overspeed evidence', () => {
    const sprint = sampleKnownPath(parametricPath(progress => [160 * progress, 0]), {
      speedMps: 8,
      cadenceSeconds: 1,
      accuracyM: 5,
    });
    const running = qualifyForLive(sprint.observations, 'running');
    const hiking = qualifyForLive(sprint.observations, 'hiking');

    expect(running.length / sprint.observations.length).toBeGreaterThan(0.8);
    expect(hiking.length).toBeLessThan(running.length);
    expect(pathLengthM(buildCausalLiveRoute(running))).toBeGreaterThan(140);
  });

  test('individual append and cold replay produce the same cross-mode route', () => {
    const sampled = sampleKnownPath(longBend(48), {
      speedMps: 4.2,
      cadenceSeconds: 1.5,
      accuracyM: 9,
      noiseModel: 'correlated',
      noiseAmplitudeM: 0.7,
      phase: 0.91,
      rotationRadians: 2.1,
    });
    const accepted = qualifyForLive(sampled.observations, 'running');
    const checkpoint = createCausalLiveReplayCheckpoint();
    accepted.forEach(point => appendCausalLiveReplayPoint(checkpoint, point));

    expect(causalLiveReplayResult(checkpoint)).toEqual(buildCausalLiveRoute(accepted));
  });
});
