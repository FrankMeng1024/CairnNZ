const secure = { value: null as string | null };

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => secure.value),
  setItemAsync: jest.fn(async (_key: string, value: string) => { secure.value = value; }),
  deleteItemAsync: jest.fn(async () => { secure.value = null; }),
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('AuthScreen session installation behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    secure.value = null;
  });

  test('AUTH/SCREEN-UNMOUNT-01 unmount during credential write cannot hydrate/publish A or leave A token authoritative', async () => {
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const { installAuthenticatedSession } = require('../authSessionInstallation');
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const tokenAuthority = await tokens.installTokenForAccountTransition(transition, 'token-a', 'owner-a');
    const credentials = deferred();
    let mounted = true;
    const publish = jest.fn();
    const hydrate = jest.fn(async () => ({ authenticatedOwnerUserId: 'owner-a' }));

    const installing = installAuthenticatedSession({
      result: {
        user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
        tokenAuthority,
        transitionAuthority: transition,
      },
      beforeHydrate: jest.fn(() => credentials.promise),
      hydrate,
      shouldContinue: () => mounted,
      publish,
    });
    await Promise.resolve();
    expect(transitions.beginAccountTransition({ kind: 'login' })).toEqual({ error: 'transition_in_progress' });

    mounted = false;
    credentials.resolve();
    await expect(installing).resolves.toBe(false);
    expect(hydrate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(secure.value).toBeNull();
    expect(transitions.beginAccountTransition({ kind: 'login' }).authority).toBeTruthy();
  });

  test('AUTH/SCREEN-INSTALL-01 publishes only after hydrate and same authority survive', async () => {
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const { installAuthenticatedSession } = require('../authSessionInstallation');
    const transition = transitions.beginAccountTransition({ kind: 'password-reset' }).authority;
    const tokenAuthority = await tokens.installTokenForAccountTransition(transition, 'token-a', 'owner-a');
    const order: string[] = [];

    await expect(installAuthenticatedSession({
      result: {
        user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
        tokenAuthority,
        transitionAuthority: transition,
      },
      beforeHydrate: jest.fn(async () => { order.push('credentials'); }),
      hydrate: jest.fn(async () => {
        order.push('hydrate');
        return { authenticatedOwnerUserId: 'owner-a' };
      }),
      beforePublish: jest.fn(async () => { order.push('marker'); }),
      shouldContinue: () => true,
      publish: jest.fn(() => { order.push('publish'); }),
    })).resolves.toBe(true);

    expect(order).toEqual(['credentials', 'hydrate', 'marker', 'publish']);
    expect(secure.value).toBe('token-a');
  });

  test('AUTH/SCREEN-INSTALL-02 guest hydrate cannot be published as the supplied authenticated owner', async () => {
    const transitions = require('../accountTransitionAuthority');
    const tokens = require('../tokenStore');
    const { installAuthenticatedSession } = require('../authSessionInstallation');
    const transition = transitions.beginAccountTransition({ kind: 'login' }).authority;
    const tokenAuthority = await tokens.installTokenForAccountTransition(transition, 'token-a', 'owner-a');
    const publish = jest.fn();

    await expect(installAuthenticatedSession({
      result: {
        user: { id: 'owner-a', name: 'A', email: 'a@example.test' },
        tokenAuthority,
        transitionAuthority: transition,
      },
      hydrate: jest.fn(async () => ({ authenticatedOwnerUserId: null })),
      shouldContinue: () => true,
      publish,
    })).resolves.toBe(false);

    expect(publish).not.toHaveBeenCalled();
    expect(secure.value).toBeNull();
    expect(transitions.beginAccountTransition({ kind: 'login' }).authority).toBeTruthy();
  });
});
