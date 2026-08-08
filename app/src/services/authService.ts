/**
 * Auth service — wraps backend API calls for register / login / me / logout.
 * Returns a typed result so callers can handle errors inline without try/catch.
 */
import { API_BASE_URL } from '../config/api';
import { saveToken, clearToken, getToken } from './tokenStore';
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

interface AuthResult {
  user?: UserProfile;
  token?: string;
  error?: string;
  hint?: string;                    // 'age_gate' | 'use_oauth' | 'pending_deletion'
  restoreDeadline?: string;         // ISO — only when hint='pending_deletion'
  // 2-step registration: backend sent a code, frontend shows verify screen
  step?: 'verify';
  email?: string;
  devCode?: string;  // only present in dev builds — backend returns code directly
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
      return { error: data?.error || data?.message || 'Registration failed.', hint: data?.hint };
    }
    // Backend sends a verification code — frontend must show the verify screen
    // dev_code is only present in non-production builds
    return { step: 'verify', email: data.email, devCode: data.dev_code };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function verifyCode(email: string, code: string): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/verify', { email, code });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || 'Verification failed.' };
    }
    await saveToken(data.token);
    return { user: data.user, token: data.token };
  } catch {
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
  try {
    const res = await post('/api/auth/login', { email, password });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || data?.message || 'Sign in failed. Check your email and password.', hint: data?.hint };
    }
    await saveToken(data.token);
    // O18 AUTH-01: backend surfaces hint='pending_deletion' when the account
    // was soft-deleted. Token is still valid so restore endpoint can auth,
    // caller decides whether to show restore modal or block sign-in.
    return {
      user: data.user,
      token: data.token,
      hint: data.hint,
      restoreDeadline: data.restore_deadline,
    };
  } catch {
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
export async function getMe(): Promise<UserProfile | null> {
  try {
    const token = await getToken();
    if (!token) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        // Only clear token on 401/403 (auth failure), not on transient 5xx
        if (res.status === 401 || res.status === 403) {
          await clearToken();
        }
        return null;
      }
      const data = await res.json();
      return data.user ?? null;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    // AbortError (timeout) or network error — keep token, retry next launch
    return null;
  }
}

export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/google', { id_token: idToken });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || 'Google sign-in failed. Please try again.', hint: data?.hint };
    }
    await saveToken(data.token);
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
    };
  } catch {
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
  try {
    const res = await post('/api/auth/apple', {
      identity_token: idToken,
      name: providedName,
      raw_nonce: rawNonce,
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || 'Apple sign-in failed. Please try again.', hint: data?.hint };
    }
    await saveToken(data.token);
    return {
      user: data.user,
      token: data.token,
      hint: data.hint,
      restoreDeadline: data.restore_deadline,
    };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function logout(): Promise<void> {
  // O18 AUTH-08: revoke jti server-side so the token can't be re-used
  // (e.g. if the user handed the phone off and someone lifted the token).
  // Best-effort: local clearToken always runs even if the backend call fails.
  const token = await getToken();
  if (token) {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* silent — network offline is fine, blacklist is a nice-to-have */ }
  }
  await clearToken();
}

// O18 AUTH-04: request a 6-digit password reset code by email.
// Returns 200 always (privacy — do not leak account existence).
export async function passwordResetRequest(email: string): Promise<{ error?: string; devCode?: string }> {
  try {
    const res = await post('/api/auth/password-reset/request', { email });
    const data = await res.json();
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
  try {
    const res = await post('/api/auth/password-reset/verify', {
      email, code, new_password: newPassword,
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || 'Reset failed.', hint: data?.hint };
    }
    await saveToken(data.token);
    return { user: data.user, token: data.token };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

// O18 AUTH-01: soft-delete the current account. Returns the grace deadline
// so the UI can display "Restore before <date>". Auth middleware will
// invalidate the current token via jti blacklist as a side-effect.
export async function deleteAccount(): Promise<{
  error?: string;
  deletedAt?: string;
  restoreDeadline?: string;
}> {
  const token = await getToken();
  if (!token) return { error: 'not_signed_in' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error || 'Could not delete account.' };
    return { deletedAt: data.deleted_at, restoreDeadline: data.restore_deadline };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
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
export async function restoreAccount(): Promise<AuthResult> {
  const token = await getToken();
  if (!token) return { error: 'not_signed_in' };
  let res: Response;
  let data: any;
  try {
    res = await fetch(`${API_BASE_URL}/api/auth/account/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    data = await res.json();
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
  if (!res.ok) return { error: data?.error || 'Restore failed.' };
  if (data.token) {
    try {
      await saveToken(data.token);
    } catch {
      return {
        error: 'Restore succeeded on server but we couldn\'t save the new session. Please sign in with email + password to continue.',
        hint: 'save_token_failed',
      };
    }
  }
  return { user: data.user, token: data.token };
}

// O18 batch 6.7 (AUTH-GDPR): request a full data export.
// Backend queues + emails the download link when ready. Client also
// gets the token immediately so the UI can show "Export requested".
export async function requestDataExport(): Promise<{
  error?: string;
  status?: string;
  downloadToken?: string;
  expiresAt?: string;
}> {
  const token = await getToken();
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
      downloadToken: data.download_token,
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
export async function fetchExportHistory(): Promise<Array<{
  id: number;
  status: string;
  size_bytes: number | null;
  requested_at: string;
  built_at: string | null;
  expires_at: string | null;
  sent_at: string | null;
}>> {
  const token = await getToken();
  if (!token) return [];
  try {
    const res = await fetch(`${API_BASE_URL}/api/account/exports`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.map((r: any) => ({
      id: Number(r.id),
      status: String(r.status ?? ''),
      size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
      requested_at: String(r.requested_at ?? ''),
      built_at: r.built_at ?? null,
      expires_at: r.expires_at ?? null,
      sent_at: r.sent_at ?? null,
    }));
  } catch {
    return [];
  }
}
// O18 AUTH-06: legacy DOB backfill (users who registered before this
// migration have dateOfBirth=null and get a modal on next login).
// Backend enforces >= 13 same as register + immutable once set.
export async function patchDob(dateOfBirth: string): Promise<AuthResult> {
  crashLogger.breadcrumb(`patchdob:start dob_len=${dateOfBirth.length}`);
  const token = await getToken();
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
  const token = await getToken();
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
export async function patchName(name: string): Promise<AuthResult> {
  const token = await getToken();
  if (!token) return { error: 'not_signed_in' };
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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
export async function refreshToken(): Promise<{ token?: string; error?: string; authInvalid?: boolean }> {
  const token = await getToken();
  if (!token) return { error: 'no_token' };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const authInvalid = res.headers.get('X-Cairn-Auth-Invalid') === 'true';
        return { error: `http_${res.status}`, authInvalid };
      }
      const data = await res.json();
      if (data.token) {
        await saveToken(data.token);
        return { token: data.token };
      }
      return { error: 'no_token_in_response' };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { error: 'network' };
  }
}
