/**
 * Thin abstraction over token storage.
 * - Native (iOS/Android): expo-secure-store
 * - Web: localStorage
 *
 * All keychain access wrapped in try/catch. iOS keychain can throw on:
 *   - Device locked at boot (errSecInteractionNotAllowed)
 *   - Corrupt keychain
 *   - Simulator quirks
 * In any error case, treat as "no token" so the app falls through to the
 * Sign In screen rather than crashing or hanging.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'cairn_jwt';

export async function saveToken(token: string): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tokenStore] saveToken failed:', err);
  }
}

export async function getToken(): Promise<string | null> {
  try {
    if (Platform.OS !== 'web') {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    }
    return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tokenStore] getToken failed:', err);
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } else if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[tokenStore] clearToken failed:', err);
  }
}
