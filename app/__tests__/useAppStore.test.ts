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
  // v405: hydrate 现在 attach memory sync + hydrate memory points。
  // mock 两者,避免测试拉入 expo-* native deps。
  jest.doMock('../src/services/memorySync', () => ({
    attachMemorySync: jest.fn(),
    detachMemorySync: jest.fn(),
  }));
  jest.doMock('../src/features/memory/services/memoryPersistence', () => ({
    hydrateMemoryForUser: jest.fn(async () => {}),
    detachMemoryPersistence: jest.fn(async () => {}),
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

    it('v404: valid JWT → user pre-warmed, but isLoggedIn STAYS false (cold boot 必登)', async () => {
      const realUser = { id: '42', name: 'Frank', email: 'frank@example.com' };
      setupMocks(() => realUser);
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();
      const state = useAppStore.getState();

      // v404 rule: 任何 cold boot 都不 auto-login。hydrate 触发 = 一定
      // 是 cold boot(JS bundle 重启),用户必须手动重登。切后台/回前台
      // 走 warm resume,不经过 hydrate,内存里 isLoggedIn 保留。
      expect(state.isLoggedIn).toBe(false);
      // user pre-warmed 使登录后 UI 立可见,不留空白
      expect(state.user).toEqual(realUser);
      expect(state.hydrated).toBe(true);
    });

    it('v405: valid JWT cold-boot → attachMemorySync 被调用 (happy path 修复 1)', async () => {
      const realUser = { id: '4', name: 'Frank', email: 'f@example.com' };
      setupMocks(() => realUser);
      const memSync = require('../src/services/memorySync');
      const memPersist = require('../src/features/memory/services/memoryPersistence');
      const { useAppStore } = require('../src/store/useAppStore');

      await useAppStore.getState().hydrate();

      // 铁证: hydrate 里必须先 hydrateMemoryForUser 再 attachMemorySync,
      // 否则 AsyncStorage 里悬挂的 unsynced points 无法被 subscriber 捕获。
      expect(memPersist.hydrateMemoryForUser).toHaveBeenCalledWith('4');
      expect(memSync.attachMemorySync).toHaveBeenCalledWith('4');
      // Verify order: hydrate 先于 attach (通过调用序号)
      const hydrateOrder = memPersist.hydrateMemoryForUser.mock.invocationCallOrder[0];
      const attachOrder = memSync.attachMemorySync.mock.invocationCallOrder[0];
      expect(hydrateOrder).toBeLessThan(attachOrder);
    });

    it('v405: logout → detachMemorySync + detachMemoryPersistence 双清 (避免旧 userId 泄漏)', async () => {
      setupMocks(() => null);
      const memSync = require('../src/services/memorySync');
      const memPersist = require('../src/features/memory/services/memoryPersistence');
      const { useAppStore } = require('../src/store/useAppStore');

      useAppStore.getState().logout();

      expect(memSync.detachMemorySync).toHaveBeenCalled();
      expect(memPersist.detachMemoryPersistence).toHaveBeenCalled();
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
