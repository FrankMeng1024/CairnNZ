/**
 * useAppStore.test — verify auth hydration flow.
 * Critical: Ensures bypass NEVER auto-logs prod users in,
 * fresh install lands on Auth screen, and restored JWT lands on Home.
 */

const setupMocks = (getMeImpl: () => any) => {
  jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
  jest.doMock('@react-native-async-storage/async-storage', () => {
    const store: Record<string, string> = {};
    return {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
    };
  });
  jest.doMock('../src/services/authService', () => ({
    getMe: jest.fn(getMeImpl),
  }));
  // Sprint 72 STORY-00549: mocks for new dependencies pulled in by hydrate rewrite
  jest.doMock('../src/services/crashLogger', () => ({
    crashLogger: { breadcrumb: jest.fn(), install: jest.fn(), uploadCrashIfAny: jest.fn(async () => {}) },
  }));
  jest.doMock('../src/services/a8Migration', () => ({
    runA8Migration: jest.fn(async () => ({ showToast: false })),
  }));
  jest.doMock('../src/store/useArOriginStore', () => ({
    useArOriginStore: {
      getState: () => ({ hydrate: jest.fn(async () => {}), setMigrationToast: jest.fn() }),
    },
  }));
  jest.doMock('../src/services/sessionService', () => ({
    fetchSessions: jest.fn(async () => []),
  }));
  jest.doMock('../src/store/useSessionStore', () => ({
    useSessionStore: {
      getState: () => ({ hydrate: jest.fn(async () => {}), clearSessions: jest.fn() }),
      setState: jest.fn(),
    },
  }));
  jest.doMock('../src/store/useMarkerStore', () => ({
    useMarkerStore: {
      getState: () => ({ hydrate: jest.fn(async () => {}), clearMarkers: jest.fn() }),
    },
  }));
};

describe('useAppStore.hydrate', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS;
  });

  describe('production safety (no bypass)', () => {
    beforeEach(() => {
      (global as any).__DEV__ = false;
    });

    it('does NOT auto-login as Playwright user even when env var is "true"', async () => {
      process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS = 'true';
      setupMocks(() => null);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(false);
      expect(state.user).toBeNull();
      expect(state.hydrated).toBe(true);
    });

    it('lands on Sign In (isLoggedIn=false) when no JWT exists', async () => {
      setupMocks(() => null);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(false);
      expect(state.hydrated).toBe(true);
    });

    it('restores user (isLoggedIn=true) when JWT is valid', async () => {
      const realUser = { id: '42', name: 'Frank', email: 'frank@example.com' };
      setupMocks(() => realUser);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(true);
      expect(state.user).toEqual(realUser);
      expect(state.hydrated).toBe(true);
    });

    it('lands on Sign In when network throws (offline first launch)', async () => {
      setupMocks(() => {
        throw new Error('network down');
      });
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(false);
      expect(state.hydrated).toBe(true);
    });
  });

  describe('dev bypass (only in __DEV__)', () => {
    beforeEach(() => {
      (global as any).__DEV__ = true;
    });

    it('activates bypass when both __DEV__ and env="true"', async () => {
      process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS = 'true';
      setupMocks(() => null);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(true);
      expect(state.user?.email).toBe('pw@cairn.nz');
      expect(state.hydrated).toBe(true);
    });

    it('does NOT activate bypass when env is empty string (EAS dev profile override)', async () => {
      process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS = '';
      setupMocks(() => null);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      expect(state.isLoggedIn).toBe(false);
      expect(state.user).toBeNull();
    });
  });
});
