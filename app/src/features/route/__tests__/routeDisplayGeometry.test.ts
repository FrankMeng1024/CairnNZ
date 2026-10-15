import { canonicalRouteGeometry, canonicalRouteGeometryFingerprint } from '../canonicalRouteGeometry';
import { buildRouteDisplayGeometry } from '../routeDisplayGeometry';
import { appendOrderedSegment, createEmptyOrderedDraft } from '../orderedRouteDraft';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM = 0) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});

describe('display-only repeated traversal projection', () => {
  test('merges connected tool parts so internal joins do not receive line caps', () => {
    const empty = createEmptyOrderedDraft({ draftId: 'display', ownerId: 'owner' });
    const first = appendOrderedSegment(empty, [p(0), p(50), p(100)], 'draw-manual');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(100), p(150), p(200)], 'point');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const canonical = canonicalRouteGeometry({ orderedDraft: second.draft });
    const before = canonicalRouteGeometryFingerprint(canonical);
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.baseLines).toHaveLength(1);
    expect(display.baseLines[0].coordinates).toHaveLength(5);
    expect(canonicalRouteGeometryFingerprint(canonical)).toBe(before);
  });

  test('A to B to A uses two stable opposite lanes without changing canonical geometry', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(50), p(100), p(50), p(0)] });
    const before = canonicalRouteGeometryFingerprint(canonical);
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes.map(lane => lane.offsetPx).sort()).toEqual([-3, 3]);
    expect(display.repeatLanes.every(lane => lane.multiplicity === 1)).toBe(true);
    expect(canonicalRouteGeometryFingerprint(canonical)).toBe(before);
  });

  test('five passes cap display lanes at two and retain directional multiplicity', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(100), p(0), p(100), p(0), p(100)] });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toHaveLength(2);
    expect(display.repeatLanes.map(lane => lane.multiplicity).sort()).toEqual([2, 3]);
    expect(display.repeatLabels.map(label => label.text).sort()).toEqual(['← ×2', '→ ×3']);
  });

  test('nearby parallel geometry is not mistaken for the same traversal', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0, 0), p(100, 0), p(100, 8), p(0, 8)] });
    expect(buildRouteDisplayGeometry(canonical).repeatLanes).toEqual([]);
  });

  test('curved and partial returns preserve ordered occurrence ids', () => {
    const canonical = canonicalRouteGeometry({
      points: [p(0), p(30, 18), p(70, 18), p(100), p(70, 18), p(30, 18)],
    });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toHaveLength(2);
    expect(display.repeatLanes.flatMap(lane => lane.occurrenceIds)).toHaveLength(4);
    expect(display.baseLines.flatMap(line => line.coordinates)).toContainEqual(p(0));
    expect(display.repeatLanes.flatMap(line => line.coordinates)).toContainEqual(p(100));
  });

  test('same-direction repeats use a count without inventing an opposite lane', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(100), p(0, 20), p(100, 20), p(0), p(100)] });
    const display = buildRouteDisplayGeometry(canonical);
    const repeated = display.repeatLanes.filter(lane => lane.multiplicity > 1);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]).toMatchObject({ direction: 'forward', multiplicity: 2, offsetPx: 0 });
    expect(display.repeatLabels.find(label => label.id.includes(repeated[0].id))?.text).toBe('→ ×2');
  });

  test('an explicit gap remains a boundary even when its endpoints coincide', () => {
    const canonical = canonicalRouteGeometry({
      orderedDraft: {
        ...createEmptyOrderedDraft({ draftId: 'gap-display', ownerId: 'owner' }),
        parts: [
          { id: 'before', resolution: 'draw-manual', points: [p(0), p(100)] },
          { id: 'after', resolution: 'draw-manual', points: [p(100), p(200)] },
        ],
        gaps: [{ id: 'real-gap', afterPartId: 'before', reason: 'activity-gap' }],
      },
    });
    expect(canonical.gaps[0].afterPartId).toBe('before');
    expect(buildRouteDisplayGeometry(canonical).baseLines).toHaveLength(2);
  });

  test('ten successive connected Draw/Point strokes render as one round-joined centerline', () => {
    let draft = createEmptyOrderedDraft({ draftId: 'ten-strokes', ownerId: 'owner' });
    for (let index = 0; index < 10; index += 1) {
      const result = appendOrderedSegment(
        draft,
        [p(index * 20, Math.sin(index) * 4), p((index + 1) * 20, Math.sin(index + 1) * 4)],
        index % 2 ? 'point' : 'draw-manual',
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      draft = result.draft;
    }
    const canonical = canonicalRouteGeometry({ orderedDraft: draft });
    const before = canonicalRouteGeometryFingerprint(canonical);
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.baseLines).toHaveLength(1);
    expect(display.baseLines[0].occurrenceIds).toHaveLength(10);
    expect(canonicalRouteGeometryFingerprint(canonical)).toBe(before);
  });
});
