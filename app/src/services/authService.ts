/**
 * Auth service — wraps backend API calls for register / login / me / logout.
 * Returns a typed result so callers can handle errors inline without try/catch.
 */
import { API_BASE_URL } from '../config/api';
import {
  bindTokenOwnerIfCurrent,
  clearTokenIfCurrent,
  getToken,
  getTokenAuthority,
  installTokenForAccountTransition,
  isTokenAuthorityCurrent,
  replaceTokenIfCurrent,
  type TokenAuthority,
} from './tokenStore';
import {
  beginAccountTransition,
  clearUnknownAccountTransitionResult,
  finishAccountTransition,
  isAccountTransitionCurrent,
  markAccountTransitionResultUnknown,
  type AccountTransitionAuthority,
  type AccountTransitionKind,
} from './accountTransitionAuthority';
import { crashLogger } from './crashLogger';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  hasPassword?: boolean;
  createdAt?: string | null;
  dateOfBirth?: string | null;     // O18 AUTH-06 — 'YYYY-MM-DD' or null
  deletedAt?: string | null;        // O18 AUTH-01 — soft-delete timestamp
  providers?: string[];
}

export interface AuthResult {
  user?: UserProfile;
  token?: string;
  error?: string;
  hint?: string;                    // 'age_gate' | 'use_oauth' | 'pending_deletion'
  restoreDeadline?: string;         // ISO — only when hint='pending_deletion'
  // 2-step registration: backend sent a code, frontend shows verify screen
  step?: 'verify';
  email?: string;
  devCode?: string;  // only present in dev builds — backend returns code directly
  tokenAuthority?: TokenAuthority;
  transitionAuthority?: AccountTransitionAuthority;
  commitState?: 'committed' | 'unknown';
}

function currentUserId(): string | null {
  try {
    // Dynamic to avoid the authService -> useAppStore -> authService cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useAppStore } = require('../store/useAppStore');
    return useAppStore.getState().user?.id == null
      ? null
      : String(useAppStore.getState().user.id);
  } catch {
    return null;
  }
}

function ownerStillCurrent(expectedUserId?: string): boolean {
  return expectedUserId === undefined || currentUserId() === String(expectedUserId);
}

async function getCurrentOwnedToken(): Promise<string | null> {
  const owner = currentUserId();
  return owner ? getToken(owner) : null;
}

async function commitUnauthenticatedToken(
  transition: AccountTransitionAuthority,
  data: any,
): Promise<TokenAuthority | null> {
  if (!data?.token) return null;
  return installTokenForAccountTransition(
    transition,
    String(data.token),
    data?.user?.id == null ? null : String(data.user.id),
  );
}

function startTransition(input: {
  kind: AccountTransitionKind;
  expectedOwnerUserId?: string | null;
  reconciliationKey?: string | null;
}): AccountTransitionAuthority | null {
  return beginAccountTransition(input).authority ?? null;
}

async function resumeCommittedDeletionBeforeAuth(
  transition: AccountTransitionAuthority,
): Promise<void> {
  // Keep this a lazy CommonJS require: authService participates in a store
  // cycle, while the app's Jest/Babel runtime does not enable VM dynamic
  // modules. The dependency is still resolved only at the account boundary.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resumeScheduledDeletedAccountLocalPurge } = require('./accountLocalData');
  await resumeScheduledDeletedAccountLocalPurge(transition);
}

async function reconcileDeletionAfterLogin(ownerUserId: string, hint?: string): Promise<void> {
  clearUnknownAccountTransitionResult(`restore-account:${ownerUserId}`);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const localData = require('./accountLocalData');
  const pendingDelete = await localData.getDeletedAccountPurgeRecord();
  if (pendingDelete?.ownerUserId !== ownerUserId || pendingDelete.state !== 'unknown') return;
  if (hint === 'pending_deletion') {
    await localData.scheduleDeletedAccountLocalPurge(ownerUserId);
  } else {
    await localData.clearDeletedAccountPurgeAfterReconciliation(ownerUserId);
    clearUnknownAccountTransitionResult(`delete-account:${ownerUserId}`);
  }
}

function authorityOwns(
  authority: TokenAuthority | null,
  expectedUserId: string | undefined,
  transition?: AccountTransitionAuthority,
): authority is TokenAuthority {
  if (!authority) return false;
  if (expectedUserId === undefined) return true;
  const expectedOwner = String(expectedUserId);
  if (authority.ownerUserId !== expectedOwner) return false;
  const publishedOwner = currentUserId();
  if (publishedOwner === expectedOwner) return true;
  if (publishedOwner !== null || !transition || !isAccountTransitionCurrent(transition)) return false;

  // Session installation intentionally hydrates before publishing the user.
  // Only token-producing/cold-hydrate leases may authorize that signed-out
  // interval. Destructive mutations and background refresh never may.
  const permitsPrePublishOwner: Record<AccountTransitionKind, boolean> = {
    'cold-hydrate': true,
    login: true,
    'verify-registration': true,
    'google-login': true,
    'apple-login': true,
    'password-reset': true,
    'restore-account': true,
    'refresh-token': false,
    logout: false,
    'delete-account': false,
    'change-password': false,
  };
  return permitsPrePublishOwner[transition.kind]
    && (transition.expectedOwnerUserId === null
      || transition.expectedOwnerUserId === expectedOwner);
}

