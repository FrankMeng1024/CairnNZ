/**
 * storage.ts — thin persistence wrapper.
 * Uses AsyncStorage on native, localStorage on web.
 * API is async on both platforms.
 *
 * Errors are caught and logged: storage failures must not block app boot.
 * getItem returns null on failure; setItem/removeItem swallow errors by
 * default, but callers may pass `strict: true` to opt into throwing so
 * critical writes (session data, plant drafts) don't disappear silently
 * on a full disk (O18 SAF-02).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

export const storage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (isWeb) {
        return typeof window !== 'undefined' && window.localStorage
          ? window.localStorage.getItem(key)
          : null;
      }
      return await AsyncStorage.getItem(key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[storage] getItem(${key}) failed:`, err);
      return null;
    }
  },
  setItem: async (key: string, value: string, opts?: { strict?: boolean }): Promise<void> => {
    try {
      if (isWeb) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
        return;
      }
      await AsyncStorage.setItem(key, value);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[storage] setItem(${key}) failed:`, err);
      // O18 SAF-02: strict callers get the error so they can surface a
      // "disk full" message to the user instead of silently losing data.
      if (opts?.strict) throw err;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (isWeb) {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
        return;
      }
      await AsyncStorage.removeItem(key);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[storage] removeItem(${key}) failed:`, err);
    }
  },
};
