/**
 * Authenticated fetch utility.
 * Adds Bearer token header and intercepts 401 responses.
 * On 401: clears token, resets auth state, sets sessionExpired flag.
 *
 * Import and use instead of fetch() for any authenticated endpoint.
 *
 * v78 #8: caller can pass `skipLogoutOn401: true` for retries / queued
 * mutations so a flaky network 401 doesn't kick the user back to
 * SignIn. Real auth-protected reads (login refresh, profile) keep the
 * default behavior. Every logout now logs a breadcrumb with the
 * triggering path so we can diagnose unexpected sign-outs.
 */
import { API_BASE_URL } from '../config/api';
import { getToken, clearToken } from './tokenStore';
import { useAppStore } from '../store/useAppStore';
import { crashLogger } from './crashLogger';

interface AuthFetchOptions extends RequestInit {
  /** When true, a 401 response does NOT trigger logout. Use for queued
   *  retries where a transient 401 should not boot the user. */
  skipLogoutOn401?: boolean;
}

export async function authenticatedFetch(
  path: string,
  options: AuthFetchOptions = {}
): Promise<Response> {
  const { skipLogoutOn401, ...fetchOptions } = options;
  const token = await getToken();

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...(fetchOptions.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 401) {
    crashLogger.breadcrumb(`api:401 path=${path} skipLogout=${!!skipLogoutOn401}`);
    if (!skipLogoutOn401) {
      crashLogger.breadcrumb(`signout_reason=401 path=${path}`);
      await clearToken();
      const store = useAppStore.getState();
      store.logout();
      store.setSessionExpired(true);
    }
  }

  return res;
}