async function post(path: string, body: object): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function register(
  name: string,
  email: string,
  password: string,
  dateOfBirth: string,   // O18 AUTH-06 — 'YYYY-MM-DD'
): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/register', { name, email, password, dateOfBirth });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.details?.[0]?.message || data?.error || data?.message || 'Registration failed.', hint: data?.hint };
    }
    // Backend sends a verification code — frontend must show the verify screen
    // dev_code is only present in non-production builds
    return { step: 'verify', email: data.email, devCode: data.dev_code };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  const transition = startTransition({ kind: 'verify-registration' });
  if (!transition) return { error: 'Another account change is already in progress.' };
  try {
    await resumeCommittedDeletionBeforeAuth(transition);
    const res = await post('/api/auth/verify', { email, code });
    const data = await res.json();
    if (!res.ok) {
      finishAccountTransition(transition);
      return { error: data?.error || 'Verification failed.' };
    }
    const tokenAuthority = await commitUnauthenticatedToken(transition, data);
    if (!tokenAuthority) {
      finishAccountTransition(transition);
      return { error: 'This sign-in attempt no longer owns the device session.' };
    }
    return { user: data.user, token: data.token, tokenAuthority, transitionAuthority: transition };
  } catch {
    finishAccountTransition(transition);
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function resendCode(email: string): Promise<{ error?: string }> {
  try {
    const res = await post('/api/auth/resend', { email });
    const data = await res.json();
    if (!res.ok) return { error: data?.error || 'Could not resend code.' };
    return {};
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const transition = startTransition({ kind: 'login' });
  if (!transition) return { error: 'Another account change is already in progress.' };
  try {
    await resumeCommittedDeletionBeforeAuth(transition);
    const res = await post('/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) {
      finishAccountTransition(transition);
      return { error: data?.error || data?.message || 'Sign in failed. Check your email and password.', hint: data?.hint };
    }
    const tokenAuthority = await commitUnauthenticatedToken(transition, data);
    if (!tokenAuthority) {
      finishAccountTransition(transition);
      return { error: 'This sign-in attempt no longer owns the device session.' };
    }
    const reconciledOwner = data?.user?.id == null ? null : String(data.user.id);
    if (reconciledOwner) {
      clearUnknownAccountTransitionResult(`password-reset:${email.trim().toLowerCase()}`);
      // A successful password login is the reconciliation proof for an
      // earlier ambiguous change-password response. Either old or new
      // password working makes an immediate mutation retry safe again.
      clearUnknownAccountTransitionResult(`change-password:${reconciledOwner}`);
      try {
        await reconcileDeletionAfterLogin(reconciledOwner, data.hint);
      } catch {
        await clearTokenIfCurrent(tokenAuthority);
        finishAccountTransition(transition);
        return { error: 'This account was verified, but its earlier deletion result could not be reconciled safely.' };
      }
    }
    // O18 AUTH-01: backend surfaces hint='pending_deletion' when the account
    // was soft-deleted. Token is still valid so restore endpoint can auth,
    // caller decides whether to show restore modal or block sign-in.
    return {
      user: data.user,
      token: data.token,
      hint: data.hint,
      restoreDeadline: data.restore_deadline,
      tokenAuthority,
      transitionAuthority: transition,
    };
  } catch {
    finishAccountTransition(transition);
    return { error: 'Unable to connect. Please try again.' };
  }
}

/**
 * Called on app launch to verify stored JWT and get current user profile.
 * Returns null if no token or token is invalid/expired.
 *
 * Uses an 8-second timeout via AbortController so a captive-portal or slow
 * network never blocks app boot indefinitely. On timeout, returns null and
 * the caller falls through to the offline / Sign In path.
 */
export async function getMe(
  expectedUserId?: string,
  transition?: AccountTransitionAuthority,
): Promise<UserProfile | null> {
  try {
    const authority = await getTokenAuthority();
    if (!authorityOwns(authority, expectedUserId, transition)) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${authority.token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        // Only clear token on 401/403 (auth failure), not on transient 5xx
        if (res.status === 401 || res.status === 403) {
          await clearTokenIfCurrent(authority);
        }
        return null;
      }
      const data = await res.json();
      if (!data.user
        || !authorityOwns(authority, expectedUserId, transition)
        || !(await isTokenAuthorityCurrent(authority))) return null;
      if (expectedUserId !== undefined && String(data.user.id) !== String(expectedUserId)) return null;
      const bound = await bindTokenOwnerIfCurrent(authority, String(data.user.id));
      return bound ? data.user : null;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // AbortError (timeout) or network error — keep token, retry next launch
    return null;
  }
}

export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const transition = startTransition({ kind: 'google-login' });
  if (!transition) return { error: 'Another account change is already in progress.' };
  try {
    await resumeCommittedDeletionBeforeAuth(transition);
    const res = await post('/api/auth/google', { id_token: idToken });
    const data = await res.json();
    if (!res.ok) {
      finishAccountTransition(transition);
      return { error: data?.error || 'Google sign-in failed. Please try again.', hint: data?.hint };
    }
    const tokenAuthority = await commitUnauthenticatedToken(transition, data);
    if (!tokenAuthority) {
      finishAccountTransition(transition);
      return { error: 'This sign-in attempt no longer owns the device session.' };
    }
    try {
      await reconcileDeletionAfterLogin(String(data.user.id), data.hint);
    } catch {
      await clearTokenIfCurrent(tokenAuthority);
      finishAccountTransition(transition);
      return { error: 'This account was verified, but its earlier deletion result could not be reconciled safely.' };
    }
    // Sprint 6 round-10 review R10B7 fix: forward pending_deletion +
    // restoreDeadline from backend so AuthScreen's restore_confirm view
    // fires on Google login the same way it does for password + Apple.
    // Pre-fix, Google users with a soft-deleted account got logged in
    // silently and their account continued sliding toward hard-delete.
    return {
      user: data.user,
      token: data.token,
      hint: data.hint,
      restoreDeadline: data.restore_deadline,
      tokenAuthority,
      transitionAuthority: transition,
    };
  } catch {
    finishAccountTransition(transition);
    return { error: 'Unable to connect. Please try again.' };
  }
}

// O18 batch 6.6 AUTH-02: Sign in with Apple.
// idToken = identity_token returned by expo-apple-authentication.signInAsync
// providedName = only present on first authorize — Apple never resends it.
//   Store it in AsyncStorage before calling this so a retry can still send
//   the display name.
// rawNonce = plain (unhashed) nonce that the client sent (hashed) to Apple.
//   Backend hashes it + compares to payload.nonce claim to prevent replay
//   attacks (Sprint 6 review C7).
export async function loginWithApple(
  idToken: string,
  providedName?: string,
  rawNonce?: string,
): Promise<AuthResult> {
  const transition = startTransition({ kind: 'apple-login' });
  if (!transition) return { error: 'Another account change is already in progress.' };
  try {
    await resumeCommittedDeletionBeforeAuth(transition);
    const res = await post('/api/auth/apple', {
      identity_token: idToken,
      name: providedName,
      raw_nonce: rawNonce,
    });
    const data = await res.json();
    if (!res.ok) {
      finishAccountTransition(transition);
      return { error: data?.error || 'Apple sign-in failed. Please try again.', hint: data?.hint };
    }
    const tokenAuthority = await commitUnauthenticatedToken(transition, data);
    if (!tokenAuthority) {
      finishAccountTransition(transition);
      return { error: 'This sign-in attempt no longer owns the device session.' };
    }
    try {
      await reconcileDeletionAfterLogin(String(data.user.id), data.hint);
    } catch {
      await clearTokenIfCurrent(tokenAuthority);
      finishAccountTransition(transition);
      return { error: 'This account was verified, but its earlier deletion result could not be reconciled safely.' };
    }
    return {
      user: data.user,
      token: data.token,
      hint: data.hint,
      restoreDeadline: data.restore_deadline,
      tokenAuthority,
      transitionAuthority: transition,
    };
  } catch {
    finishAccountTransition(transition);
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function logout(options: {
  expectedAuthority?: TokenAuthority;
  expectedUserId?: string;
  transitionAuthority?: AccountTransitionAuthority;
  revoke?: boolean;
  keepTransition?: boolean;
} = {}): Promise<{ cleared: boolean; ownerChanged: boolean }> {
  const suppliedTransition = options.transitionAuthority;
  const usingSuppliedTransition = !!suppliedTransition && isAccountTransitionCurrent(suppliedTransition);
  const transition = usingSuppliedTransition
    ? suppliedTransition
    : startTransition({ kind: 'logout', expectedOwnerUserId: options.expectedUserId });
  if (!transition) return { cleared: false, ownerChanged: true };
  const ownsTransition = !usingSuppliedTransition;
  const authority = options.expectedAuthority ?? await getTokenAuthority();
  try {
    if (authority && !(await isTokenAuthorityCurrent(authority))) {
      return { cleared: false, ownerChanged: true };
    }
    if (options.expectedUserId !== undefined
      && authority
      && authority.ownerUserId !== String(options.expectedUserId)) {
      return { cleared: false, ownerChanged: true };
    }
    if (options.expectedUserId !== undefined
      && !authority
      && currentUserId() !== String(options.expectedUserId)) {
      return { cleared: false, ownerChanged: true };
    }
    if (authority && options.revoke !== false) {
      try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authority.token}` },
        });
      } catch { /* local sign-out remains authoritative */ }
    }
    if (!isAccountTransitionCurrent(transition)) return { cleared: false, ownerChanged: true };
    const currentOwner = currentUserId();
    if (currentOwner != null) {
      if (options.expectedUserId !== undefined && currentOwner !== String(options.expectedUserId)) {
        return { cleared: true, ownerChanged: true };
      }
      // Dynamic import avoids the authService/useAppStore module cycle.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAppStore } = require('../store/useAppStore');
      const localCleared = await useAppStore.getState().logout({
        expectedUserId: options.expectedUserId ?? currentOwner,
        transitionAuthority: transition,
      });
      if (!localCleared) return { cleared: false, ownerChanged: false };
    }
    if (!isAccountTransitionCurrent(transition)) return { cleared: false, ownerChanged: true };
    const cleared = authority ? await clearTokenIfCurrent(authority) : true;
    return { cleared, ownerChanged: false };
  } finally {
    if (ownsTransition && !options.keepTransition) finishAccountTransition(transition);
  }
}

// O18 AUTH-04: request a 6-digit password reset code by email.
// R21 (2026-08-17): backend now surfaces rate-limit info (10 codes /
// 15 min max, then 429 with retryAfterSeconds).
export async function passwordResetRequest(email: string): Promise<{ error?: string; devCode?: string; rateLimited?: boolean; retryAfterSeconds?: number }> {
  try {
    const res = await post('/api/auth/password-reset/request', { email });
    const data = await res.json();
    if (res.status === 429 && data?.rateLimited) {
      return {
        error: data.error || 'Too many code requests. Please wait a bit.',
        rateLimited: true,
        retryAfterSeconds: data.retryAfterSeconds || 900,
      };
    }
    if (!res.ok) return { error: data?.error || 'Could not send reset code.' };
    return { devCode: data.dev_code };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

// O18 AUTH-04: verify the code and set a new password. Returns a fresh
// JWT + user profile on success so the caller can sign the user in.
export async function passwordResetVerify(
  email: string,
  code: string,
  newPassword: string,
): Promise<AuthResult> {
  const reconciliationKey = `password-reset:${email.trim().toLowerCase()}`;
  const transition = startTransition({ kind: 'password-reset', reconciliationKey });
  if (!transition) return {
    error: 'The previous reset result is still unresolved. Sign in with the new password before requesting another reset.',
    hint: 'commit_unknown',
  };
  try {
    await resumeCommittedDeletionBeforeAuth(transition);
    const res = await post('/api/auth/password-reset/verify', {
      email, code, new_password: newPassword,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status >= 500) {
        markAccountTransitionResultUnknown(transition);
        return {
          error: 'The reset reached Cairn, but the final result is unknown. Try signing in with the new password; do not submit the reset again.',
          hint: 'commit_unknown',
          commitState: 'unknown',
        };
      }
      finishAccountTransition(transition);
      return { error: data?.details?.[0]?.message || data?.error || 'Reset failed.', hint: data?.hint };
    }
    const tokenAuthority = await commitUnauthenticatedToken(transition, data);
    if (!tokenAuthority) {
      finishAccountTransition(transition);
      return { error: 'Password reset committed, but this device could not install the returned session. Sign in with the new password.', commitState: 'committed' };
    }
    return {
      user: data.user,
      token: data.token,
      tokenAuthority,
      transitionAuthority: transition,
      commitState: 'committed',
    };
  } catch {
    markAccountTransitionResultUnknown(transition);
    return {
      error: 'The reset result is unknown. Try signing in with the new password; do not submit the reset again.',
      hint: 'commit_unknown',
      commitState: 'unknown',
    };
  }
}

// O18 AUTH-01: soft-delete the current account. Returns the grace deadline
// so the UI can display "Restore before <date>". Auth middleware will
// invalidate the current token via jti blacklist as a side-effect.
export async function deleteAccount(expectedUserId?: string): Promise<{
  error?: string;
  deletedAt?: string;
  restoreDeadline?: string;
  commitState?: 'committed' | 'unknown';
  localCleanup?: 'complete' | 'pending';
  durableCleanupScheduled?: boolean;
}> {
  if (!expectedUserId) return { error: 'account_owner_required' };
  const transition = startTransition({
    kind: 'delete-account',
    expectedOwnerUserId: expectedUserId,
    reconciliationKey: `delete-account:${expectedUserId}`,
  });
  if (!transition) return {
    error: 'A previous account deletion result is unresolved or another account change is in progress.',
  };
  const authority = await getTokenAuthority();
  if (!authorityOwns(authority, expectedUserId)) {
    finishAccountTransition(transition);
    return { error: 'account_changed' };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const localData = require('./accountLocalData');
  let dispatched = false;
  let serverCommitObserved = false;
  let committedData: any = null;
  let durableCleanupScheduled = false;
  try {
    // The single durable slot is claimed before dispatch. A second account
    // cannot overwrite this owner or reach the server while it is occupied.
    await localData.reserveDeletedAccountLocalPurge(expectedUserId);
    // Promote to UNKNOWN immediately before dispatch. If the process dies
    // after this durable write, a request may have reached the server and the
    // user must reconcile. A process death while still RESERVED is known to
    // precede dispatch and cold boot may release that reservation safely.
    await localData.markDeletedAccountLocalPurgeUnknown(expectedUserId);
    dispatched = true;
    const res = await fetch(`${API_BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authority.token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status >= 500) {
        await localData.markDeletedAccountLocalPurgeUnknown(expectedUserId);
        markAccountTransitionResultUnknown(transition);
        return {
          commitState: 'unknown',
          error: 'Cairn received the deletion request, but its result is unknown. Do not retry until this account is reconciled.',
        };
      }
      await localData.clearDeletedAccountPurgeAfterReconciliation(expectedUserId);
      finishAccountTransition(transition);
      return { error: data?.error || 'Could not delete account.' };
    }

    serverCommitObserved = true;
    committedData = data;
    try {
      await localData.scheduleDeletedAccountLocalPurge(expectedUserId);
      durableCleanupScheduled = true;
    } catch {
      durableCleanupScheduled = false;
    }
    let localCleanup: 'complete' | 'pending' = 'pending';
    // DELETE already revoked the server session. The shared transition keeps
    // B out while token, stores, globals, credentials and marker are cleared.
    const signOut = await logout({
      expectedAuthority: authority,
      expectedUserId,
      transitionAuthority: transition,
      revoke: false,
    });
    if (signOut.cleared && !signOut.ownerChanged && durableCleanupScheduled) {
      try {
        await localData.completeDeletedAccountLocalPurge(expectedUserId, transition);
        localCleanup = 'complete';
      } catch {
        // The committed marker remains authoritative, including when strict
        // SecureStore credential deletion fails.
      }
    } else if (signOut.cleared && !signOut.ownerChanged) {
      // Both durable marker stores were unavailable after a known server
      // commit. Best effort may still finish safely in this live process,
      // but failure must remain visibly unsafe because it cannot resume.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { clearCredentialsStrict } = require('./credentialsStore');
        await localData.purgeDeletedAccountLocalData(expectedUserId);
        await localData.purgeDeletedAccountDeviceGlobalData(expectedUserId, transition);
        await clearCredentialsStrict();
        await localData.clearDeletedAccountPurgeAfterReconciliation(expectedUserId);
        localCleanup = 'complete';
      } catch { /* truthful pending/unsafe result below */ }
    }
    finishAccountTransition(transition);
    return {
      commitState: 'committed',
      deletedAt: data.deleted_at,
      restoreDeadline: data.restore_deadline,
      localCleanup,
      durableCleanupScheduled,
    };
  } catch {
    if (serverCommitObserved) {
      // A 2xx is monotonic server truth. Later sign-out/keychain/cache errors
      // can only leave local cleanup pending; they can never turn the DELETE
      // back into UNKNOWN or invite a duplicate server mutation.
      if (!durableCleanupScheduled) {
        try {
          await localData.scheduleDeletedAccountLocalPurge(expectedUserId);
          durableCleanupScheduled = true;
        } catch { /* surface the missing durable retry authority below */ }
      }
      finishAccountTransition(transition);
      return {
        commitState: 'committed',
        deletedAt: committedData?.deleted_at,
        restoreDeadline: committedData?.restore_deadline,
        localCleanup: 'pending',
        durableCleanupScheduled,
        error: durableCleanupScheduled
          ? 'Account deletion committed. On-device cleanup is pending and will resume safely.'
          : 'Account deletion committed, but this device could not schedule durable local cleanup. Keep the app open and contact support before using another account.',
      };
    }
    if (!dispatched) {
      try { await localData.clearDeletedAccountPurgeReservation(expectedUserId); } catch { /* cold boot also releases RESERVED */ }
      finishAccountTransition(transition);
      return { error: 'Cairn could not reserve safe on-device deletion cleanup. No deletion was sent; an earlier unresolved deletion may require reconciliation.' };
    }
    // Any thrown outcome after dispatch may be a committed server mutation.
    // Persist UNKNOWN when possible; never release the durable slot as a
    // known-precommit retry.
    try { await localData.markDeletedAccountLocalPurgeUnknown(expectedUserId); } catch { /* keep prior reservation */ }
    markAccountTransitionResultUnknown(transition);
    return {
      commitState: 'unknown',
      error: 'The account deletion result is unknown. Do not submit another deletion until this account is reconciled.',
    };
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  expectedUserId?: string,
): Promise<{
  error?: string;
  commitState?: 'committed' | 'unknown';
  sessionTransitioned?: boolean;
}> {
  if (!expectedUserId) return { error: 'The signed-in account is required.' };
  const transition = startTransition({
    kind: 'change-password',
    expectedOwnerUserId: expectedUserId,
    reconciliationKey: `change-password:${expectedUserId}`,
  });
  if (!transition) return {
    error: 'The previous password result is unresolved or another account change is in progress.',
  };
  const authority = await getTokenAuthority();
  if (!authorityOwns(authority, expectedUserId)) {
    finishAccountTransition(transition);
    return { error: 'The signed-in account changed. Open Password again for the current account.' };
  }
  let dispatched = false;
  let serverCommitObserved = false;
  try {
    dispatched = true;
    const res = await fetch(`${API_BASE_URL}/api/auth/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authority.token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status >= 500) {
        markAccountTransitionResultUnknown(transition);
        return {
          commitState: 'unknown',
          error: 'Cairn received the password change, but its result is unknown. Check which password works before trying again.',
        };
      }
      finishAccountTransition(transition);
      return { error: data?.details?.[0]?.message || data?.error || 'Password could not be updated.' };
    }
    serverCommitObserved = true;
    // A credential change ends every session, including this device. During
    // a rolling backend deploy an older server may still return a replacement
    // token; install it only long enough to revoke it, then run the same
    // account-fenced local purge as an ordinary sign out.
    let revokeAuthority = authority;
    if (data?.token) {
      const replacement = await replaceTokenIfCurrent(
        authority,
        String(data.token),
        data?.user?.id == null ? authority.ownerUserId : String(data.user.id),
        transition,
      );
      if (replacement) revokeAuthority = replacement;
    }
    try {
      // Dynamic require keeps authService independent from native storage at
      // module load (important for account-boundary tests and cold boot).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { storage } = require('../store/storage');
      await storage.setItem('cairn_auth_notice', 'Password updated. Sign in again with your new password.');
    } catch { /* the security transition must not depend on UX notice storage */ }
    const signedOut = await logout({
      expectedAuthority: revokeAuthority,
      expectedUserId,
      transitionAuthority: transition,
      revoke: Boolean(data?.token),
      keepTransition: true,
    });
    finishAccountTransition(transition);
    return {
      commitState: 'committed',
      sessionTransitioned: false,
      error: signedOut.cleared && !signedOut.ownerChanged
        ? undefined
        : 'Password updated. Cairn could not fully clear this device session; close the app before another account signs in.',
    };
  } catch {
    if (serverCommitObserved) {
      // A successful HTTP response is monotonic server truth. A later local
      // logout, token replacement, or keychain cleanup failure cannot turn a
      // committed password mutation into UNKNOWN or invite a duplicate PATCH.
      finishAccountTransition(transition);
      return {
        commitState: 'committed',
        sessionTransitioned: false,
        error: 'Password updated on the server, but this device could not finish the local session transition. Sign in again; do not retry the password change.',
      };
    }
    if (!dispatched) finishAccountTransition(transition);
    else markAccountTransitionResultUnknown(transition);
    return {
      commitState: dispatched ? 'unknown' : undefined,
      error: dispatched
        ? 'The password result is unknown. Check which password works before trying again.'
        : 'The password request was not sent. Please try again.',
    };
  }
}

// O18 AUTH-01: restore a soft-deleted account. Token in header is the one
// just issued by /login post-delete (still valid because auth middleware
// allows it — the row exists, jti not blacklisted).
// Sprint 6 review M10: backend now returns a fresh JWT on successful
// restore so we save it in place of the old (about-to-be-revoked) token.
// Sprint 6 review NB2: split network failure from SecureStore failure.
// On SecureStore failure the backend has already committed the restore
// + revoked the old jti, but the client has no new token to use — we
// surface `hint: 'save_token_failed'` and a specific error message
// telling the user to re-sign in (a fresh /login mints a new token
// which we can retry saving with a clean keychain slot).
export async function restoreAccount(
  expectedAuthority?: TokenAuthority,
  suppliedTransition?: AccountTransitionAuthority,
): Promise<AuthResult> {
  const usingSuppliedTransition = !!suppliedTransition && isAccountTransitionCurrent(suppliedTransition);
  const transition = usingSuppliedTransition
    ? suppliedTransition
    : startTransition({ kind: 'restore-account' });
  if (!transition) return {
    error: 'The previous restore result is unresolved or another account change is in progress.',
    hint: 'commit_unknown',
  };
  const ownsTransition = !usingSuppliedTransition;
  const authority = expectedAuthority ?? await getTokenAuthority();
  // AUTH-3 (2026-08-11): user-facing English message replaces internal
  // 'not_signed_in' sentinel. Root cause: restore modal is entered right
  // after login (with hint='pending_deletion'), so getToken() should
  // return a fresh token — but if SecureStore race / stale hydration
  // leaves the slot empty, the modal surfaces `not_signed_in` to the
  // Alert which the user cannot act on. We now return a message that
  // (a) is plain English (no snake_case) and (b) tells the user exactly
  // what to do next. AuthScreen inspects hint='session_missing' to
  // route back to the sign-in view instead of splash.
  if (!authority
    || !authority.ownerUserId
    || !(await isTokenAuthorityCurrent(authority))) {
    finishAccountTransition(transition);
    return { error: 'Your session ended. Please sign in again to restore your account.', hint: 'session_missing' };
  }
  const reconciliationKey = `restore-account:${authority.ownerUserId}`;
  let res: Response;
  let data: any;
  try {
    res = await fetch(`${API_BASE_URL}/api/auth/account/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authority.token}` },
    });
    data = await res.json().catch(() => null);
  } catch {
    await clearTokenIfCurrent(authority);
    markAccountTransitionResultUnknown(transition, reconciliationKey);
    return {
      error: 'The restore result is unknown. Sign in again to reconcile this account; do not retry Restore now.',
      hint: 'commit_unknown',
      commitState: 'unknown',
    };
  }
  if (!res.ok) {
    // AUTH-3 4:59-race (2026-08-11, 4-eyes review #2): if the row was
    // hard-deleted between login and Restore tap, backend returns:
    //   - authenticate middleware 401 `{ message: 'Account not found.', code: 'TOKEN_INVALID' }`
    //   - or /restore route 404 `{ error: 'Account not found. It may have been permanently deleted.' }`
    // Either way, the account is gone. Surface a distinct hint so the
    // modal shows an actionable "Sign in" button rather than looping on
    // a generic "Restore failed" Alert.
    const backendMsg = data?.error || data?.message || '';
    const isAccountGone =
      res.status === 404 ||
      (res.status === 401 && /account\s*not\s*found/i.test(backendMsg));
    if (isAccountGone) {
      finishAccountTransition(transition);
      return {
        error: 'This account has been permanently deleted. Please sign in with a different account or create a new one.',
        hint: 'account_gone',
      };
    }
    if (res.status >= 500) {
      await clearTokenIfCurrent(authority);
      markAccountTransitionResultUnknown(transition, reconciliationKey);
      return {
        error: 'Cairn received the restore request, but its result is unknown. Sign in again to reconcile; do not retry Restore now.',
        hint: 'commit_unknown',
        commitState: 'unknown',
      };
    }
    if (ownsTransition) finishAccountTransition(transition);
    return { error: backendMsg || 'Restore failed.' };
  }
  if (data.token) {
    const replacement = await replaceTokenIfCurrent(
      authority,
      String(data.token),
      data?.user?.id == null ? authority.ownerUserId : String(data.user.id),
      transition,
    );
    if (!replacement) {
      // Server restore committed, but the old token may now be revoked.
      // Clear local authenticated UI under the still-exclusive transition.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAppStore } = require('../store/useAppStore');
      await useAppStore.getState().logout({
        expectedUserId: authority.ownerUserId,
        transitionAuthority: transition,
      });
      await clearTokenIfCurrent(authority);
      finishAccountTransition(transition);
      return {
        error: 'Restore succeeded on server but we couldn\'t save the new session. Please sign in with email + password to continue.',
        hint: 'save_token_failed',
        commitState: 'committed',
      };
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const localData = require('./accountLocalData');
      await localData.clearDeletedAccountPurgeAfterRestore(authority.ownerUserId);
      clearUnknownAccountTransitionResult(reconciliationKey);
      clearUnknownAccountTransitionResult(`delete-account:${authority.ownerUserId}`);
    } catch {
      // Leaving a committed purge marker would erase the restored account on
      // next boot, so fail closed and remove its local authenticated UI.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useAppStore } = require('../store/useAppStore');
      await useAppStore.getState().logout({
        expectedUserId: authority.ownerUserId,
        transitionAuthority: transition,
      });
      await clearTokenIfCurrent(replacement);
      finishAccountTransition(transition);
      return {
        error: 'Restore succeeded, but this device could not retire its deletion marker. Sign in again after checking device storage.',
        hint: 'save_token_failed',
        commitState: 'committed',
      };
    }
    return {
      user: data.user,
      token: data.token,
      tokenAuthority: replacement,
      transitionAuthority: transition,
      commitState: 'committed',
    };
  }
  await clearTokenIfCurrent(authority);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useAppStore } = require('../store/useAppStore');
  await useAppStore.getState().logout({
    expectedUserId: authority.ownerUserId,
    transitionAuthority: transition,
  });
  finishAccountTransition(transition);
  return {
    error: 'Restore succeeded on the server, but no replacement session was returned. Sign in again; do not retry Restore.',
    hint: 'save_token_failed',
    commitState: 'committed',
  };
}

// Request a full data export. A successful response only means the job was
// accepted; readiness is established by fetchExportHistory.
export async function requestDataExport(): Promise<{
  error?: string;
  status?: string;
  downloadUrl?: string | null;
  expiresAt?: string;
}> {
  const token = await getCurrentOwnedToken();
  if (!token) return { error: 'not_signed_in' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/account/export`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error || 'Could not request export.' };
    return {
      status: data.status,
      downloadUrl: data.download_url ?? null,
      expiresAt: data.expires_at,
    };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

// O18 batch 6.7: list my previous export requests (status + timing).
// Sprint 6 round-4 review R4B9: coerce size_bytes to Number since MySQL2
// can return BIGINT as a string on some driver configs. TS type says
// number|null and any UI arithmetic (e.g. formatBytes) breaks on string.
export interface DataExportSummary {
  id: number;
  status: string;
  size_bytes: number | null;
  requested_at: string;
  built_at: string | null;
  expires_at: string | null;
  sent_at: string | null;
  download_url: string | null;
  error_msg: string | null;
}

export async function fetchExportHistory(): Promise<{
  exports: DataExportSummary[];
  error?: string;
}> {
  const token = await getCurrentOwnedToken();
  if (!token) return { exports: [], error: 'Your session ended. Please sign in again.' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/account/exports`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { exports: [], error: data?.error || 'Export status could not be loaded.' };
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return { exports: [], error: 'Export status could not be read.' };
    return { exports: rows.map((r: any) => ({
      id: Number(r.id),
      status: String(r.status ?? ''),
      size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
      requested_at: String(r.requested_at ?? ''),
      built_at: r.built_at ?? null,
      expires_at: r.expires_at ?? null,
      sent_at: r.sent_at ?? null,
      download_url: r.download_url ?? null,
      error_msg: r.error_msg ?? null,
    })) };
  } catch {
    return { exports: [], error: 'Unable to connect. Export status is unchanged.' };
  }
}

export async function submitFeedback(input: {
  submissionId: string;
  kind: 'feedback' | 'bug';
  message: string;
  appVersion?: string | null;
}): Promise<{ acknowledged: boolean; error?: string }> {
  const token = await getCurrentOwnedToken();
  if (!token) return { acknowledged: false, error: 'Your session ended. Please sign in again.' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/account/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        client_submission_id: input.submissionId,
        kind: input.kind,
        message: input.message,
        app_version: input.appVersion || undefined,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.acknowledged !== true) {
      return { acknowledged: false, error: data?.error || 'Feedback could not be delivered.' };
    }
    return { acknowledged: true };
  } catch {
    return { acknowledged: false, error: 'Unable to connect. Your message is still here—try again when you are online.' };
  }
}
// O18 AUTH-06: legacy DOB backfill (users who registered before this
// migration have dateOfBirth=null and get a modal on next login).
// Backend enforces >= 13 same as register + immutable once set.
export async function patchDob(dateOfBirth: string): Promise<AuthResult> {
  crashLogger.breadcrumb(`patchdob:start dob_len=${dateOfBirth.length}`);
  const token = await getCurrentOwnedToken();
  if (!token) {
    crashLogger.breadcrumb('patchdob:no_token — return not_signed_in');
    return { error: 'not_signed_in' };
  }
  crashLogger.breadcrumb(`patchdob:token_read token_len=${token.length}`);
  try {
    crashLogger.breadcrumb('patchdob:fetch_start');
    const res = await fetch(`${API_BASE_URL}/api/auth/dob`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dateOfBirth }),
    });
    crashLogger.breadcrumb(`patchdob:response status=${res.status} ok=${res.ok}`);
    const data = await res.json();
    crashLogger.breadcrumb(`patchdob:json_parsed has_user=${!!data?.user} has_error=${!!data?.error}`);
    if (!res.ok) {
      crashLogger.breadcrumb(`patchdob:not_ok err=${String(data?.error).slice(0, 60)}`);
      return { error: data?.error || 'Could not save date of birth.', hint: data?.hint };
    }
    crashLogger.breadcrumb('patchdob:success');
    return { user: data.user };
  } catch (err: any) {
    crashLogger.breadcrumb(`patchdob:catch ${String(err?.message || err).slice(0, 80)}`);
    return { error: 'Unable to connect. Please try again.' };
  }
}

// R114/O22 STORY-73006 (H2): mark onboarding done on the server so it
// follows the user account across devices and reinstalls. Backend adds
// `users.onboarding_done_at TIMESTAMP NULL` + `PATCH /api/auth/onboarding`.
// Client calls this after the user finishes the 4-screen intro.
// Non-fatal: local per-account AsyncStorage key is still written first
// so the user isn't blocked if the endpoint is unreachable.
export async function patchOnboardingDone(): Promise<AuthResult> {
  crashLogger.breadcrumb('h2:patch_onboarding_start');
  const token = await getCurrentOwnedToken();
  if (!token) {
    crashLogger.breadcrumb('h2:no_token');
    return { error: 'not_signed_in' };
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/onboarding`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ done: true }),
    });
    crashLogger.breadcrumb(`h2:response status=${res.status} ok=${res.ok}`);
    if (!res.ok) {
      // Non-fatal: local flag is still set. Silently note the failure.
      return { error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { user: data.user };
  } catch (err: any) {
    crashLogger.breadcrumb(`h2:catch ${String(err?.message || err).slice(0, 80)}`);
    return { error: 'network' };
  }
}

// R100 SETTINGS: update display name from Settings screen. Called by
// Edit Name modal after user types + hits Save. Backend enforces
// length 1..32 + strips control chars. Returns updated user on success.
export async function patchName(name: string, expectedUserId?: string): Promise<AuthResult> {
  const authority = await getTokenAuthority();
  if (!authorityOwns(authority, expectedUserId)) return { error: 'account_changed' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authority.token}`,
      },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error || 'Could not save name.' };
    return { user: data.user };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

/**
 * Sprint 72 STORY-00550: exchange current valid token for a fresh one.
 * Called by:
 *   - useAppStore.hydrate() pre-expiry (if token <3 days from expiry)
 *   - useTrackingStore periodic refresh during active hiking (every 30 min)
 *
 * Returns { token } on success. On any failure (network / 401 / 5xx) returns
 * { error } — caller decides whether to clear token (only clearToken on the
 * strict "TOKEN_INVALID" signal, per apiService iron rule).
 *
 * IMPORTANT: This function itself never clears the token — the decision to
 * treat a failure as "user must re-login" is up to the caller (typically
 * apiService.ts, which owns the auth-invalid header check).
 */
export async function refreshToken(expectedUserId?: string): Promise<{ token?: string; error?: string; authInvalid?: boolean }> {
  if (!expectedUserId) return { error: 'account_owner_required' };
  const transition = startTransition({
    kind: 'refresh-token',
    expectedOwnerUserId: expectedUserId,
  });
  if (!transition) return { error: 'transition_in_progress' };
  try {
    const authority = await getTokenAuthority();
    if (!authority) return { error: 'no_token' };
    if (!isAccountTransitionCurrent(transition)
      || !authorityOwns(authority, expectedUserId)) return { error: 'account_changed' };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authority.token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const authInvalid = res.headers.get('X-Cairn-Auth-Invalid') === 'true';
        return { error: `http_${res.status}`, authInvalid };
      }
      const data = await res.json();
      if (data.token) {
        if (!isAccountTransitionCurrent(transition)
          || !authorityOwns(authority, expectedUserId)) return { error: 'authority_changed' };
        const replacement = await replaceTokenIfCurrent(
          authority,
          String(data.token),
          authority.ownerUserId,
          transition,
        );
        if (!replacement
          || !isAccountTransitionCurrent(transition)
          || !ownerStillCurrent(expectedUserId)) return { error: 'authority_changed' };
        return { token: data.token };
      }
      return { error: 'no_token_in_response' };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { error: 'network' };
  } finally {
    finishAccountTransition(transition);
  }
}
