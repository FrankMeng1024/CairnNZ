import {
  buildEvidenceSupportedLocalFinalGeometry,
  buildEvidenceSupportedTrendFinalGeometry,
} from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

const independentFixtures = require('./fixtures/trendNoRegressionFixtures.json') as {
  fixtures: Array<{
    id: string;
    expected_before: {
      localCrossings: number;
      trendCrossings: number;
      acceptedTrend: boolean;
    };
    points: RawPoint[];
  }>;
};

const METRES_PER_DEGREE = 111_320;
const LATITUDE = -43;

function point(eastM: number, northM: number, seconds: number, accuracy = 14): RawPoint {
  return {
    lat: LATITUDE + northM / METRES_PER_DEGREE,
    lng: 170 + eastM / (METRES_PER_DEGREE * Math.cos(LATITUDE * Math.PI / 180)),
    t: 1_800_000_000_000 + seconds * 1_000,
    accuracy,
  };
}

function properIntersections(points: RawPoint[]): number {
  const cross = (a: RawPoint, b: RawPoint, c: RawPoint) => (
    (b.lng - a.lng) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lng - a.lng)
  );
  let count = 0;
  for (let left = 1; left < points.length; left += 1) {
    for (let right = left + 2; right < points.length; right += 1) {
      if (left === 1 && right === points.length - 1
        && Math.abs(points[0].lat - points.at(-1)!.lat) < 1e-7
        && Math.abs(points[0].lng - points.at(-1)!.lng) < 1e-7) continue;
      const [a, b, c, d] = [points[left - 1], points[left], points[right - 1], points[right]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) count += 1;
    }
  }
  return count;
}

function sustainedReversals(points: RawPoint[], axis: 'east' | 'north'): number {
  const scalar = points.map(sample => axis === 'east'
    ? (sample.lng - 170) * METRES_PER_DEGREE * Math.cos(LATITUDE * Math.PI / 180)
    : (sample.lat - LATITUDE) * METRES_PER_DEGREE);
  const directions = scalar.slice(1).map((value, index) => Math.sign(value - scalar[index]))
    .filter(value => value !== 0);
  const runs: Array<{ direction: number; travel: number }> = [];
  for (let index = 0; index < directions.length; index += 1) {
    const travel = Math.abs(scalar[index + 1] - scalar[index]);
    const tail = runs[runs.length - 1];
    if (tail?.direction === directions[index]) tail.travel += travel;
    else runs.push({ direction: directions[index], travel });
  }
  return runs.filter(run => run.travel >= 8).slice(1).length;
}

function repeatedCorridor(passCount: 2 | 3 | 4, maximumOffsetM: number): RawPoint[] {
  const points: RawPoint[] = [];
  const perPass = 18;
  for (let pass = 0; pass < passCount; pass += 1) {
    const direction = pass % 2 === 0 ? 1 : -1;
    const lateral = -maximumOffsetM / 2 + (maximumOffsetM * pass) / (passCount - 1);
    for (let index = 0; index < perPass; index += 1) {
      const progress = direction > 0 ? index : perPass - 1 - index;
      points.push(point(
        lateral + Math.sin((index + pass) * 0.9) * 0.18,
        progress * 4.5,
        points.length,
        8,
      ));
    }
  }
  return points;
}

