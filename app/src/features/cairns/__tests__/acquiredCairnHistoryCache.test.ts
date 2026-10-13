const mockMemory = new Map<string, string>();
jest.mock('../../../store/storage', () => ({ storage: {
  getItemStrict: jest.fn(async (key: string) => mockMemory.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockMemory.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockMemory.delete(key); }),
} }));

import {
  __acquiredCairnHistoryCacheTest,
  beginAcquiredCairnHistoryRequest,
  cacheAcquiredCairnHistory,
  loadCachedAcquiredCairnHistory,
  markAcquiredCairnKnownUnavailable,
  purgeAcquiredCairnHistoryForOwner,
  updateCachedAcquiredRevision,
} from '../acquiredCairnHistoryCache';

const revision = (id: number, availability = 'available', contentRevision = id) => ({
  revision_id: id, content_revision: contentRevision, type: 'text', text: `page-${id}`,
  source_audience: 'public', availability, acquired_at: '2026-10-13T00:00:00.000Z',
  opened_at: null, thanked_at: null,
});

describe('account-scoped acquired Cairn history cache', () => {
  const mockStorage = jest.requireMock('../../../store/storage').storage;

  beforeEach(() => {
    mockMemory.clear();
    __acquiredCairnHistoryCacheTest.reset();
    mockStorage.getItemStrict.mockImplementation(async (key: string) => mockMemory.get(key) ?? null);
    mockStorage.setItem.mockImplementation(async (key: string, value: string) => { mockMemory.set(key, value); });
    mockStorage.removeItem.mockImplementation(async (key: string) => { mockMemory.delete(key); });
  });

  test('offline restart restores only exact versions acquired by the same account', async () => {
    const request = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    await cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(5), revision(2, 'available', 0)], request);
    __acquiredCairnHistoryCacheTest.reset();
    expect((await loadCachedAcquiredCairnHistory('owner-a', 'marker-1'))?.map(row => [row.revision_id, row.content_revision])).toEqual([[5, 5], [2, 0]]);
    expect(await loadCachedAcquiredCairnHistory('owner-b', 'marker-1')).toBeNull();
    expect(await loadCachedAcquiredCairnHistory('owner-a', 'marker-2')).toBeNull();
  });

  test('known removal fails closed and cannot resurrect cached content', async () => {
    const request = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    await cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(1)], request);
    await markAcquiredCairnKnownUnavailable('owner-a', 'marker-1');
    __acquiredCairnHistoryCacheTest.reset();
    expect(await loadCachedAcquiredCairnHistory('owner-a', 'marker-1')).toBeNull();
  });

  test('moderation states never retain text; read/thanks metadata remains independent', async () => {
    const request1 = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    await cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(2, 'under_review')], request1);
    expect((await loadCachedAcquiredCairnHistory('owner-a', 'marker-1'))?.[0].text).toBeNull();
    const request2 = beginAcquiredCairnHistoryRequest('owner-a', 'marker-2');
    await cacheAcquiredCairnHistory('owner-a', 'marker-2', [revision(3)], request2);
    await updateCachedAcquiredRevision('owner-a', 'marker-2', 3, { opened_at: 'opened' });
    expect((await loadCachedAcquiredCairnHistory('owner-a', 'marker-2'))?.[0]).toMatchObject({ opened_at: 'opened', thanked_at: null });
  });

  test('owner purge removes durable and memory copies', async () => {
    const request = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    await cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(1)], request);
    await purgeAcquiredCairnHistoryForOwner('owner-a');
    expect(await loadCachedAcquiredCairnHistory('owner-a', 'marker-1')).toBeNull();
    expect([...mockMemory.keys()].some(key => key.includes('owner-a'))).toBe(false);
  });

  test('owner purge invalidates an in-flight cache fill before it can resurrect content', async () => {
    let release!: (value: string | null) => void;
    mockStorage.getItemStrict.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const request = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    const staleWrite = cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(1)], request);
    while (mockStorage.getItemStrict.mock.calls.length < 1) await Promise.resolve();
    const purge = purgeAcquiredCairnHistoryForOwner('owner-a');
    release(null);
    await expect(staleWrite).rejects.toThrow('acquired_cache_owner_invalidated');
    await purge;
    expect(await loadCachedAcquiredCairnHistory('owner-a', 'marker-1')).toBeNull();
    expect([...mockMemory.keys()].some(key => key.includes('owner-a'))).toBe(false);
  });

  test('a late history response cannot overwrite a newer tombstone for the same owner and Cairn', async () => {
    const request = beginAcquiredCairnHistoryRequest('owner-a', 'marker-1');
    await markAcquiredCairnKnownUnavailable('owner-a', 'marker-1');
    await expect(cacheAcquiredCairnHistory('owner-a', 'marker-1', [revision(1)], request))
      .rejects.toThrow('acquired_cache_marker_invalidated');
    expect(await loadCachedAcquiredCairnHistory('owner-a', 'marker-1')).toBeNull();
  });
});
