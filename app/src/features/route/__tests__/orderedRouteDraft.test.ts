import {
  appendOrderedSegment,
  beginRouteOperation,
  bridgeOrderedGap,
  commitRouteHistory,
  createEmptyOrderedDraft,
  createImportedOrderedDraft,
  createLegacyOrderedDraft,
  keepOnlyOrderedPart,
  normalizeOrderedPoints,
  orderedDraftCanUseOrShare,
  orderedDraftDistanceM,
  orderedDraftPoints,
  orderedPositionAtDistanceFraction,
  replaceOrderedInterval,
  routePointDistanceM,
  routeOperationIsCurrent,
  setOrderedDraftStart,
  trimOrderedDraft,
  undoRouteHistory,
  validateOrderedDraft,
  type OrderedRouteDraft,
  type RouteDraftHistory,
} from '../orderedRouteDraft';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM: number) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});

function empty(): OrderedRouteDraft {
  return createEmptyOrderedDraft({ draftId: 'draft-a', ownerId: 'owner-a' });
}

describe('ordered Route draft topology', () => {
  test.each([
    ['arc', [p(0, 0), p(15, 12), p(30, 18), p(45, 12), p(60, 0)]],
    ['z', [p(0, 0), p(30, 0), p(10, 20), p(40, 20), p(20, 40)]],
    ['switchback', [p(0, 0), p(30, 0), p(10, 20), p(30, 40), p(10, 60)]],
    ['u-turn', [p(0, 0), p(40, 0), p(40, 10), p(5, 10)]],
    ['out-and-back', [p(0, 0), p(40, 0), p(0, 0)]],
    ['closed loop', [p(0, 0), p(30, 0), p(30, 30), p(0, 30), p(0, 0)]],
    ['figure-eight', [p(0, 0), p(20, 20), p(0, 40), p(-20, 20), p(0, 0), p(20, -20), p(0, -40), p(-20, -20), p(0, 0)]],
    ['lollipop', [p(0, 0), p(30, 0), p(45, 15), p(30, 30), p(15, 15), p(30, 0), p(0, 0)]],
  ])('retains ordered %s geometry including revisits', (_label, points) => {
    const result = appendOrderedSegment(empty(), points, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts[0].points).toEqual(points);
    expect(orderedDraftCanUseOrShare(result.draft)).toBe(true);
  });

  test('only consecutive duplicates are removed', () => {
    const a = p(0, 0);
    const b = p(20, 0);
    expect(normalizeOrderedPoints([a, a, b, a])).toEqual([a, b, a]);
  });

  test('legacy continuous Routes retain order without inventing a drawing tool', () => {
    const points = [p(0, 0), p(20, 0), p(0, 0)];
    const draft = createLegacyOrderedDraft({ draftId: 'legacy-a', ownerId: 'owner-a', points });
    expect(draft.parts[0]).toMatchObject({ resolution: 'legacy', points });
    expect(orderedDraftCanUseOrShare(draft)).toBe(true);
  });

  test('empty plan establishes start explicitly and appends at its terminal', () => {
    const started = setOrderedDraftStart(empty(), p(100, 100));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const appended = appendOrderedSegment(started.draft, [p(101, 100), p(140, 100)], 'point');
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.draft.parts[0].points[0]).toEqual(p(100, 100));
    expect(appended.draft.startPoint).toBeUndefined();
  });

  test('removes a bounded snapped fold from an otherwise straight continuation', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'draw-manual');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const extended = appendOrderedSegment(base.draft, [p(80, 0), p(79, 0.1), p(90, 0), p(120, 0)], 'draw-manual');
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    expect(extended.draft.parts[1].points).toEqual([p(80, 0), p(90, 0), p(120, 0)]);
  });

  test('preserves intentional sharp turns and U-turns outside duplicate seam ink', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'draw-manual');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const corner = appendOrderedSegment(base.draft, [p(80, 0), p(80, 8), p(70, 18)], 'draw-manual');
    expect(corner.ok).toBe(true);
    if (!corner.ok) return;
    expect(corner.draft.parts[1].points).toEqual([p(80, 0), p(80, 8), p(70, 18)]);

    const uTurn = appendOrderedSegment(base.draft, [p(80, 0), p(75, 0), p(55, 0)], 'draw-manual');
    expect(uTurn.ok).toBe(true);
    if (!uTurn.ok) return;
    expect(uTurn.draft.parts[1].points).toEqual([p(80, 0), p(75, 0), p(55, 0)]);
  });

  test('disconnected append rejects only the edit and preserves draft identity', () => {
    const first = appendOrderedSegment(empty(), [p(0, 0), p(40, 0)], 'point');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const before = first.draft;
    const rejected = appendOrderedSegment(before, [p(200, 0), p(240, 0)], 'draw-manual');
    expect(rejected).toEqual({ ok: false, code: 'DISCONNECTED', draft: before });
  });

  test('zero-length and malformed inputs do not create a route', () => {
    expect(appendOrderedSegment(empty(), [p(0, 0), p(0, 0)], 'point')).toMatchObject({
      ok: false,
      code: 'ZERO_LENGTH',
    });
    expect(appendOrderedSegment(empty(), [{ lat: NaN, lng: 0 }, p(1, 1)], 'point')).toMatchObject({
      ok: false,
      code: 'INVALID_COORDINATE',
    });
  });
});

