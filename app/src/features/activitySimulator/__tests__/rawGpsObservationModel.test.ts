import { destinationPoint, distanceMeters } from '../geodesy';
import {
  advanceRawGpsModel,
  createRawGpsModelState,
  REALISTIC_GPS_PROFILE,
  type RawGpsObservation,
} from '../rawGpsObservationModel';

const ORIGIN = { lat: -45.0312, lng: 168.6626 };
const EPOCH = 1_800_000_000_000;

type Tick = {
  second: number;
  truth: { lat: number; lng: number };
  observation: RawGpsObservation | null;
};

function simulate(args: {
  seed?: number;
  durationS: number;
  truthAt: (second: number) => { lat: number; lng: number };
  speedAt?: (second: number) => number;
  signalAt?: (second: number) => 'normal' | 'poor' | 'lost' | 'frozen';
  observationAllowedAt?: (second: number) => boolean;
  forcedOutlierAt?: number;
}): Tick[] {
  let state = createRawGpsModelState(args.seed ?? 55, EPOCH);
  return Array.from({ length: args.durationS + 1 }, (_unused, second) => {
    const truth = args.truthAt(second);
    const forceOutlier = second === args.forcedOutlierAt;
    const result = advanceRawGpsModel({
      state,
      groundTruth: truth,
      timestampMs: EPOCH + second * 1_000,
      trueSpeedMps: args.speedAt?.(second) ?? 0,
      trueCourseDegrees: 90,
      signal: args.signalAt?.(second) ?? 'normal',
      observationAllowed: args.observationAllowedAt?.(second) ?? true,
      forceObservation: forceOutlier,
      forceOutlierMagnitudeM: forceOutlier ? 100 : undefined,
    });
    state = result.state;
    return { second, truth, observation: result.observation };
  });
}

function fixes(ticks: Tick[]) {
  return ticks.flatMap(tick => tick.observation ? [{ ...tick.observation, second: tick.second }] : []);
}

function lagOne(values: number[]): number {
  const left = values.slice(0, -1);
  const right = values.slice(1);
  const meanLeft = left.reduce((sum, value) => sum + value, 0) / left.length;
  const meanRight = right.reduce((sum, value) => sum + value, 0) / right.length;
  const numerator = left.reduce((sum, value, index) => sum + (value - meanLeft) * (right[index] - meanRight), 0);
  const denominator = Math.sqrt(
    left.reduce((sum, value) => sum + (value - meanLeft) ** 2, 0)
    * right.reduce((sum, value) => sum + (value - meanRight) ** 2, 0),
  );
  return numerator / denominator;
}

