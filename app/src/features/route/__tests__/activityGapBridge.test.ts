import { canonicalRouteGeometry, canonicalRouteGeometryFingerprint } from '../canonicalRouteGeometry';
import { buildRouteDisplayGeometry } from '../routeDisplayGeometry';
import {
  applyDrawTransaction,
  applyDrawTransactionParts,
  classifyDrawTransaction,
  nearestOrderedPositions,
} from '../routeEditTransactions';
import {
  commitRouteHistory,
  createImportedOrderedDraft,
  orderedDraftDistanceM,
  orderedDraftPoints,
  undoRouteHistory,
  type OrderedRouteDraft,
  type RouteDraftHistory,
} from '../orderedRouteDraft';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM = 0) => ({
  lat: origin.lat + northM / 111_132,
  lng: origin.lng + eastM / (111_320 * Math.cos(origin.lat * Math.PI / 180)),
});

const imported = (id = 'gap-bridge'): OrderedRouteDraft => createImportedOrderedDraft({
  draftId: id,
  ownerId: 'owner-a',
  segments: [
    [p(0), p(20), p(40)],
    [p(80), p(100), p(120)],
  ],
});

const applyClassified = (
  draft: OrderedRouteDraft,
  raw: ReturnType<typeof p>[],
  resolution: 'draw-manual' | 'draw-matched' = 'draw-manual',
) => {
  const intent = classifyDrawTransaction(draft, raw, undefined, 12);
  if (intent.kind !== 'replace-across-gap') return { intent, result: null };
  return {
    intent,
    result: applyDrawTransaction(draft, {
      kind: intent.kind,
      gapId: intent.gapId,
      option: intent.options[0],
    }, raw, resolution),
  };
};

