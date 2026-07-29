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

  // O18 SAF-07 (2026-07-29): user reported "network request failed" on
  // hike upload AND direct upload — the fetch() throw path was previously
  // invisible (no breadcrumb, no aliyun log, no status code). We now log
  // BEFORE fetch so we see attempts, AND after any throw so we see the
  // exact failure mode (DNS / timeout / TLS / offline / server-close).
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const startedAt = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  let bodySize = 0;
  if (fetchOptions.body != null) {
    if (typeof fetchOptions.body === 'string') bodySize = fetchOptions.body.length;
    else if ((fetchOptions.body as any).length != null) bodySize = (fetchOptions.body as any).length;
  }
  crashLogger.breadcrumb(`api:req id=${requestId} ${method} ${path} bodyBytes=${bodySize} hasToken=${!!token}`);
  // Non-blocking aliyun log — helps diagnose network issues from a remote
  // device where breadcrumbs are lost on crash. Guard against log module
  // being unavailable / recursing on itself (log endpoint is same base URL).
  const logAliyun = (event: string, data: any) => {
    if (path.startsWith('/api/edit-diag')) return; // don't self-log the log endpoint
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('./appLog');
      log(event, data);
    } catch { /* silent */ }
  };
  logAliyun('api.req', { id: requestId, method, path, bodyBytes: bodySize, hasToken: !!token });

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      headers: {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (netErr: any) {
    // O18 SAF-07: network throw path — this is what user hit. Log everything
    // we know: error name (TypeError = network layer), message, elapsed ms,
    // NetInfo state if available. Then re-throw so caller sees the failure.
    const elapsedMs = Date.now() - startedAt;
    const errName = netErr?.name || 'Error';
    const errMsg = String(netErr?.message || netErr).slice(0, 200);
    let netState: string = 'unknown';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const NetInfo = require('@react-native-community/netinfo');
      const state = await (NetInfo.default?.fetch?.() ?? NetInfo.fetch?.());
      if (state) {
        netState = `type=${state.type} conn=${state.isConnected} reach=${state.isInternetReachable}`;
      }
    } catch { /* NetInfo not available */ }
    crashLogger.breadcrumb(
      `api:net_error id=${requestId} ${method} ${path} ms=${elapsedMs} name=${errName} msg="${errMsg}" net=${netState}`
    );
    logAliyun('api.net_error', {
      id: requestId, method, path, elapsedMs, errName, errMsg, netState, bodyBytes: bodySize,
    });
    throw netErr;
  }

  const elapsedMs = Date.now() - startedAt;
  crashLogger.breadcrumb(`api:res id=${requestId} ${method} ${path} status=${res.status} ms=${elapsedMs}`);
  if (res.status >= 400) {
    // Peek the body for diagnostics without consuming it.
    let bodyPreview = '';
    try {
      const peek = res.clone();
      const text = await peek.text();
      bodyPreview = text.slice(0, 300);
    } catch { /* ignore */ }
    logAliyun('api.err_status', {
      id: requestId, method, path, status: res.status, elapsedMs, bodyPreview,
    });
  }

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
    // O1 batch 37: sessionExpired was set here for deferred reauth surfacing, but
    // 0 screens ever read it, so the deferred signal was never actionable. We now
    // simply return without logging out (tracking continues; next app resume handles it).
    const tracking = useTrackingStore.getState().status;
    if (tracking === 'tracking' || tracking === 'paused') {
      crashLogger.breadcrumb(`revoke:401_during_tracking_deferred path=${path}`);
      return res;
    }

    // Rule 3: hard signal + not tracking → true logout.
    crashLogger.breadcrumb(`apiService:401_hard_logout path=${path}`);
    crashLogger.breadcrumb(`signout_reason=401_invalid path=${path}`);
    await clearToken();
    useAppStore.getState().logout();
  }

  return res;
}
