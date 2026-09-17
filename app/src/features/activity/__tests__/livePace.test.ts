import { deriveAveragePaceSecondsPerKm, deriveLivePace } from '../livePace';

const LAT = -41.28;
const point = (eastM: number, seconds: number, extra: Record<string, unknown> = {}) => ({
  lat: LAT,
  lng: 174.77 + eastM / (111_320 * Math.cos(LAT * Math.PI / 180)),
  t: seconds * 1_000,
  accuracy: 8,
  segmentId: 'segment-a',
  ...extra,
});

describe('Run Live Pace', () => {
  test('startup with ten metres of movement remains unavailable', () => {
    const result = deriveLivePace({ points: [point(0, 0), point(10, 8)], nowMs: 8_000, recording: true });
    expect(result).toMatchObject({ secondsPerKm: null, reason: 'insufficient' });
  });

  test('steady movement uses a recent window, not cumulative Activity average', () => {
    const oldSlow = [point(0, 0), point(100, 120)];
    const recent = Array.from({ length: 8 }, (_, index) => point(100 + index * 10, 120 + index * 4));
    const result = deriveLivePace({ points: [...oldSlow, ...recent], nowMs: 148_000, recording: true });
    expect(result.secondsPerKm).toBeGreaterThan(380);
    expect(result.secondsPerKm).toBeLessThan(420);
    expect(deriveAveragePaceSecondsPerKm(148, 170)).toBeGreaterThan(800);
  });

  test('responds to acceleration and slowing within the bounded window', () => {
    const fast = Array.from({ length: 8 }, (_, index) => point(index * 10, index * 3));
    const slow = Array.from({ length: 8 }, (_, index) => point(index * 10, index * 7));
    const fastPace = deriveLivePace({ points: fast, nowMs: 21_000, recording: true }).secondsPerKm!;
    const slowPace = deriveLivePace({ points: slow, nowMs: 49_000, recording: true }).secondsPerKm!;
    expect(fastPace).toBeLessThan(slowPace);
  });

  test('stop, pause, stale evidence and poor accuracy do not fake precision', () => {
    const moving = Array.from({ length: 7 }, (_, index) => point(index * 8, index * 4));
    expect(deriveLivePace({ points: moving, nowMs: 40_000, recording: true }).reason).toBe('stale');
    expect(deriveLivePace({ points: moving, nowMs: 24_000, recording: false }).reason).toBe('not-recording');
    const poor = moving.map(sample => ({ ...sample, accuracy: 40 }));
    expect(deriveLivePace({ points: poor, nowMs: 24_000, recording: true }).reason).toBe('poor-accuracy');
  });

  test('Resume segment starts a clean pace window', () => {
    const before = Array.from({ length: 10 }, (_, index) => point(index * 10, index * 4));
    const after = [point(100, 40, { segmentId: 'segment-b' }), point(110, 44, { segmentId: 'segment-b' })];
    expect(deriveLivePace({ points: [...before, ...after], nowMs: 44_000, recording: true })).toMatchObject({
      secondsPerKm: null,
      reason: 'insufficient',
    });
  });
});