describe('calibrated Raw GPS observation model', () => {
  const east = (metres: number) => destinationPoint(ORIGIN, 90, metres);

  test('same truth and seed reproduces the same fixes while another seed varies plausibly', () => {
    const run = (seed: number) => fixes(simulate({
      seed,
      durationS: 90,
      truthAt: second => east(second * 1.4),
      speedAt: () => 1.4,
    })).map(fix => [fix.second, fix.coordinate.lat, fix.coordinate.lng, fix.accuracyM]);
    expect(run(12345)).toEqual(run(12345));
    expect(run(12345)).not.toEqual(run(54321));
  });

  test('moving errors persist over time instead of behaving like independent white noise', () => {
    const result = fixes(simulate({
      seed: 550055,
      durationS: 240,
      truthAt: second => east(second * 1.4),
      speedAt: () => 1.4,
    }));
    expect(result.length).toBeGreaterThan(70);
    expect(lagOne(result.map(fix => fix.errorNorthM))).toBeGreaterThan(0.45);
    expect(lagOne(result.map(fix => fix.errorEastM))).toBeGreaterThan(0.45);
  });

  test('stationary truth keeps emitting a correlated drifting cloud rather than freezing', () => {
    const result = fixes(simulate({
      seed: 550059,
      durationS: 180,
      truthAt: () => ORIGIN,
    }));
    const radii = result.map(fix => distanceMeters(ORIGIN, fix.coordinate)).sort((a, b) => a - b);
    const falsePathM = result.slice(1).reduce((sum, fix, index) => (
      sum + distanceMeters(result[index].coordinate, fix.coordinate)
    ), 0);
    expect(result.length).toBeGreaterThan(35);
    expect(new Set(result.map(fix => `${fix.coordinate.lat}:${fix.coordinate.lng}`)).size).toBeGreaterThan(20);
    expect(radii[Math.floor(radii.length * 0.95)]).toBeGreaterThan(5);
    expect(radii[Math.floor(radii.length * 0.95)]).toBeLessThan(30);
    expect(falsePathM).toBeGreaterThan(40);
    expect(lagOne(result.map(fix => fix.errorNorthM))).toBeGreaterThan(0.35);
  });

  test('cadence and hAcc vary within field-supported ranges', () => {
    const result = fixes(simulate({
      seed: 777,
      durationS: 420,
      truthAt: second => east(second * 1.6),
      speedAt: () => 1.6,
    }));
    const intervals = result.slice(1).map((fix, index) => fix.second - result[index].second);
    const accuracies = result.map(fix => fix.accuracyM);
    expect(new Set(intervals).size).toBeGreaterThan(4);
    expect(intervals.some(value => value >= 6)).toBe(true);
    expect(Math.min(...accuracies)).toBeGreaterThanOrEqual(REALISTIC_GPS_PROFILE.minimumAccuracyM);
    expect(Math.max(...accuracies)).toBeGreaterThan(Math.min(...accuracies) + 4);
    expect(Math.max(...accuracies)).toBeLessThanOrEqual(REALISTIC_GPS_PROFILE.maximumAccuracyM);
  });

  test('a rare forced outlier decays through a correlated recovery tail', () => {
    const result = fixes(simulate({
      seed: 901,
      durationS: 120,
      truthAt: second => east(second * 1.4),
      speedAt: () => 1.4,
      forcedOutlierAt: 60,
    }));
    const injectedIndex = result.findIndex(fix => fix.second === 60);
    expect(injectedIndex).toBeGreaterThan(0);
    const injectedMagnitude = Math.hypot(result[injectedIndex].errorEastM, result[injectedIndex].errorNorthM);
    expect(injectedMagnitude).toBeGreaterThan(75);
    const recovered = result.slice(injectedIndex + 1).find(fix => (
      Math.hypot(fix.errorEastM, fix.errorNorthM) < 20
    ));
    expect(recovered).toBeDefined();
    expect(recovered!.second - result[injectedIndex].second).toBeGreaterThanOrEqual(5);
    expect(recovered!.second - result[injectedIndex].second).toBeLessThanOrEqual(30);
  });

  test('move-stop-move retains observations and bias memory through the physical stop', () => {
    const result = fixes(simulate({
      seed: 550055,
      durationS: 240,
      truthAt: second => east(second <= 60 ? second * 1.4 : second <= 180 ? 84 : 84 + (second - 180) * 1.4),
      speedAt: second => second <= 60 || second > 180 ? 1.4 : 0,
    }));
    const stop = result.filter(fix => fix.second > 60 && fix.second <= 180);
    const resumed = result.find(fix => fix.second > 180);
    expect(stop.length).toBeGreaterThan(20);
    expect(new Set(stop.map(fix => `${fix.coordinate.lat}:${fix.coordinate.lng}`)).size).toBeGreaterThan(15);
    expect(resumed).toBeDefined();
    const endOfStop = stop.at(-1)!;
    const vectorDeltaM = Math.hypot(
      resumed!.errorEastM - endOfStop.errorEastM,
      resumed!.errorNorthM - endOfStop.errorNorthM,
    );
    expect(vectorDeltaM).toBeLessThan(15);
  });

  test('source silence is distinct from stationary fixes and recovery resumes output', () => {
    const ticks = simulate({
      seed: 44,
      durationS: 150,
      truthAt: () => ORIGIN,
      observationAllowedAt: second => second < 45 || second > 105,
    });
    expect(fixes(ticks.filter(tick => tick.second >= 45 && tick.second <= 105))).toHaveLength(0);
    expect(fixes(ticks.filter(tick => tick.second < 45)).length).toBeGreaterThan(5);
    expect(fixes(ticks.filter(tick => tick.second > 105)).length).toBeGreaterThan(5);
  });
});
