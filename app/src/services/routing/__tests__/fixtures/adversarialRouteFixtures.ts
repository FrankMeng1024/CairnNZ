import type { RawPoint } from '../../snapTrack';

export type AdversarialFixtureId =
  | 'clean-straight-road'
  | 'gentle-curved-road'
  | 'real-90-degree-turn'
  | 'hairpin-switchback'
  | 'z-shaped-corridor'
  | 'u-turn'
  | 'out-and-back'
  | 'loop'
  | 'figure-eight'
  | 'two-parallel-roads'
  | 'road-crossing'
  | 'mixed-road-trail-road'
  | 'full-off-road'
  | 'off-road-near-road'
  | 'one-point-lateral-spike'
  | 'multi-point-gps-burst'
  | 'prolonged-poor-accuracy'
  | 'bad-upstream-acceptance'
  | 'low-cadence-background'
  | 'stationary-then-walk'
  | 'real-signal-gap'
  | 'combined-hard-case';

export interface QaRawPoint extends RawPoint {
  qaTruthEastM: number;
  qaTruthNorthM: number;
  qaSection: 'road' | 'trail' | 'crossing' | 'gap';
}

export interface AdversarialRouteFixture {
  id: AdversarialFixtureId;
  seed: number;
  raw: QaRawPoint[];
  truth: Array<{ eastM: number; northM: number }>;
  protectedTopology: 'none' | 'curve' | 'corner' | 'switchback' | 'z' | 'u-turn' | 'loop' | 'self-crossing';
  offRoad: boolean;
  expectedGapCount: number;
}

const METRES_PER_DEGREE = 111_320;
const BASE_LAT = -41.2865;
const BASE_LNG = 174.7762;
const START_T = 1_800_000_000_000;

type XY = { eastM: number; northM: number };

function xy(eastM: number, northM: number): XY { return { eastM, northM }; }

function interpolatePath(waypoints: XY[], spacingM = 5): XY[] {
  const output: XY[] = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index += 1) {
    const start = waypoints[index - 1];
    const end = waypoints[index];
    const distanceM = Math.hypot(end.eastM - start.eastM, end.northM - start.northM);
    const steps = Math.max(1, Math.ceil(distanceM / spacingM));
    for (let step = 1; step <= steps; step += 1) {
      const fraction = step / steps;
      output.push(xy(
        start.eastM + (end.eastM - start.eastM) * fraction,
        start.northM + (end.northM - start.northM) * fraction,
      ));
    }
  }
  return output;
}

function curve(radiusM: number, startRad: number, endRad: number, count: number, offset: XY): XY[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = startRad + (endRad - startRad) * index / Math.max(1, count - 1);
    return xy(
      offset.eastM + Math.cos(angle) * radiusM,
      offset.northM + Math.sin(angle) * radiusM,
    );
  });
}

function join(parts: XY[][]): XY[] {
  return parts.flatMap((part, index) => index === 0 ? part : part.slice(1));
}

function correlatedRaw(
  truth: XY[],
  seed: number,
  options: {
    section?: (index: number) => QaRawPoint['qaSection'];
    accuracy?: (index: number) => number;
    dtMs?: (index: number) => number;
    mutate?: (point: XY, index: number) => XY;
  } = {},
): QaRawPoint[] {
  let driftEastM = 0;
  let driftNorthM = 0;
  let timestamp = START_T;
  return truth.map((target, index) => {
    const accuracy = options.accuracy?.(index)
      ?? [5, 6, 7, 9, 12, 8, 6, 10][(index + seed) % 8];
    // Deterministic first-order drift: consecutive fixes lean the same way,
    // then recover. This is deliberately not independent Gaussian noise.
    const innovationEastM = Math.sin((index + seed) * 0.61) * accuracy * 0.13;
    const innovationNorthM = Math.cos((index + seed * 2) * 0.47) * accuracy * 0.15;
    driftEastM = driftEastM * 0.74 + innovationEastM;
    driftNorthM = driftNorthM * 0.78 + innovationNorthM;
    const mutated = options.mutate?.({
      eastM: target.eastM + driftEastM,
      northM: target.northM + driftNorthM,
    }, index) ?? {
      eastM: target.eastM + driftEastM,
      northM: target.northM + driftNorthM,
    };
    if (index > 0) timestamp += options.dtMs?.(index) ?? [3_000, 4_000, 5_000, 4_000][(index + seed) % 4];
    return {
      lng: BASE_LNG + mutated.eastM / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
      lat: BASE_LAT + mutated.northM / METRES_PER_DEGREE,
      t: timestamp,
      accuracy,
      qaTruthEastM: target.eastM,
      qaTruthNorthM: target.northM,
      qaSection: options.section?.(index) ?? 'road',
    };
  });
}

