const secure = { value: null as string | null };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => secure.value),
  setItemAsync: jest.fn(async (_key: string, value: string) => { secure.value = value; }),
  deleteItemAsync: jest.fn(async () => { secure.value = null; }),
}));

describe('token owner + generation compare-and-swap boundary', () => {
  beforeEach(() => {
    jest.resetModules();
    secure.value = null;
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
});
