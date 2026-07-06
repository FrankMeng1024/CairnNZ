/**
 * Authenticated fetch utility.
 * Adds Bearer token header and intercepts 401 responses.
 *
 * Sprint 72 STORY-00550 IRON RULE — 401 handling:
 *
 *   1. Network error (fetch throws): NEVER touch token. Response propagates
 *      to caller. Caller sees the error and can retry.
 *   2. 401 WITHOUT `X-Cairn-Auth-Invalid: true` header: token is preserved.
 *      Only a breadcrumb is logged. This covers rate-limit 401s, upstream
 *      proxy 401s, misconfigured routes, and other transient sources.
 *   3. 401 WITH `X-Cairn-Auth-Invalid: true` header: this is the server's
 *      explicit "your token is invalid" signal (set by authenticate.js
 *      middleware). Clear token + logout.
 *   4. tracking-active guard: if useTrackingStore.status === 'tracking',
 *      NEVER logout even on hard invalid signal. Record a `pendingReauth`
 *      flag; hydrate-time or AppState=active path handles re-login later.
 *      Rationale: user is mid-hike and we do NOT want to interrupt GPS
 *      recording just because the server revoked the token.
 *
 * The `skipLogoutOn401` option is still honored (legacy path for offline
 * queue retries).
 */
import { API_BASE_URL } from '../config/api';
import { getToken, clearToken } from './tokenStore';
import { useAppStore } from '../store/useAppStore';
import { useTrackingStore } from '../store/useTrackingStore';
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
    // Header path is fastest (no body clone). Falls through to body check
    // when the header is unreachable — e.g. web/browser CORS strips
    // response headers not listed in Access-Control-Expose-Headers.
    // Native iOS/Android fetch has no CORS, so header path succeeds there.
    // Body path is the reliable universal fallback.
    let authInvalid = res.headers.get('X-Cairn-Auth-Invalid') === 'true';
    if (!authInvalid) {
      try {
        // Clone so caller can still read the body downstream.
        const peek = res.clone();
        const body = await peek.json();
        if (body && body.code === 'TOKEN_INVALID') authInvalid = true;
      } catch { /* body was not JSON; leave authInvalid as-is */ }
    }
    crashLogger.breadcrumb(
      `api:401 path=${path} skipLogout=${!!skipLogoutOn401} authInvalid=${authInvalid}`
    );

    if (skipLogoutOn401) {
      // Explicit opt-out (e.g. offline queue retries).
      return res;
    }

    if (!authInvalid) {
      // Rule 2: 401 without server's explicit invalid signal — keep token,
      // do NOT logout. Caller sees the 401 status and can retry.
      crashLogger.breadcrumb(`apiService:401_ignored path=${path} reason=no_invalid_header`);
      return res;
    }

    // Rule 4: hard signal, but tracking active → defer logout.
    const tracking = useTrackingStore.getState().status;
    if (tracking === 'tracking' || tracking === 'paused') {
      crashLogger.breadcrumb(`revoke:401_during_tracking_marked path=${path}`);
      // Mark deferred reauth on the app store. hydrate() / AppState=active
      // path is responsible for surfacing it to the user later.
      const store = useAppStore.getState();
      store.setSessionExpired(true);
      return res;
    }

    // Rule 3: hard signal + not tracking → true logout.
    crashLogger.breadcrumb(`apiService:401_hard_logout path=${path}`);
    crashLogger.breadcrumb(`signout_reason=401_invalid path=${path}`);
    await clearToken();
    const store = useAppStore.getState();
    store.logout();
    store.setSessionExpired(true);
  }

  return res;
}
