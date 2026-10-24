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

  test('A to B to A keeps one continuous canonical path through the real turn without changing geometry', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(50), p(100), p(50), p(0)] });
    const before = canonicalRouteGeometryFingerprint(canonical);
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.baseLines).toHaveLength(1);
    expect(display.baseLines[0].coordinates).toEqual([p(0), p(50), p(100), p(50), p(0)]);
    expect(display.repeatLanes).toHaveLength(2);
    expect(display.repeatLanes.every(lane => lane.offsetPx > 0)).toBe(true);
    expect(display.repeatLanes.every(lane => lane.multiplicity === 2)).toBe(true);
    expect(display.repeatLanes.flatMap(lane => lane.coordinates)).toEqual(expect.arrayContaining([p(100)]));
    expect(display.repeatLabels).toEqual([]);
    // Opposing traversals are separate screen-offset lines. Their round caps
    // meet at the genuine turn without a metre-scaled loop that distorts as
    // the camera zoom changes.
    expect(display.turnConnectors).toHaveLength(1);
    expect(display.turnConnectors[0].coordinate).toEqual(p(100));
    expect(display.turnConnectors[0].occurrenceIds).toEqual(expect.arrayContaining([
      'legacy-route:1',
      'legacy-route:2',
    ]));
    expect(display.turnConnectors[0]).not.toHaveProperty('coordinates');
    expect(canonicalRouteGeometryFingerprint(canonical)).toBe(before);
  });

  test('R06 a dense slightly wobbly one-way stroke is not a repeated traversal', () => {
    const canonical = canonicalRouteGeometry({
      points: [
        p(0, 0), p(20, 1.2), p(8, -0.8), p(28, 1), p(16, -1.1),
        p(36, 0.7), p(24, -0.9), p(44, 0.8), p(32, -0.6), p(52, 0),
      ],
    });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toEqual([]);
    expect(display.repeatLabels).toEqual([]);
  });

  test('five passes stay a continuous serpentine and use a traversal count without arrows', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(100), p(0), p(100), p(0), p(100)] });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toHaveLength(5);
    expect(display.repeatLanes.every(lane => lane.multiplicity === 5)).toBe(true);
    expect(new Set(display.repeatLanes.map(lane => lane.direction))).toEqual(new Set(['forward', 'backward']));
    expect(display.repeatLabels.map(label => label.text)).toEqual(['5 passes']);
    expect(display.repeatLabels[0].text).not.toMatch(/[←→]/);
  });

  test('three passes retain truthful turnback coordinates at both corridor ends', () => {
    const canonical = canonicalRouteGeometry({
      points: [p(0), p(45), p(90), p(45), p(0), p(45), p(90)],
    });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.turnConnectors.map(connector => connector.coordinate)).toEqual([
      p(90),
      p(0),
    ]);
  });

  test('nearby parallel geometry is not mistaken for the same traversal', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0, 0), p(100, 0), p(100, 8), p(0, 8)] });
    expect(buildRouteDisplayGeometry(canonical).repeatLanes).toEqual([]);
  });

  test('a crossing-only figure eight does not manufacture passes or parallel lanes', () => {
    const canonical = canonicalRouteGeometry({
      points: [
        p(-60, 0), p(-30, 30), p(0, 0), p(-30, -30), p(-60, 0),
        p(0, 0), p(30, 30), p(60, 0), p(30, -30), p(0, 0),
      ],
    });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toEqual([]);
    expect(display.repeatLabels).toEqual([]);
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

  test('same-direction repeats are recognized without inventing an opposite direction arrow', () => {
    const canonical = canonicalRouteGeometry({ points: [p(0), p(100), p(0, 20), p(100, 20), p(0), p(100)] });
    const display = buildRouteDisplayGeometry(canonical);
    const repeated = display.repeatLanes.filter(lane => lane.multiplicity > 1);
    expect(repeated.length).toBeGreaterThan(0);
    expect(repeated.every(lane => lane.offsetPx > 0)).toBe(true);
    expect(display.repeatLabels.every(label => !/[←→]/.test(label.text))).toBe(true);
  });

  test('different sampling densities on the return share the same display corridor', () => {
    const canonical = canonicalRouteGeometry({
      points: [p(0), p(100), p(75), p(50), p(25), p(0)],
    });
    const display = buildRouteDisplayGeometry(canonical);
    expect(display.repeatLanes).toHaveLength(2);
    expect(display.repeatLanes.every(lane => lane.multiplicity === 2)).toBe(true);
    expect(display.baseLines).toHaveLength(1);
    expect(display.baseLines[0].coordinates).toEqual([p(0), p(100), p(75), p(50), p(25), p(0)]);
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
