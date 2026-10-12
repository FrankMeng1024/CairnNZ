import type { MatchResult } from '../../../services/routing/mapmatch/types';
import {
  ROUTE_MATCH_CHUNK_COORDINATES,
  chunkOrderedTrace,
  resampleOrderedForBudget,
  resolveDrawPlan,
  resolvePointPlan,
  orderedShapeDeviationM,
} from '../routePlanningProvider';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM: number) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});

const ok = (points: Array<{ lat: number; lng: number }>): MatchResult => ({
  ok: true,
  matchedPoints: points.map(point => ({ ...point })),
  confidence: 0.95,
  segments: [{ points: points.map(point => ({ ...point })), confidence: 0.95 }],
  durationMs: 2,
});

describe('Route planning provider boundaries', () => {
  test('resampling preserves endpoints, order and bounded count', () => {
    const points = Array.from({ length: 1_200 }, (_, index) => p(index, Math.sin(index / 20) * 20));
    const sampled = resampleOrderedForBudget(points, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled.at(-1)).toEqual(points.at(-1));
    for (let index = 1; index < sampled.length; index += 1) {
      expect(sampled[index].lng).toBeGreaterThan(sampled[index - 1].lng);
    }
  });

  test('large strokes are bounded into overlapping chunks without silent tail truncation', () => {
    const points = Array.from({ length: 900 }, (_, index) => p(index, 0));
    const chunks = chunkOrderedTrace(points);
    expect(chunks.length).toBeLessThanOrEqual(8);
    expect(chunks.every(chunk => chunk.length <= ROUTE_MATCH_CHUNK_COORDINATES)).toBe(true);
    expect(chunks[0][0]).toEqual(points[0]);
    expect(chunks.at(-1)?.at(-1)).toEqual(points.at(-1));
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index][0]).toEqual(chunks[index - 1].at(-1));
    }
  });

  test('Draw keeps an arc through the matching request rather than endpoint routing', async () => {
    const raw = [p(0, 0), p(20, 20), p(40, 35), p(60, 20), p(80, 0)];
    const matcher = jest.fn(async segment => ok(segment.coords));
    const result = await resolveDrawPlan(raw, { matcher });
    expect(result).toEqual({ outcome: 'accepted', points: raw, callCount: 1 });
    expect(matcher.mock.calls[0][0].coords).toEqual(raw);
  });

  test('Draw rejects a provider-added far spur even when every raw vertex remains present', async () => {
    const raw = [p(0, 0), p(40, 0), p(80, 0)];
    const withFarSpur = [raw[0], raw[1], p(2_000, 2_000), raw[2]];
    expect(orderedShapeDeviationM(raw, withFarSpur)).toBeGreaterThan(90);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(withFarSpur) })).resolves.toEqual({
      outcome: 'manual-available', rawPoints: raw, reason: 'shape-deviation', callCount: 1,
    });
  });

  test('Draw does not accept a collapsed deliberate loop with matching endpoints', async () => {
    const raw = [p(0, 0), p(80, 0), p(80, 80), p(0, 80), p(0, 0)];
    await expect(resolveDrawPlan(raw, { matcher: async () => ok([raw[0], raw.at(-1)!]) }))
      .resolves.toMatchObject({ outcome: 'manual-available', reason: 'no-match' });
  });

  test('Point may use a direct provider path for the same endpoints', async () => {
    const start = p(0, 0);
    const end = p(80, 0);
    const result = await resolvePointPlan(start, end, {
      router: async () => [start, end],
    });
    expect(result).toEqual({ outcome: 'accepted', points: [start, end] });
  });

  test('multiple Map Matching submatches are never concatenated', async () => {
    const raw = [p(0, 0), p(20, 10), p(40, 0)];
    const matcher = async (): Promise<MatchResult> => ({
      ok: true,
      matchedPoints: [raw[0], raw[1]],
      confidence: 0.6,
      segments: [
        { points: [raw[0], raw[1]], confidence: 0.6 },
        { points: [raw[1], raw[2]], confidence: 0.6 },
      ],
      durationMs: 2,
    });
    await expect(resolveDrawPlan(raw, { matcher })).resolves.toEqual({
      outcome: 'manual-available', rawPoints: raw, reason: 'split-match', callCount: 1,
    });
  });

  test.each([
    ['no match', { ok: false, reason: 'no-match', durationMs: 1 } as MatchResult, 'no-match'],
    ['quota', { ok: false, reason: 'rate-limit', durationMs: 1 } as MatchResult, 'provider-unavailable'],
    ['token', { ok: false, reason: 'auth', durationMs: 1 } as MatchResult, 'provider-unavailable'],
    ['timeout', { ok: false, reason: 'timeout', durationMs: 1 } as MatchResult, 'provider-unavailable'],
  ])('%s keeps coherent Draw available as an explicit manual recovery', async (_label, response, reason) => {
    const raw = [p(0, 0), p(20, 10), p(40, 0)];
    const result = await resolveDrawPlan(raw, { matcher: async () => response });
    expect(result).toEqual({ outcome: 'manual-available', rawPoints: raw, reason, callCount: 1 });
  });

  test('provider endpoint shift is review for Point and manual recovery for Draw', async () => {
    const start = p(0, 0);
    const end = p(80, 0);
    await expect(resolvePointPlan(start, end, {
      router: async () => [p(40, 40), p(80, 0)],
    })).resolves.toMatchObject({ outcome: 'review', reason: 'endpoint-shift' });
    await expect(resolveDrawPlan([start, p(40, 20), end], {
      matcher: async () => ok([p(40, 40), end]),
    })).resolves.toMatchObject({ outcome: 'manual-available', reason: 'endpoint-shift' });
  });

  test('invalid coordinates and duplicate targets make no provider call', async () => {
    const matcher = jest.fn(async () => ok([p(0, 0), p(20, 0)]));
    await expect(resolveDrawPlan([{ lat: Infinity, lng: 0 }, p(20, 0)], { matcher }))
      .resolves.toEqual({ outcome: 'rejected', reason: 'invalid-input', callCount: 0 });
    expect(matcher).not.toHaveBeenCalled();
    const router = jest.fn(async () => [p(0, 0), p(0, 0)]);
    await expect(resolvePointPlan(p(0, 0), p(0, 0), { router }))
      .resolves.toEqual({ outcome: 'rejected', reason: 'invalid-input' });
    expect(router).not.toHaveBeenCalled();
  });

  test('connected chunk seams are normalized; broken seams preserve raw Draw', async () => {
    const raw = Array.from({ length: 120 }, (_, index) => p(index * 2, Math.sin(index / 10) * 10));
    const accepted = await resolveDrawPlan(raw, { matcher: async segment => ok(segment.coords) });
    expect(accepted.outcome).toBe('accepted');
    if (accepted.outcome === 'accepted') {
      expect(accepted.points[0]).toEqual(raw[0]);
      expect(accepted.points.at(-1)).toEqual(raw.at(-1));
    }
    let call = 0;
    const broken = await resolveDrawPlan(raw, {
      matcher: async segment => {
        call += 1;
        const points = segment.coords.map(point => ({ ...point }));
        if (call === 2) points[0] = p(1_000, 1_000);
        return ok(points);
      },
    });
    expect(broken).toMatchObject({ outcome: 'manual-available', reason: 'endpoint-shift' });
  });
});
