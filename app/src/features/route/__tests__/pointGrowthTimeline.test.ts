import {
  pointCameraStops,
  pointCameraToleranceM,
  pointGrowthDurationMs,
  pointGrowthFrame,
  pointGrowthSample,
  pointInsideUsableMap,
  preparePointGrowthTimeline,
} from '../pointGrowthTimeline';

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
    expect(pointGrowthDurationMs([p(174.77, -36.85), p(174.78, -36.85)])).toBe(2200);
  });

  test('usable map bounds reserve the dock and top controls', () => {
    const viewport = { width: 390, height: 844, topInset: 0, bottomInset: 190 };
    expect(pointInsideUsableMap({ x: 195, y: 300 }, viewport)).toBe(true);
    expect(pointInsideUsableMap({ x: 195, y: 700 }, viewport)).toBe(false);
  });

  test('camera stops collapse dense straight provider samples onto one arc-length transition', () => {
    const points = Array.from({ length: 101 }, (_, index) => p(index * 0.00001, 0));
    const timeline = preparePointGrowthTimeline(points)!;
    expect(pointCameraStops(timeline, 1)).toEqual([
      { point: points[0], progress: 0, sourceIndex: 0 },
      { point: points[100], progress: 1, sourceIndex: 100 },
    ]);
  });

  test('camera stops retain real turns and a returning endpoint without chasing every provider vertex', () => {
    const points = [
      p(0, 0), p(0.0005, 0), p(0.001, 0),
      p(0.001, 0.0005), p(0.001, 0.001),
      p(0.0005, 0.001), p(0, 0.001),
      p(0, 0.0005), p(0, 0),
    ];
    const stops = pointCameraStops(preparePointGrowthTimeline(points)!, 1);
    expect(stops.length).toBeGreaterThanOrEqual(5);
    expect(stops.length).toBeLessThan(points.length);
    expect(stops[0]).toMatchObject({ point: points[0], progress: 0, sourceIndex: 0 });
    expect(stops.at(-1)).toMatchObject({ point: points.at(-1), progress: 1, sourceIndex: points.length - 1 });
    expect(stops.map(stop => stop.progress)).toEqual([...stops.map(stop => stop.progress)].sort((a, b) => a - b));
  });

  test('camera stops collapse near-simultaneous handoffs but preserve the exact endpoint', () => {
    const points = [
      p(0, 0),
      p(0.001, 0),
      p(0.00098, 0.000005),
      p(0, 0.0001),
    ];
    const stops = pointCameraStops(preparePointGrowthTimeline(points)!, 1);
    expect(stops[0].sourceIndex).toBe(0);
    expect(stops.at(-1)?.sourceIndex).toBe(points.length - 1);
    expect(stops.map(stop => stop.sourceIndex)).not.toContain(2);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index].progress - stops[index - 1].progress).toBeGreaterThanOrEqual(0.014);
    }
  });

  test('camera simplification stays within two screen pixels across ordinary phone zooms', () => {
    const points = [p(174.77, -36.85), p(174.78, -36.84)];
    expect(pointCameraToleranceM(points, 14)).toBe(8);
    expect(pointCameraToleranceM(points, 18)).toBeGreaterThanOrEqual(0.5);
    expect(pointCameraToleranceM(points, 18)).toBeLessThan(1.1);
  });

  test('the animation hot path can reuse one sample without changing arc-length truth', () => {
    const timeline = preparePointGrowthTimeline([
      p(174.77, -36.85),
      p(174.771, -36.85),
      p(174.771, -36.849),
    ])!;
    const reusable = pointGrowthSample(timeline, 0.25);
    const firstHead = reusable.head;
    const result = pointGrowthSample(timeline, 0.75, reusable);
    expect(result).toBe(reusable);
    expect(result.head).toBe(firstHead);
    expect(result.progress).toBe(0.75);
    expect(result.travelledM).toBeCloseTo(timeline.totalM * 0.75, 8);
    expect(result.visiblePointCount).toBe(3);
  });
});
