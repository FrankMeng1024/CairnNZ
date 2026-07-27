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
 * Public marketing / legal pages. NOT the API host.
 *
 * O12 Round-5 R5-H1: pre-fix, SettingsScreen linked Privacy Policy to
 * `${API_BASE_URL}/privacy` = `https://api.yiiling.cn/privacy`, which is
 * the JSON API host and would return 404 for a browser. Apple App Store
 * review 5.1.1(i) explicitly requires a working Privacy Policy link.
 *
 * Currently points to the hosted privacy page on yiiling.cn (Cairn's
 * public site). Change here if a Cairn-specific privacy URL comes
 * online (e.g. https://cairnapp.nz/privacy) — every screen that shows a
 * Privacy Policy link should import PRIVACY_URL from this file, not
 * assemble it from API_BASE_URL.
 */
export const PRIVACY_URL = 'https://yiiling.cn/privacy';

