let mockResolveMemoryDetach: (() => void) | null = null;
let mockMemoryDetachPromise: Promise<void> = Promise.resolve();
const mockStorage = {
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
  getItem: jest.fn(async () => null),
};
const mockSessionState = { clearSessions: jest.fn(), hydrate: jest.fn(async () => undefined), sessions: [] };
const mockMarkerState = { clearMarkers: jest.fn(), hydrate: jest.fn(async () => undefined) };
const mockTrackingState = {
  suspendForUserSwitch: jest.fn(async () => undefined),
  status: 'idle',
};
const mockGetMe = jest.fn(async () => null);
const mockResumeDeletedAccountPurge = jest.fn(async () => false);

jest.mock('../../services/authService', () => ({ getMe: mockGetMe }));
jest.mock('../../services/accountLocalData', () => ({
  resumeScheduledDeletedAccountLocalPurge: mockResumeDeletedAccountPurge,
}));
jest.mock('../storage', () => ({ storage: mockStorage }));
jest.mock('../useSessionStore', () => ({
  useSessionStore: { getState: () => mockSessionState, setState: jest.fn() },
}));
jest.mock('../useMarkerStore', () => ({
  useMarkerStore: { getState: () => mockMarkerState },
}));
jest.mock('../../services/sessionService', () => ({ fetchSessions: jest.fn(async () => []) }));
jest.mock('../../services/memorySync', () => ({ detachMemorySync: jest.fn() }));
jest.mock('../../features/memory/services/memoryPersistence', () => ({
  detachMemoryPersistence: jest.fn(() => mockMemoryDetachPromise),
}));
jest.mock('../useTrackingStore', () => ({
  useTrackingStore: {
    getState: () => mockTrackingState,
    setState: jest.fn(),
  },
}));
jest.mock('../useFriendStore', () => ({ useFriendStore: { setState: jest.fn() } }));
jest.mock('../../features/friends/services/friendContent', () => ({ resetFriendContentForAccountBoundary: jest.fn() }));
jest.mock('../../features/memory/store/useMemoryStore', () => ({
  useMemoryStore: { getState: () => ({ resetForUserSwitch: jest.fn() }) },
}));
jest.mock('../../features/memory/store/useMemorySettingsStore', () => ({
  useMemorySettingsStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('../../services/iapService', () => ({ resetPurchases: jest.fn(async () => undefined) }));
jest.mock('../../services/crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));

describe('useAppStore serialized account cleanup', () => {
  beforeEach(() => {
    jest.resetModules();
    mockMemoryDetachPromise = new Promise<void>((resolve) => { mockResolveMemoryDetach = resolve; });
    mockStorage.setItem.mockClear();
    mockStorage.removeItem.mockClear();
    mockSessionState.clearSessions.mockClear();
    mockMarkerState.clearMarkers.mockClear();
    mockTrackingState.suspendForUserSwitch.mockClear();
    mockGetMe.mockClear();
    mockResumeDeletedAccountPurge.mockReset();
    mockResumeDeletedAccountPurge.mockResolvedValue(false);
  });

  test('APP/LOGOUT-LOCK-01 B cannot begin and A remains published until all awaited A cleanup settles', async () => {
    const transitions = require('../../services/accountTransitionAuthority');
    const { useAppStore } = require('../useAppStore');
    useAppStore.setState({
      user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
      isLoggedIn: true,
    });

    const logoutA = useAppStore.getState().logout({ expectedUserId: 'owner-a' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(useAppStore.getState().user?.id).toBe('owner-a');
    expect(transitions.beginAccountTransition({ kind: 'login' })).toEqual({ error: 'transition_in_progress' });
    expect(mockSessionState.clearSessions).toHaveBeenCalledTimes(1);

    mockResolveMemoryDetach?.();
    await expect(logoutA).resolves.toBe(true);
    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().isLoggedIn).toBe(false);
    expect(transitions.beginAccountTransition({ kind: 'login' }).authority).toBeTruthy();
  });

  test('APP/PURGE-READ-FAIL-01 cold hydrate does not treat marker read failure as absence', async () => {
    const { useAppStore } = require('../useAppStore');
    mockResumeDeletedAccountPurge.mockRejectedValueOnce(new Error('account_local_purge_secure_read_failed'));
    useAppStore.setState({ user: null, isLoggedIn: false, hydrated: false });

    await useAppStore.getState().hydrate();

    expect(mockGetMe).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toMatchObject({
      user: null,
      isLoggedIn: false,
      hydrated: true,
    });
  });
});
