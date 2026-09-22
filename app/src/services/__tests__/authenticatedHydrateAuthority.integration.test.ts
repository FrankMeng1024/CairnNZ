const secure = { token: null as string | null };
const mockStorage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};
const mockSessionState = {
  sessions: [] as any[],
  hydrate: jest.fn(async () => undefined),
  clearSessions: jest.fn(),
};
const mockMarkerState = {
  hydrate: jest.fn(async () => undefined),
  clearMarkers: jest.fn(),
};
const mockResumeDeletedAccountPurge = jest.fn(async () => false);

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 1,
  getItemAsync: jest.fn(async () => secure.token),
  setItemAsync: jest.fn(async (_key: string, value: string) => { secure.token = value; }),
  deleteItemAsync: jest.fn(async () => { secure.token = null; }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    removeItem: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
  },
}));
jest.mock('../../config/api', () => ({ API_BASE_URL: 'https://authority.test' }));
jest.mock('../../store/storage', () => ({ storage: mockStorage }));
jest.mock('../../store/useSessionStore', () => ({
  useSessionStore: { getState: () => mockSessionState, setState: jest.fn() },
}));
jest.mock('../../store/useMarkerStore', () => ({
  useMarkerStore: { getState: () => mockMarkerState },
}));
jest.mock('../sessionService', () => ({ fetchSessions: jest.fn(async () => []) }));
jest.mock('../memorySync', () => ({ detachMemorySync: jest.fn() }));
jest.mock('../../features/memory/services/memoryPersistence', () => ({
  detachMemoryPersistence: jest.fn(async () => undefined),
}));
jest.mock('../../store/useTrackingStore', () => ({
  useTrackingStore: {
    getState: () => ({ status: 'idle', suspendForUserSwitch: jest.fn(async () => undefined) }),
    setState: jest.fn(),
  },
}));
jest.mock('../../store/useFriendStore', () => ({ useFriendStore: { setState: jest.fn() } }));
jest.mock('../../features/friends/services/friendContent', () => ({ resetFriendContentForAccountBoundary: jest.fn() }));
jest.mock('../../features/memory/store/useMemoryStore', () => ({
  useMemoryStore: { getState: () => ({ resetForUserSwitch: jest.fn() }) },
}));
jest.mock('../../features/memory/store/useMemorySettingsStore', () => ({
  useMemorySettingsStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('../accountLocalData', () => ({
  resumeScheduledDeletedAccountLocalPurge: mockResumeDeletedAccountPurge,
}));
jest.mock('../pendingSyncStore', () => ({ listPending: jest.fn(async () => []) }));
jest.mock('../offlineQueue', () => ({ drain: jest.fn(async () => undefined) }));
jest.mock('../syncDaemon', () => ({ drainPending: jest.fn(async () => undefined) }));
jest.mock('../../store/useWeatherStore', () => ({
  useWeatherStore: { getState: () => ({ locationOverride: null, fetchWeather: jest.fn() }) },
}));
jest.mock('../iapService', () => ({ resetPurchases: jest.fn(async () => undefined) }));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: jest.fn(async () => body),
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function waitForCall(mock: jest.Mock): Promise<void> {
  for (let index = 0; index < 20 && mock.mock.calls.length === 0; index += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  expect(mock).toHaveBeenCalled();
}

describe('real pre-publish authenticated hydrate authority', () => {
  beforeEach(() => {
    jest.resetModules();
    secure.token = null;
    mockSessionState.sessions = [];
    mockSessionState.hydrate.mockClear();
    mockMarkerState.hydrate.mockClear();
    mockResumeDeletedAccountPurge.mockClear();
  });

  afterEach(() => { delete (global as any).fetch; });

  test('AUTH/HYDRATE-PREPUBLISH-01 signed-out login lease hydrates owner A, never guest, before publishing A', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (!url.endsWith('/api/auth/me')) throw new Error(`unexpected request ${url}`);
      return response({ user: { id: 'owner-a', name: 'A', email: 'a@example.test' } });
    }) as unknown as typeof fetch;
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const { installAuthenticatedSession } = require('../authSessionInstallation');
    const { useAppStore } = require('../../store/useAppStore');
    useAppStore.setState({ user: null, isLoggedIn: false, hydrated: false });

    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const tokenAuthority = await tokens.installTokenForAccountTransition(
      transition, 'token-a', 'owner-a',
    );
    const user = { id: 'owner-a', name: 'A', email: 'a@example.test' };

    await expect(installAuthenticatedSession({
      result: { user, tokenAuthority, transitionAuthority: transition },
      hydrate: (options: any) => useAppStore.getState().hydrate(options),
      shouldContinue: () => true,
      publish: (installed: any) => useAppStore.setState({ user: installed, isLoggedIn: true }),
    })).resolves.toBe(true);

    expect(mockResumeDeletedAccountPurge).toHaveBeenCalledWith(transition);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://authority.test/api/auth/me',
      expect.objectContaining({ headers: { Authorization: 'Bearer token-a' } }),
    );
    expect(mockMarkerState.hydrate).toHaveBeenCalledWith('owner-a');
    expect(mockMarkerState.hydrate).not.toHaveBeenCalledWith('guest');
    expect(mockSessionState.hydrate).toHaveBeenCalledWith('owner-a');
    expect(mockSessionState.hydrate).not.toHaveBeenCalledWith('guest');
    expect(useAppStore.getState()).toMatchObject({
      isLoggedIn: true,
      user: { id: 'owner-a' },
    });
  });

  test('AUTH/HYDRATE-PREPUBLISH-02 guest fallback cannot publish the login result as authenticated', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const { installAuthenticatedSession } = require('../authSessionInstallation');
    const { useAppStore } = require('../../store/useAppStore');
    useAppStore.setState({ user: null, isLoggedIn: false, hydrated: false });

    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const tokenAuthority = await tokens.installTokenForAccountTransition(
      transition, 'token-a', 'owner-a',
    );
    const user = { id: 'owner-a', name: 'A', email: 'a@example.test' };
    const publish = jest.fn((installed: any) => {
      useAppStore.setState({ user: installed, isLoggedIn: true });
    });

    await expect(installAuthenticatedSession({
      result: { user, tokenAuthority, transitionAuthority: transition },
      hydrate: (options: any) => useAppStore.getState().hydrate(options),
      shouldContinue: () => true,
      publish,
    })).resolves.toBe(false);

    expect(mockSessionState.hydrate).toHaveBeenCalledWith('guest');
    expect(mockMarkerState.hydrate).toHaveBeenCalledWith('guest');
    expect(publish).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({ isLoggedIn: false, user: null });
    expect(secure.token).toBeNull();
  });

  test('AUTH/HYDRATE-UNMOUNT-03 keeps A exclusive until its real hydrate settles', async () => {
    global.fetch = jest.fn(async (url: string) => {
      if (!url.endsWith('/api/auth/me')) throw new Error(`unexpected request ${url}`);
      return response({ user: { id: 'owner-a', name: 'A', email: 'a@example.test' } });
    }) as unknown as typeof fetch;
    const markerGate = deferred<undefined>();
    mockMarkerState.hydrate.mockImplementationOnce(() => markerGate.promise);
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const sessions = require('../authSessionInstallation');
    const { useAppStore } = require('../../store/useAppStore');
    useAppStore.setState({ user: null, isLoggedIn: false, hydrated: false });

    const transitionA = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const tokenAuthorityA = await tokens.installTokenForAccountTransition(
      transitionA, 'token-a', 'owner-a',
    );
    let mounted = true;
    let installationInFlight = true;
    const installingA = sessions.installAuthenticatedSession({
      result: {
        user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
        tokenAuthority: tokenAuthorityA,
        transitionAuthority: transitionA,
      },
      hydrate: (options: any) => useAppStore.getState().hydrate(options),
      shouldContinue: () => mounted,
      publish: jest.fn(),
    }).finally(() => { installationInFlight = false; });
    await waitForCall(mockMarkerState.hydrate);

    mounted = false;
    const releaseOnUnmount = sessions.releaseAuthScreenAuthorityOnUnmount
      ?? ((input: any) => {
        if (input.token) void tokens.clearTokenIfCurrent(input.token);
        if (input.transition) transitions.finishAccountTransition(input.transition);
      });
    releaseOnUnmount({
      installationInFlight,
      transition: transitionA,
      token: tokenAuthorityA,
    });

    const competingB = transitions.beginAccountTransition({ kind: 'login' });
    if (competingB.authority) transitions.finishAccountTransition(competingB.authority);
    expect(competingB.error).toBe('transition_in_progress');

    markerGate.resolve(undefined);
    await expect(installingA).resolves.toBe(false);
    expect(mockSessionState.hydrate).toHaveBeenCalledWith('owner-a');
    expect(installationInFlight).toBe(false);

    const afterA = transitions.beginAccountTransition({ kind: 'login' });
    expect(afterA.authority).toBeDefined();
    transitions.finishAccountTransition(afterA.authority);
  });
});