describe('ordered interval replacement', () => {
  test.each(['point', 'draw-matched', 'draw-manual'] as const)(
    '%s replacement preserves exact untouched prefix and suffix',
    resolution => {
      const base = appendOrderedSegment(empty(), [p(0, 0), p(10, 0), p(20, 0), p(30, 0), p(40, 0)], 'draw-manual');
      expect(base.ok).toBe(true);
      if (!base.ok) return;
      const part = base.draft.parts[0];
      const result = replaceOrderedInterval(
        base.draft,
        { partId: part.id, pointIndex: 1 },
        { partId: part.id, pointIndex: 3 },
        [p(10.2, 0), p(20, 15), p(29.8, 0)],
        resolution,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(orderedDraftPoints(result.draft)).toEqual([
        p(0, 0), p(10, 0), p(20, 15), p(30, 0), p(40, 0),
      ]);
      expect(result.draft.parts.map(part => part.resolution)).toEqual([
        'draw-manual', resolution, 'draw-manual',
      ]);
      expect(result.draft.parts[0].points).toEqual([p(0, 0), p(10, 0)]);
      expect(result.draft.parts[2].points).toEqual([p(30, 0), p(40, 0)]);
    },
  );

  test('ordered positions distinguish repeated-coordinate occurrences', () => {
    const points = [p(0, 0), p(20, 0), p(0, 0), p(-20, 0), p(0, 0)];
    const base = appendOrderedSegment(empty(), points, 'draw-manual');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const part = base.draft.parts[0];
    const result = replaceOrderedInterval(
      base.draft,
      { partId: part.id, pointIndex: 2 },
      { partId: part.id, pointIndex: 4 },
      [p(0, 0), p(-10, -10), p(0, 0)],
      'draw-manual',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderedDraftPoints(result.draft).slice(0, 2)).toEqual(points.slice(0, 2));
    expect(orderedDraftPoints(result.draft)).toHaveLength(5);
  });

  test('material endpoint mismatch rejects without synthetic connector', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(20, 0), p(40, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const part = base.draft.parts[0];
    const result = replaceOrderedInterval(
      base.draft,
      { partId: part.id, pointIndex: 0 },
      { partId: part.id, pointIndex: 2 },
      [p(100, 100), p(120, 100)],
      'point',
    );
    expect(result).toEqual({ ok: false, code: 'DISCONNECTED', draft: base.draft });
  });

  test('R2 Point then Draw replacements may repeatedly span connected provenance boundaries with exact Undo', () => {
    const first = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'point');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(80, 0), p(120, 0), p(160, 0)], 'draw-manual');
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const pointReplacement = replaceOrderedInterval(
      second.draft,
      { partId: second.draft.parts[0].id, pointIndex: 1 },
      { partId: second.draft.parts[1].id, pointIndex: 1 },
      [p(40, 0), p(80, 20), p(120, 0)],
      'point',
    );
    expect(pointReplacement.ok).toBe(true);
    if (!pointReplacement.ok) return;
    expect(pointReplacement.draft.parts.map(part => part.resolution)).toEqual(['point', 'point', 'draw-manual']);

    const history0: RouteDraftHistory = { present: second.draft, past: [] };
    const history1 = commitRouteHistory(history0, pointReplacement, 'replace-point');
    const drawReplacement = replaceOrderedInterval(
      history1.present,
      { partId: history1.present.parts[0].id, pointIndex: history1.present.parts[0].points.length - 1 },
      { partId: history1.present.parts.at(-1)!.id, pointIndex: 0 },
      [p(40, 0), p(80, -25), p(120, 0)],
      'draw-manual',
    );
    expect(drawReplacement.ok).toBe(true);
    if (!drawReplacement.ok) return;
    const history2 = commitRouteHistory(history1, drawReplacement, 'replace-draw');
    expect(history2.present.parts.map(part => part.resolution)).toEqual(['point', 'draw-manual', 'draw-manual']);
    expect(undoRouteHistory(history2).present).toEqual(history1.present);
    expect(undoRouteHistory(undoRouteHistory(history2)).present).toEqual(history0.present);
  });
});

