const mockMemory = new Map<string, string>();

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    getItemStrict: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { mockMemory.delete(key); }),
  },
}));

import { appendOrderedSegment, createEmptyOrderedDraft } from '../orderedRouteDraft';
import {
  loadRoutePlannerDraft,
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
});