function fixture(
  id: AdversarialFixtureId,
  seed: number,
  truth: XY[],
  protectedTopology: AdversarialRouteFixture['protectedTopology'],
  options: Parameters<typeof correlatedRaw>[2] & { offRoad?: boolean; expectedGapCount?: number } = {},
): AdversarialRouteFixture {
  return {
    id,
    seed,
    truth,
    raw: correlatedRaw(truth, seed, options),
    protectedTopology,
    offRoad: options.offRoad ?? false,
    expectedGapCount: options.expectedGapCount ?? 0,
  };
}

const straight = interpolatePath([xy(0, 0), xy(160, 0)]);
const broadCurve = curve(110, -Math.PI / 2, 0, 42, xy(0, 110));
const corner = interpolatePath([xy(0, 0), xy(65, 0), xy(65, 70)]);
const switchback = interpolatePath([xy(0, 0), xy(85, 0), xy(20, 18), xy(92, 36)]);
const zShape = interpolatePath([xy(0, 0), xy(55, 0), xy(20, 38), xy(78, 76)]);
const uTurn = interpolatePath([xy(0, 0), xy(85, 0), xy(85, 8), xy(0, 8)]);
const loop = interpolatePath([xy(0, 0), xy(65, 0), xy(65, 55), xy(0, 55), xy(0, 3)]);
const figureEight = Array.from({ length: 73 }, (_unused, index) => {
  const angle = Math.PI * 2 * index / 72;
  return xy(60 * Math.sin(angle), 32 * Math.sin(angle * 2));
});
const mixed = interpolatePath([
  xy(0, 0), xy(60, 0), xy(82, 18), xy(103, 42), xy(132, 55), xy(195, 55),
]);
const offRoadWinding = Array.from({ length: 48 }, (_unused, index) => (
  xy(index * 4.5, Math.sin(index / 4.8) * 22 + Math.sin(index / 2.1) * 3)
));
const stationaryThenWalk = [
  ...Array.from({ length: 12 }, () => xy(0, 0)),
  ...interpolatePath([xy(0, 0), xy(110, 0)]).slice(1),
];
const combinedHard = join([
  interpolatePath([xy(0, 0), xy(70, 0)]),
  curve(50, -Math.PI / 2, -0.15, 18, xy(70, 50)),
  interpolatePath([xy(119, 43), xy(135, 65), xy(168, 65), xy(120, 82), xy(176, 100)]),
  Array.from({ length: 16 }, (_unused, index) => xy(176 + index * 4, 100 + Math.sin(index / 2.4) * 12)),
  interpolatePath([xy(236, 100), xy(310, 100)]),
]);

