import { pointGrowthDurationMs, pointGrowthFrame, pointInsideUsableMap } from '../pointGrowthTimeline';

const p = (lng: number, lat: number) => ({ lng, lat });

describe('Point reveal and camera share one arc-length timeline', () => {
  test('curved and returning legs place the camera head on the revealed geometry', () => {
    const points = [p(0, 0), p(0.001, 0), p(0.001, 0.001), p(0, 0.001)];
    const quarter = pointGrowthFrame(points, 0.25)!;
    const half = pointGrowthFrame(points, 0.5)!;
    const done = pointGrowthFrame(points, 1)!;
    expect(quarter.visiblePoints.at(-1)).toEqual(quarter.head);
    expect(half.visiblePoints.at(-1)).toEqual(half.head);
    expect(half.travelledM).toBeGreaterThan(quarter.travelledM);
    expect(done.visiblePoints).toEqual(points);
  });

  test('duration scales with the visible task but stays bounded', () => {
    expect(pointGrowthDurationMs([p(0, 0), p(0.0001, 0)])).toBeGreaterThanOrEqual(720);
    expect(pointGrowthDurationMs([p(0, 0), p(1, 0)])).toBe(2200);
  });

  test('usable map bounds reserve the dock and top controls', () => {
    const viewport = { width: 390, height: 844, topInset: 0, bottomInset: 190 };
    expect(pointInsideUsableMap({ x: 195, y: 300 }, viewport)).toBe(true);
    expect(pointInsideUsableMap({ x: 195, y: 700 }, viewport)).toBe(false);
  });
});
