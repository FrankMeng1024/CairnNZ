import { appendOrderedSegment, createEmptyOrderedDraft, orderedDraftDistanceM, orderedDraftPoints } from '../orderedRouteDraft';
import { knownMappedRetrace, pointSnapToleranceM, selectPointRouteCandidate } from '../pointRouteIntent';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM = 0) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});
const empty = () => createEmptyOrderedDraft({ draftId: 'point-continuity', ownerId: 'owner-a' });

function route(points: ReturnType<typeof p>[]) {
  const result = appendOrderedSegment(empty(), points, 'point');
  if (!result.ok) throw new Error(result.code);
  return result.draft;
}

describe('Point continuity-aware walking candidates', () => {
  test('screen tolerance is scale-aware and geographically bounded', () => {
    expect(pointSnapToleranceM(origin.lat, 18)).toBeGreaterThan(5);
    expect(pointSnapToleranceM(origin.lat, 18)).toBeLessThan(12);
    expect(pointSnapToleranceM(origin.lat, 10)).toBe(18);
    expect(pointSnapToleranceM(origin.lat, 22)).toBe(3);
  });

  test.each([7, -7])('small %sm side error drops a transverse terminal spur', northM => {
    const draft = route([p(0), p(50), p(100)]);
    const target = p(170, northM);
    const selected = selectPointRouteCandidate({
      draft,
      target,
      provider: [p(100), p(130), p(170), target],
      zoom: 17,
    });
    expect(selected.accepted).toBe(true);
    expect(selected.source).toBe('continuity-snap');
    expect(selected.reason).toBe('continuity-terminal-spur');
    expect(selected.rawTarget).toEqual(target);
    expect(selected.effectiveTarget).toEqual(p(170));
    expect(selected.points.at(-1)).toEqual(selected.effectiveTarget);
    expect(selected.terminalSpurLengthM).toBeCloseTo(7, 0);
  });

  test('the next turn after a corrected side error does not contain a cross-and-return spike', () => {
    const draft = route([p(0), p(50), p(100)]);
    const first = selectPointRouteCandidate({
      draft,
      target: p(170, 7),
      provider: [p(100), p(135), p(170), p(170, 7)],
      zoom: 17,
    });
    expect(first.source).toBe('continuity-snap');
    const appended = appendOrderedSegment(draft, first.points, 'point');
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const second = selectPointRouteCandidate({
      draft: appended.draft,
      target: p(220, 45),
      provider: [p(170), p(195, 10), p(220, 45)],
      zoom: 17,
    });
    expect(second.source).toBe('provider');
    expect(second.points[0]).toEqual(p(170));
    expect(orderedDraftPoints(appended.draft).at(-1)).toEqual(p(170));
  });

  test('a clear opposite-side selection outside tolerance remains the provider target', () => {
    const draft = route([p(0), p(50), p(100)]);
    const target = p(170, 28);
    const selected = selectPointRouteCandidate({
      draft,
      target,
      provider: [p(100), p(140), p(170), target],
      zoom: 17,
    });
    expect(selected.source).toBe('provider');
    expect(selected.effectiveTarget).toEqual(target);
  });

  test('single-centerline provider snap stays on the known line without a cosmetic connector', () => {
    const draft = route([p(0), p(100)]);
    const raw = p(180, 7);
    const selected = selectPointRouteCandidate({
      draft,
      target: raw,
      provider: [p(100), p(140), p(180)],
      zoom: 17,
    });
    expect(selected.source).toBe('provider');
    expect(selected.rawTarget).toEqual(raw);
    expect(selected.providerTarget).toEqual(p(180));
    expect(selected.effectiveTarget).toEqual(p(180));
    expect(selected.points).not.toContainEqual(raw);
  });

  test('a remote provider endpoint does not silently count as the selected neighborhood', () => {
    const draft = route([p(0), p(100)]);
    const selected = selectPointRouteCandidate({
      draft,
      target: p(250),
      provider: [p(100), p(180, 80), p(220, 80)],
      zoom: 16,
    });
    expect(selected.accepted).toBe(false);
    expect(selected.reason).toBe('provider-moved-target');
    expect(selected.effectiveTarget).toBeNull();
  });

  test('a nearby earlier coordinate does not automatically reverse a remote old route', () => {
    const draft = route([p(0), p(500), p(500, 500), p(0, 500), p(0, 10)]);
    const target = p(5, 0);
    const provider = [p(0, 10), p(40, 40), p(5, 0)];
    const selected = selectPointRouteCandidate({ draft, target, provider, zoom: 17 });
    expect(selected.accepted).toBe(true);
    expect(selected.source).toBe('provider');
    expect(selected.points).toEqual(provider);
  });

  test('A2 rejects an enormous provider detour for a nearby closure without retracing the Activity', () => {
    const draft = route([p(0), p(50), p(100)]);
    const selected = selectPointRouteCandidate({
      draft,
      target: p(5),
      provider: [p(100), p(100, 600), p(-100, 600), p(-100), p(5)],
      zoom: 17,
    });
    expect(selected.accepted).toBe(false);
    expect(selected.reason).toBe('provider-absurd-detour');
    expect(selected.points).toEqual([]);
    expect(selected.knownRetraceLengthM).toBeGreaterThan(90);
  });

  test('A → B → A reuses a provider-confirmed known traversal and preserves distance', () => {
    const outbound = route([p(0), p(50), p(100)]);
    const selected = selectPointRouteCandidate({
      draft: outbound,
      target: p(0),
      provider: [p(100), p(50), p(0)],
      zoom: 17,
    });
    expect(selected.source).toBe('known-mapped-retrace');
    const returned = appendOrderedSegment(outbound, selected.points, 'point');
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(orderedDraftPoints(returned.draft)).toEqual([p(0), p(50), p(100), p(50), p(0)]);
    expect(orderedDraftDistanceM(returned.draft)).toBeCloseTo(200, -1);
  });

  test('segment-interior retrace occurrences stay ordered and distinct', () => {
    const draft = route([p(0), p(50), p(100), p(50), p(0), p(100)]);
    const known = knownMappedRetrace(draft, p(50));
    expect(known?.occurrence?.segmentIndex).toBe(4);
    expect(known?.points[0]).toEqual(p(100));
    expect(known?.points.at(-1)).toEqual(p(50));
  });

  test('intentional short U-turn remains ordered inside the seam cleanup radius', () => {
    const first = route([p(0), p(8)]);
    const second = appendOrderedSegment(first, [p(8), p(4), p(0)], 'point');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(orderedDraftPoints(second.draft)).toEqual([p(0), p(8), p(4), p(0)]);
    expect(orderedDraftDistanceM(second.draft)).toBeCloseTo(16, 0);
  });
});
