/**
 * devFlags.ts — feature flags.
 *
 * Production builds (Hermes minifier with __DEV__=false) dead-code-eliminate
 * any code gated by these flags.
 *
 * Defense in depth: even if EXPO_PUBLIC_PLAYWRIGHT_BYPASS leaks into a
 * production bundle, the __DEV__ guard ensures it cannot activate.
 */

export const isPlaywrightBypass: boolean =
  __DEV__ && process.env.EXPO_PUBLIC_PLAYWRIGHT_BYPASS === 'true';


