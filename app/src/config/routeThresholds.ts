/**
 * Route navigation thresholds — single source of truth for the constants
 * the route-follow engine uses. Pulled out of components so Hiking and
 * Running share the same engine but reference different threshold sets
 * (per route-rules.md §6.1: same algorithm, different constants).
 *
 * If you tune any of these, do it here — never hardcode the number in
 * a screen or store. This makes it easy to A/B test thresholds via
 * remote config in the future.
 */

import type { ActivityMode } from '../store/useSessionStore';

export interface NavThresholds {
  /** Below this many metres off route, no announcement (silent zone) */
  offRouteSilentM: number;
  /** Between silentM and warningM, gentle "Route is on your left" */
  offRouteWarningM: number;
  /** Above warningM, stronger "You've left the route" */
  offRouteCriticalM: number;
  /** Distance ahead at which marker / waypoint approach is announced */
  approachDistanceM: number;
  /** Minimum seconds between repeat announcements of the same event */
  repeatCooldownS: number;
}

// Hiking: slower pace (4-6 km/h), tighter tolerances, user looks at
// screen frequently. Approach distance shorter because reaction time
// is plentiful.
export const HIKING_THRESHOLDS: NavThresholds = {
  offRouteSilentM: 20,
  offRouteWarningM: 50,
  offRouteCriticalM: 100,
  approachDistanceM: 50,
  repeatCooldownS: 30,
};

// Running: faster (8-15 km/h), wider GPS noise, eyes off screen.
// Wider warning zone because by the time you can react you'd be
// 30m further down the path. Earlier marker approach announcements.
export const RUNNING_THRESHOLDS: NavThresholds = {
  offRouteSilentM: 30,
  offRouteWarningM: 80,
  offRouteCriticalM: 150,
  approachDistanceM: 100,
  repeatCooldownS: 30,
};

/** Pick the right threshold set for a given mode. */
export function getThresholds(mode: ActivityMode): NavThresholds {
  return mode === 'running' ? RUNNING_THRESHOLDS : HIKING_THRESHOLDS;
}
