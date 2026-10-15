import { appendOrderedSegment, createEmptyOrderedDraft, orderedDraftDistanceM, orderedDraftPoints } from '../orderedRouteDraft';
import { knownMappedRetrace, selectPointRouteCandidate } from '../pointRouteIntent';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM = 0) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});
const empty = () => createEmptyOrderedDraft({ draftId: 'point-retrace', ownerId: 'owner-a' });

describe('Point ordered retracing', () => {
  test('A → B → A preserves the repeated return traversal and distance', () => {
    const outbound = appendOrderedSegment(empty(), [p(0), p(50), p(100)], 'point');
    expect(outbound.ok).toBe(true);
    if (!outbound.ok) return;
    const selected = selectPointRouteCandidate({
      draft: outbound.draft,
      target: p(0),
      provider: [p(100), p(110, 20), p(0)],
    });
    expect(selected.source).toBe('known-mapped-retrace');
    const returned = appendOrderedSegment(outbound.draft, selected.points, 'point');
    expect(returned.ok).toBe(true);
    if (!returned.ok) return;
    expect(orderedDraftPoints(returned.draft)).toEqual([p(0), p(50), p(100), p(50), p(0)]);
    expect(orderedDraftDistanceM(returned.draft)).toBeCloseTo(200, -1);
  });

  test('A → B → C uses the latest segment-interior occurrence when C is between A and B', () => {
    const outbound = appendOrderedSegment(empty(), [p(0), p(50), p(100)], 'point');
    expect(outbound.ok).toBe(true);
    if (!outbound.ok) return;
    const known = knownMappedRetrace(outbound.draft, p(60));
    expect(known?.points[0]).toEqual(p(100));
    expect(known?.points.at(-1)).toEqual(p(60));
    expect(known?.occurrence?.fraction).toBeCloseTo(0.2, 2);
  });

  test('A → B → A → B keeps co-located ordered occurrences distinct', () => {
    const first = appendOrderedSegment(empty(), [p(0), p(50), p(100)], 'point');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(100), p(50), p(0)], 'point');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const third = appendOrderedSegment(second.draft, knownMappedRetrace(second.draft, p(100))!.points, 'point');
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(orderedDraftPoints(third.draft)).toEqual([p(0), p(50), p(100), p(50), p(0), p(50), p(100)]);
    expect(orderedDraftDistanceM(third.draft)).toBeCloseTo(300, -1);
  });

  test('short retracing inside seam cleanup radius remains a traversal, not a fold deletion', () => {
    const first = appendOrderedSegment(empty(), [p(0), p(8)], 'point');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(8), p(4), p(0)], 'point');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(orderedDraftPoints(second.draft)).toEqual([p(0), p(8), p(0)]);
    expect(orderedDraftDistanceM(second.draft)).toBeCloseTo(16, 0);
  });

  test('curved mapped roads retrace their actual ordered shape instead of a straight chord', () => {
    const curve = [p(0), p(25, 14), p(50, 24), p(75, 14), p(100)];
    const outbound = appendOrderedSegment(empty(), curve, 'point');
    expect(outbound.ok).toBe(true);
    if (!outbound.ok) return;
    const selected = selectPointRouteCandidate({
      draft: outbound.draft,
      target: p(0),
      provider: [p(100), p(50, -35), p(0)],
    });
    expect(selected.source).toBe('known-mapped-retrace');
    expect(selected.points).toEqual([...curve].reverse());
  });

  test('a genuine loop remains ordered and the latest target occurrence wins', () => {
    const loop = [p(0), p(40, 30), p(80), p(40, -30), p(0), p(100)];
    const outbound = appendOrderedSegment(empty(), loop, 'point');
    expect(outbound.ok).toBe(true);
    if (!outbound.ok) return;
    const known = knownMappedRetrace(outbound.draft, p(0));
    expect(known?.occurrence?.segmentIndex).toBe(3);
    expect(known?.points).toEqual([p(100), p(0)]);
  });
});
