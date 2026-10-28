import {
  buildEvidenceSupportedLocalFinalGeometry,
  buildEvidenceSupportedTrendFinalGeometry,
} from '../pedestrianFinalRoute';
import type { RawPoint } from '../snapTrack';

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

describe('bounded chronological trend Final', () => {
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
