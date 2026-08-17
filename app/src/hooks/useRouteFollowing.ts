/**
 * useRouteFollowing — React hook that produces UI-ready follow state.
 *
 * Wires the pure RouteFollower + VoiceGuidance to the live stores:
 *   - useTrackingStore.lastCoordinate (GPS ticks)
 *   - useTrackingStore.status         (only follow when actively tracking)
 *   - useRouteStore.followingRouteId  (the currently-followed route)
 *   - useSettingsStore.voiceGuidance  (mute switch)
 *   - useSettingsStore.offRouteThresholdM (deviation threshold)
 *
 * Every GPS tick, this hook:
 *   1. Recomputes the FollowState (pure).
 *   2. Fires voice cues via VoiceGuidance (debounced internally).
 *   3. Returns the UI-visible state for banners / next-turn / speed display.
 *
 * The hook is idempotent — mounting it a second time on a different screen
 * (Hiking vs Running) is safe: both screens see the same follow state and
 * the voice singleton dedups regardless of caller.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTrackingStore } from '../store/useTrackingStore';
import { useRouteStore } from '../store/useRouteStore';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  computeFollowState,
  precomputeCumulative,
  FollowState,
  RoutePointLite,
  WaypointLite,
} from '../services/routeFollowing/RouteFollower';
import { voiceGuidance } from '../services/routeFollowing/VoiceGuidance';

const OFF_ROUTE_HYSTERESIS_FRAC = 0.3; // clear when back within (threshold × 0.7)

export interface UseRouteFollowingResult {
  /** True when a route is selected AND tracking is active. */
  isFollowingRoute: boolean;
  /** The route being followed, if any. Slim shape (id, name only). */
  followingRoute?: { id: string; name: string };
  /** Full follow state, or undefined when not following. */
  state?: FollowState;
  /** True when user is currently > threshold from route. */
  isOffRoute: boolean;
  /** The most recent off-route distance seen (for display). */
  distanceToRouteM: number;
}