describe('multipart Activity repair', () => {
  function imported() {
    return createImportedOrderedDraft({
      draftId: 'activity-draft',
      ownerId: 'owner-a',
      segments: [
        [p(0, 0), p(30, 0)],
        [p(60, 0), p(90, 0)],
        [p(120, 0), p(150, 0)],
      ],
    });
  }

  test('preserves temporal segments and excludes unknown gap distance', () => {
    const draft = imported();
    expect(draft.parts).toHaveLength(3);
    expect(draft.gaps).toHaveLength(2);
    expect(orderedDraftDistanceM(draft)).toBeCloseTo(90, -1);
    expect(orderedDraftCanUseOrShare(draft)).toBe(false);
  });

  test('each valid adjacent bridge reduces gaps by exactly one', () => {
    const draft = imported();
    const first = bridgeOrderedGap(
      draft,
      draft.gaps[0].id,
      [p(30, 0), p(45, 10), p(60, 0)],
      'point',
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.draft.gaps).toHaveLength(1);
    expect(first.draft.parts).toHaveLength(4);
    const secondGap = first.draft.gaps[0];
    const second = bridgeOrderedGap(
      first.draft,
      secondGap.id,
      [p(90, 0), p(105, -10), p(120, 0)],
      'draw-manual',
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.draft.gaps).toHaveLength(0);
    expect(orderedDraftCanUseOrShare(second.draft)).toBe(true);
  });

  test('failed bridge commits nothing and keeping one segment is explicit', () => {
    const draft = imported();
    const failed = bridgeOrderedGap(draft, draft.gaps[0].id, [p(500, 0), p(520, 0)], 'point');
    expect(failed).toEqual({ ok: false, code: 'DISCONNECTED', draft });
    const kept = keepOnlyOrderedPart(draft, draft.parts[1].id);
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.draft.parts.map(part => part.id)).toEqual([draft.parts[1].id]);
    expect(kept.draft.gaps).toEqual([]);
  });

  test('trim preserves remaining order and internal gaps; empty result is rejected', () => {
    const draft = imported();
    const trimmed = trimOrderedDraft(
      draft,
      { partId: draft.parts[0].id, pointIndex: 1 },
      { partId: draft.parts[2].id, pointIndex: 0 },
    );
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.draft.parts.map(part => part.id)).toEqual([draft.parts[1].id]);
    expect(trimmed.draft.gaps).toEqual([]);
    const emptyTrim = trimOrderedDraft(
      draft,
      { partId: draft.parts[0].id, pointIndex: 1 },
      { partId: draft.parts[0].id, pointIndex: 1 },
    );
    expect(emptyTrim).toMatchObject({ ok: false, code: 'EMPTY_ROUTE' });
  });

  test('R1 trim applies both anchors to the original same part before mutating it', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'trim-same-part',
      ownerId: 'owner-a',
      segments: [[p(0, 0), p(100, 0), p(200, 0), p(300, 0), p(400, 0)]],
    });
    const part = draft.parts[0];
    const trimmed = trimOrderedDraft(
      draft,
      { partId: part.id, pointIndex: 1 },
      { partId: part.id, pointIndex: 3 },
    );
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.draft.parts).toHaveLength(1);
    expect(trimmed.draft.parts[0].points).toEqual([p(100, 0), p(200, 0), p(300, 0)]);
  });

  test('R1 trim rejects reversed same-part anchors without changing the draft', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'trim-reversed', ownerId: 'owner-a',
      segments: [[p(0, 0), p(100, 0), p(200, 0), p(300, 0)]],
    });
    const part = draft.parts[0];
    expect(trimOrderedDraft(
      draft,
      { partId: part.id, pointIndex: 3 },
      { partId: part.id, pointIndex: 1 },
    )).toEqual({ ok: false, code: 'INVALID_INTERVAL', draft });
  });

  test('R1 cross-part trim preserves only internal gaps and exact remaining endpoints', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'trim-cross-part', ownerId: 'owner-a',
      segments: [
        [p(0, 0), p(20, 0), p(40, 0)],
        [p(80, 0), p(100, 0), p(120, 0)],
        [p(160, 0), p(180, 0), p(200, 0)],
      ],
    });
    const trimmed = trimOrderedDraft(
      draft,
      { partId: draft.parts[0].id, pointIndex: 1 },
      { partId: draft.parts[2].id, pointIndex: 1 },
    );
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.draft.parts.map(part => part.points)).toEqual([
      [p(20, 0), p(40, 0)],
      draft.parts[1].points,
      [p(160, 0), p(180, 0)],
    ]);
    expect(trimmed.draft.gaps.map(gap => gap.afterPartId)).toEqual([
      draft.parts[0].id,
      draft.parts[1].id,
    ]);
  });

  test('R1 Trim UI fractions follow arc length rather than point count', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'trim-distance', ownerId: 'owner-a',
      segments: [[p(0, 0), p(10, 0), p(110, 0), p(210, 0)]],
    });
    const halfway = orderedPositionAtDistanceFraction(draft, 0.5);
    expect(halfway).toMatchObject({ partId: draft.parts[0].id, pointIndex: 1 });
    expect(halfway?.fraction).toBeCloseTo(0.95, 6);
    const end = orderedPositionAtDistanceFraction(draft, 0.75);
    expect(end).not.toBeNull();
    const trimmed = trimOrderedDraft(draft, halfway!, end!);
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(routePointDistanceM(trimmed.draft.parts[0].points[0], p(105, 0))).toBeLessThan(0.5);
    expect(routePointDistanceM(trimmed.draft.parts[0].points.at(-1)!, p(157.5, 0))).toBeLessThan(0.5);
  });
});

