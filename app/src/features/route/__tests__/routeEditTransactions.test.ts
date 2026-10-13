import {
  applyDrawTransaction,
  classifyDrawTransaction,
  continueDrawTransaction,
  nearestOrderedPositions,
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

  test('repeated coordinate occurrences expose interval choices instead of guessing', () => {
    const base = appendOrderedSegment(
      empty(),
      [p(0, 0), p(20, 0), p(0, 0), p(-20, 0), p(0, 0), p(30, 0)],
      'draw-manual',
    );
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(nearestOrderedPositions(base.draft, p(0, 0))).toHaveLength(3);
    const intent = classifyDrawTransaction(base.draft, [p(0, 0), p(0, 20), p(0, 0)]);
    expect(intent.kind).toBe('replace');
    if (intent.kind !== 'replace') return;
    expect(intent.options.length).toBeGreaterThan(1);
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
});