export function useRouteFollowing(): UseRouteFollowingResult {
  const lastCoordinate = useTrackingStore((s) => s.lastCoordinate);
  const status = useTrackingStore((s) => s.status);
  const followingRouteId = useRouteStore((s) => s.followingRouteId);
  const routes = useRouteStore((s) => s.routes);
  const voiceEnabled = useSettingsStore((s) => s.voiceGuidance);
  const offRouteThresholdM = useSettingsStore((s) => s.offRouteThresholdM);
  const units = useSettingsStore((s) => s.units);

  const route = useMemo(
    () => (followingRouteId ? routes.find((r) => r.id === followingRouteId) : undefined),
    [followingRouteId, routes],
  );

  // Precompute cumulative distances once per route change.
  const geometry = useMemo(() => {
    if (!route) return undefined;
    const points: RoutePointLite[] = (route.points ?? []).map((p) => ({ lat: p.lat, lng: p.lng }));
    if (points.length < 2) return undefined;
    const cum = precomputeCumulative(points);
    const waypoints: WaypointLite[] = (route.waypoints ?? []).map((w) => ({
      id: w.id,
      lat: w.lat,
      lng: w.lng,
      label: w.label,
      announceOnArrival: w.announceOnArrival,
      radiusM: w.radiusM,
    }));
    return { points, cum, waypoints, totalM: cum[cum.length - 1] };
  }, [route]);

  // Keep voice service in sync with mute toggle and unit preference each render.
  useEffect(() => {
    voiceGuidance.configure({ enabled: voiceEnabled, imperial: units === 'imperial' });
  }, [voiceEnabled, units]);

  // All refs declared up-front so downstream effects can safely reference
  // them (TDZ would throw if declared later in source order).
  const prevRouteIdRef = useRef<string | undefined>(undefined);
  const prevStatusRef = useRef<string>(status);
  // Off-route state with hysteresis so we don't flap around the threshold.
  const offRouteRef = useRef(false);
  // Voice side-effect latches.
  const lastAnnouncedWpRef = useRef<string | undefined>(undefined);
  const routeCompletedRef = useRef(false);

  // Reset voice queue + latches when the route or tracking session changes.
  // pauseTracking (in this project) clears lastCoordinate, so any off-route
  // or waypoint state cached in refs no longer reflects a real position —
  // reset those latches on pause so resume starts clean.
  useEffect(() => {
    const routeChanged = prevRouteIdRef.current !== followingRouteId;
    const stoppedTracking = prevStatusRef.current === 'tracking' && status !== 'tracking';
    if (routeChanged || stoppedTracking) {
      voiceGuidance.reset();
    }
    // Any transition OUT of 'tracking' invalidates cached position-derived
    // state (off-route, last-announced-waypoint). Route-complete latch stays
    // — a pause mid-route shouldn't re-announce completion.
    if (stoppedTracking) {
      offRouteRef.current = false;
      lastAnnouncedWpRef.current = undefined;
    }
    prevRouteIdRef.current = followingRouteId ?? undefined;
    prevStatusRef.current = status;
  }, [followingRouteId, status]);

  const followState: FollowState | undefined = useMemo(() => {
    if (!geometry || !lastCoordinate) return undefined;
    return computeFollowState({
      user: { lat: lastCoordinate.lat, lng: lastCoordinate.lng },
      points: geometry.points,
      waypoints: geometry.waypoints,
      cum: geometry.cum,
    });
  }, [geometry, lastCoordinate]);

  useEffect(() => {
    if (status !== 'tracking' || !followState || !geometry) return;

    // ── Off-route detection with hysteresis ───────────────────────────────
    const wasOff = offRouteRef.current;
    // Hysteresis is a fraction of the threshold rather than a fixed 15m —
    // scales with user's tolerance so tight (20m) and loose (200m) settings
    // both feel equally "sticky" on the boundary.
    const hysteresisM = offRouteThresholdM * OFF_ROUTE_HYSTERESIS_FRAC;
    const isOff = !wasOff
      ? followState.distanceToRouteM > offRouteThresholdM
      : followState.distanceToRouteM > offRouteThresholdM - hysteresisM;
    if (isOff && !wasOff) {
      voiceGuidance.announceOffRoute();
    } else if (!isOff && wasOff) {
      voiceGuidance.announceBackOnRoute();
    }
    offRouteRef.current = isOff;

    // ── Turn hints ────────────────────────────────────────────────────────
    if (followState.nextTurn && !isOff) {
      const t = followState.nextTurn;
      const turnKey = `t:${t.atIndex}`;
      if (t.distanceM <= 40 && t.direction !== 'straight') {
        voiceGuidance.announceTurnNow(t.direction, turnKey);
      } else if (t.direction !== 'straight') {
        voiceGuidance.announceTurnAhead(t.direction, t.distanceM, turnKey);
      }
    }

    // ── Waypoint approach announcement ────────────────────────────────────
    const nextWp = followState.nextWaypoint;
    if (nextWp && nextWp.announceOnArrival && followState.distanceToNextWaypointM != null) {
      // Announce once when within max(radiusM, 60m) so the user gets a
      // heads-up before actually reaching the trigger radius.
      const triggerM = Math.max(nextWp.radiusM, 60);
      if (
        followState.distanceToNextWaypointM <= triggerM &&
        lastAnnouncedWpRef.current !== nextWp.id
      ) {
        voiceGuidance.announceWaypoint(nextWp.label, nextWp.id);
        lastAnnouncedWpRef.current = nextWp.id;
      }
    }

    // ── Route complete ────────────────────────────────────────────────────
    if (
      !routeCompletedRef.current &&
      geometry.totalM > 0 &&
      followState.remainingM < 20 &&
      !isOff
    ) {
      voiceGuidance.announceRouteComplete();
      routeCompletedRef.current = true;
    }
  }, [followState, geometry, offRouteThresholdM, status]);

  // Reset the "completed" latch when route changes.
  useEffect(() => {
    routeCompletedRef.current = false;
    lastAnnouncedWpRef.current = undefined;
    offRouteRef.current = false;
  }, [followingRouteId]);

  const isFollowingRoute = !!route && status === 'tracking';
  const isOffRoute =
    isFollowingRoute && !!followState && followState.distanceToRouteM > offRouteThresholdM;

  return {
    isFollowingRoute,
    followingRoute: route ? { id: route.id, name: route.name } : undefined,
    state: followState,
    isOffRoute,
    distanceToRouteM: followState?.distanceToRouteM ?? 0,
  };
}