describe('bounded chronological trend Final', () => {
  test.each(independentFixtures.fixtures)(
    '$id rejects the unchanged independent counterexample and returns exact Local point metadata',
    fixture => {
      const local = buildEvidenceSupportedLocalFinalGeometry(fixture.points);
      const selected = buildEvidenceSupportedTrendFinalGeometry(fixture.points);

      expect(properIntersections(local.points)).toBe(fixture.expected_before.localCrossings);
      expect(fixture.expected_before).toMatchObject({ acceptedTrend: true });
      expect(fixture.expected_before.trendCrossings).toBeGreaterThan(
        fixture.expected_before.localCrossings,
      );
      expect(selected.diagnostics).toMatchObject({
        accepted: false,
        rejectionReason: 'trend:crossing-regression',
      });
      expect(selected.points).toEqual(local.points);
      expect(properIntersections(selected.points)).toBe(properIntersections(local.points));
    },
  );

  test('Back Around same-corridor out/back loses the small figure-eight without losing its reversal', () => {
    const outbound = Array.from({ length: 25 }, (_unused, index) => (
      point(index * 2, index + Math.sin(index * 1.8) * 1.25, index * 2)
    ));
    const turnNoise = [point(46, 26, 51), point(49, 23, 53), point(46, 21, 55)];
    const returning = Array.from({ length: 23 }, (_unused, index) => (
      point(44 - index * 2, 22 - index + Math.sin(index * 1.6) * 1.15, 57 + index * 2)
    ));
    const canonical = [...outbound, ...turnNoise, ...returning];
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    const trend = buildEvidenceSupportedTrendFinalGeometry(canonical);

    expect(trend.diagnostics.accepted).toBe(true);
    expect(trend.diagnostics.passCount).toBe(2);
    expect(sustainedReversals(trend.points, 'east')).toBe(1);
    expect(properIntersections(trend.points)).toBe(0);
    expect(properIntersections(trend.points)).toBeLessThanOrEqual(properIntersections(local.points));
    expect(trend.diagnostics.longitudinalRangeRatio).toBeGreaterThan(0.94);
    expect(trend.points[0]).toMatchObject({ lat: canonical[0].lat, lng: canonical[0].lng });
    expect(trend.points.at(-1)).toMatchObject({ lat: canonical.at(-1)!.lat, lng: canonical.at(-1)!.lng });
  });

  test('Run-like two-reversal chronology is never flattened into a single trip or given extra crossings', () => {
    const canonical = [
      ...Array.from({ length: 13 }, (_unused, index) => point(-index * 0.4, -index * 2, index)),
      ...Array.from({ length: 13 }, (_unused, index) => point(-5 + index * 0.8, -24 - index, 13 + index)),
      ...Array.from({ length: 25 }, (_unused, index) => point(5 - index * 1.25, -36 + index * 1.25, 26 + index)),
      ...Array.from({ length: 13 }, (_unused, index) => point(-25 + index * 0.55, -6 - index * 0.9, 51 + index)),
    ];
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    const trend = buildEvidenceSupportedTrendFinalGeometry(canonical);

    expect(trend.diagnostics.accepted).toBe(false);
    expect(trend.points).toEqual(local.points);
    expect(sustainedReversals(trend.points, 'north')).toBeGreaterThanOrEqual(2);
    expect(properIntersections(trend.points)).toBeLessThanOrEqual(properIntersections(local.points));
  });

  test.each([
    ['L-shaped route', [point(0, 0, 0), point(30, 0, 10), point(60, 0, 20), point(60, 30, 30), point(60, 60, 40)]],
    ['large loop', [point(0, 0, 0), point(50, 0, 10), point(50, 50, 20), point(0, 50, 30), point(0, 0, 40)]],
    ['parallel roads', [point(0, 0, 0), point(50, 0, 10), point(100, 0, 20), point(100, 12, 30), point(50, 12, 40), point(0, 12, 50)]],
    ['real hairpin', [point(0, 0, 0), point(35, 0, 10), point(70, 0, 20), point(60, 18, 30), point(30, 24, 40), point(0, 28, 50)]],
  ])('does not co-centre %s', (_name, canonical) => {
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    const trend = buildEvidenceSupportedTrendFinalGeometry(canonical);
    expect(trend.diagnostics.accepted).toBe(false);
    expect(trend.points).toEqual(local.points);
  });

  test.each([
    ['two chronological passes', repeatedCorridor(2, 1.2)],
    ['three chronological passes', repeatedCorridor(3, 2.4)],
    ['four chronological passes', repeatedCorridor(4, 3.4)],
    ['pass-centre boundary outside the corridor', repeatedCorridor(3, 3.6)],
    ['curved corridor', Array.from({ length: 45 }, (_unused, index) => {
      const angle = (Math.PI / 2) * index / 44;
      return point(Math.sin(angle) * 75, (1 - Math.cos(angle)) * 75, index, 8);
    })],
    ['adjacent walking paths', [
      ...Array.from({ length: 18 }, (_unused, index) => point(0, index * 4.5, index, 8)),
      ...Array.from({ length: 18 }, (_unused, index) => point(6, (17 - index) * 4.5, 18 + index, 8)),
    ]],
  ] as Array<[string, RawPoint[]]>)('%s never gains a proper crossing over Local', (_name, canonical) => {
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    const selected = buildEvidenceSupportedTrendFinalGeometry(canonical);
    expect(properIntersections(selected.points)).toBeLessThanOrEqual(
      properIntersections(local.points),
    );
    expect(selected.points[0]).toMatchObject({ lat: local.points[0].lat, lng: local.points[0].lng });
    expect(selected.points.at(-1)).toMatchObject({
      lat: local.points.at(-1)!.lat,
      lng: local.points.at(-1)!.lng,
    });
    expect(selected.points.every((sample, index) => (
      index === 0 || sample.t == null || selected.points[index - 1].t == null
        || sample.t >= selected.points[index - 1].t!
    ))).toBe(true);
  });

  test('ordinary Good-like foreground geometry remains on the established Local Final', () => {
    const canonical = Array.from({ length: 80 }, (_unused, index) => (
      point(index * 3, Math.sin(index / 15) * 3, index * 2, 9)
    ));
    const local = buildEvidenceSupportedLocalFinalGeometry(canonical);
    const trend = buildEvidenceSupportedTrendFinalGeometry(canonical);
    expect(trend.diagnostics.accepted).toBe(false);
    expect(trend.points).toEqual(local.points);
  });
});
