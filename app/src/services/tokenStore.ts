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
const TOKEN_OWNER_KEY = 'cairn_jwt_owner_v1';

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

async function readRawOwner(): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(TOKEN_OWNER_KEY);
  return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_OWNER_KEY) : null;
}

async function writeRawOwner(ownerUserId: string): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.setItemAsync(TOKEN_OWNER_KEY, ownerUserId);
  else if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_OWNER_KEY, ownerUserId);
}

async function deleteRawOwner(): Promise<void> {
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(TOKEN_OWNER_KEY);
  else if (typeof localStorage !== 'undefined') localStorage.removeItem(TOKEN_OWNER_KEY);
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
      // Owner is removed before credential replacement. A separate headless
      // runtime therefore either sees an exact token+owner pair or fails
      // closed; it can never attach Account-A location to Account B while a
      // login/account switch is between secure writes.
      await deleteRawOwner();
      await writeRawToken(token);
      if (!isAccountTransitionCurrent(transition)) {
        if (await readRawToken() === token) await deleteRawToken();
        observedToken = null;
        observedOwnerUserId = null;
        generation += 1;
        return null;
      }
      if (ownerUserId) await writeRawOwner(String(ownerUserId));
      if (!isAccountTransitionCurrent(transition)) {
        await deleteRawOwner();
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
        await writeRawOwner(owner);
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
      if (ownerUserId !== authority.ownerUserId) await deleteRawOwner();
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
      if (ownerUserId) await writeRawOwner(String(ownerUserId));
      else await deleteRawOwner();
      if (generation !== expectedGeneration
        || (transition && !isAccountTransitionCurrent(transition))) {
        // The transition can be synchronously pre-empted while the owner
        // companion write itself is awaiting Keychain. Remove both halves
        // before publishing any replacement authority.
        await deleteRawOwner();
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
      await deleteRawOwner();
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

/**
 * Credential access for a native TaskManager runtime that has no hydrated
 * React account store. The durable owner companion is written only inside the
 * token CAS lock and is cleared before account replacement/logout. Callers
 * must still revalidate their own durable work lease around each request.
 */
export async function getHeadlessTokenForOwner(expectedOwnerUserId: string): Promise<string | null> {
  if (!expectedOwnerUserId) return null;
  return withMutationLock(async () => {
    try {
      const [token, owner] = await Promise.all([readRawToken(), readRawOwner()]);
      return token && owner === String(expectedOwnerUserId) ? token : null;
    } catch {
      return null;
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
