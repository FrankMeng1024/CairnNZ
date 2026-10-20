const mockSecureValues = new Map<string, string>();
const secure = {
  get value(): string | null { return mockSecureValues.get('cairn_jwt') ?? null; },
  set value(value: string | null) { if (value == null) mockSecureValues.delete('cairn_jwt'); else mockSecureValues.set('cairn_jwt', value); },
};

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureValues.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockSecureValues.set(key, value); }),
  deleteItemAsync: jest.fn(async (key: string) => { mockSecureValues.delete(key); }),
}));

describe('token owner + generation compare-and-swap boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSecureValues.clear();
    const secureStore = require('expo-secure-store');
    secureStore.getItemAsync.mockImplementation(async (key: string) => mockSecureValues.get(key) ?? null);
    secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => { mockSecureValues.set(key, value); });
    secureStore.deleteItemAsync.mockImplementation(async (key: string) => { mockSecureValues.delete(key); });
  });

  test('AUTH/TOKEN-OWNER-01 owner-null snapshot dies when getMe binds owner', async () => {
    const transitions = require('../accountTransitionAuthority');
    const store = require('../tokenStore');
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const ownerNull = await store.installTokenForAccountTransition(transition, 'token-a', null);

    const bound = await store.bindTokenOwnerIfCurrent(ownerNull, 'owner-a');

    expect(bound).toMatchObject({ token: 'token-a', ownerUserId: 'owner-a' });
    expect(bound.generation).toBeGreaterThan(ownerNull.generation);
    await expect(store.isTokenAuthorityCurrent(ownerNull)).resolves.toBe(false);
    await expect(store.clearTokenIfCurrent(ownerNull)).resolves.toBe(false);
    expect(secure.value).toBe('token-a');
  });

  test('AUTH/TRANSITION-01 B cannot install while A owns device transition', async () => {
    const transitions = require('../accountTransitionAuthority');
    const store = require('../tokenStore');
    const a = transitions.beginAccountTransition({ kind: 'logout', expectedOwnerUserId: 'owner-a' }).authority;
    const bBlocked = transitions.beginAccountTransition({ kind: 'login' });

    expect(bBlocked).toEqual({ error: 'transition_in_progress' });
    expect(await store.installTokenForAccountTransition(a, 'token-a', 'owner-a')).toBeTruthy();
    transitions.finishAccountTransition(a);

    const b = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const bAuthority = await store.installTokenForAccountTransition(b, 'token-b', 'owner-b');
    expect(bAuthority).toMatchObject({ token: 'token-b', ownerUserId: 'owner-b' });
    expect(secure.value).toBe('token-b');
  });

  test('AUTH/TOKEN-OWNER-02 CAS rejects matching token+generation with wrong owner', async () => {
    const transitions = require('../accountTransitionAuthority');
    const store = require('../tokenStore');
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const authority = await store.installTokenForAccountTransition(transition, 'same-token', 'owner-a');
    const forged = { ...authority, ownerUserId: 'owner-b' };

    await expect(store.replaceTokenIfCurrent(forged, 'forged-refresh')).resolves.toBeNull();
    await expect(store.clearTokenIfCurrent(forged)).resolves.toBe(false);
    expect(secure.value).toBe('same-token');
  });

  test('HEADLESS/TOKEN-OWNER-01 returns a credential only for its durable exact owner', async () => {
    const transitions = require('../accountTransitionAuthority');
    const store = require('../tokenStore');
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    await store.installTokenForAccountTransition(transition, 'token-a', 'owner-a');

    await expect(store.getHeadlessTokenForOwner('owner-a')).resolves.toBe('token-a');
    await expect(store.getHeadlessTokenForOwner('owner-b')).resolves.toBeNull();
  });

  test('AUTH/REFRESH-LEASE-01 same-owner logout synchronously preempts refresh but other owner cannot', () => {
    const transitions = require('../accountTransitionAuthority');
    const refreshA = transitions.beginAccountTransition({
      kind: 'refresh-token', expectedOwnerUserId: 'owner-a',
    }).authority;

    expect(transitions.beginAccountTransition({
      kind: 'logout', expectedOwnerUserId: 'owner-b',
    })).toEqual({ error: 'transition_in_progress' });

    const logoutA = transitions.beginAccountTransition({
      kind: 'logout', expectedOwnerUserId: 'owner-a',
    }).authority;
    expect(logoutA).toBeTruthy();
    expect(transitions.isAccountTransitionCurrent(refreshA)).toBe(false);
    expect(transitions.isAccountTransitionCurrent(logoutA)).toBe(true);
    // A stale refresh finally block cannot release the replacement lease.
    expect(transitions.finishAccountTransition(refreshA)).toBe(false);
    expect(transitions.isAccountTransitionCurrent(logoutA)).toBe(true);
  });

  test('AUTH/REFRESH-LEASE-02 preemption during durable owner write retires both token halves', async () => {
    const transitions = require('../accountTransitionAuthority');
    const store = require('../tokenStore');
    const secureStore = require('expo-secure-store');
    const login = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const original = await store.installTokenForAccountTransition(login, 'token-a', 'owner-a');
    transitions.finishAccountTransition(login);

    let ownerWriteEntered!: () => void;
    let releaseOwnerWrite!: () => void;
    const entered = new Promise<void>(resolve => { ownerWriteEntered = resolve; });
    const held = new Promise<void>(resolve => { releaseOwnerWrite = resolve; });
    secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
      mockSecureValues.set(key, value);
      if (key === 'cairn_jwt_owner_v1') {
        ownerWriteEntered();
        await held;
      }
    });

    const refresh = transitions.beginAccountTransition({
      kind: 'refresh-token', expectedOwnerUserId: 'owner-a',
    }).authority;
    const replacing = store.replaceTokenIfCurrent(original, 'token-refreshed', 'owner-a', refresh);
    await entered;
    const logout = transitions.beginAccountTransition({
      kind: 'logout', expectedOwnerUserId: 'owner-a',
    }).authority;
    expect(logout).toBeTruthy();
    releaseOwnerWrite();

    await expect(replacing).resolves.toBeNull();
    expect(mockSecureValues.get('cairn_jwt')).toBeUndefined();
    expect(mockSecureValues.get('cairn_jwt_owner_v1')).toBeUndefined();
    await expect(store.getHeadlessTokenForOwner('owner-a')).resolves.toBeNull();
  });
});
