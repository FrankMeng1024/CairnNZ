import { appendCausalLivePoint, buildCausalLiveRoute } from '../causalLiveRoute';
import { haversineM } from '../../../utils/geo';
import type { TrackPoint } from '../../../store/useSessionStore';

const LAT = -41.28;
const sample = (eastM: number, northM: number, index: number, segmentId = 'a') => ({
  lat: LAT + northM / 111_320,
  lng: 174.77 + eastM / (111_320 * Math.cos(LAT * Math.PI / 180)),
  t: index * 2_000,
  accuracy: 14,
  segmentId,
});
const length = (points: TrackPoint[]) => points.slice(1)
  .reduce((sum, point, index) => sum + haversineM(points[index], point), 0);

describe('causal Live route presentation', () => {
  test('materially calms a straight urban corridor with 1–5 m wobble', () => {
    const canonical = Array.from({ length: 41 }, (_, index) => sample(index * 4, Math.sin(index * 1.7) * 4, index));
    const live = buildCausalLiveRoute(canonical);
    expect(live.length).toBeLessThan(canonical.length / 2);
    expect(length(live) / haversineM(canonical[0], canonical[canonical.length - 1])).toBeLessThan(1.05);
    expect(live.at(-1)).toBe(canonical.at(-1));
  });

  test('removes a small Z but preserves a true 90 degree corner', () => {
    const z = [sample(0, 0, 0), sample(8, 0, 1), sample(12, 4, 2), sample(16, 0, 3), sample(24, 0, 4)];
    expect(buildCausalLiveRoute(z).length).toBeLessThan(z.length);
    const corner = [
      ...Array.from({ length: 6 }, (_, index) => sample(index * 5, 0, index)),
      ...Array.from({ length: 6 }, (_, index) => sample(25, index * 5, index + 6)).slice(1),
    ];
    const live = buildCausalLiveRoute(corner);
    expect(live.some(point => haversineM(point, sample(25, 0, 0)) < 1)).toBe(true);
  });

  test('preserves U-turn chronology and never joins a Gap', () => {
    const outbound = Array.from({ length: 8 }, (_, index) => sample(index * 6, 0, index));
    const returning = Array.from({ length: 8 }, (_, index) => sample(42 - index * 6, 1, index + 8)).slice(1);
    const afterGap = [sample(100, 30, 20, 'b'), sample(110, 30, 21, 'b')];
    const live = buildCausalLiveRoute([...outbound, ...returning, ...afterGap]);
    expect(length(live.filter(point => point.segmentId === 'a') as any)).toBeGreaterThan(70);
    expect(live.filter(point => point.segmentId === 'b')).toHaveLength(2);
  });

  test('is causal: each publication is derived only from the observed prefix', () => {
    const points = Array.from({ length: 20 }, (_, index) => sample(index * 4, Math.sin(index) * 3, index));
    let published: TrackPoint[] = [];
    const history: TrackPoint[] = [];
    points.forEach((point, index) => {
      history.push(point);
      published = appendCausalLivePoint(published, point, history);
      expect(published).toEqual(buildCausalLiveRoute(points.slice(0, index + 1)));
    });
  });
});
