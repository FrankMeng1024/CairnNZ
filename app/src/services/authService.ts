/**
 * Auth service — wraps backend API calls for register / login / me / logout.
 * Returns a typed result so callers can handle errors inline without try/catch.
 */
import { API_BASE_URL } from '../config/api';
import { saveToken, clearToken, getToken } from './tokenStore';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

interface AuthResult {
  user?: UserProfile;
  token?: string;
  error?: string;
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
  password: string
): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/register', { name, email, password });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || data?.message || 'Registration failed.' };
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
      return { error: data?.error || data?.message || 'Sign in failed. Check your email and password.' };
    }
    await saveToken(data.token);
    return { user: data.user, token: data.token };
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
      return { error: data?.error || 'Google sign-in failed. Please try again.' };
    }
    await saveToken(data.token);
    return { user: data.user, token: data.token };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function loginWithApple(
  identityToken: string,
  fullName: { givenName?: string | null; familyName?: string | null } | null,
): Promise<AuthResult> {
  try {
    const res = await post('/api/auth/apple', {
      identity_token: identityToken,
      full_name: fullName,
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: data?.error || 'Apple sign-in failed. Please try again.' };
    }
    await saveToken(data.token);
    return { user: data.user, token: data.token };
  } catch {
    return { error: 'Unable to connect. Please try again.' };
  }
}

export async function logout(): Promise<void> {
  await clearToken();
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
