import { buildCausalLiveRoute } from '../causalLiveRoute';
import {
  parametricPath,
  pathLengthM,
  presentationMetrics,
  qualifyForLive,
  sampleKnownPath,
} from './movementPresentationFixtures';

const circle = (radiusM: number) => parametricPath(progress => {
  const angle = progress * Math.PI * 2;
  return [radiusM * Math.cos(angle), radiusM * Math.sin(angle)];
});

const oval = (eastRadiusM: number, northRadiusM: number) => parametricPath(progress => {
  const angle = progress * Math.PI * 2;
  return [eastRadiusM * Math.cos(angle), northRadiusM * Math.sin(angle)];
});

const sCurve = (lengthM: number, amplitudeM: number) => parametricPath(progress => (
  [lengthM * progress, amplitudeM * Math.sin(progress * Math.PI * 2)]
));

describe('O98 one-pass meaningful movement coverage', () => {
  test.each([
    ['circle-correlated', circle(20), 1.4, 2, 'correlated' as const, 0.75, 0.37, 0],
    ['circle-alternating', circle(31), 1.1, 2.6, 'alternating' as const, 0.55, 1.13, 0.71],
    ['oval-correlated', oval(34, 15), 1.6, 2.4, 'correlated' as const, 0.7, 2.07, 1.2],
    ['s-curve-correlated', sCurve(96, 13), 1.3, 2.8, 'correlated' as const, 0.7, 0.83, 0.4],
  ])('%s preserves ordered low-noise curved movement', (
    _name, path, speedMps, cadenceSeconds, noiseModel, noiseAmplitudeM, phase, rotationRadians,
  ) => {
    const sampled = sampleKnownPath(path, {
      speedMps, cadenceSeconds, noiseModel, noiseAmplitudeM, phase, rotationRadians,
    });
    const accepted = qualifyForLive(sampled.observations);
    const display = buildCausalLiveRoute(accepted);
    const metrics = presentationMetrics(sampled.truth, accepted, display);
    process.stderr.write(`movement-coverage=${JSON.stringify({
      name: _name, raw: sampled.observations.length, accepted: accepted.length,
      display: display.length, metrics,
    })}\n`);

    expect(accepted.length / sampled.observations.length).toBeGreaterThan(0.8);
    expect(metrics.displayLengthM / metrics.acceptedLengthM).toBeGreaterThan(0.68);
    expect(metrics.acceptedToDisplayP95M).toBeLessThanOrEqual(8);
    expect(metrics.truthToDisplayP95M).toBeLessThanOrEqual(8);
    expect(metrics.orderedLandmarksCovered).toBeGreaterThanOrEqual(5);
    expect(metrics.orderedLandmarkMaxM).toBeLessThanOrEqual(10);
  });

  test('the same continuous movement/noise process remains covered across sampling schedules', () => {
    const path = circle(23);
    const rows = [0.5, 1, 2, 3, 5].map(cadenceSeconds => {
      const sampled = sampleKnownPath(path, {
        speedMps: 1.35,
        cadenceSeconds,
        noiseModel: 'correlated',
        noiseAmplitudeM: 0.72,
        phase: 0.49,
        rotationRadians: 0.63,
      });
      const accepted = qualifyForLive(sampled.observations);
      const display = buildCausalLiveRoute(accepted);
      return {
        cadenceSeconds,
        ...presentationMetrics(sampled.truth, accepted, display),
      };
    });
    process.stderr.write(`movement-sampling=${JSON.stringify(rows)}\n`);

    rows.forEach(metrics => {
      expect(metrics.displayLengthM / metrics.acceptedLengthM).toBeGreaterThan(0.68);
      expect(metrics.truthToDisplayP95M).toBeLessThanOrEqual(8);
      expect(metrics.orderedLandmarksCovered).toBeGreaterThanOrEqual(5);
    });
    const ratios = rows.map(metrics => metrics.displayLengthM / metrics.acceptedLengthM);
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeLessThan(0.32);
  });

  test('straight correlated uncertainty remains calm rather than freezing every accepted fix', () => {
    const straight = parametricPath(progress => [120 * progress, 0]);
    const sampled = sampleKnownPath(straight, {
      speedMps: 1.4,
      cadenceSeconds: 1,
      accuracyM: 8,
      noiseModel: 'correlated',
      noiseAmplitudeM: 1.8,
      phase: 1.7,
    });
    const accepted = qualifyForLive(sampled.observations);
    const display = buildCausalLiveRoute(accepted);
    const metrics = presentationMetrics(sampled.truth, accepted, display);

    expect(display.length).toBeLessThan(accepted.length / 2);
    expect(metrics.truthToDisplayP95M).toBeLessThanOrEqual(3);
    expect(pathLengthM(display) / pathLengthM(sampled.truth)).toBeLessThan(1.08);
  });

  test('uncertainty-sized correlated lateral motion does not settle into immutable straight-line zigzags', () => {
    const straight = parametricPath(progress => [220 * progress, 0]);
    const rows = [0.5, 1, 2, 4].flatMap(cadenceSeconds => (
      [0.5, 0.75, 1].map(accuracyFraction => {
        const sampled = sampleKnownPath(straight, {
          speedMps: 1.4,
          cadenceSeconds,
          accuracyM: 8,
          noiseModel: 'lateral-wave',
          noiseAmplitudeM: 8 * accuracyFraction,
          noisePeriodSeconds: 8,
          phase: 0.37,
          rotationRadians: 0.41,
        });
        const accepted = qualifyForLive(sampled.observations);
        const display = buildCausalLiveRoute(accepted);
        return {
          cadenceSeconds,
          accuracyFraction,
          accepted: accepted.length,
          display: display.length,
          confirmed: display.filter(point => point.liveTrendConfirmed === true).length,
          settled: display.filter(point => point.livePresentationSettled === true).length,
          lengthRatio: pathLengthM(display) / pathLengthM(sampled.truth),
        };
      })
    ));
    process.stderr.write(`movement-straight-uncertainty=${JSON.stringify(rows)}\n`);

    rows.forEach(row => {
      expect(row.lengthRatio).toBeLessThan(1.15);
    });
  });
});
