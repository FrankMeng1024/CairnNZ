const mockValues = new Map<string, string>();
const mockPurgeFriend = jest.fn(async () => undefined);
const mockPurgeFriendContent = jest.fn(async () => undefined);
const mockFriendSetState = jest.fn();
const mockMarkerSetState = jest.fn();
let mockAuthenticatedOwnerId: string | null = 'viewer-a';
let mockIsLoggedIn = true;

jest.mock('../../../store/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { mockValues.set(key, value); }),
  },
}));
jest.mock('../../../services/apiService', () => ({ authenticatedFetch: jest.fn() }));
jest.mock('../../../store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      isLoggedIn: mockIsLoggedIn,
      user: mockAuthenticatedOwnerId === null ? null : { id: mockAuthenticatedOwnerId },
    }),
  },
}));
jest.mock('../../memory/store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: { getState: () => ({ purgeFriend: mockPurgeFriend }) },
}));
jest.mock('../../friends/services/friendContent', () => ({ purgeFriendContent: mockPurgeFriendContent }));
jest.mock('../../../store/useFriendStore', () => ({ useFriendStore: { setState: mockFriendSetState } }));
jest.mock('../../../store/useMarkerStore', () => ({ useMarkerStore: { setState: mockMarkerSetState } }));

import {
  __publicCairnTest,
  queuePublicActivityReconciliation,
  usePublicCairnStore,
} from '../services/publicCairns';

const mockFetch = jest.requireMock('../../../services/apiService').authenticatedFetch as jest.Mock;
const mockSetItem = jest.requireMock('../../../store/storage').storage.setItem as jest.Mock;
const BASE = 1_800_000_000_000;

function response(status: number, body: any): any {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body) };
}

function summary(revision = 'v1', authorization = 'public:1:1:1') {
  return {
    id: '1', author: { id: '10', name: 'Aroha' }, type: 'cairn',
    lat: -41.28, lng: 174.77, approximate: false,
    created_at: new Date(BASE - 60_000).toISOString(),
    encountered_at: new Date(BASE - 10_000).toISOString(), read_only: true,
    resource_revision: revision, authorization_revision: authorization,
    authorization_issued_at: new Date(BASE).toISOString(),
    authorization_expires_at: new Date(BASE + 86_400_000).toISOString(),
  };
}

function secondSummary() {
  return {
    ...summary('v1-b', 'public:2:1:1'),
    id: '2',
    lat: -41.281,
    lng: 174.771,
  };
}

function detail(revision = 'v1', authorization = 'public:1:1:1') {
  return { ...summary(revision, authorization), text: 'Ridge light\u001eA quiet note.', display_text: 'Ridge light' };
}

function scene(entries = [summary()]) {
  return { entries, newly_surfaced: entries.slice(0, 1) };
}

async function initialize(entries = [summary()]): Promise<void> {
  mockAuthenticatedOwnerId = 'viewer-a';
  mockFetch
    .mockResolvedValueOnce(response(200, { enabled: true, scene_limit: 3, scene_author_limit: 1, new_card_limit: 1 }))
    .mockResolvedValueOnce(response(200, scene(entries)));
  await usePublicCairnStore.getState().initialize('viewer-a');
}

function holdAcknowledgementPersistence(actionPrefix: string) {
  let releaseWrite!: () => void;
  let markStarted!: () => void;
  let sawPending = false;
  let held = false;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const released = new Promise<void>(resolve => { releaseWrite = resolve; });
  mockSetItem.mockImplementation(async (key: string, value: string) => {
    if (key === `${__publicCairnTest.cachePrefix}viewer-a`) {
      const parsed = JSON.parse(value);
      const ids = Object.keys(parsed.pendingActions ?? {});
      if (ids.some(id => id.startsWith(actionPrefix))) sawPending = true;
      if (sawPending && !held && !ids.some(id => id.startsWith(actionPrefix))) {
        held = true;
        markStarted();
        await released;
      }
    }
    mockValues.set(key, value);
  });
  return { started, release: () => releaseWrite() };
}

