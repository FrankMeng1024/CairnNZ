import {
  applyDrawTransaction,
  classifyDrawTransaction,
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
});