describe('Activity-import true gap ordered replacement', () => {
  test.each([
    ['endpoint to endpoint', [p(40), p(58, 12), p(80)]],
    ['interior to interior', [p(20), p(58, 18), p(100)]],
    ['interior to opposite endpoint', [p(20), p(54, -16), p(80)]],
    ['first endpoint to interior', [p(40), p(70, 22), p(100)]],
    ['deliberate curved detour', [p(20), p(35, 25), p(60, 38), p(85, 25), p(100)]],
  ])('%s replaces only the ordered interval and removes its one gap', (_label, raw) => {
    const draft = imported(`positive-${_label}`);
    const { intent, result } = applyClassified(draft, raw);
    expect(intent).toMatchObject({ kind: 'replace-across-gap', gapId: draft.gaps[0].id });
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.draft.gaps).toEqual([]);
    expect(result.draft.parts[0].points[0]).toEqual(p(0));
    expect(result.draft.parts[0].points.at(-1)).toEqual(raw[0]);
    expect(result.draft.parts.at(-1)?.points[0]).toEqual(raw.at(-1));
    expect(result.draft.parts.at(-1)?.points.at(-1)).toEqual(p(120));
    expect(orderedDraftPoints(result.draft)).toContainEqual(raw[Math.floor(raw.length / 2)]);
  });

  test('a gap wider than one viewport is still selected from solid projected anchors', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'wide-gap', ownerId: 'owner-a',
      segments: [[p(0), p(30), p(60)], [p(1_560), p(1_590), p(1_620)]],
    });
    const raw = [p(30), p(500, 90), p(1_100, -60), p(1_590)];
    expect(applyClassified(draft, raw).intent).toMatchObject({
      kind: 'replace-across-gap', gapId: draft.gaps[0].id,
    });
  });

  test('with two true gaps, one bridge removes only the gap actually spanned', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'two-gaps', ownerId: 'owner-a',
      segments: [[p(0), p(20), p(40)], [p(80), p(100), p(120)], [p(160), p(180), p(200)]],
    });
    const { result } = applyClassified(draft, [p(20), p(58, 15), p(100)]);
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    expect(result.draft.gaps).toHaveLength(1);
    expect(result.draft.gaps[0].id).toBe(draft.gaps[1].id);
  });

  test.each([
    ['matched', 'draw-matched' as const],
    ['honest manual', 'draw-manual' as const],
  ])('%s provenance is retained in the committed gap replacement', (_label, resolution) => {
    const draft = imported(`provenance-${resolution}`);
    const raw = [p(20), p(55, 16), p(100)];
    const intent = classifyDrawTransaction(draft, raw, undefined, 12);
    expect(intent.kind).toBe('replace-across-gap');
    if (intent.kind !== 'replace-across-gap') return;
    const result = applyDrawTransactionParts(draft, {
      kind: intent.kind, gapId: intent.gapId, option: intent.options[0],
    }, [{ points: raw, resolution }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts.some(part => part.resolution === resolution)).toBe(true);
  });

  test('the accepted bridge is one atomic Undo and JSON save/reopen preserves order', () => {
    const source = imported('undo-save');
    const raw = [p(20), p(58, 20), p(100)];
    const { result } = applyClassified(source, raw, 'draw-matched');
    expect(result?.ok).toBe(true);
    if (!result?.ok) return;
    const history: RouteDraftHistory = { present: source, past: [] };
    const committed = commitRouteHistory(history, result, 'replace-gap-draw');
    expect(committed.past).toHaveLength(1);
    expect(undoRouteHistory(committed).present).toEqual(source);
    const reopened = JSON.parse(JSON.stringify(committed.present)) as OrderedRouteDraft;
    expect(reopened).toEqual(committed.present);
    expect(canonicalRouteGeometryFingerprint(canonicalRouteGeometry({ orderedDraft: reopened })))
      .toBe(canonicalRouteGeometryFingerprint(canonicalRouteGeometry({ orderedDraft: committed.present })));
  });

  test('editing the planned copy cannot modify the source Activity draft', () => {
    const source = imported('immutable-source');
    const before = JSON.stringify(source);
    const { result } = applyClassified(source, [p(20), p(60, 20), p(100)]);
    expect(result?.ok).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
    expect(source.gaps).toHaveLength(1);
  });

  test('dashed gap has no attachment surface and contributes no distance', () => {
    const draft = imported('gap-not-geometry');
    const gapMiddle = p(60);
    expect(nearestOrderedPositions(draft, gapMiddle, 12)).toEqual([]);
    expect(orderedDraftDistanceM(draft)).toBeCloseTo(80, 0);
    expect(classifyDrawTransaction(draft, [gapMiddle, p(100)], undefined, 12))
      .toEqual({ kind: 'reject', code: 'DISCONNECTED' });
    expect(classifyDrawTransaction(draft, [p(20), gapMiddle], undefined, 12).kind)
      .not.toBe('replace-across-gap');
  });

  test('one attached endpoint cannot close a gap', () => {
    const draft = imported('one-anchor');
    expect(classifyDrawTransaction(draft, [p(20), p(60, 50)], undefined, 12).kind)
      .toBe('pending-replace');
    expect(draft.gaps).toHaveLength(1);
  });

  test('two anchors on the same solid section remain a local edit and keep the gap', () => {
    const draft = imported('local-edit');
    const raw = [p(5), p(18, 15), p(35)];
    const intent = classifyDrawTransaction(draft, raw, undefined, 12);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    const applied = applyDrawTransaction(draft, { kind: 'replace', option: intent.options[0] }, raw, 'draw-manual');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.draft.gaps).toHaveLength(1);
  });

  test('one Draw cannot silently close two Activity gaps', () => {
    const draft = createImportedOrderedDraft({
      draftId: 'two-gap-negative', ownerId: 'owner-a',
      segments: [[p(0), p(30)], [p(60), p(90)], [p(120), p(150)]],
    });
    expect(classifyDrawTransaction(draft, [p(15), p(75, 30), p(135)], undefined, 12).kind)
      .not.toBe('replace-across-gap');
    expect(draft.gaps).toHaveLength(2);
  });

  test('repeat presentation on/off has identical classification and canonical result', () => {
    const draft = imported('repeat-independent');
    const geometry = canonicalRouteGeometry({ orderedDraft: draft });
    const raw = [p(20), p(58, 22), p(100)];
    buildRouteDisplayGeometry(geometry, { repeatPresentationEnabled: false });
    const without = applyClassified(draft, raw, 'draw-matched');
    buildRouteDisplayGeometry(geometry, { repeatPresentationEnabled: true });
    const withRepeat = applyClassified(draft, raw, 'draw-matched');
    expect(withRepeat.intent).toEqual(without.intent);
    expect(withRepeat.result).toEqual(without.result);
  });
});