describe('transaction fencing and exact Undo', () => {
  test('late replies fail after edit, Undo, account switch or draft switch', () => {
    const draft = empty();
    const token = beginRouteOperation(draft, 'owner-a', 'point', 'op-1');
    expect(routeOperationIsCurrent(draft, 'owner-a', token, 'op-1')).toBe(true);
    const edit = appendOrderedSegment(draft, [p(0, 0), p(20, 0)], 'point');
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(routeOperationIsCurrent(edit.draft, 'owner-a', token, 'op-1')).toBe(false);
    expect(routeOperationIsCurrent(draft, 'owner-b', token, 'op-1')).toBe(false);
    expect(routeOperationIsCurrent({ ...draft, draftId: 'other' }, 'owner-a', token, 'op-1')).toBe(false);
    expect(routeOperationIsCurrent(draft, 'owner-a', token, null)).toBe(false);
    expect(routeOperationIsCurrent(draft, 'owner-a', token, 'replacement-operation')).toBe(false);
  });

  test('Undo restores geometry, gaps, provenance and revision exactly', () => {
    const initial = createImportedOrderedDraft({
      draftId: 'undo-draft',
      ownerId: 'owner-a',
      segments: [[p(0, 0), p(20, 0)], [p(40, 0), p(60, 0)]],
    });
    const history: RouteDraftHistory = { present: initial, past: [] };
    const result = bridgeOrderedGap(initial, initial.gaps[0].id, [p(20, 0), p(30, 10), p(40, 0)], 'draw-manual');
    const committed = commitRouteHistory(history, result, 'bridge');
    expect(committed.past).toHaveLength(1);
    expect(undoRouteHistory(committed).present).toEqual(initial);
  });

  test('invalid transaction creates no Undo entry', () => {
    const draft = empty();
    const history: RouteDraftHistory = { present: draft, past: [] };
    const invalid = appendOrderedSegment(draft, [p(0, 0), p(0, 0)], 'point');
    expect(commitRouteHistory(history, invalid, 'point')).toBe(history);
  });

  test('flattening never invents gap connector coordinates', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'flat', ownerId: 'owner-a',
      segments: [[p(0, 0), p(10, 0)], [p(100, 0), p(110, 0)]],
    });
    expect(orderedDraftPoints(draft)).toEqual([p(0, 0), p(10, 0), p(100, 0), p(110, 0)]);
    expect(validateOrderedDraft(draft)).toEqual([]);
  });
});
