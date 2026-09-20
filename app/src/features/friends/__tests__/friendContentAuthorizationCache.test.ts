const mockStorageValues = new Map<string, string>();

jest.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: () => {
    const id = (globalThis as any).__friendContentViewerId;
    return { user: id ? { id } : null };
  } },
}));
jest.mock('../../../store/storage', () => ({
  storage: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));

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

const mockFetch = jest.requireMock('../../../services/apiService').authenticatedFetch as jest.Mock;
const mockStorage = jest.requireMock('../../../store/storage').storage;
const mockGetItem = mockStorage.getItem as jest.Mock;
const mockSetItem = mockStorage.setItem as jest.Mock;

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
    mockGetItem.mockImplementation(async (key: string) => mockStorageValues.get(key) ?? null);
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockStorageValues.set(key, value); });
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

  test('a queued older disk write cannot recreate content after purge', async () => {
    let releaseWrite!: () => void;
    let writes = 0;
    mockSetItem.mockImplementation(async (key: string, value: string) => {
      writes += 1;
      if (writes === 1) await new Promise<void>(resolve => { releaseWrite = resolve; });
      mockStorageValues.set(key, value);
    });
    listResponses();
    const read = fetchFriendContent('owner-a').catch(error => error);
    while (writes < 1) await Promise.resolve();
    const purge = purgeFriendContent('owner-a');
    releaseWrite();
    await expect(read).resolves.toMatchObject({ code: 'superseded' });
    await purge;
    expect(mockStorageValues.get(`${__friendContentTest.cachePrefix}viewer-a`)).not.toContain('Alice');
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
});

describe('borrowed Route authorization lifecycle', () => {
  beforeEach(() => {
    setMockViewer('viewer-a');
    mockStorageValues.clear();
    mockFetch.mockReset();
    mockGetItem.mockClear();
    mockSetItem.mockClear();
    mockGetItem.mockImplementation(async (key: string) => mockStorageValues.get(key) ?? null);
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockStorageValues.set(key, value); });
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