describe('Public Cairn shared list/detail authority', () => {
  beforeEach(() => {
    mockValues.clear();
    mockFetch.mockReset();
    mockPurgeFriend.mockClear();
    mockPurgeFriendContent.mockClear();
    mockFriendSetState.mockClear();
    mockMarkerSetState.mockClear();
    mockSetItem.mockReset();
    mockSetItem.mockImplementation(async (key: string, value: string) => { mockValues.set(key, value); });
    mockAuthenticatedOwnerId = 'viewer-a';
    mockIsLoggedIn = true;
    __publicCairnTest.reset();
    jest.spyOn(Date, 'now').mockReturnValue(BASE + 1_000);
  });
  afterEach(() => jest.restoreAllMocks());

  test('capability and encountered scene hydrate an account-scoped durable summary', async () => {
    await initialize();
    expect(usePublicCairnStore.getState()).toMatchObject({ enabled: true, newlySurfacedId: '1' });
    expect(usePublicCairnStore.getState().entries).toHaveLength(1);
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`)).toContain('public:1:1:1');
  });

  test('late scene cannot resurrect a resource after authoritative Detail denial', async () => {
    await initialize();
    let releaseScene!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { releaseScene = resolve; }));
    const staleScene = usePublicCairnStore.getState().refreshScene();
    while (mockFetch.mock.calls.length < 3) await Promise.resolve();
    mockFetch.mockResolvedValueOnce(response(404, { code: 'PUBLIC_CAIRN_UNAVAILABLE' }));
    await expect(usePublicCairnStore.getState().loadDetail('1')).rejects.toMatchObject({ code: 'unavailable' });
    releaseScene(response(200, scene([summary('v1')])));
    await staleScene;
    expect(usePublicCairnStore.getState().entries).toEqual([]);
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain('Ridge light');
  });

  test('new summary revision invalidates mismatched full content and cannot relabel it', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(200, { cairn: detail('v1') }));
    await usePublicCairnStore.getState().loadDetail('1');
    expect(usePublicCairnStore.getState().details['1'].text).toContain('quiet note');

    mockFetch.mockResolvedValueOnce(response(200, scene([summary('v2', 'public:1:1:2')])));
    await usePublicCairnStore.getState().refreshScene();
    expect(usePublicCairnStore.getState().entries[0].resourceRevision).toBe('v2');
    expect(usePublicCairnStore.getState().details['1']).toBeUndefined();

    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(usePublicCairnStore.getState().loadDetail('1')).rejects.toMatchObject({ code: 'offline' });
    const persisted = JSON.parse(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '{}');
    expect(persisted.entries['1'].resourceRevision).toBe('v2');
    expect(persisted.details['1']).toBeUndefined();
  });

  test('same summary revision preserves compatible Detail without renewing authorization', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(200, { cairn: detail('v1') }));
    await usePublicCairnStore.getState().loadDetail('1');
    (Date.now as jest.Mock).mockReturnValue(BASE + 20_000);
    mockFetch.mockResolvedValueOnce(response(200, scene([summary('v1')])));
    await usePublicCairnStore.getState().refreshScene();
    expect(usePublicCairnStore.getState().details['1'].authorizationExpiresAt).toBe(BASE + 86_400_000);
  });

  test('offline relaunch keeps a previously enabled, non-expired downloaded Detail without renewal', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(200, { cairn: detail('v1') }));
    await usePublicCairnStore.getState().loadDetail('1');
    const expiresAt = usePublicCairnStore.getState().details['1'].authorizationExpiresAt;
    __publicCairnTest.reset();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await usePublicCairnStore.getState().initialize('viewer-a');
    expect(usePublicCairnStore.getState()).toMatchObject({ enabled: true, error: 'offline' });
    expect(usePublicCairnStore.getState().details['1'].authorizationExpiresAt).toBe(expiresAt);
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(usePublicCairnStore.getState().loadDetail('1')).resolves.toMatchObject({
      text: expect.stringContaining('quiet note'), authorizationExpiresAt: expiresAt,
    });
  });

  test('presentation acknowledgement is durable and retries without inventing a second display fact', async () => {
    await initialize();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await usePublicCairnStore.getState().present('1');
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`)).toContain('present:1:public:1:1:1');
    mockFetch
      .mockResolvedValueOnce(response(200, { enabled: true }))
      .mockResolvedValueOnce(response(200, { presented: true }))
      .mockResolvedValueOnce(response(200, scene([])));
    await usePublicCairnStore.getState().initialize('viewer-a');
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`)).not.toContain('present:1:public:1:1:1');
  });

  test('Hide fences delayed list and Detail writers and remains durable on network failure', async () => {
    await initialize();
    let releaseScene!: (value: any) => void;
    let releaseDetail!: (value: any) => void;
    mockFetch.mockImplementation((path: string) => {
      if (path.endsWith('/hide')) return Promise.reject(new Error('offline'));
      if (path.endsWith('/scene')) return new Promise(resolve => { releaseScene = resolve; });
      if (path.endsWith('/cairns/1')) return new Promise(resolve => { releaseDetail = resolve; });
      throw new Error(`unexpected ${path}`);
    });
    const sceneRead = usePublicCairnStore.getState().refreshScene();
    const detailRead = usePublicCairnStore.getState().loadDetail('1').catch(error => error);
    while (!releaseScene || !releaseDetail) await Promise.resolve();
    await expect(usePublicCairnStore.getState().hide('1')).resolves.toEqual({ status: 'queued_offline' });
    releaseScene(response(200, scene([summary()])));
    releaseDetail(response(200, { cairn: detail() }));
    await sceneRead;
    await expect(detailRead).resolves.toMatchObject({ code: 'superseded' });
    expect(usePublicCairnStore.getState().entries).toEqual([]);
    const persisted = mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '';
    expect(persisted).toContain('hide:1');
    expect(persisted).not.toContain('quiet note');
  });

  test('account switch fences an older async response before memory or disk publication', async () => {
    await initialize([]);
    let release!: (value: any) => void;
    mockFetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const old = usePublicCairnStore.getState().refreshScene();
    while (mockFetch.mock.calls.length < 3) await Promise.resolve();
    mockFetch
      .mockResolvedValueOnce(response(200, { enabled: true }))
      .mockResolvedValueOnce(response(200, scene([])));
    mockAuthenticatedOwnerId = 'viewer-b';
    await usePublicCairnStore.getState().initialize('viewer-b');
    release(response(200, scene([summary('old-account')])));
    await old;
    expect(usePublicCairnStore.getState().viewerId).toBe('viewer-b');
    expect(usePublicCairnStore.getState().entries).toEqual([]);
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-b`) ?? '').not.toContain('old-account');
  });

  test('every Public transport binds the authenticated owner behaviorally', async () => {
    mockFetch.mockImplementation(async (path: string, options?: { expectedUserId?: string }) => {
      if (options?.expectedUserId !== mockAuthenticatedOwnerId) {
        const error: any = new Error('authenticated_fetch_account_changed');
        error.code = 'ACCOUNT_CHANGED';
        throw error;
      }
      if (path === '/api/public-cairns/capabilities') return response(200, { enabled: true });
      if (path === '/api/public-cairns/scene') return response(200, scene());
      if (path === '/api/public-cairns/cairns/1') return response(200, { cairn: detail() });
      if (path === '/api/public-cairns/cairns/1/thanks') return response(200, { thanked: true });
      throw new Error(`unexpected ${path}`);
    });

    await usePublicCairnStore.getState().initialize('viewer-a');
    await expect(usePublicCairnStore.getState().loadDetail('1')).resolves.toMatchObject({ id: '1' });
    await expect(usePublicCairnStore.getState().thanks('1')).resolves.toEqual({ status: 'confirmed' });

    expect(mockFetch.mock.calls.map(([path, options]) => [path, options?.expectedUserId])).toEqual([
      ['/api/public-cairns/capabilities', 'viewer-a'],
      ['/api/public-cairns/scene', 'viewer-a'],
      ['/api/public-cairns/cairns/1', 'viewer-a'],
      ['/api/public-cairns/cairns/1/thanks', 'viewer-a'],
    ]);
  });

  test('a stale initialize invoked after authenticated owner B cannot steal the store or dispatch', async () => {
    mockAuthenticatedOwnerId = 'viewer-b';
    mockFetch.mockImplementation(async (path: string, options?: { expectedUserId?: string }) => {
      expect(options?.expectedUserId).toBe('viewer-b');
      expect(path).toBe('/api/public-cairns/capabilities');
      return response(200, { enabled: false });
    });
    await usePublicCairnStore.getState().initialize('viewer-b');
    const callsBeforeStaleInvocation = mockFetch.mock.calls.length;

    await usePublicCairnStore.getState().initialize('viewer-a');

    expect(mockFetch).toHaveBeenCalledTimes(callsBeforeStaleInvocation);
    expect(usePublicCairnStore.getState()).toMatchObject({
      viewerId: 'viewer-b', enabled: false, capabilityChecked: true, entries: [], details: {},
    });
  });

  test('a populated user during signed-out pre-publish cannot initialize or dispatch Public state', async () => {
    mockAuthenticatedOwnerId = 'viewer-a';
    mockIsLoggedIn = false;

    await usePublicCairnStore.getState().initialize('viewer-a');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(usePublicCairnStore.getState()).toMatchObject({
      viewerId: null, enabled: false, capabilityChecked: false, entries: [], details: {},
    });
  });

  test('authenticated owner change fences a delayed capability completion without another initialize', async () => {
    let releaseCapability!: (value: any) => void;
    let jsonStarted!: () => void;
    const jsonReady = new Promise<void>(resolve => { jsonStarted = resolve; });
    mockFetch.mockImplementationOnce(async (_path: string, options?: { expectedUserId?: string }) => {
      expect(options?.expectedUserId).toBe('viewer-a');
      return {
        ok: true,
        status: 200,
        json: jest.fn(() => {
          jsonStarted();
          return new Promise(resolve => { releaseCapability = resolve; });
        }),
      };
    });
    const staleInitialize = usePublicCairnStore.getState().initialize('viewer-a');
    await jsonReady;

    mockAuthenticatedOwnerId = 'viewer-b';
    releaseCapability({ enabled: true });
    await staleInitialize;

    expect(mockFetch.mock.calls.filter(([path]) => path === '/api/public-cairns/scene')).toHaveLength(0);
    expect(usePublicCairnStore.getState()).toMatchObject({
      viewerId: 'viewer-a', enabled: false, capabilityChecked: false, entries: [], details: {},
    });
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain('"pilotEnabled":true');
  });

  test('refresh and Detail refuse delayed invocation after authenticated owner changes', async () => {
    await initialize();
    const callsBeforeSwitch = mockFetch.mock.calls.length;
    mockAuthenticatedOwnerId = 'viewer-b';

    await usePublicCairnStore.getState().refreshScene();
    await expect(usePublicCairnStore.getState().loadDetail('1'))
      .rejects.toMatchObject({ code: 'superseded' });

    expect(mockFetch).toHaveBeenCalledTimes(callsBeforeSwitch);
    expect(usePublicCairnStore.getState().details).toEqual({});
  });

  test('authenticated owner change fences delayed refresh and Detail completions', async () => {
    await initialize();
    let releaseScene!: (value: any) => void;
    mockFetch.mockImplementationOnce((_path: string, options?: { expectedUserId?: string }) => {
      expect(options?.expectedUserId).toBe('viewer-a');
      return new Promise(resolve => { releaseScene = resolve; });
    });
    const staleScene = usePublicCairnStore.getState().refreshScene();
    while (!releaseScene) await Promise.resolve();
    mockAuthenticatedOwnerId = 'viewer-b';
    releaseScene(response(200, scene([summary('stale-revision', 'public:1:9:9')])));
    await staleScene;
    expect(usePublicCairnStore.getState().entries[0].resourceRevision).toBe('v1');
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain('stale-revision');

    mockAuthenticatedOwnerId = 'viewer-a';
    let releaseDetail!: (value: any) => void;
    mockFetch.mockImplementationOnce((_path: string, options?: { expectedUserId?: string }) => {
      expect(options?.expectedUserId).toBe('viewer-a');
      return new Promise(resolve => { releaseDetail = resolve; });
    });
    const staleDetail = usePublicCairnStore.getState().loadDetail('1');
    while (!releaseDetail) await Promise.resolve();
    mockAuthenticatedOwnerId = 'viewer-b';
    releaseDetail(response(200, { cairn: detail() }));
    await expect(staleDetail).rejects.toMatchObject({ code: 'superseded' });
    expect(usePublicCairnStore.getState().details).toEqual({});
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain('quiet note');
  });

  test.each([
    ['thanks', 'thanks:1', '/api/public-cairns/cairns/1/thanks',
      () => usePublicCairnStore.getState().thanks('1')],
    ['hide', 'hide:1', '/api/public-cairns/cairns/1/hide',
      () => usePublicCairnStore.getState().hide('1')],
    ['block', 'block:10', '/api/friends/10/block',
      () => usePublicCairnStore.getState().blockAuthor('10')],
    ['report', 'report:1:', '/api/public-cairns/cairns/1/report',
      () => usePublicCairnStore.getState().report('1', 'other', 'account fence')],
    ['encounter', 'encounter:11111111-1111-4111-8111-111111111111',
      '/api/public-cairns/encounters/verify',
      () => usePublicCairnStore.getState().verifyCompletedActivity('11111111-1111-4111-8111-111111111111')],
  ])('action %s cannot report A success after acknowledgement persistence crosses into B', async (
    _label, actionPrefix, actionPath, invoke,
  ) => {
    await initialize();
    const held = holdAcknowledgementPersistence(actionPrefix);
    mockFetch.mockImplementation(async (path: string, options?: { expectedUserId?: string }) => {
      if (path === actionPath) {
        expect(options?.expectedUserId).toBe('viewer-a');
        return response(200, { accepted: true });
      }
      expect(options?.expectedUserId).toBe('viewer-b');
      if (path === '/api/public-cairns/capabilities') return response(200, { enabled: true });
      if (path === '/api/public-cairns/scene') return response(200, scene());
      throw new Error(`unexpected ${path}`);
    });

    const staleAction = invoke();
    await held.started;
    mockAuthenticatedOwnerId = 'viewer-b';
    await usePublicCairnStore.getState().initialize('viewer-b');
    const callsBeforeRelease = mockFetch.mock.calls.length;
    expect(usePublicCairnStore.getState()).toMatchObject({ viewerId: 'viewer-b', newlySurfacedId: '1' });

    held.release();
    await expect(staleAction).resolves.toEqual(
      _label === 'encounter' ? false : { status: 'superseded' },
    );
    expect(usePublicCairnStore.getState()).toMatchObject({ viewerId: 'viewer-b', newlySurfacedId: '1' });
    expect(mockFetch).toHaveBeenCalledTimes(callsBeforeRelease);
  });

  test('present cannot clear B newlySurfacedId after A acknowledgement persistence completes late', async () => {
    await initialize();
    const held = holdAcknowledgementPersistence('present:1:');
    mockFetch.mockImplementation(async (path: string, options?: { expectedUserId?: string }) => {
      if (path === '/api/public-cairns/cairns/1/present') {
        expect(options?.expectedUserId).toBe('viewer-a');
        return response(200, { presented: true });
      }
      expect(options?.expectedUserId).toBe('viewer-b');
      if (path === '/api/public-cairns/capabilities') return response(200, { enabled: true });
      if (path === '/api/public-cairns/scene') return response(200, scene());
      throw new Error(`unexpected ${path}`);
    });

    const stalePresent = usePublicCairnStore.getState().present('1');
    await held.started;
    mockAuthenticatedOwnerId = 'viewer-b';
    await usePublicCairnStore.getState().initialize('viewer-b');
    expect(usePublicCairnStore.getState()).toMatchObject({ viewerId: 'viewer-b', newlySurfacedId: '1' });

    held.release();
    await stalePresent;
    expect(usePublicCairnStore.getState()).toMatchObject({ viewerId: 'viewer-b', newlySurfacedId: '1' });
  });

  test('Block is one durable author fence across Public, Friend content and Friend Memory', async () => {
    await initialize([summary(), secondSummary()]);
    mockFetch.mockResolvedValueOnce(response(200, { cairn: detail() }));
    await usePublicCairnStore.getState().loadDetail('1');

    let releaseScene!: (value: any) => void;
    let releaseDetail!: (value: any) => void;
    mockFetch.mockImplementation((path: string) => {
      if (path === '/api/public-cairns/scene') return new Promise(resolve => { releaseScene = resolve; });
      if (path.endsWith('/cairns/2')) return new Promise(resolve => { releaseDetail = resolve; });
      if (path === '/api/friends/10/block') return Promise.reject(new Error('offline'));
      throw new Error(`unexpected ${path}`);
    });
    const oldScene = usePublicCairnStore.getState().refreshScene();
    const oldDetail = usePublicCairnStore.getState().loadDetail('2').catch(error => error);
    while (!releaseScene || !releaseDetail) await Promise.resolve();

    await expect(usePublicCairnStore.getState().blockAuthor('10')).resolves.toEqual({ status: 'queued_offline' });
    expect(mockPurgeFriend).toHaveBeenCalledWith('10', 'viewer-a');
    expect(mockPurgeFriendContent).toHaveBeenCalledWith('10', 'viewer-a');
    expect(mockFriendSetState).toHaveBeenCalledTimes(1);
    expect(mockMarkerSetState).toHaveBeenCalledTimes(1);

    releaseScene(response(200, scene([summary(), secondSummary()])));
    releaseDetail(response(200, { cairn: { ...detail(), ...secondSummary(), text: 'late' } }));
    await oldScene;
    await expect(oldDetail).resolves.toMatchObject({ code: 'superseded' });
    expect(usePublicCairnStore.getState().entries).toEqual([]);
    expect(usePublicCairnStore.getState().details).toEqual({});
    const persisted = mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '';
    expect(persisted).toContain('"blockedAuthorIds":["10"]');
    expect(persisted).toContain('block:10');

    __publicCairnTest.reset();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await usePublicCairnStore.getState().initialize('viewer-a');
    expect(usePublicCairnStore.getState().entries).toEqual([]);
    expect(usePublicCairnStore.getState().details).toEqual({});
  });

  test('a fresh authorized scene begun after invalidation may restore a new publication epoch', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(404, {}));
    await expect(usePublicCairnStore.getState().loadDetail('1')).rejects.toMatchObject({ code: 'unavailable' });
    mockFetch.mockResolvedValueOnce(response(200, scene([summary('v2', 'public:1:2:2')])));
    await usePublicCairnStore.getState().refreshScene();
    expect(usePublicCairnStore.getState().entries[0]).toMatchObject({ resourceRevision: 'v2', authorizationRevision: 'public:1:2:2' });
  });

  test('encounter verification rechecks authority after the refresh it triggered', async () => {
    await initialize();
    let releaseRefresh!: () => void;
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>(resolve => { markRefreshStarted = resolve; });
    const refreshReleased = new Promise<void>(resolve => { releaseRefresh = resolve; });
    const heldRefresh = jest.fn(async () => {
      markRefreshStarted();
      await refreshReleased;
    });
    usePublicCairnStore.setState({ refreshScene: heldRefresh });
    mockFetch.mockResolvedValueOnce(response(200, { accepted: true }));

    const verification = usePublicCairnStore.getState()
      .verifyCompletedActivity('11111111-1111-4111-8111-111111111111');
    await refreshStarted;
    mockAuthenticatedOwnerId = 'viewer-b';
    releaseRefresh();

    await expect(verification).resolves.toBe(false);
    expect(heldRefresh).toHaveBeenCalledTimes(1);
  });

  test('feature-disabled environment purges old Public cache and denies presentation', async () => {
    await initialize();
    __publicCairnTest.reset();
    mockFetch.mockResolvedValueOnce(response(200, { enabled: false }));
    await usePublicCairnStore.getState().initialize('viewer-a');
    expect(usePublicCairnStore.getState()).toMatchObject({ enabled: false, entries: [], details: {} });
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`)).not.toContain('public:1:1:1');
  });

  test('a capability kill switch clears content but preserves and later drains a durable Activity reconciliation', async () => {
    const activityId = '11111111-1111-4111-8111-111111111111';
    await expect(queuePublicActivityReconciliation('viewer-a', activityId)).resolves.toBe(true);
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`)).toContain(`encounter:${activityId}`);

    mockFetch.mockResolvedValueOnce(response(200, { enabled: false }));
    await usePublicCairnStore.getState().initialize('viewer-a');
    const disabled = mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '';
    expect(disabled).toContain(`encounter:${activityId}`);
    expect(disabled).not.toContain('public:1:1:1');

    __publicCairnTest.reset();
    mockFetch
      .mockResolvedValueOnce(response(200, { enabled: true }))
      .mockResolvedValueOnce(response(200, { accepted: true }))
      .mockResolvedValueOnce(response(200, scene([])));
    await usePublicCairnStore.getState().initialize('viewer-a');
    expect(mockFetch.mock.calls.filter(([path]) => path === '/api/public-cairns/encounters/verify')).toHaveLength(1);
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain(`encounter:${activityId}`);
  });

  test('a capability kill switch preserves durable suppression and action queues without retaining Public content', async () => {
    await initialize();
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    await expect(usePublicCairnStore.getState().hide('1')).resolves.toEqual({ status: 'queued_offline' });
    mockFetch.mockResolvedValueOnce(response(200, { enabled: false }));
    await usePublicCairnStore.getState().initialize('viewer-a');
    const disabled = JSON.parse(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '{}');
    expect(disabled.entries).toEqual({});
    expect(disabled.details).toEqual({});
    expect(disabled.hiddenIds).toEqual(['1']);
    expect(Object.keys(disabled.pendingActions)).toContain('hide:1');
  });

  test('authentication expiry is retained for retry and is not mislabeled as offline', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(401, { code: 'TOKEN_EXPIRED' }));
    await expect(usePublicCairnStore.getState().thanks('1')).resolves.toEqual({ status: 'auth_required' });
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').toContain('thanks:1');
  });

  test('an API failure is queued as retryable while a validation rejection is terminal', async () => {
    await initialize();
    mockFetch.mockResolvedValueOnce(response(503, { code: 'TEMPORARY' }));
    await expect(usePublicCairnStore.getState().thanks('1')).resolves.toEqual({ status: 'queued_retry' });
    mockFetch.mockResolvedValueOnce(response(400, { code: 'INVALID_ACTION' }));
    await expect(usePublicCairnStore.getState().thanks('1')).resolves.toEqual({ status: 'rejected' });
    expect(mockValues.get(`${__publicCairnTest.cachePrefix}viewer-a`) ?? '').not.toContain('thanks:1');
  });

  test.each([7301, 7302, 7303])('stateful sequence seed %i preserves account, revision, Hide and reload invariants', async seed => {
    let randomState = seed >>> 0;
    const next = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState;
    };
    let revision = 1;
    let hidden = false;
    let pendingHide = false;
    await initialize([summary(`v${revision}`, `public:1:1:${revision}`)]);

    const initializeAccount = async (viewer: 'viewer-a' | 'viewer-b') => {
      mockAuthenticatedOwnerId = viewer;
      mockFetch.mockResolvedValueOnce(response(200, { enabled: true }));
      if (viewer === 'viewer-a' && pendingHide) {
        mockFetch.mockResolvedValueOnce(response(200, { hidden: true }));
        pendingHide = false;
      }
      const entries = viewer === 'viewer-a' && !hidden
        ? [summary(`v${revision}`, `public:1:1:${revision}`)] : [];
      mockFetch.mockResolvedValueOnce(response(200, scene(entries)));
      await usePublicCairnStore.getState().initialize(viewer);
    };

    for (let step = 0; step < 24; step += 1) {
      const operation = next() % 6;
      if (operation === 0) {
        revision += 1;
        mockFetch.mockResolvedValueOnce(response(200, scene(hidden ? [] : [summary(`v${revision}`, `public:1:1:${revision}`)])));
        await usePublicCairnStore.getState().refreshScene();
      } else if (operation === 1 && usePublicCairnStore.getState().entries[0]) {
        mockFetch.mockResolvedValueOnce(response(200, { cairn: detail(`v${revision}`, `public:1:1:${revision}`) }));
        await usePublicCairnStore.getState().loadDetail('1');
      } else if (operation === 2 && usePublicCairnStore.getState().entries[0]) {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        await usePublicCairnStore.getState().loadDetail('1').catch(() => undefined);
      } else if (operation === 3 && !hidden && usePublicCairnStore.getState().entries[0]) {
        mockFetch.mockRejectedValueOnce(new Error('offline'));
        await usePublicCairnStore.getState().hide('1');
        hidden = true;
        pendingHide = true;
      } else if (operation === 4) {
        await initializeAccount('viewer-b');
        expect(usePublicCairnStore.getState().entries).toEqual([]);
        await initializeAccount('viewer-a');
      } else {
        __publicCairnTest.reset();
        await initializeAccount('viewer-a');
      }

      const state = usePublicCairnStore.getState();
      expect(state.viewerId).toBe('viewer-a');
      if (hidden) expect(state.entries).toEqual([]);
      for (const cachedDetail of Object.values(state.details)) {
        const cachedSummary = state.entries.find(item => item.id === cachedDetail.id);
        expect(cachedSummary).toMatchObject({
          resourceRevision: cachedDetail.resourceRevision,
          authorizationRevision: cachedDetail.authorizationRevision,
        });
      }
    }
  });
});
