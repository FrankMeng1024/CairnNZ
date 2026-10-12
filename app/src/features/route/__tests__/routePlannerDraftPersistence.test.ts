const mockMemory = new Map<string, string>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockMemory.delete(key); }),
    getAllKeysStrict: jest.fn(async () => [...mockMemory.keys()]),
    removeItemsStrict: jest.fn(async (keys: string[]) => { keys.forEach(key => mockMemory.delete(key)); }),
  },
}));

import { appendOrderedSegment, createEmptyOrderedDraft, createImportedOrderedDraft } from '../orderedRouteDraft';
import {
  loadRoutePlannerDraft,
  plannerDraftMatchesRequest,
  purgeRoutePlannerDraftsForOwner,
  removeRoutePlannerDraft,
  saveRoutePlannerDraft,
} from '../routePlannerDraftPersistence';

describe('Route planner draft recovery', () => {
  beforeEach(() => mockMemory.clear());

  test('round-trips exact ordered history and latest pointer inside one account', async () => {
    const initial = createEmptyOrderedDraft({ draftId: 'draft-a', ownerId: 'owner-a' });
    const edited = appendOrderedSegment(initial, [
      { lat: -41.2, lng: 174.7 }, { lat: -41.201, lng: 174.701 },
    ], 'draw-manual');
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    await saveRoutePlannerDraft({
      ownerId: 'owner-a', draftId: 'draft-a',
      history: { present: edited.draft, past: [{ draft: initial, operation: 'draw' }] },
      name: 'Recovered', permission: 'personal',
    });

    const recovered = await loadRoutePlannerDraft('owner-a');
    expect(recovered).toMatchObject({ ownerId: 'owner-a', draftId: 'draft-a', name: 'Recovered' });
    expect(recovered?.history.present).toEqual(edited.draft);
    expect(recovered?.history.past[0].draft).toEqual(initial);
    recovered!.history.present.parts[0].points[0].lat = 0;
    expect((await loadRoutePlannerDraft('owner-a'))?.history.present.parts[0].points[0].lat).toBe(-41.2);
  });

  test('never loads another account draft and removal clears the latest pointer', async () => {
    const draft = createEmptyOrderedDraft({ draftId: 'draft-a', ownerId: 'owner-a' });
    await saveRoutePlannerDraft({
      ownerId: 'owner-a', draftId: 'draft-a', history: { present: draft, past: [] },
      name: '', permission: 'personal',
    });
    expect(await loadRoutePlannerDraft('owner-b', 'draft-a')).toBeNull();
    await removeRoutePlannerDraft('owner-a', 'draft-a');
    expect(await loadRoutePlannerDraft('owner-a')).toBeNull();
  });

  test('does not recover an Activity-derived latest draft as a new empty plan', async () => {
    const activityDraft = createImportedOrderedDraft({
      draftId: 'activity:walk-a',
      ownerId: 'owner-a',
      segments: [[
        { lat: -41.2, lng: 174.7 },
        { lat: -41.21, lng: 174.71 },
      ]],
    });
    await saveRoutePlannerDraft({
      ownerId: 'owner-a', draftId: activityDraft.draftId,
      history: { present: activityDraft, past: [] }, name: 'Recorded walk Route',
      permission: 'personal', sourceActivityId: 'walk-a',
    });
    const latest = await loadRoutePlannerDraft('owner-a');
    expect(latest).not.toBeNull();
    expect(plannerDraftMatchesRequest(latest!, undefined)).toBe(false);
    expect(plannerDraftMatchesRequest(latest!, 'activity:walk-a')).toBe(true);

    const planDraft = createEmptyOrderedDraft({ draftId: 'plan:new-a', ownerId: 'owner-a' });
    await saveRoutePlannerDraft({
      ownerId: 'owner-a', draftId: planDraft.draftId,
      history: { present: planDraft, past: [] }, name: '', permission: 'personal',
    });
    const planLatest = await loadRoutePlannerDraft('owner-a');
    expect(planLatest).not.toBeNull();
    expect(plannerDraftMatchesRequest(planLatest!, undefined)).toBe(true);
  });

  test('owner purge removes all planner records while preserving another account', async () => {
    const a = createEmptyOrderedDraft({ draftId: 'plan-a', ownerId: 'owner-a' });
    const b = createEmptyOrderedDraft({ draftId: 'plan-b', ownerId: 'owner-b' });
    await saveRoutePlannerDraft({ ownerId: 'owner-a', draftId: a.draftId, history: { present: a, past: [] }, name: '', permission: 'personal' });
    await saveRoutePlannerDraft({ ownerId: 'owner-b', draftId: b.draftId, history: { present: b, past: [] }, name: '', permission: 'personal' });
    await purgeRoutePlannerDraftsForOwner('owner-a');
    expect(await loadRoutePlannerDraft('owner-a')).toBeNull();
    expect((await loadRoutePlannerDraft('owner-b'))?.draftId).toBe('plan-b');
  });
});
