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

/**
 * SPIKE-006 sim-walker (v428): dev-only GPS simulator.
 *
 * v428 change: env-var gate removed. Sim-walker is now controlled by:
 *   1. useSettingsStore.debugMode (persistent, 5-tap version toggle)
 *   2. useSimWalkerStore.active (in-memory, cold-restart resets)
 *
 * Both must be true for the overlay to render. See:
 *   - app/src/dev/simWalker/useSimWalkerStore.ts
 *   - app/src/screens/HikingScreen.tsx mount site
 *   - app/src/screens/SettingsScreen.tsx toggle
 */

