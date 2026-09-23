const mockSecureToken = { current: null as string | null };
const mockApp = {
  state: {
    user: null as null | { id: string },
    isLoggedIn: false,
    logout: jest.fn(async ({ expectedUserId }: { expectedUserId: string }) => {
      if (mockApp.state.user?.id !== expectedUserId) return false;
      mockApp.state.user = null;
      mockApp.state.isLoggedIn = false;
      return true;
    }),
  },
};

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: 1,
  getItemAsync: jest.fn(async () => mockSecureToken.current),
  setItemAsync: jest.fn(async (_key: string, value: string) => { mockSecureToken.current = value; }),
  deleteItemAsync: jest.fn(async () => { mockSecureToken.current = null; }),
}));
jest.mock('../../config/api', () => ({ API_BASE_URL: 'https://authority.test' }));
jest.mock('../crashLogger', () => ({ crashLogger: { breadcrumb: jest.fn() } }));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => mockApp.state },
}));
jest.mock('../accountLocalData', () => ({
  resumeScheduledDeletedAccountLocalPurge: jest.fn(async () => false),
  getDeletedAccountPurgeRecord: jest.fn(async () => null),
  reserveDeletedAccountLocalPurge: jest.fn(async () => undefined),
  markDeletedAccountLocalPurgeUnknown: jest.fn(async () => undefined),
  clearDeletedAccountPurgeReservation: jest.fn(async () => undefined),
  clearDeletedAccountPurgeAfterReconciliation: jest.fn(async () => undefined),
  clearDeletedAccountPurgeAfterRestore: jest.fn(async () => undefined),
  scheduleDeletedAccountLocalPurge: jest.fn(async () => undefined),
  completeDeletedAccountLocalPurge: jest.fn(async () => undefined),
  purgeDeletedAccountLocalData: jest.fn(async () => undefined),
  purgeDeletedAccountDeviceGlobalData: jest.fn(async () => undefined),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function response(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    headers: { get: () => null },
    json: jest.fn(async () => body),
  } as unknown as Response;
}

async function install(owner: string, token: string) {
  const transitions = require('../accountTransitionAuthority');
  const store = require('../tokenStore');
  const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
  const authority = await store.installTokenForAccountTransition(transition, token, owner);
  transitions.finishAccountTransition(transition);
  mockApp.state.user = { id: owner };
  mockApp.state.isLoggedIn = true;
  return authority;
}

describe('authService account/token authority races', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSecureToken.current = null;
    mockApp.state.user = null;
    mockApp.state.isLoggedIn = false;
    mockApp.state.logout.mockClear();
  });

  afterEach(() => { delete (global as any).fetch; });

  test('AUTH/LOGOUT-LOCK-01 B transition is rejected until delayed A logout cleanup settles', async () => {
    const authorityA = await install('owner-a', 'token-a');
    const auth = require('../authService');
    const transitions = require('../accountTransitionAuthority');
    const reply = deferred<Response>();
    global.fetch = jest.fn(() => reply.promise);

    const logoutA = auth.logout({ expectedAuthority: authorityA, expectedUserId: 'owner-a' });
    await Promise.resolve();
    expect(transitions.beginAccountTransition({ kind: 'login' })).toEqual({ error: 'transition_in_progress' });

    reply.resolve(response(true, 204, {}));
    await expect(logoutA).resolves.toEqual({ cleared: true, ownerChanged: false });
    expect(mockApp.state.logout).toHaveBeenCalledWith(expect.objectContaining({ expectedUserId: 'owner-a' }));
    expect(mockSecureToken.current).toBeNull();
    expect(transitions.beginAccountTransition({ kind: 'login' }).authority).toBeTruthy();
  });

  test('AUTH/OWNER-DISPATCH-01 app-A/token-B mismatch fails before getMe network dispatch', async () => {
    await install('owner-b', 'token-b');
    mockApp.state.user = { id: 'owner-a' };
    global.fetch = jest.fn();
    const auth = require('../authService');

    await expect(auth.getMe('owner-a')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('AUTH/OWNER-DISPATCH-02 signed-out expected-owner getMe needs the current install transition', async () => {
    await install('owner-a', 'token-a');
    mockApp.state.user = null;
    mockApp.state.isLoggedIn = false;
    global.fetch = jest.fn();
    const auth = require('../authService');

    await expect(auth.getMe('owner-a')).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('AUTH/REFRESH-LOGOUT-01 in-flight A refresh cannot rotate after logout captures A', async () => {
    const authorityA = await install('owner-a', 'token-a');
    const auth = require('../authService');
    const reply = deferred<Response>();
    let markRefreshDispatched!: () => void;
    const refreshDispatched = new Promise<void>((accept) => { markRefreshDispatched = accept; });
    global.fetch = jest.fn((url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        markRefreshDispatched();
        return reply.promise;
      }
      return Promise.resolve(response(true, 204, {}));
    }) as unknown as typeof fetch;

    const refreshA = auth.refreshToken('owner-a');
    await refreshDispatched;
    await expect(auth.logout({ expectedAuthority: authorityA, expectedUserId: 'owner-a' }))
      .resolves.toEqual({ cleared: true, ownerChanged: false });
    expect(mockSecureToken.current).toBeNull();
    reply.resolve(response(true, 200, { token: 'late-a-refresh' }));

    await expect(refreshA).resolves.toEqual({ error: 'authority_changed' });
    expect(mockSecureToken.current).toBeNull();
  });

  test('AUTH/REFRESH-LOGOUT-02 logout preemption inside the token-write barrier retires the late token atomically', async () => {
    await install('owner-a', 'token-a');
    const auth = require('../authService');
    const secureStore = require('expo-secure-store');
    const writeEntered = deferred<void>();
    const releaseWrite = deferred<void>();
    secureStore.setItemAsync.mockImplementationOnce(async (_key: string, value: string) => {
      writeEntered.resolve(undefined);
      await releaseWrite.promise;
      mockSecureToken.current = value;
    });
    global.fetch = jest.fn(async (url: string) => {
      if (!url.endsWith('/api/auth/refresh')) throw new Error(`unexpected request ${url}`);
      return response(true, 200, { token: 'late-a-refresh' });
    }) as unknown as typeof fetch;

    const refreshA = auth.refreshToken('owner-a');
    await writeEntered.promise;
    // beginAccountTransition runs synchronously before logout's token read,
    // preempting refresh while replaceTokenIfCurrent is inside SecureStore.
    const logoutA = auth.logout({ expectedUserId: 'owner-a' });
    releaseWrite.resolve(undefined);

    await expect(refreshA).resolves.toEqual({ error: 'authority_changed' });
    await expect(logoutA).resolves.toEqual({ cleared: true, ownerChanged: false });
    expect(mockApp.state.user).toBeNull();
    expect(mockSecureToken.current).toBeNull();
  });

  test('AUTH/PASSWORD-UNKNOWN-01 post-dispatch 500 is UNKNOWN and retry does not dispatch', async () => {
    await install('owner-a', 'token-a');
    global.fetch = jest.fn(async () => response(false, 500, { error: 'server_error' }));
    const auth = require('../authService');

    await expect(auth.changePassword('old-password', 'New-password1', 'owner-a')).resolves.toMatchObject({
      commitState: 'unknown',
    });
    await expect(auth.changePassword('old-password', 'New-password1', 'owner-a')).resolves.toMatchObject({
      error: expect.stringContaining('unresolved'),
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('AUTH/PASSWORD-RECONCILE-01 successful password login clears prior change-password UNKNOWN fence', async () => {
    await install('owner-a', 'token-a');
    let passwordCalls = 0;
    global.fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/password')) {
        passwordCalls += 1;
        return passwordCalls === 1
          ? response(false, 500, { error: 'server_error' })
          : response(false, 400, { error: 'wrong_current_password' });
      }
      if (url.endsWith('/api/auth/login')) {
        return response(true, 200, {
          token: 'reconciled-token-a',
          user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
        });
      }
      throw new Error(`unexpected request ${url}`);
    }) as unknown as typeof fetch;
    const auth = require('../authService');
    const transitions = require('../accountTransitionAuthority');

    await expect(auth.changePassword('old', 'new', 'owner-a')).resolves.toMatchObject({
      commitState: 'unknown',
    });
    const reconciled = await auth.login('a@example.test', 'new');
    expect(reconciled.error).toBeUndefined();
    transitions.finishAccountTransition(reconciled.transitionAuthority);

    await expect(auth.changePassword('new', 'newer', 'owner-a')).resolves.toMatchObject({
      error: 'wrong_current_password',
    });
    expect(passwordCalls).toBe(2);
  });

  test('AUTH/DELETE-MONOTONIC-01 post-2xx local logout throw stays COMMITTED and never marks UNKNOWN', async () => {
    await install('owner-a', 'token-a');
    mockApp.state.logout.mockImplementationOnce(async () => { throw new Error('local_cleanup_failed'); });
    global.fetch = jest.fn(async () => response(true, 200, {
      deleted_at: '2026-09-20T08:00:00.000Z',
      restore_deadline: '2026-09-27T08:00:00.000Z',
    }));
    const auth = require('../authService');
    const local = require('../accountLocalData');

    await expect(auth.deleteAccount('owner-a')).resolves.toMatchObject({
      commitState: 'committed',
      localCleanup: 'pending',
      durableCleanupScheduled: true,
    });
    expect(local.scheduleDeletedAccountLocalPurge).toHaveBeenCalledWith('owner-a');
    // Exactly one UNKNOWN promotion is required immediately pre-dispatch.
    // A post-2xx cleanup error must not add a second/downgrading write.
    expect(local.markDeletedAccountLocalPurgeUnknown).toHaveBeenCalledTimes(1);
    expect(local.markDeletedAccountLocalPurgeUnknown.mock.invocationCallOrder[0])
      .toBeLessThan(local.scheduleDeletedAccountLocalPurge.mock.invocationCallOrder[0]);
  });

  test('AUTH/RESET-UNKNOWN-01 post-dispatch 500 blocks immediate reset replay', async () => {
    global.fetch = jest.fn(async () => response(false, 500, { error: 'server_error' }));
    const auth = require('../authService');

    await expect(auth.passwordResetVerify('a@example.test', '123456', 'New-password1')).resolves.toMatchObject({
      commitState: 'unknown',
      hint: 'commit_unknown',
    });
    await expect(auth.passwordResetVerify('a@example.test', '123456', 'New-password1')).resolves.toMatchObject({
      hint: 'commit_unknown',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
