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
import {
  isAccountTransitionCurrent,
  type AccountTransitionAuthority,
} from './accountTransitionAuthority';

const TOKEN_KEY = 'cairn_jwt';

export interface TokenAuthority {
  token: string;
  generation: number;
  ownerUserId: string | null;
}

let mutationTail: Promise<void> = Promise.resolve();
let generation = 0;
let observedToken: string | null | undefined;
let observedOwnerUserId: string | null = null;

function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function readRawToken(): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(TOKEN_KEY);
  return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}

async function writeRawToken(token: string): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(TOKEN_KEY, token);
  else if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, token);
}

async function deleteRawToken(): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(TOKEN_KEY);
  else if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_KEY);
}

async function observeToken(): Promise<string | null> {
  const token = await readRawToken();
  if (observedToken === undefined) observedToken = token;
  else if (observedToken !== token) {
    observedToken = token;
    observedOwnerUserId = null;
    generation += 1;
  }
  return token;
}

function authorityFor(token: string): TokenAuthority {
  return { token, generation, ownerUserId: observedOwnerUserId };
}

function exactAuthorityMatches(
  authority: TokenAuthority,
  token: string | null,
): boolean {
  return token === authority.token
    && generation === authority.generation
    && observedOwnerUserId === authority.ownerUserId;
}

/**
 * Install a token only while the caller owns the process-wide account
 * transition. Generic unconditional token writes are intentionally absent.
 */
export async function installTokenForAccountTransition(
  transition: AccountTransitionAuthority,
  token: string,
  ownerUserId: string | null,
): Promise<TokenAuthority | null> {
  return withMutationLock(async () => {
    if (!isAccountTransitionCurrent(transition)) return null;
    try {
      await writeRawToken(token);
      if (!isAccountTransitionCurrent(transition)) {
        if (await readRawToken() === token) await deleteRawToken();
        observedToken = null;
        observedOwnerUserId = null;
        generation += 1;
        return null;
      }
      observedToken = token;
      observedOwnerUserId = ownerUserId;
      generation += 1;
      return authorityFor(token);
    } catch (err) {
      console.warn('[tokenStore] installTokenForAccountTransition failed:', err);
      return null;
    }
  });
}

export async function getTokenAuthority(): Promise<TokenAuthority | null> {
  return withMutationLock(async () => {
    try {
      const token = await observeToken();
      return token ? authorityFor(token) : null;
    } catch (err) {
      console.warn('[tokenStore] getTokenAuthority failed:', err);
      return null;
    }
  });
}

export async function isTokenAuthorityCurrent(authority: TokenAuthority): Promise<boolean> {
  return withMutationLock(async () => {
    try {
      const token = await observeToken();
      return exactAuthorityMatches(authority, token);
    } catch {
      return false;
    }
  });
}

export async function bindTokenOwnerIfCurrent(
  authority: TokenAuthority,
  ownerUserId: string,
): Promise<TokenAuthority | null> {
  return withMutationLock(async () => {
    try {
      const token = await observeToken();
      if (!exactAuthorityMatches(authority, token)) return null;
      const owner = String(ownerUserId);
      if (observedOwnerUserId !== owner) {
        observedOwnerUserId = owner;
        // Binding/rebinding is an authority mutation. A pre-bind owner-null
        // snapshot must never remain usable after the user identity is known.
        generation += 1;
      }
      return authorityFor(authority.token);
    } catch {
      return null;
    }
  });
}

export async function replaceTokenIfCurrent(
  authority: TokenAuthority,
  replacement: string,
  ownerUserId: string | null = authority.ownerUserId,
  transition?: AccountTransitionAuthority,
): Promise<TokenAuthority | null> {
  return withMutationLock(async () => {
    try {
      if (transition && !isAccountTransitionCurrent(transition)) return null;
      const token = await observeToken();
      if (!exactAuthorityMatches(authority, token)) return null;
      const expectedGeneration = generation;
      await writeRawToken(replacement);
      if (generation !== expectedGeneration
        || (transition && !isAccountTransitionCurrent(transition))) {
        // Transition loss can occur while SecureStore is awaiting its write.
        // Retire only the value this operation wrote, inside the same token
        // mutation lock, before another token consumer can observe authority.
        if (await readRawToken() === replacement) await deleteRawToken();
        observedToken = null;
        observedOwnerUserId = null;
        generation += 1;
        return null;
      }
      observedToken = replacement;
      observedOwnerUserId = ownerUserId;
      generation += 1;
      return authorityFor(replacement);
    } catch (err) {
      console.warn('[tokenStore] replaceTokenIfCurrent failed:', err);
      return null;
    }
  });
}

export async function clearTokenIfCurrent(authority: TokenAuthority): Promise<boolean> {
  return withMutationLock(async () => {
    try {
      const token = await observeToken();
      if (!exactAuthorityMatches(authority, token)) return false;
      const expectedGeneration = generation;
      await deleteRawToken();
      if (generation !== expectedGeneration) {
        observedToken = null;
        observedOwnerUserId = null;
        generation += 1;
        return false;
      }
      observedToken = null;
      observedOwnerUserId = null;
      generation += 1;
      return true;
    } catch (err) {
      console.warn('[tokenStore] clearTokenIfCurrent failed:', err);
      return false;
    }
  });
}

export async function getToken(expectedOwnerUserId: string): Promise<string | null> {
  const authority = await getTokenAuthority();
  return authority?.ownerUserId === String(expectedOwnerUserId)
    ? authority.token
    : null;
}

/** Bootstrap-only presence check; never returns a bearer credential. */
export async function hasStoredToken(): Promise<boolean> {
  return (await getTokenAuthority()) != null;
}
