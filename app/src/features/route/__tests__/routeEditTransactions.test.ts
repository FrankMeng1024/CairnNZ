import {
  applyDrawTransaction,
  classifyDrawTransaction,
  classifyDrawTransactionWithDiagnostics,
  continueDrawTransaction,
  nearestOrderedPositions,
  routeAttachmentToleranceM,
  selectIntentAwareDrawCandidate,
} from '../routeEditTransactions';
import {
  appendOrderedSegment,
  createEmptyOrderedDraft,
  createImportedOrderedDraft,
} from '../orderedRouteDraft';

const origin = { lat: -41.2865, lng: 174.7762 };
const p = (eastM: number, northM: number) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});

const empty = () => createEmptyOrderedDraft({ draftId: 'draft-a', ownerId: 'owner-a' });

describe('Route edit transaction classification', () => {
  test('24 px attachment tolerance scales with zoom but stays geographically bounded', () => {
    expect(routeAttachmentToleranceM(origin.lat, 18)).toBeGreaterThanOrEqual(4);
    expect(routeAttachmentToleranceM(origin.lat, 18)).toBeLessThan(20);
    expect(routeAttachmentToleranceM(origin.lat, 13)).toBe(60);
    expect(routeAttachmentToleranceM(origin.lat, 8)).toBe(60);
  });
  test('O81 production path flattens a V before the ordered replacement commit', () => {
    const apex = p(50, 75);
    const base = appendOrderedSegment(empty(), [p(0, 0), apex, p(100, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(0, 0), p(25, 1), p(50, -1), p(75, 1), p(100, 0)];
    const provider = [p(0, 0), p(48, 72), p(100, 0)];
    const intent = classifyDrawTransaction(base.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    const selected = selectIntentAwareDrawCandidate({
      draft: base.draft,
      raw,
      provider,
      intent,
      viewport: { width: 390, height: 844, center: origin, zoom: 17, bearing: 0, pitch: 0 },
    });
    expect(selected?.decision).toMatchObject({
      status: 'accepted', intent: 'straight-replacement', selectionSource: 'drawn-intent',
    });
    expect(selected?.points).toHaveLength(2);
    if (!selected?.points || !selected.resolution) return;
    const result = applyDrawTransaction(
      base.draft,
      { kind: 'replace', option: intent.options[0] },
      selected.points,
      selected.resolution,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts.flatMap(part => part.points)).not.toContainEqual(apex);
  });

  test('first stroke starts anywhere and later terminal stroke appends', () => {
    const firstRaw = [p(100, 50), p(120, 60), p(140, 50)];
    const firstIntent = classifyDrawTransaction(empty(), firstRaw);
    expect(firstIntent).toEqual({ kind: 'new' });
    const first = applyDrawTransaction(empty(), firstIntent as any, firstRaw, 'draw-manual');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const appendRaw = [p(140.2, 50), p(170, 60)];
    const appendIntent = classifyDrawTransaction(first.draft, appendRaw);
    expect(appendIntent).toEqual({ kind: 'append' });
    const appended = applyDrawTransaction(first.draft, appendIntent as any, appendRaw, 'draw-manual');
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.draft.parts).toHaveLength(2);
  });

  test('middle crossings do not terminate a Draw; only its endpoints choose replacement', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(20, 0), p(40, 0), p(60, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(20, 0), p(40, 20), p(40, 0), p(30, -20), p(60, 0)];
    const intent = classifyDrawTransaction(base.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options).toHaveLength(1);
    expect(intent.options[0].start.pointIndex).toBe(1);
    expect(intent.options[0].end.pointIndex).toBe(3);
  });

  test('R2 diagnostics record unique occurrences while interior crossings stay non-boundaries', () => {
    const base = appendOrderedSegment(empty(), [
      p(0, 0), p(30, 30), p(60, -30), p(90, 30), p(120, 0),
    ], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const classified = classifyDrawTransactionWithDiagnostics(base.draft, [p(0, 0), p(120, 0)]);
    expect(classified.intent.kind).toBe('replace');
    expect(classified.diagnostics.startCandidates).toHaveLength(1);
    expect(classified.diagnostics.endCandidates).toHaveLength(1);
    expect(classified.diagnostics.startCandidates[0]).toMatchObject({ distanceM: 0, arcM: 0 });
    expect(classified.diagnostics.interiorCrossingCount).toBeGreaterThanOrEqual(2);
    expect(classified.diagnostics.crossingPolicy).toBe('interior-crossings-ignored-as-boundaries');
    expect(classified.diagnostics.ambiguityReason).toBe('none');
  });

  test('R2 true ambiguity is competing ordered endpoint occurrences on a retraced route', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(50, 0), p(0, 0), p(50, 0), p(100, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const classified = classifyDrawTransactionWithDiagnostics(base.draft, [p(0, 0), p(20, 30), p(50, 0)]);
    expect(classified.intent).toMatchObject({ kind: 'pending-replace', ambiguity: 'overlap' });
    expect(classified.diagnostics.startCandidates.length).toBeGreaterThan(1);
    expect(classified.diagnostics.endCandidates.length).toBeGreaterThan(1);
    expect(classified.diagnostics.ambiguityReason).toBe('near-equal-intervals');
    expect(classified.diagnostics.intervalCandidates.every(option => Number.isFinite(option.shapeScore))).toBe(true);
  });

  test('repeated coordinate occurrences stay unchanged instead of guessing an interval', () => {
    const base = appendOrderedSegment(
      empty(),
      [p(0, 0), p(20, 0), p(0, 0), p(-20, 0), p(0, 0), p(30, 0)],
      'draw-manual',
    );
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(nearestOrderedPositions(base.draft, p(0, 0))).toHaveLength(3);
    const before = JSON.stringify(base.draft);
    const intent = classifyDrawTransaction(base.draft, [p(0, 0), p(0, 20), p(0, 0)]);
    expect(intent).toMatchObject({ kind: 'pending-replace', ambiguity: 'overlap' });
    expect(JSON.stringify(base.draft)).toBe(before);
  });

  test('a near-but-not-exact end hotspot extends without requiring pen-up to touch the Route', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(86, 2), p(115, 18), p(145, 28)];
    const intent = classifyDrawTransaction(base.draft, raw, undefined, 12);
    expect(intent).toEqual({ kind: 'append' });
    if (intent.kind !== 'append') return;
    const result = applyDrawTransaction(base.draft, intent, raw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts[0].points).toEqual(base.draft.parts[0].points);
    expect(result.draft.parts[1].points[0]).toEqual(p(80, 0));
    expect(result.draft.parts[1].points.at(-1)).toEqual(p(145, 28));
  });

  test('the equivalent start hotspot prepends while preserving canonical traversal order', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    // The gesture begins at the old start and ends at the intended new start.
    const raw = [p(4, -2), p(-25, 15), p(-55, 25)];
    const intent = classifyDrawTransaction(base.draft, raw, undefined, 12);
    expect(intent).toEqual({ kind: 'prepend' });
    if (intent.kind !== 'prepend') return;
    const result = applyDrawTransaction(base.draft, intent, raw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts[0].points[0]).toEqual(p(-55, 25));
    expect(result.draft.parts[0].points.at(-1)).toEqual(p(0, 0));
    expect(result.draft.parts[1].points).toEqual(base.draft.parts[0].points);
  });

  test('an interior start with a free endpoint cannot delete the untouched suffix', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(50, 0), p(100, 0), p(150, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const before = JSON.stringify(base.draft);
    const intent = classifyDrawTransaction(base.draft, [p(50, 2), p(70, 35), p(95, 55)]);
    expect(intent.kind).toBe('pending-replace');
    expect(JSON.stringify(base.draft)).toBe(before);
  });

  test('true final pen-up selects the boundary after an overlapping tail', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(20, 0), p(40, 0), p(60, 0), p(80, 0), p(100, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(20, 0), p(35, 30), p(40, 0), p(60, 0), p(80, 0)];
    const intent = classifyDrawTransaction(base.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options[0].start.pointIndex).toBe(1);
    expect(intent.options[0].end.pointIndex).toBe(4);
  });

  test('reverse-direction replacement is stored in canonical Route order', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(20, 0), p(40, 0), p(60, 0), p(80, 0), p(100, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(80, 0), p(60, -25), p(40, -30), p(20, 0)];
    const intent = classifyDrawTransaction(base.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options[0].reverseCandidate).toBe(true);
    const result = applyDrawTransaction(base.draft, { kind: 'replace', option: intent.options[0] }, raw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const replacement = result.draft.parts.find(part => part.resolution === 'draw-manual');
    expect(replacement?.points[0]).toEqual(p(20, 0));
    expect(replacement?.points.at(-1)).toEqual(p(80, 0));
    expect(result.draft.parts[0].points[0]).toEqual(p(0, 0));
    expect(result.draft.parts.at(-1)?.points.at(-1)).toEqual(p(100, 0));
  });

  test('selected Activity gap accepts only its adjacent endpoints and reverse drawing is oriented', () => {
    const imported = createImportedOrderedDraft({
      draftId: 'activity-a', ownerId: 'owner-a',
      segments: [[p(0, 0), p(20, 0)], [p(50, 0), p(70, 0)]],
    });
    const gapId = imported.gaps[0].id;
    expect(classifyDrawTransaction(imported, [p(200, 0), p(220, 0)], gapId)).toEqual({
      kind: 'reject', code: 'DISCONNECTED',
    });
    const reverseRaw = [p(50, 0), p(35, 10), p(20, 0)];
    const intent = classifyDrawTransaction(imported, reverseRaw, gapId);
    expect(intent).toEqual({ kind: 'bridge', gapId, reverseCandidate: true });
    if (intent.kind !== 'bridge') return;
    const result = applyDrawTransaction(imported, intent, reverseRaw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.gaps).toEqual([]);
    expect(result.draft.parts[1].points).toEqual([p(20, 0), p(35, 10), p(50, 0)]);
  });

  test('ordinary Draw across one imported Activity gap infers the adjacent bridge without a compulsory selection step', () => {
    const imported = createImportedOrderedDraft({
      draftId: 'activity-auto-gap', ownerId: 'owner-a',
      segments: [[p(0, 0), p(20, 0)], [p(50, 0), p(70, 0)]],
    });
    const raw = [p(20, 0), p(34, 8), p(50, 0)];
    const intent = classifyDrawTransaction(imported, raw);
    expect(intent).toEqual({
      kind: 'bridge', gapId: imported.gaps[0].id, reverseCandidate: false,
    });
    if (intent.kind !== 'bridge') return;
    const result = applyDrawTransaction(imported, intent, raw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.gaps).toEqual([]);
    expect(result.draft.parts[0].resolution).toBe('recorded');
    expect(result.draft.parts[1].resolution).toBe('draw-manual');
    expect(result.draft.parts[2].resolution).toBe('recorded');
  });

  test('a disconnected stroke rejects the transaction without changing the draft', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(30, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(classifyDrawTransaction(base.draft, [p(200, 0), p(230, 0)])).toEqual({
      kind: 'reject', code: 'DISCONNECTED',
    });
  });

  test('R2 replacement may span connected adjacent parts without crossing an unresolved gap', () => {
    const first = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'point');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(80, 0), p(120, 0), p(160, 0)], 'draw-manual');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const raw = [p(40, 0), p(80, 30), p(120, 0)];
    const intent = classifyDrawTransaction(second.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options).toHaveLength(1);
    const applied = applyDrawTransaction(
      second.draft,
      { kind: 'replace', option: intent.options[0] },
      raw,
      'draw-manual',
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.draft.gaps).toEqual([]);
    expect(applied.draft.parts.map(part => part.resolution)).toEqual([
      'point', 'draw-manual', 'draw-manual',
    ]);
    expect(applied.draft.parts[0].points).toEqual([p(0, 0), p(40, 0)]);
    expect(applied.draft.parts.at(-1)?.points).toEqual([p(120, 0), p(160, 0)]);
  });

  test('one shared vertex across connected stroke parts is one ordered occurrence', () => {
    const first = appendOrderedSegment(empty(), [p(0, 0), p(40, 0), p(80, 0)], 'draw-manual');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = appendOrderedSegment(first.draft, [p(80, 0), p(40, 40), p(120, 60)], 'draw-manual');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const joinHits = nearestOrderedPositions(second.draft, p(80, 0));
    expect(joinHits).toHaveLength(1);
    const intent = classifyDrawTransaction(second.draft, [p(40, 0), p(80, -20), p(120, 60)]);
    expect(intent.kind).toBe('replace');
    if (intent.kind === 'replace') expect(intent.options).toHaveLength(1);
  });

  test('R2 replacement never crosses an unresolved imported gap', () => {
    const imported = createImportedOrderedDraft({
      draftId: 'replace-gap', ownerId: 'owner-a',
      segments: [[p(0, 0), p(40, 0)], [p(80, 0), p(120, 0)]],
    });
    expect(classifyDrawTransaction(imported, [p(20, 0), p(60, 20), p(100, 0)])).toEqual({
      kind: 'reject', code: 'DISCONNECTED',
    });
  });

  test('R3 sparse segment-interior anchors are projected without enlarging attachment tolerance', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(200, 0), p(400, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const raw = [p(100, 1), p(200, 40), p(300, 1)];
    const intent = classifyDrawTransaction(base.draft, raw);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options).toHaveLength(1);
    const applied = applyDrawTransaction(
      base.draft,
      { kind: 'replace', option: intent.options[0] },
      raw,
      'draw-manual',
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.draft.parts[0].points.at(-1)).toEqual(p(100, 0));
    expect(applied.draft.parts.at(-1)?.points[0]).toEqual(p(300, 0));
  });

  test('R3 projection handles bends and short edges while rejecting a geographically remote anchor', () => {
    const base = appendOrderedSegment(
      empty(),
      [p(0, 0), p(100, 100), p(200, 0), p(201, 0), p(300, 0)],
      'draw-manual',
    );
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const bend = nearestOrderedPositions(base.draft, p(50, 50.5));
    expect(bend.some(anchor => anchor.pointIndex === 0 && (anchor.fraction ?? 0) > 0.45 && (anchor.fraction ?? 0) < 0.55)).toBe(true);
    // One metre is short relative to the editor scale but remains outside the
    // intentional 0.35 m endpoint-normalization tolerance on both ends.
    const shortEdge = nearestOrderedPositions(base.draft, p(200.5, 0.05));
    expect(shortEdge.some(anchor => anchor.pointIndex === 2 && (anchor.fraction ?? 0) > 0)).toBe(true);
    expect(nearestOrderedPositions(base.draft, p(150, 200))).toEqual([]);
  });

  test('R4 a bridge can remain pending after one bounded connected stroke', () => {
    const imported = createImportedOrderedDraft({
      draftId: 'pending-bridge', ownerId: 'owner-a',
      segments: [[p(0, 0), p(20, 0)], [p(160, 0), p(180, 0)]],
    });
    const intent = classifyDrawTransaction(
      imported,
      [p(20, 0), p(60, 10), p(90, 10)],
      imported.gaps[0].id,
    );
    expect((intent as any).kind).toBe('pending-bridge');
    if (intent.kind !== 'pending-bridge') return;
    expect(intent).toMatchObject({ draftId: imported.draftId, baseRevision: imported.revision });
    const continued = continueDrawTransaction(
      imported,
      intent,
      [p(90.2, 10), p(125, 15), p(160, 0)],
    );
    expect(continued.kind).toBe('bridge');
    if (continued.kind !== 'bridge') return;
    const result = applyDrawTransaction(
      imported,
      continued,
      [...intent.points, p(125, 15), p(160, 0)],
      'draw-manual',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.gaps).toEqual([]);
  });

  test('R4 three connected strokes remain pending until the final adjacent gap endpoint', () => {
    const imported = createImportedOrderedDraft({
      draftId: 'pending-bridge-three', ownerId: 'owner-a',
      segments: [[p(0, 0), p(20, 0)], [p(180, 0), p(200, 0)]],
    });
    const first = classifyDrawTransaction(imported, [p(20, 0), p(60, 10)], imported.gaps[0].id);
    expect(first.kind).toBe('pending-bridge');
    if (first.kind !== 'pending-bridge') return;
    const second = continueDrawTransaction(imported, first, [p(60.1, 10), p(110, 15)]);
    expect(second.kind).toBe('pending-bridge');
    if (second.kind !== 'pending-bridge') return;
    const thirdStroke = [p(110.1, 15), p(145, 8), p(180, 0)];
    const completed = continueDrawTransaction(imported, second, thirdStroke);
    expect(completed.kind).toBe('bridge');
    if (completed.kind !== 'bridge') return;
    const candidate = [...second.points, ...thirdStroke.slice(1)];
    const result = applyDrawTransaction(imported, completed, candidate, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.gaps).toEqual([]);
  });

  test('R4 pending replacement survives camera browsing and rejects a disconnected continuation', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(100, 0), p(200, 0), p(300, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const pending = classifyDrawTransaction(base.draft, [p(50, 0), p(90, 30), p(130, 35)]);
    expect(pending.kind).toBe('pending-replace');
    if (pending.kind !== 'pending-replace') return;
    expect(continueDrawTransaction(base.draft, pending, [p(500, 0), p(520, 0)])).toEqual({
      kind: 'reject', code: 'DISCONNECTED',
    });
    const complete = continueDrawTransaction(base.draft, pending, [p(130.1, 35), p(200, 25), p(250, 0)]);
    expect(complete.kind).toBe('replace');
  });

  test('R4 a pending transaction is fenced to its exact draft revision', () => {
    const base = appendOrderedSegment(empty(), [p(0, 0), p(100, 0), p(200, 0), p(300, 0)], 'point');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const pending = classifyDrawTransaction(base.draft, [p(50, 0), p(90, 30), p(130, 35)]);
    expect(pending.kind).toBe('pending-replace');
    if (pending.kind !== 'pending-replace') return;
    const changed = { ...base.draft, revision: base.draft.revision + 1 };
    expect(continueDrawTransaction(changed, pending, [p(130.1, 35), p(250, 0)]))
      .toEqual({ kind: 'reject', code: 'STALE_TRANSACTION' });
  });

  test('A3 a near-closed Activity endpoint owns Draw append before coincident replacement occurrences', () => {
    const recorded = Array.from({ length: 120 }, (_, index) => p(
      index < 60 ? index * 12 : (120 - index) * 12,
      index < 60 ? Math.sin(index / 5) * 80 : 360 + Math.cos(index / 5) * 80,
    ));
    recorded.push(p(5, 0));
    const imported = createImportedOrderedDraft({
      draftId: 'activity-near-closure', ownerId: 'owner-a', segments: [recorded],
    });
    const raw = [recorded.at(-1)!, p(3, -8), recorded[0]];
    const intent = classifyDrawTransaction(imported, raw, undefined, 20);
    expect(intent).toEqual({ kind: 'append' });
    if (intent.kind !== 'append') return;
    const result = applyDrawTransaction(imported, intent, raw, 'draw-manual');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.parts[0].points).toEqual(imported.parts[0].points);
    expect(result.draft.parts).toHaveLength(2);
  });

  test('A3 forced whole-Activity short-chord replacement fails closed before mutation', () => {
    const recorded = Array.from({ length: 160 }, (_, index) => {
      const angle = index / 159 * Math.PI * 2;
      return p(Math.cos(angle) * 700, Math.sin(angle) * 500);
    });
    recorded[recorded.length - 1] = p(695, 2);
    const imported = createImportedOrderedDraft({
      draftId: 'activity-collapse-guard', ownerId: 'owner-a', segments: [recorded],
    });
    const part = imported.parts[0];
    const before = JSON.stringify(imported);
    const result = applyDrawTransaction(imported, {
      kind: 'replace',
      option: {
        id: 'forced-whole-interval',
        start: { partId: part.id, pointIndex: 0 },
        end: { partId: part.id, pointIndex: part.points.length - 1 },
        reverseCandidate: false,
      },
    }, [part.points[0], part.points.at(-1)!], 'draw-manual');
    expect(result).toMatchObject({ ok: false, code: 'DESTRUCTIVE_ACTIVITY_REPLACEMENT' });
    expect(JSON.stringify(imported)).toBe(before);
  });
});
