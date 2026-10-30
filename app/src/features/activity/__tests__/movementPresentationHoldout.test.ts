import { buildCausalLiveRoute } from '../causalLiveRoute';
import {
  parametricPath,
  polylinePath,
  presentationMetrics,
  qualifyForLive,
  sampleKnownPath,
} from './movementPresentationFixtures';

// Frozen before the implementation change. These topologies, phases,
// orientations and cadences are intentionally separate from the development
// reproductions; do not update their expectations to match an implementation.
const holdouts = [
  {
    name: 'rotated-wide-oval',
    path: parametricPath(progress => {
      const angle = progress * Math.PI * 2;
      return [47 * Math.cos(angle), 19 * Math.sin(angle)];
    }),
    options: {
      speedMps: 1.8, cadenceSeconds: 1.7, noiseModel: 'slow-bias' as const,
      noiseAmplitudeM: 0.68, phase: 2.31, rotationRadians: 2.08,
    },
  },
  {
    name: 'off-axis-figure-eight',
    path: parametricPath(progress => {
      const angle = progress * Math.PI * 2;
      return [29 * Math.sin(angle), 17 * Math.sin(angle * 2)];
    }),
    options: {
      speedMps: 1.25, cadenceSeconds: 2.3, noiseModel: 'correlated' as const,
      noiseAmplitudeM: 0.62, phase: 1.91, rotationRadians: 0.92,
    },
  },
  {
    name: 'sparse-switchback',
    path: polylinePath([[0, 0], [46, 0], [48, 8], [3, 8], [1, 17], [52, 17], [54, 27]]),
    options: {
      speedMps: 1.55, cadenceSeconds: 3.4, noiseModel: 'correlated' as const,
      noiseAmplitudeM: 0.66, phase: 3.17, rotationRadians: 1.37,
    },
  },
  {
    name: 'compact-real-detour',
    path: polylinePath([[0, 0], [28, 0], [34, 8], [37, 16], [44, 0], [76, 0]]),
    options: {
      speedMps: 1.2, cadenceSeconds: 2.1, noiseModel: 'alternating' as const,
      noiseAmplitudeM: 0.45, phase: 4.03, rotationRadians: 2.62,
    },
  },
];

describe('O98 one-pass frozen movement holdouts', () => {
  test.each(holdouts)('$name keeps known traversal and corridor coverage', ({ name, path, options }) => {
    const sampled = sampleKnownPath(path, options);
    const accepted = qualifyForLive(sampled.observations);
    const display = buildCausalLiveRoute(accepted);
    const metrics = presentationMetrics(sampled.truth, accepted, display);
    process.stderr.write(`movement-holdout=${JSON.stringify({
      name, raw: sampled.observations.length, accepted: accepted.length,
      display: display.length, metrics,
    })}\n`);

    expect(accepted.length / sampled.observations.length).toBeGreaterThan(0.75);
    expect(metrics.displayLengthM / metrics.truthLengthM).toBeGreaterThan(0.70);
    expect(metrics.displayLengthM / metrics.truthLengthM).toBeLessThan(1.15);
    expect(metrics.truthToDisplayP95M).toBeLessThanOrEqual(9);
    expect(metrics.orderedLandmarksCovered).toBeGreaterThanOrEqual(5);
    expect(metrics.orderedLandmarkMaxM).toBeLessThanOrEqual(12);
  });
});