export const ADVERSARIAL_ROUTE_FIXTURES: AdversarialRouteFixture[] = [
  fixture('clean-straight-road', 1, straight, 'none'),
  fixture('gentle-curved-road', 2, broadCurve, 'curve'),
  fixture('real-90-degree-turn', 3, corner, 'corner'),
  fixture('hairpin-switchback', 4, switchback, 'switchback'),
  fixture('z-shaped-corridor', 5, zShape, 'z'),
  fixture('u-turn', 6, uTurn, 'u-turn'),
  fixture('out-and-back', 7, uTurn.map((point, index) => ({ ...point, northM: index > uTurn.length / 2 ? 1.5 : 0 })), 'u-turn'),
  fixture('loop', 8, loop, 'loop'),
  fixture('figure-eight', 9, figureEight, 'self-crossing'),
  fixture('two-parallel-roads', 10, straight, 'none', {
    mutate: (point, index) => ({ ...point, northM: point.northM + (index >= 8 && index <= 18 ? 7 : 0) }),
  }),
  fixture('road-crossing', 11, interpolatePath([xy(0, 0), xy(60, 0), xy(60, 30), xy(115, 30)]), 'corner', {
    section: index => index >= 12 && index <= 20 ? 'crossing' : 'road',
  }),
  fixture('mixed-road-trail-road', 12, mixed, 'curve', {
    offRoad: true,
    section: index => index >= 12 && index <= 34 ? 'trail' : 'road',
  }),
  fixture('full-off-road', 13, offRoadWinding, 'curve', {
    offRoad: true,
    section: () => 'trail',
    mutate: (point, index) => index === 24 ? { ...point, northM: point.northM + 13 } : point,
  }),
  fixture('off-road-near-road', 14, straight.map(point => ({ ...point, northM: 20 })), 'none', {
    offRoad: true,
    section: () => 'trail',
    mutate: (point, index) => ({ ...point, northM: point.northM - (index % 9 >= 5 ? 6 : 0) }),
  }),
  fixture('one-point-lateral-spike', 15, straight, 'none', {
    accuracy: index => index === 16 ? 20 : 8,
    mutate: (point, index) => index === 16 ? { ...point, northM: point.northM + 13 } : point,
  }),
  fixture('multi-point-gps-burst', 16, straight, 'none', {
    accuracy: index => index >= 14 && index <= 16 ? 25 : 8,
    mutate: (point, index) => index >= 14 && index <= 16
      ? { ...point, northM: point.northM + [10, 14, 10][index - 14] }
      : point,
  }),
  fixture('prolonged-poor-accuracy', 17, straight, 'none', {
    accuracy: index => index >= 9 && index <= 20 ? [20, 28, 36, 45][index % 4] : 7,
  }),
  fixture('bad-upstream-acceptance', 18, broadCurve, 'curve', {
    accuracy: index => index >= 14 && index <= 18 ? 18 : 8,
    mutate: (point, index) => index >= 14 && index <= 18
      ? { ...point, northM: point.northM + [0, 8, -7, 8, 0][index - 14] }
      : point,
  }),
  fixture('low-cadence-background', 19, offRoadWinding.slice(0, 28), 'curve', {
    offRoad: true,
    section: () => 'trail',
    dtMs: index => [5_000, 8_000, 18_000, 22_000, 7_000][(index - 1) % 5],
  }),
  fixture('stationary-then-walk', 20, stationaryThenWalk, 'none', {
    mutate: (point, index) => index < 12
      ? { eastM: Math.sin(index * 1.7) * 5, northM: Math.cos(index * 1.3) * 5 }
      : point,
    accuracy: index => index < 12 ? 14 : 7,
  }),
  fixture('real-signal-gap', 21, [
    ...interpolatePath([xy(0, 0), xy(65, 0)]),
    ...interpolatePath([xy(150, 35), xy(220, 35)]),
  ], 'none', {
    expectedGapCount: 1,
    section: index => index === 14 ? 'gap' : 'road',
    dtMs: index => index === 14 ? 180_000 : 4_000,
  }),
  fixture('combined-hard-case', 22, combinedHard, 'switchback', {
    offRoad: true,
    section: index => index >= 38 && index <= 72 ? 'trail' : index >= 20 && index <= 26 ? 'crossing' : 'road',
    accuracy: index => index >= 58 && index <= 61 ? 24 : index % 13 >= 9 ? 13 : 7,
    dtMs: index => index >= 72 && index <= 76 ? [5_000, 8_000, 18_000, 22_000, 7_000][index - 72] : 4_000,
    mutate: (point, index) => index >= 58 && index <= 60
      ? { ...point, northM: point.northM + [9, 14, 8][index - 58] }
      : point,
  }),
];

export function rawForMode(
  fixtureValue: AdversarialRouteFixture,
  mode: 'hiking' | 'running',
): QaRawPoint[] {
  let timestamp = START_T;
  return fixtureValue.raw.map((point, index) => {
    if (index > 0) {
      const originalDt = Number(point.t) - Number(fixtureValue.raw[index - 1].t);
      timestamp += mode === 'running' && originalDt <= 5_000
        ? Math.max(1_500, Math.round(originalDt * 0.55))
        : originalDt;
    }
    return { ...point, t: timestamp };
  });
}
