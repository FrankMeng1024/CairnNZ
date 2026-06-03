/**
 * storage.test — verify storage abstraction works for both web and native.
 */

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __reset: () => {
      Object.keys(store).forEach((k) => delete store[k]);
    },
  };
});

// Default to native; override per-test if web behavior is needed
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

describe('storage', () => {
  beforeEach(() => {
    (AsyncStorage as any).__reset?.();
    jest.clearAllMocks();
  });

  describe('on native (iOS/Android)', () => {
    it('round-trips a string via AsyncStorage', async () => {
      const { storage } = require('../src/store/storage');
      await storage.setItem('foo', 'bar');
      const got = await storage.getItem('foo');
      expect(got).toBe('bar');
      expect(AsyncStorage.setItem).toHaveBeenCalledWith('foo', 'bar');
      expect(AsyncStorage.getItem).toHaveBeenCalledWith('foo');
    });

    it('returns null for missing key', async () => {
      const { storage } = require('../src/store/storage');
      const got = await storage.getItem('missing');
      expect(got).toBeNull();
    });

    it('removes a key', async () => {
      const { storage } = require('../src/store/storage');
      await storage.setItem('removeme', 'value');
      await storage.removeItem('removeme');
      const got = await storage.getItem('removeme');
      expect(got).toBeNull();
      expect(AsyncStorage.removeItem).toHaveBeenCalledWith('removeme');
    });

    it('persists across multiple operations on the same module instance', async () => {
      const { storage } = require('../src/store/storage');
      await storage.setItem('persist_test', 'value123');
      // Multiple subsequent reads return the persisted value
      expect(await storage.getItem('persist_test')).toBe('value123');
      expect(await storage.getItem('persist_test')).toBe('value123');
      // Even after writing other keys
      await storage.setItem('other_key', 'other');
      expect(await storage.getItem('persist_test')).toBe('value123');
    });

    it('does NOT throw when AsyncStorage.getItem rejects (boot resilience)', async () => {
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      const { storage } = require('../src/store/storage');
      const got = await storage.getItem('any_key');
      expect(got).toBeNull(); // Silently returns null instead of throwing
    });

    it('does NOT throw when AsyncStorage.setItem rejects', async () => {
      (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      const { storage } = require('../src/store/storage');
      await expect(storage.setItem('k', 'v')).resolves.toBeUndefined();
    });

    it('does NOT throw when AsyncStorage.removeItem rejects', async () => {
      (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
      const { storage } = require('../src/store/storage');
      await expect(storage.removeItem('k')).resolves.toBeUndefined();
    });
  });

  describe('on web', () => {
    beforeEach(() => {
      jest.resetModules();
      jest.doMock('react-native', () => ({
        Platform: { OS: 'web' },
      }));
      // Mock window.localStorage
      const lsStore: Record<string, string> = {};
      (global as any).window = {
        localStorage: {
          getItem: (k: string) => lsStore[k] ?? null,
          setItem: (k: string, v: string) => {
            lsStore[k] = v;
          },
          removeItem: (k: string) => {
            delete lsStore[k];
          },
        },
      };
    });

    afterEach(() => {
      delete (global as any).window;
    });

    it('round-trips via localStorage', async () => {
      const { storage } = require('../src/store/storage');
      await storage.setItem('webkey', 'webvalue');
      const got = await storage.getItem('webkey');
      expect(got).toBe('webvalue');
    });

    it('does NOT call AsyncStorage on web', async () => {
      const { storage } = require('../src/store/storage');
      await storage.setItem('webkey', 'webvalue');
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    });
  });
});
