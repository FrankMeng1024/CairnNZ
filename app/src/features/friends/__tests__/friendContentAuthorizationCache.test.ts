const mockStorageValues = new Map<string, string>();
const mockPurgeFriendMemory = jest.fn(async () => undefined);
const mockMarkerSetState = jest.fn();

jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => {
    const id = (globalThis as any).__friendContentViewerId;
    return { user: id ? { id } : null };
  } },
}));
jest.mock('../../../store/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../../memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: { getState: () => ({ purgeFriend: mockPurgeFriendMemory }) },
}));
jest.mock('../../../store/useMarkerStore', () => ({
  useMarkerStore: { setState: mockMarkerSetState },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import {
  __friendContentTest,
  authorizeBorrowedRouteStart,
  drainBorrowedRouteTerminalOutbox,
  fetchFriendContent,
  fetchFriendRoute,
  finalizeBorrowedRouteUse,
  hideFriendContent,
  leaseFriendRoute,
  prepareFriendRouteUse,
  purgeFriendContent,
  resetFriendContentForAccountBoundary,
  type FriendRoute,
} from '../services/friendContent';
import {
  blockUser,
  fetchFriendProfileForNavigation,
  friendProfileNavigationAuthorityIsCurrent,
  removeFriendAPI,
  useFriendStore,
} from '../../../store/useFriendStore';

const mockFetch = jest.requireMock('../../../services/apiService').authenticatedFetch as jest.Mock;
const mockStorage = jest.requireMock('../../../store/storage').storage;
const mockGetItem = mockStorage.getItem as jest.Mock;
const mockSetItem = mockStorage.setItem as jest.Mock;
const mockRemoveItem = mockStorage.removeItem as jest.Mock;
const mockFriendListStorage = jest.requireMock('@react-native-async-storage/async-storage');
const mockFriendListSetItem = mockFriendListStorage.setItem as jest.Mock;
const mockFriendListRemoveItem = mockFriendListStorage.removeItem as jest.Mock;

function setMockViewer(id: string): void {
  (globalThis as any).__friendContentViewerId = id;
}

const BASE = 1_800_000_000_000;

function response(status: number, body: any): any {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body) };
}

function cairn(revision = 'c1') {
  return {
    id: 101,
    author: { id: 'owner-a', name: 'Alice' },
    type: 'cairn', text: 'A moment here', lat: -41.3, lng: 174.8,
    created_at: new Date(BASE - 10_000).toISOString(),
    updated_at: new Date(BASE - 5_000).toISOString(),
    encountered_at: new Date(BASE - 1_000).toISOString(),
    resource_revision: revision,
    authorization_revision: 'episode-1:audience-1',
    authorization_issued_at: new Date(BASE).toISOString(),
    authorization_expires_at: new Date(BASE + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function route(revision = 'r1', detail = false, overrides: Record<string, unknown> = {}) {
  return {
    id: 202,
    author: { id: 'owner-a', name: 'Alice' },
    name: `Route ${revision}`,
    description: detail ? 'Author journal text' : '',
    distance_m: 1400,
    elevation_gain_m: 80,
    ...(detail ? { points: [{ lat: -41.3, lng: 174.8 }, { lat: -41.301, lng: 174.802 }] } : {}),
    resource_revision: revision,
    authorization_revision: 'episode-1:audience-1',
    authorization_issued_at: new Date(BASE).toISOString(),
    authorization_expires_at: new Date(BASE + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function listResponses() {
  mockFetch
    .mockResolvedValueOnce(response(200, { cairns: [cairn()] }))
    .mockResolvedValueOnce(response(200, { routes: [route()] }));
}

describe('downloaded friend content authorization cache', () => {
  beforeEach(() => {
    setMockViewer('viewer-a');
    mockStorageValues.clear();
    mockFetch.mockReset();
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockRemoveItem.mockClear();
    mockPurgeFriendMemory.mockClear();
    mockMarkerSetState.mockClear();
    mockFriendListSetItem.mockReset().mockResolvedValue(undefined);
    mockFriendListRemoveItem.mockReset().mockResolvedValue(undefined);
    useFriendStore.setState({ friends: [] });
    mockGetItem.mockImplementation(async (key: string) => mockStorageValues.get(key) ?? null);
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockStorageValues.set(key, value); });
    mockRemoveItem.mockImplementation(async (key: string) => { mockStorageValues.delete(key); });
    __friendContentTest.reset();
    jest.spyOn(Date, 'now').mockReturnValue(BASE + 1_000);
  });

  afterEach(() => jest.restoreAllMocks());

  test('persists authorized downloads and hydrates a non-renewed offline copy after relaunch', async () => {
    listResponses();
    const online = await fetchFriendContent('owner-a');
    expect(online.source).toBe('network');
    expect(online.cairns).toHaveLength(1);

    __friendContentTest.reset();
    mockFetch.mockRejectedValue(new Error('offline'));
    const offline = await fetchFriendContent('owner-a');
    expect(offline.source).toBe('offline-cache');
    expect(offline.expiresAt).toBe(BASE + 24 * 60 * 60 * 1000);
  });

  test('expiry and device-clock rollback fail closed without renewing authorization', async () => {
    listResponses();
    await fetchFriendContent('owner-a');
    __friendContentTest.reset();
    mockFetch.mockRejectedValue(new Error('offline'));

    (Date.now as jest.Mock).mockReturnValue(BASE + 24 * 60 * 60 * 1000 + 1);
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });

    __friendContentTest.reset();
    (Date.now as jest.Mock).mockReturnValue(BASE - 1);
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('purge fences a late same-account detail response and survives relaunch', async () => {
    let release!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const read = fetchFriendRoute('202', 'owner-a').catch(error => error);
    await Promise.resolve();
    await purgeFriendContent('owner-a');
    release(response(200, { route: route('late', true) }));
    await expect(read).resolves.toMatchObject({ code: 'superseded' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).not.toContain('late');

    __friendContentTest.reset();
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('two detail reads resolving out of order publish only the latest resource revision', async () => {
    let releaseOld!: (value: any) => void;
    let releaseNew!: (value: any) => void;
    mockFetch
      .mockReturnValueOnce(new Promise(resolve => { releaseOld = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { releaseNew = resolve; }));
    const oldRead = fetchFriendRoute('202', 'owner-a').catch(error => error);
    while (mockFetch.mock.calls.length < 1) await Promise.resolve();
    const newRead = fetchFriendRoute('202', 'owner-a');
    while (mockFetch.mock.calls.length < 2) await Promise.resolve();
    releaseNew(response(200, { route: route('new', true) }));
    await expect(newRead).resolves.toMatchObject({ content: { name: 'Route new' } });
    releaseOld(response(200, { route: route('old', true) }));
    await expect(oldRead).resolves.toMatchObject({ code: 'superseded' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).toContain('Route new');
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).not.toContain('Route old');
  });

  test('account change invalidates a late response before memory or disk publication', async () => {
    let release!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const read = fetchFriendRoute('202', 'owner-a').catch(error => error);
    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    release(response(200, { route: route('account-a-late', true) }));
    await expect(read).resolves.toMatchObject({ code: 'superseded' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('account-a-late');
  });

  test('local Hide is durable when the remote request fails and does not reappear offline', async () => {
    listResponses();
    await fetchFriendContent('owner-a');
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(hideFriendContent('cairns', '101', 'owner-a')).resolves.toEqual({
      localHidden: true,
      remoteConfirmed: false,
    });

    __friendContentTest.reset();
    mockFetch.mockRejectedValue(new Error('offline'));
    const offline = await fetchFriendContent('owner-a');
    expect(offline.cairns).toEqual([]);
    expect(offline.routes).toHaveLength(1);
  });

  test('an authoritative 404 purges a previously downloaded detail', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('current', true) }));
    await fetchFriendRoute('202', 'owner-a');
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'revoked' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).not.toContain('Route current');
  });

  test('C1: a rejected denial write removes the stale cache and later authorization can restore it', async () => {
    const key = `${__friendContentTest.cachePrefix}viewer-a`;
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    expect(mockStorageValues.get(key)).toContain('Route v1');

    mockSetItem.mockRejectedValueOnce(new Error('replacement write failed'));
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'revoked' });
    expect(mockRemoveItem).toHaveBeenCalledWith(key, { strict: true });
    expect(mockStorageValues.has(key)).toBe(false);

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'unavailable' });

    mockFetch.mockReset().mockResolvedValueOnce(response(200, { route: route('v2', true, {
      authorization_revision: 'episode-2:audience-1',
    }) }));
    await expect(fetchFriendRoute('202', 'owner-a')).resolves.toMatchObject({
      content: { resourceRevision: 'v2', authorizationRevision: 'episode-2:audience-1' },
    });

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).resolves.toMatchObject({
      source: 'offline-cache',
      content: { resourceRevision: 'v2', authorizationRevision: 'episode-2:audience-1' },
    });
  });

  test('C1: if replacement and removal both fail, invalidation reports storage and cannot promise relaunch safety', async () => {
    const key = `${__friendContentTest.cachePrefix}viewer-a`;
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    const staleDisk = mockStorageValues.get(key);

    mockSetItem.mockRejectedValueOnce(new Error('replacement write failed'));
    mockRemoveItem.mockRejectedValueOnce(new Error('removal failed'));
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'storage' });
    expect(mockStorageValues.get(key)).toBe(staleDisk);

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).resolves.toMatchObject({
      source: 'offline-cache', content: { resourceRevision: 'v1' },
    });
  });

  test('C1: queued older write plus rejected purge write ends in strict cache removal', async () => {
    let releaseWrite!: () => void;
    let writes = 0;
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      writes += 1;
      if (writes === 1) await new Promise<void>(resolve => { releaseWrite = resolve; });
      if (writes === 2) throw new Error('purge replacement failed');
      mockStorageValues.set(key, value);
    });
    listResponses();
    const read = fetchFriendContent('owner-a').catch(error => error);
    while (writes < 1) await Promise.resolve();
    const purge = purgeFriendContent('owner-a');
    releaseWrite();
    await expect(read).resolves.toMatchObject({ code: 'superseded' });
    await expect(purge).resolves.toBeUndefined();
    expect(mockRemoveItem).toHaveBeenCalledWith(
      `${__friendContentTest.cachePrefix}viewer-a`,
      { strict: true },
    );
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('Alice');

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('C1: a late owner list cannot resurrect a Route after authoritative Detail denial', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');

    let releaseRoutes!: (value: any) => void;
    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockReturnValueOnce(new Promise(resolve => { releaseRoutes = resolve; }))
      .mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    const staleList = fetchFriendContent('owner-a').catch(error => error);
    while (mockFetch.mock.calls.length < 2) await Promise.resolve();
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'revoked' });
    releaseRoutes(response(200, { routes: [route('v1')] }));
    await expect(staleList).resolves.toMatchObject({ code: 'superseded' });

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('Route v1');
  });

  test('C1: a late Detail cannot republish a resource invalidated by a newer owner list', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');

    let releaseDetail!: (value: any) => void;
    mockFetch.mockReset()
      .mockReturnValueOnce(new Promise(resolve => { releaseDetail = resolve; }))
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockResolvedValueOnce(response(200, { routes: [] }));
    const staleDetail = fetchFriendRoute('202', 'owner-a').catch(error => error);
    while (mockFetch.mock.calls.length < 1) await Promise.resolve();
    const currentList = await fetchFriendContent('owner-a');
    expect(currentList.routes).toEqual([]);
    releaseDetail(response(200, { route: route('v1', true) }));
    await expect(staleDetail).resolves.toMatchObject({ code: 'superseded' });

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('C2: same-revision summary retains compatible Detail without renewing authorization', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    const detail = await fetchFriendRoute('202', 'owner-a');
    expect(detail.content.points).toHaveLength(2);

    (Date.now as jest.Mock).mockReturnValue(BASE + 20_000);
    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockResolvedValueOnce(response(200, { routes: [route('v1', false, {
        authorization_issued_at: new Date(BASE + 20_000).toISOString(),
        authorization_expires_at: new Date(BASE + 20_000 + 24 * 60 * 60 * 1000).toISOString(),
      })] }));
    const list = await fetchFriendContent('owner-a');
    expect(list.routes[0].name).toBe('Route v1');

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    const offline = await fetchFriendRoute('202', 'owner-a');
    expect(offline.content.points).toHaveLength(2);
    expect(offline.expiresAt).toBe(BASE + 24 * 60 * 60 * 1000);
  });

  test('C2: newer summary invalidates mismatched full Detail and survives relaunch consistently', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockResolvedValueOnce(response(200, { routes: [route('v2')] }));
    const list = await fetchFriendContent('owner-a');
    expect(list.routes[0]).toMatchObject({ name: 'Route v2', resourceRevision: 'v2' });

    const persisted = JSON.parse(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '{}');
    const record = persisted.resources['route:202'];
    const fullPayload = record?.detailContent ?? record?.content;
    if (fullPayload) expect(fullPayload.resourceRevision).toBe(record.resourceRevision);

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'unavailable' });
    const offlineList = await fetchFriendContent('owner-a');
    expect(offlineList.routes[0]).toMatchObject({ name: 'Route v2', resourceRevision: 'v2' });
  });

  test('C2: authorization revision change invalidates old Detail even at the same resource revision', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockResolvedValueOnce(response(200, { routes: [route('v1', false, {
        authorization_revision: 'episode-2:audience-1',
      })] }));
    await fetchFriendContent('owner-a');

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('C2: an older list response cannot downgrade a newer accepted Detail revision', async () => {
    let releaseOldRoutes!: (value: any) => void;
    mockFetch
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockReturnValueOnce(new Promise(resolve => { releaseOldRoutes = resolve; }))
      .mockResolvedValueOnce(response(200, { route: route('v2', true) }));
    const olderList = fetchFriendContent('owner-a');
    while (mockFetch.mock.calls.length < 2) await Promise.resolve();
    await expect(fetchFriendRoute('202', 'owner-a')).resolves.toMatchObject({
      content: { name: 'Route v2', resourceRevision: 'v2' },
    });
    releaseOldRoutes(response(200, { routes: [route('v1')] }));
    const acceptedList = await olderList;
    expect(acceptedList.routes[0]).toMatchObject({ name: 'Route v2', resourceRevision: 'v2' });

    const persisted = JSON.parse(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '{}');
    const record = persisted.resources['route:202'];
    const fullPayload = record?.detailContent ?? record?.content;
    expect(record.resourceRevision).toBe('v2');
    expect(fullPayload.resourceRevision).toBe('v2');
  });

  test('C1: a fresh authorized generation can restore a resource after authoritative denial', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    await expect(fetchFriendRoute('202', 'owner-a')).rejects.toMatchObject({ code: 'revoked' });

    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { cairns: [] }))
      .mockResolvedValueOnce(response(200, { routes: [route('v2', false, {
        authorization_revision: 'episode-2:audience-1',
      })] }));
    const restored = await fetchFriendContent('owner-a');
    expect(restored.routes[0]).toMatchObject({ name: 'Route v2', authorizationRevision: 'episode-2:audience-1' });
  });

  test('C1: Hide fences simultaneous list and Detail writers before durable deletion', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');
    let releaseList!: (value: any) => void;
    let releaseDetail!: (value: any) => void;
    mockFetch.mockReset().mockImplementation((path: string) => {
      if (path.includes('/routes/202/hide')) return Promise.resolve(response(200, { hidden: true }));
      if (path.includes('/cairns?')) return Promise.resolve(response(200, { cairns: [] }));
      if (path.includes('/routes?')) return new Promise(resolve => { releaseList = resolve; });
      if (path.includes('/routes/202')) return new Promise(resolve => { releaseDetail = resolve; });
      throw new Error(`unexpected ${path}`);
    });
    const list = fetchFriendContent('owner-a').catch(error => error);
    const detail = fetchFriendRoute('202', 'owner-a').catch(error => error);
    while (!releaseList || !releaseDetail) await Promise.resolve();
    await hideFriendContent('routes', '202', 'owner-a');
    releaseList(response(200, { routes: [route('v1')] }));
    releaseDetail(response(200, { route: route('v1', true) }));
    await expect(list).resolves.toMatchObject({ code: 'superseded' });
    await expect(detail).resolves.toMatchObject({ code: 'superseded' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('Route v1');
  });

  test('C1: account switch fences an owner list before it can publish or persist', async () => {
    let releaseCairns!: (value: any) => void;
    let releaseRoutes!: (value: any) => void;
    mockFetch
      .mockReturnValueOnce(new Promise(resolve => { releaseCairns = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { releaseRoutes = resolve; }));
    const list = fetchFriendContent('owner-a').catch(error => error);
    while (mockFetch.mock.calls.length < 2) await Promise.resolve();
    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    releaseCairns(response(200, { cairns: [cairn()] }));
    releaseRoutes(response(200, { routes: [route('v1')] }));
    await expect(list).resolves.toMatchObject({ code: 'superseded' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('Route v1');
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-b`) ?? '').not.toContain('Route v1');
  });

  test.each([
    ['block', async () => blockUser('owner-a')],
    ['unfriend', async () => removeFriendAPI('owner-a')],
  ])('C1: %s intent fences simultaneous owner list and Detail through the real caller', async (_label, act) => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('v1', true) }));
    await fetchFriendRoute('202', 'owner-a');

    let releaseCairns!: (value: any) => void;
    let releaseRoutes!: (value: any) => void;
    let releaseDetail!: (value: any) => void;
    mockFetch.mockReset().mockImplementation((path: string) => {
      if (path.includes('/friend-content/cairns?')) {
        return new Promise(resolve => { releaseCairns = resolve; });
      }
      if (path.includes('/friend-content/routes?')) {
        return new Promise(resolve => { releaseRoutes = resolve; });
      }
      if (path.endsWith('/friend-content/routes/202')) {
        return new Promise(resolve => { releaseDetail = resolve; });
      }
      if (path === '/api/friends/owner-a/block') return Promise.resolve(response(200, { blocked: true }));
      if (path === '/api/friends/owner-a') return Promise.resolve(response(200, { removed: true }));
      if (path === '/api/friends') return Promise.resolve(response(200, []));
      throw new Error(`unexpected ${path}`);
    });
    const list = fetchFriendContent('owner-a').catch(error => error);
    const detailRead = fetchFriendRoute('202', 'owner-a').catch(error => error);
    while (!releaseCairns || !releaseRoutes || !releaseDetail) await Promise.resolve();

    const action = await act();
    expect(action).toMatchObject({ success: true });
    releaseCairns(response(200, { cairns: [cairn()] }));
    releaseRoutes(response(200, { routes: [route('v1')] }));
    releaseDetail(response(200, { route: route('v1', true) }));
    await expect(list).resolves.toMatchObject({ code: 'superseded' });
    await expect(detailRead).resolves.toMatchObject({ code: 'superseded' });

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    await expect(fetchFriendContent('owner-a')).rejects.toMatchObject({ code: 'unavailable' });
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '').not.toContain('Route v1');
  });

  test.each([
    ['block', async () => blockUser('owner-a')],
    ['unfriend', async () => removeFriendAPI('owner-a')],
  ])('C1 R2: stale %s completion cannot purge or mutate account B', async (_label, act) => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('a', true) }));
    await fetchFriendRoute('202', 'owner-a');
    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    mockFetch.mockResolvedValueOnce(response(200, { route: route('b', true) }));
    await fetchFriendRoute('202', 'owner-a');
    const viewerBKey = `${__friendContentTest.cachePrefix}viewer-b`;
    expect(mockStorageValues.get(viewerBKey)).toContain('Route b');

    setMockViewer('viewer-a');
    resetFriendContentForAccountBoundary();
    useFriendStore.setState({ friends: [{ id: 'owner-a', name: 'A friend' } as any] });
    let releaseAction!: (value: any) => void;
    let actionOptions: any;
    mockFetch.mockReset().mockImplementation((path: string, options?: any) => {
      if (path === '/api/friends/owner-a/block' || path === '/api/friends/owner-a') {
        actionOptions = options;
        return new Promise(resolve => { releaseAction = resolve; });
      }
      if (path === '/api/friends') return Promise.resolve(response(200, []));
      throw new Error(`unexpected ${path}`);
    });
    mockPurgeFriendMemory.mockClear();
    mockMarkerSetState.mockClear();
    const action = act();
    while (!releaseAction) await Promise.resolve();
    expect(actionOptions?.expectedUserId).toBe('viewer-a');
    expect(mockPurgeFriendMemory).toHaveBeenCalledWith('owner-a', 'viewer-a');

    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    useFriendStore.setState({ friends: [{ id: 'viewer-b-friend', name: 'B friend' } as any] });
    releaseAction(response(200, { success: true }));
    await expect(action).resolves.toEqual({ success: false, superseded: true });

    expect(mockStorageValues.get(viewerBKey)).toContain('Route b');
    expect(useFriendStore.getState().friends.map(friend => friend.id)).toEqual(['viewer-b-friend']);
    expect(mockPurgeFriendMemory).toHaveBeenCalledTimes(1);
    expect(mockMarkerSetState).not.toHaveBeenCalled();
  });

  test.each([
    ['block', async () => blockUser('owner-a')],
    ['unfriend', async () => removeFriendAPI('owner-a')],
  ])('C1 R2: stale %s completion fails an A to B to A generation rollover', async (_label, act) => {
    let releaseAction!: (value: any) => void;
    mockFetch.mockImplementation((path: string) => {
      if (path === '/api/friends/owner-a/block' || path === '/api/friends/owner-a') {
        return new Promise(resolve => { releaseAction = resolve; });
      }
      if (path === '/api/friends') return Promise.resolve(response(200, []));
      throw new Error(`unexpected ${path}`);
    });
    mockPurgeFriendMemory.mockClear();
    mockMarkerSetState.mockClear();
    useFriendStore.setState({ friends: [{ id: 'owner-a', name: 'old A friend' } as any] });
    const action = act();
    while (!releaseAction) await Promise.resolve();

    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    setMockViewer('viewer-a');
    resetFriendContentForAccountBoundary();
    useFriendStore.setState({ friends: [{ id: 'owner-a', name: 'new A session friend' } as any] });
    releaseAction(response(200, { success: true }));
    await expect(action).resolves.toEqual({ success: false, superseded: true });

    expect(useFriendStore.getState().friends.map(friend => friend.name)).toEqual(['new A session friend']);
    expect(mockPurgeFriendMemory).toHaveBeenCalledTimes(1);
    expect(mockPurgeFriendMemory).toHaveBeenCalledWith('owner-a', 'viewer-a');
    expect(mockMarkerSetState).not.toHaveBeenCalled();
  });

  test.each([
    ['A to B', () => {
      setMockViewer('viewer-b');
      resetFriendContentForAccountBoundary();
    }],
    ['A to B to A', () => {
      setMockViewer('viewer-b');
      resetFriendContentForAccountBoundary();
      setMockViewer('viewer-a');
      resetFriendContentForAccountBoundary();
    }],
  ])('C1 R3: a delayed friend-list response cannot publish across %s', async (_label, changeAccount) => {
    let releaseRows!: (rows: any[]) => void;
    let listOptions: any;
    mockFetch.mockImplementation((path: string, options?: any) => {
      if (path !== '/api/friends') throw new Error(`unexpected ${path}`);
      listOptions = options;
      return Promise.resolve({
        ok: true,
        json: jest.fn(() => new Promise<any[]>(resolve => { releaseRows = resolve; })),
      });
    });
    useFriendStore.setState({ friends: [{ id: 'old-a', name: 'Old A' } as any] });
    const load = useFriendStore.getState().loadFriendsFromBackend();
    while (!releaseRows) await Promise.resolve();
    expect(listOptions?.expectedUserId).toBe('viewer-a');

    changeAccount();
    useFriendStore.setState({ friends: [{ id: 'current-session', name: 'Current session' } as any] });
    releaseRows([{ id: 17, name: 'Late A', email: 'late-a@example.com', added_at: new Date(BASE).toISOString() }]);
    await load;

    expect(useFriendStore.getState().friends.map(friend => friend.name)).toEqual(['Current session']);
    expect(mockFriendListSetItem).not.toHaveBeenCalled();
  });

  test('C1 R3: a friend-list persistence crossing an account boundary is removed before any publish', async () => {
    let releaseWrite!: () => void;
    mockFriendListSetItem.mockImplementation(() => new Promise<void>(resolve => { releaseWrite = resolve; }));
    mockFetch.mockResolvedValueOnce(response(200, [
      { id: 17, name: 'Persisting A', email: 'a@example.com', added_at: new Date(BASE).toISOString() },
    ]));
    useFriendStore.setState({ friends: [{ id: 'old-a', name: 'Old A' } as any] });
    const load = useFriendStore.getState().loadFriendsFromBackend();
    while (!releaseWrite) await Promise.resolve();

    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    useFriendStore.setState({ friends: [{ id: 'b', name: 'Current B' } as any] });
    releaseWrite();
    await load;

    expect(useFriendStore.getState().friends.map(friend => friend.name)).toEqual(['Current B']);
    expect(mockFriendListRemoveItem).toHaveBeenCalledWith('cairn_friends');
  });

  test.each([
    ['A to B', () => {
      setMockViewer('viewer-b');
      resetFriendContentForAccountBoundary();
    }],
    ['A to B to A', () => {
      setMockViewer('viewer-b');
      resetFriendContentForAccountBoundary();
      setMockViewer('viewer-a');
      resetFriendContentForAccountBoundary();
    }],
  ])('C1 R3: non-OK Unfriend body parsing cannot roll back or return stale feedback across %s', async (_label, changeAccount) => {
    let releaseBody!: (body: any) => void;
    let bodyStarted = false;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: jest.fn(() => {
        bodyStarted = true;
        return new Promise(resolve => { releaseBody = resolve; });
      }),
    });
    useFriendStore.setState({ friends: [{ id: 'owner-a', name: 'Old A friend' } as any] });
    const action = removeFriendAPI('owner-a');
    while (!bodyStarted) await Promise.resolve();

    changeAccount();
    useFriendStore.setState({ friends: [{ id: 'current-session', name: 'Current session friend' } as any] });
    releaseBody({ error: 'Late A conflict' });

    await expect(action).resolves.toEqual({ success: false, superseded: true });
    expect(useFriendStore.getState().friends.map(friend => friend.name)).toEqual(['Current session friend']);
  });

  test.each([
    ['Block', async () => blockUser('owner-a')],
    ['Unfriend', async () => removeFriendAPI('owner-a')],
  ])('C1 R3: committed %s reports durable cleanup uncertainty instead of success', async (label, act) => {
    const key = `${__friendContentTest.cachePrefix}viewer-a`;
    mockFetch.mockResolvedValueOnce(response(200, { route: route('stale', true) }));
    await fetchFriendRoute('202', 'owner-a');
    const staleDisk = mockStorageValues.get(key);

    mockSetItem.mockRejectedValue(new Error('replacement write failed'));
    mockRemoveItem.mockRejectedValue(new Error('strict removal failed'));
    mockFetch.mockReset().mockResolvedValueOnce(response(200, { committed: true }));
    useFriendStore.setState({ friends: [{ id: 'owner-a', name: 'A friend' } as any] });

    await expect(act()).resolves.toMatchObject({
      success: false,
      serverCommitted: true,
      localCleanup: 'storage-uncertain',
      error: expect.stringContaining(`${label} completed`),
    });
    expect(mockStorageValues.get(key)).toBe(staleDisk);
    expect(useFriendStore.getState().friends).toEqual([]);
  });

  test('C3 P1: a current friend gets an ephemeral offline profile-navigation fallback without durable authorization writes', async () => {
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    const result = await fetchFriendProfileForNavigation('owner-a');

    expect(result).toMatchObject({
      status: 'offline-fallback',
      identity: { id: 'owner-a', name: 'Alice', email: 'alice@example.com' },
      authority: { viewerId: 'viewer-a', friendId: 'owner-a', friendAddedAt: BASE - 10_000 },
    });
    if (result.status !== 'offline-fallback') throw new Error('expected offline fallback');
    expect(friendProfileNavigationAuthorityIsCurrent(result.authority)).toBe(true);
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ expectedUserId: 'viewer-a' });
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockFriendListSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1: an account switch fences a delayed profile transport failure and cannot publish A fallback under B', async () => {
    let rejectProfile!: (reason: Error) => void;
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockImplementationOnce(() => new Promise((_, reject) => { rejectProfile = reject; }));
    const read = fetchFriendProfileForNavigation('owner-a');
    while (!rejectProfile) await Promise.resolve();

    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    useFriendStore.setState({ friends: [{
      id: 'owner-b', userId: 'owner-b', name: 'Bob', email: 'bob@example.com',
      addedAt: BASE, shareMarkers: true,
    }] });
    rejectProfile(new TypeError('Network request failed'));

    await expect(read).resolves.toEqual({ status: 'superseded' });
    expect(useFriendStore.getState().friends.map(friend => friend.id)).toEqual(['owner-b']);
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1: nonfriends and explicit server revocation cannot obtain the offline navigation fallback', async () => {
    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'unavailable' });
    expect(mockFetch).not.toHaveBeenCalled();

    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Not found' }));
    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'unavailable' });
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1 R2: same-viewer token-owner mismatch is superseded rather than treated as offline', async () => {
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    const mismatch: any = new Error('authenticated_fetch_account_changed');
    mismatch.code = 'ACCOUNT_CHANGED';
    mockFetch.mockRejectedValueOnce(mismatch);

    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'superseded' });
    expect(useFriendStore.getState().friends.map(friend => friend.id)).toEqual(['owner-a']);
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1 R2: coded authority and uncoded non-transport exceptions fail closed', async () => {
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    const authorityFailure: any = new TypeError('Network request failed');
    authorityFailure.code = 'AUTHORITY_UNAVAILABLE';
    mockFetch.mockRejectedValueOnce(authorityFailure);
    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'unavailable' });

    mockFetch.mockRejectedValueOnce(new Error('token authority unavailable'));
    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'unavailable' });
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1 R2: incomplete 2xx profile bodies fail closed while the backend schema remains accepted', async () => {
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockResolvedValueOnce(response(200, { id: 'owner-a' }));
    await expect(fetchFriendProfileForNavigation('owner-a')).resolves.toEqual({ status: 'unavailable' });

    useFriendStore.setState({ friends: [{
      id: '17', userId: '17', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockResolvedValueOnce(response(200, {
      id: 17,
      name: 'Alice',
      email: 'alice@example.com',
      memberSince: new Date(BASE - 100_000).toISOString(),
      permittedContent: { encounteredCairns: 2, sharedRoutes: 1, memoryAvailable: true },
    }));
    await expect(fetchFriendProfileForNavigation('17')).resolves.toMatchObject({
      status: 'online',
      profile: {
        id: 17,
        permittedContent: { encounteredCairns: 2, sharedRoutes: 1, memoryAvailable: true },
      },
    });
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  test('C3 P1: block intent invalidates an already-issued profile-navigation fallback before server completion', async () => {
    useFriendStore.setState({ friends: [{
      id: 'owner-a', userId: 'owner-a', name: 'Alice', email: 'alice@example.com',
      addedAt: BASE - 10_000, shareMarkers: true,
    }] });
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    const result = await fetchFriendProfileForNavigation('owner-a');
    if (result.status !== 'offline-fallback') throw new Error('expected offline fallback');

    let releaseBlock!: (value: any) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { releaseBlock = resolve; }));
    const blocking = blockUser('owner-a');
    expect(friendProfileNavigationAuthorityIsCurrent(result.authority)).toBe(false);
    releaseBlock(response(200, { blocked: true }));
    await expect(blocking).resolves.toMatchObject({ success: true });
    expect(useFriendStore.getState().friends).toEqual([]);
  });
});

describe('borrowed Route authorization lifecycle', () => {
  beforeEach(() => {
    setMockViewer('viewer-a');
    mockStorageValues.clear();
    mockFetch.mockReset();
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockRemoveItem.mockClear();
    mockGetItem.mockImplementation(async (key: string) => mockStorageValues.get(key) ?? null);
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockStorageValues.set(key, value); });
    mockRemoveItem.mockImplementation(async (key: string) => { mockStorageValues.delete(key); });
    __friendContentTest.reset();
    jest.spyOn(Date, 'now').mockReturnValue(BASE + 1_000);
  });
  afterEach(() => jest.restoreAllMocks());

  async function issuedLease() {
    const item = route('lease', true);
    const routeModel: FriendRoute = {
      id: '202', author: { id: 'owner-a', name: 'Alice' }, name: 'Route lease',
      description: 'must not enter the active snapshot', distanceM: 1400, elevationGainM: 80,
      points: item.points, readOnly: true, resourceRevision: 'lease', authorizationRevision: 'auth-1',
    };
    mockFetch.mockResolvedValueOnce(response(201, {
      lease_id: 'lease-1', content_version: 'content-1', authorization_revision: 'auth-1',
      resource_revision: 'lease',
      issued_at: new Date(BASE).toISOString(), expires_at: new Date(BASE + 12 * 60 * 60 * 1000).toISOString(),
      route: item,
    }));
    return leaseFriendRoute(routeModel);
  }

  test('a valid issued authorization starts offline and persists only minimal reference fields', async () => {
    const launch = await issuedLease();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const use = await authorizeBorrowedRouteStart(
      launch,
      '11111111-1111-4111-8111-111111111111',
      BASE + 1_000,
      1,
    );
    expect(use.source).toBe('offline-authorization');
    const disk = mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '';
    expect(disk).not.toContain('must not enter the active snapshot');
    expect(disk).not.toContain('waypoints');
  });

  test('C3: ordinary Detail reopen reuses its valid issued authorization offline without renewing it', async () => {
    mockFetch.mockResolvedValueOnce(response(200, { route: route('lease', true, {
      authorization_revision: 'auth-1',
    }) }));
    const onlineDetail = await fetchFriendRoute('202', 'owner-a');
    const launch = await issuedLease();

    __friendContentTest.reset();
    mockFetch.mockReset().mockRejectedValue(new Error('offline'));
    const reopened = await fetchFriendRoute('202', 'owner-a');
    expect(reopened.source).toBe('offline-cache');
    const prepared = await prepareFriendRouteUse(reopened.content);
    expect(prepared).toMatchObject({
      source: 'offline-authorization',
      launch: {
        leaseId: launch.leaseId,
        resourceRevision: onlineDetail.content.resourceRevision,
        issuedAt: launch.issuedAt,
        expiresAt: launch.expiresAt,
      },
    });
    expect(prepared.launch.points).toEqual(reopened.content.points);

    const persisted = JSON.parse(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '{}');
    expect(persisted.leases['lease-1'].expiresAt).toBe(BASE + 12 * 60 * 60 * 1000);
  });

  test('C3: known denial purges a stored lease and cannot fall back to it', async () => {
    await issuedLease();
    const routeModel: FriendRoute = {
      id: '202', author: { id: 'owner-a', name: 'Alice' }, name: 'Route lease', description: '',
      distanceM: 1400, elevationGainM: 80, points: route('lease', true).points,
      readOnly: true, resourceRevision: 'lease', authorizationRevision: 'auth-1',
    };
    mockFetch.mockResolvedValueOnce(response(404, { error: 'Content not available' }));
    await expect(prepareFriendRouteUse(routeModel)).rejects.toMatchObject({ code: 'revoked' });
    const persisted = JSON.parse(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '{}');
    expect(persisted.leases).toEqual({});
  });

  test('C3: missing, expired, or resource-version-mismatched offline permission fails clearly', async () => {
    const launch = await issuedLease();
    const routeModel: FriendRoute = {
      id: '202', author: { id: 'owner-a', name: 'Alice' }, name: 'Route lease', description: '',
      distanceM: 1400, elevationGainM: 80, points: launch.points,
      readOnly: true, resourceRevision: 'newer-than-lease', authorizationRevision: 'auth-1',
    };
    mockFetch.mockRejectedValue(new Error('offline'));
    await expect(prepareFriendRouteUse(routeModel)).rejects.toMatchObject({ code: 'expired' });

    routeModel.resourceRevision = 'lease';
    (Date.now as jest.Mock).mockReturnValue(BASE + 13 * 60 * 60 * 1000);
    await expect(prepareFriendRouteUse(routeModel)).rejects.toMatchObject({ code: 'expired' });
  });

  test('expired or wrong-account authorization cannot start offline', async () => {
    const launch = await issuedLease();
    (Date.now as jest.Mock).mockReturnValue(BASE + 13 * 60 * 60 * 1000);
    await expect(authorizeBorrowedRouteStart(
      launch, '22222222-2222-4222-8222-222222222222', Date.now(), 1,
    )).rejects.toMatchObject({ code: 'expired' });

    (Date.now as jest.Mock).mockReturnValue(BASE + 2_000);
    setMockViewer('viewer-b');
    resetFriendContentForAccountBoundary();
    await expect(authorizeBorrowedRouteStart(
      launch, '33333333-3333-4333-8333-333333333333', Date.now(), 1,
    )).rejects.toMatchObject({ code: 'superseded' });
  });

  test('offline Finish queues start then terminal acknowledgement and drains idempotently after relaunch', async () => {
    const launch = await issuedLease();
    mockFetch.mockRejectedValue(new Error('offline'));
    const use = await authorizeBorrowedRouteStart(
      launch, '44444444-4444-4444-8444-444444444444', BASE + 1_000, 1,
    );
    await finalizeBorrowedRouteUse(use.identity, 'finished', BASE + 10_000);
    await Promise.resolve();
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).toContain('terminalOutbox');

    __friendContentTest.reset();
    mockFetch.mockReset()
      .mockResolvedValueOnce(response(200, { started: true }))
      .mockResolvedValueOnce(response(200, { ended: true }));
    await drainBorrowedRouteTerminalOutbox();
    const persisted = JSON.parse(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`) ?? '{}');
    expect(persisted.terminalOutbox).toEqual({});
    expect(mockFetch.mock.calls[0][0]).toContain('/start');
    expect(mockFetch.mock.calls[1][0]).toContain('/end');
  });
});
