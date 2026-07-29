/**
 * API configuration for Cairn backend.
 *
 * Resolution order:
 *   1. EXPO_PUBLIC_API_BASE_URL env var (set in eas.json build profile)
 *   2. In production builds (__DEV__ === false): fall back to the public host
 *      so a missing env var never lands the user on localhost
 *   3. In dev: fall back to localhost:3001
 */
const ENV_URL =
  typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_BASE_URL : undefined;

export const API_BASE_URL =
  ENV_URL ||
  (typeof __DEV__ !== 'undefined' && __DEV__
    ? 'http://localhost:3001'
    : 'https://api.yiiling.cn');

/**
 * Public legal pages. Served from the same host as the API — the
 * backend has a static route (index.js: `app.get('/privacy', ...)`)
 * that returns HTML for browsers.
 *
 * O13 bug 6: backend now serves privacy.html from backend/public/.
 * Previously PRIVACY_URL pointed to yiiling.cn/privacy which 404'd
 * (host not configured to serve the page). Now points to the same
 * host as API_BASE_URL, which really serves the HTML.
 */
export const PRIVACY_URL =
  ((ENV_URL || (typeof __DEV__ !== 'undefined' && __DEV__
    ? 'http://localhost:3001'
    : 'https://api.yiiling.cn')).replace(/\/api\/?$/, '')) + '/privacy';

