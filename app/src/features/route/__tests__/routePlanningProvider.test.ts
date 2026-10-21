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
    expect(result).toMatchObject({
      outcome: 'accepted', points: raw, callCount: 1,
      parts: [{ resolution: 'draw-matched', inputStartIndex: 0, inputEndIndex: 4 }],
    });
    expect(matcher.mock.calls[0][0].coords).toEqual(raw);
  });

  test('Draw rejects a provider-added far spur even when every raw vertex remains present', async () => {
    const raw = [p(0, 0), p(40, 0), p(80, 0)];
    const withFarSpur = [raw[0], raw[1], p(2_000, 2_000), raw[2]];
    expect(orderedShapeDeviationM(raw, withFarSpur)).toBeGreaterThan(90);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(withFarSpur) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'shape-deviation', callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('ordinary finger wobble accepts a genuine road correction beyond the O86 45m fidelity gate', async () => {
    const raw = [
      p(0, 0), p(30, 16), p(60, 32), p(90, 46),
      p(120, 32), p(150, 16), p(180, 0),
    ];
    const road = [p(0, 0), p(90, 0), p(180, 0)];
    expect(orderedShapeDeviationM(raw, road)).toBeGreaterThan(45);
    expect(orderedShapeDeviationM(raw, road)).toBeLessThan(90);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(road) })).resolves.toMatchObject({
      outcome: 'accepted', points: road, callCount: 1,
      parts: [{ resolution: 'draw-matched' }],
    });
  });

  test('a normal intersection alternative does not discard an otherwise faithful Mapbox match', async () => {
    const raw = [p(0, 3), p(40, -2), p(80, 4), p(120, 0)];
    const road = [p(0, 0), p(60, 0), p(120, 0)];
    const result = await resolveDrawPlan(raw, { matcher: async (): Promise<MatchResult> => ({
      ok: true,
      matchedPoints: road,
      confidence: 0.9,
      segments: [{
        points: road,
        confidence: 0.9,
        inputStartIndex: 0,
        inputEndIndex: raw.length - 1,
        alternativesCount: 2,
      }],
      durationMs: 2,
    }) });
    expect(result).toMatchObject({
      outcome: 'accepted', points: road,
      parts: [{ resolution: 'draw-matched' }],
    });
  });

  test('successful matching outside the draft seam band keeps the predeclared Draw as manual', async () => {
    const raw = [p(0, 0), p(40, 0), p(80, 0)];
    const provider = [p(22, 0), p(45, 0), p(80, 0)];
    // The provider response is usable evidence but cannot pass the ordered
    // draft's 20 m attachment boundary. Before this guard the planner called
    // it matched, then the commit rejected it as DISCONNECTED and silently
    // left the user's Route unchanged.
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(provider) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'endpoint-shift', callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('an ambiguous parallel-road detour outside the review corridor stays manual', async () => {
    const raw = [p(0, 0), p(100, 0), p(200, 0), p(300, 0), p(400, 0)];
    // Long shallow ramps deliberately avoid looking like a sharp user turn.
    // Shape/length/endpoints alone would accept this unrelated parallel road.
    const parallelRoad = [p(0, 0), p(100, 60), p(300, 60), p(400, 0)];
    const deviationM = orderedShapeDeviationM(raw, parallelRoad);
    expect(deviationM).toBeGreaterThan(45);
    expect(deviationM).toBeLessThan(90);
    const result = await resolveDrawPlan(raw, { matcher: async (): Promise<MatchResult> => ({
      ok: true,
      matchedPoints: parallelRoad,
      confidence: 0.7,
      segments: [{
        points: parallelRoad,
        confidence: 0.7,
        inputStartIndex: 0,
        inputEndIndex: raw.length - 1,
        alternativesCount: 2,
      }],
      durationMs: 2,
    }) });
    expect(result).toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'shape-deviation',
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('the wider road-snap envelope still preserves an intentional sharp turn', async () => {
    const raw = [p(0, 0), p(60, 45), p(120, 0)];
    const flattened = [p(0, 0), p(60, 0), p(120, 0)];
    expect(orderedShapeDeviationM(raw, flattened)).toBeLessThan(90);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(flattened) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'shape-deviation',
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('the wider road-snap envelope still preserves an intentional U-turn', async () => {
    const raw = [p(0, 0), p(70, 0), p(140, 0), p(70, 0), p(3, 0)];
    const collapsed = [p(0, 0), p(3, 0)];
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(collapsed) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('Draw rejects a far spur hidden between more than 100 provider vertices', async () => {
    const raw = [p(0, 0), p(80, 0)];
    const dense = Array.from({ length: 201 }, (_, index) => p(index * 0.4, 0));
    dense[1] = p(2_000, 2_000);
    expect(orderedShapeDeviationM(raw, dense)).toBeGreaterThan(90);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(dense) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'shape-deviation', callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('Draw rejects a nearby provider loop that multiplies distance without a far spatial spur', async () => {
    const raw = [p(0, 0), p(100, 0)];
    const looping = [
      raw[0], p(10, 35), p(20, -35), p(30, 35), p(40, -35),
      p(50, 35), p(60, -35), p(70, 35), p(80, -35), p(90, 35), raw[1],
    ];
    expect(orderedShapeDeviationM(raw, looping)).toBeLessThan(45);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(looping) })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'shape-deviation', callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('same line with very different provider vertex density has zero shape deviation', async () => {
    const raw = [p(0, 0), p(200, 0)];
    const dense = Array.from({ length: 501 }, (_, index) => p(index * 0.4, 0));
    expect(orderedShapeDeviationM(raw, dense)).toBeLessThan(0.01);
    await expect(resolveDrawPlan(raw, { matcher: async () => ok(dense) }))
      .resolves.toMatchObject({ outcome: 'accepted' });
  });

  test('Draw does not accept a collapsed deliberate loop with matching endpoints', async () => {
    const raw = [p(0, 0), p(80, 0), p(80, 80), p(0, 80), p(0, 0)];
    await expect(resolveDrawPlan(raw, { matcher: async () => ok([raw[0], raw.at(-1)!]) }))
      .resolves.toMatchObject({ outcome: 'accepted', fallbackReason: 'no-match', parts: [{ resolution: 'draw-manual' }] });
  });

  test('Point may use a direct provider path for the same endpoints', async () => {
    const start = p(0, 0);
    const end = p(80, 0);
    const result = await resolvePointPlan(start, end, {
      router: async () => [start, end],
    });
    expect(result).toEqual({
      outcome: 'accepted', points: [start, end],
      providerStartShiftM: 0, providerTargetShiftM: 0,
    });
  });

  test('Point preserves provider-snapped endpoint for continuity selection instead of inventing a raw-target connector', async () => {
    const start = p(0, 0);
    const rawTarget = p(80, 7);
    const snappedTarget = p(80, 0);
    const result = await resolvePointPlan(start, rawTarget, {
      router: async () => [start, p(40, 0), snappedTarget],
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      points: [start, p(40, 0), snappedTarget],
    });
    expect(result.outcome === 'accepted' && result.providerTargetShiftM).toBeCloseTo(7, 0);
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
    await expect(resolveDrawPlan(raw, { matcher })).resolves.toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: 'split-match', callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('tracepoint correspondence keeps a matched prefix and manual terminal as ordered parts', async () => {
    const raw = [p(0, 0), p(20, 2), p(40, 3), p(60, 18), p(80, 30)];
    const snappedPrefix = [p(0, 0), p(20, 0), p(40, 0)];
    const matcher = async (): Promise<MatchResult> => ({
      ok: true,
      matchedPoints: snappedPrefix,
      confidence: 0.9,
      segments: [{
        points: snappedPrefix,
        confidence: 0.9,
        inputStartIndex: 0,
        inputEndIndex: 2,
        alternativesCount: 0,
      }],
      durationMs: 2,
    });
    const result = await resolveDrawPlan(raw, { matcher });
    expect(result).toMatchObject({
      outcome: 'accepted',
      fallbackReason: 'split-match',
      parts: [
        { resolution: 'draw-matched', inputStartIndex: 0, inputEndIndex: 2 },
        { resolution: 'draw-manual', inputStartIndex: 2, inputEndIndex: 4 },
      ],
    });
    if (result.outcome !== 'accepted') return;
    expect(result.parts[0].points.at(-1)).toEqual(result.parts[1].points[0]);
    expect(result.points.at(-1)).toEqual(raw.at(-1));
  });

  test('a short unsupported lateral pen-up tail follows the stable terminal direction without becoming matched', async () => {
    const raw = [p(0, 0), p(20, 0), p(40, 0), p(60, 0), p(80, 7)];
    const snappedPrefix = raw.slice(0, 4);
    const result = await resolveDrawPlan(raw, {
      matcher: async (): Promise<MatchResult> => ({
        ok: true,
        matchedPoints: snappedPrefix,
        confidence: 0.9,
        segments: [{
          points: snappedPrefix,
          confidence: 0.9,
          inputStartIndex: 0,
          inputEndIndex: 3,
          alternativesCount: 0,
        }],
        durationMs: 2,
      }),
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      parts: [
        { resolution: 'draw-matched' },
        { resolution: 'draw-manual' },
      ],
    });
    if (result.outcome !== 'accepted') return;
    expect(result.points.at(-1)?.lng).toBeCloseTo(p(80, 0).lng, 6);
    expect(result.points.at(-1)?.lat).toBeCloseTo(p(80, 0).lat, 6);
    expect(result.points.at(-1)).not.toEqual(raw.at(-1));
  });

  test('terminal pen-up reconciliation runs after a valid alternative and unsupported tail are resolved', async () => {
    const raw = [p(0, 0), p(20, 0), p(40, 0), p(60, 0), p(70, 0), p(80, 7)];
    const result = await resolveDrawPlan(raw, {
      matcher: async (): Promise<MatchResult> => ({
        ok: true,
        matchedPoints: raw.slice(0, 4),
        confidence: 0.9,
        segments: [
          {
            points: raw.slice(0, 4),
            confidence: 0.9,
            inputStartIndex: 0,
            inputEndIndex: 3,
            alternativesCount: 0,
          },
          {
            points: raw.slice(3, 5),
            confidence: 0.4,
            inputStartIndex: 3,
            inputEndIndex: 4,
            alternativesCount: 2,
          },
        ],
        durationMs: 2,
      }),
    });
    expect(result).toMatchObject({
      outcome: 'accepted',
      parts: [
        { resolution: 'draw-matched' },
        { resolution: 'draw-manual', inputStartIndex: 4, inputEndIndex: 5 },
      ],
    });
    if (result.outcome !== 'accepted') return;
    expect(result.points.at(-1)?.lng).toBeCloseTo(p(80, 0).lng, 6);
    expect(result.points.at(-1)?.lat).toBeCloseTo(p(80, 0).lat, 6);
    expect(result.points.at(-1)).not.toEqual(raw.at(-1));
  });

  test('a deliberate unsupported terminal turn is preserved as manual geometry', async () => {
    const raw = [p(0, 0), p(20, 0), p(40, 0), p(60, 0), p(60, 9)];
    const snappedPrefix = raw.slice(0, 4);
    const result = await resolveDrawPlan(raw, {
      matcher: async (): Promise<MatchResult> => ({
        ok: true,
        matchedPoints: snappedPrefix,
        confidence: 0.9,
        segments: [{
          points: snappedPrefix,
          confidence: 0.9,
          inputStartIndex: 0,
          inputEndIndex: 3,
          alternativesCount: 0,
        }],
        durationMs: 2,
      }),
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome !== 'accepted') return;
    expect(result.points.at(-1)).toEqual(raw.at(-1));
    expect(result.parts.at(-1)?.resolution).toBe('draw-manual');
  });

  test('a spatially faithful alternative run remains matched with its reliable flanks', async () => {
    const raw = [p(0, 0), p(20, 0), p(40, 4), p(60, 4), p(80, 0), p(100, 0)];
    const matcher = async (): Promise<MatchResult> => ({
      ok: true,
      matchedPoints: raw.slice(0, 2),
      confidence: 0.9,
      segments: [
        { points: raw.slice(0, 2), confidence: 0.9, inputStartIndex: 0, inputEndIndex: 1, alternativesCount: 0 },
        { points: raw.slice(1, 5), confidence: 0.9, inputStartIndex: 1, inputEndIndex: 4, alternativesCount: 2 },
        { points: raw.slice(4, 6), confidence: 0.9, inputStartIndex: 4, inputEndIndex: 5, alternativesCount: 0 },
      ],
      durationMs: 2,
    });
    const result = await resolveDrawPlan(raw, { matcher });
    expect(result).toMatchObject({
      outcome: 'accepted',
      parts: [{ resolution: 'draw-matched', inputStartIndex: 0, inputEndIndex: 5 }],
    });
  });

  test.each([
    ['no match', { ok: false, reason: 'no-match', durationMs: 1 } as MatchResult, 'no-match'],
    ['quota', { ok: false, reason: 'rate-limit', durationMs: 1 } as MatchResult, 'provider-unavailable'],
    ['token', { ok: false, reason: 'auth', durationMs: 1 } as MatchResult, 'provider-unavailable'],
    ['timeout', { ok: false, reason: 'timeout', durationMs: 1 } as MatchResult, 'provider-unavailable'],
  ])('%s keeps a coherent Draw as an immediate manual part', async (_label, response, reason) => {
    const raw = [p(0, 0), p(20, 10), p(40, 0)];
    const result = await resolveDrawPlan(raw, { matcher: async () => response });
    expect(result).toMatchObject({
      outcome: 'accepted', points: raw, fallbackReason: reason, callCount: 1,
      parts: [{ resolution: 'draw-manual' }],
    });
  });

  test('provider endpoint shift is review for Point and manual recovery for Draw', async () => {
    const start = p(0, 0);
    const end = p(80, 0);
    await expect(resolvePointPlan(start, end, {
      router: async () => [p(40, 40), p(80, 0)],
    })).resolves.toMatchObject({ outcome: 'review', reason: 'endpoint-shift' });
    await expect(resolveDrawPlan([start, p(40, 20), end], {
      matcher: async () => ok([p(40, 40), end]),
    })).resolves.toMatchObject({ outcome: 'accepted', fallbackReason: 'endpoint-shift', parts: [{ resolution: 'draw-manual' }] });
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
    expect(broken).toMatchObject({ outcome: 'accepted', fallbackReason: 'endpoint-shift' });
  });
});
