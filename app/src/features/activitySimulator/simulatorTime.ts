import type { ActivityLocationSource, SimulatorTimeScale } from './types';
import {
  scheduleSimulatorPersistence,
  useActivitySimulatorStore,
} from './useActivitySimulatorStore';

/**
 * Accelerated evidence is replayed on a bounded historical timeline. This
 * reserve is large enough to represent a long Hike/Run while guaranteeing
 * that generated evidence never needs a future epoch timestamp.
 */
export const SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS = 12 * 60 * 60_000;
export const SIMULATOR_FUTURE_SAFETY_MARGIN_MS = 60_000;

export function simulatorActivityStartTimestamp(
  _timeScale: SimulatorTimeScale,
  wallClockTimestamp = Date.now(),
): number {
  // Every Simulator Activity reserves the same bounded historical window.
  // Runtime controls may change 1x -> 120x after Start; without this reserve,
  // acceleration would either stall at wall time or manufacture future dates.
  return wallClockTimestamp
    - SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS
    - SIMULATOR_FUTURE_SAFETY_MARGIN_MS;
}

export interface SimulatorClockAdvance {
  virtualTimestampMs: number;
  appliedVirtualElapsedMs: number;
  effectiveVirtualElapsedMs: number;
  limitReached: boolean;
  maximumVirtualTimestampMs: number;
}

export function advanceSimulatorClock(args: {
  activityStartedAtMs: number;
  previousVirtualTimestampMs: number;
  wallElapsedMs: number;
  wallClockTimestampMs: number;
  timeScale: SimulatorTimeScale;
}): SimulatorClockAdvance {
  const requested = Math.max(0, args.wallElapsedMs) * args.timeScale;
  if (args.timeScale === 1) {
    const virtualTimestampMs = Math.max(
      args.previousVirtualTimestampMs,
      Math.min(
        args.wallClockTimestampMs,
        args.previousVirtualTimestampMs + Math.max(0, args.wallElapsedMs),
      ),
    );
    return {
      virtualTimestampMs,
      // Movement follows actual elapsed wall time on the same historical
      // provider timeline. Recovery alignment is explicit and never creates
      // displacement as a side effect of catching up an epoch.
      appliedVirtualElapsedMs: virtualTimestampMs - args.previousVirtualTimestampMs,
      effectiveVirtualElapsedMs: Math.max(0, virtualTimestampMs - args.activityStartedAtMs),
      limitReached: false,
      maximumVirtualTimestampMs: args.wallClockTimestampMs,
    };
  }
  const activityLimit = args.activityStartedAtMs + SIMULATOR_MAX_VIRTUAL_ACTIVITY_MS;
  const futureLimit = args.wallClockTimestampMs - SIMULATOR_FUTURE_SAFETY_MARGIN_MS;
  const maximumVirtualTimestampMs = Math.min(activityLimit, futureLimit);
  const target = Math.min(
    maximumVirtualTimestampMs,
    args.previousVirtualTimestampMs + requested,
  );
  const virtualTimestampMs = Math.max(args.previousVirtualTimestampMs, target);
  const appliedVirtualElapsedMs = virtualTimestampMs - args.previousVirtualTimestampMs;
  return {
    virtualTimestampMs,
    appliedVirtualElapsedMs,
    effectiveVirtualElapsedMs: Math.max(0, virtualTimestampMs - args.activityStartedAtMs),
    limitReached: args.timeScale > 1 && virtualTimestampMs >= activityLimit,
    maximumVirtualTimestampMs,
  };
}

/** Lifecycle timestamps use the provider's clock, never a metric override. */
export function activityTimestampForSource(
  source: ActivityLocationSource,
  fallbackWallClockTimestamp = Date.now(),
  minimumTimestamp = 0,
): number {
  if (source === 'real') return Math.max(minimumTimestamp, fallbackWallClockTimestamp);
  const state = useActivitySimulatorStore.getState();
  const virtualTimestamp = state.virtualTimestampMs > 0
    ? state.virtualTimestampMs
    : minimumTimestamp || fallbackWallClockTimestamp;
  const safeTimestamp = Math.min(
    virtualTimestamp,
    fallbackWallClockTimestamp - SIMULATOR_FUTURE_SAFETY_MARGIN_MS,
  );
  return Math.max(minimumTimestamp, safeTimestamp);
}

/** UI freshness compares a fix to the same timeline that produced it. */
export function activityFreshnessNow(
  source: ActivityLocationSource,
  fallbackWallClockTimestamp = Date.now(),
): number {
  if (source === 'real') return fallbackWallClockTimestamp;
  return useActivitySimulatorStore.getState().virtualTimestampMs || fallbackWallClockTimestamp;
}

export function simulatorTimestampIsServerSafe(
  virtualTimestampMs: number,
  wallClockTimestamp = Date.now(),
): boolean {
  return Number.isFinite(virtualTimestampMs)
    && virtualTimestampMs > 0
    && virtualTimestampMs <= wallClockTimestamp;
}

/** Recovery may restore a journal point newer than the last coalesced clock write. */
export function alignSimulatorClockForRecovery(
  minimumTimestampMs: number,
  activityStartedAtMs: number,
): void {
  if (!Number.isFinite(minimumTimestampMs) || minimumTimestampMs <= 0) return;
  const state = useActivitySimulatorStore.getState();
  if (state.virtualTimestampMs >= minimumTimestampMs) return;
  useActivitySimulatorStore.setState({
    virtualActivityStartedAtMs: state.virtualActivityStartedAtMs ?? activityStartedAtMs,
    virtualTimestampMs: minimumTimestampMs,
    effectiveVirtualElapsedMs: Math.max(
      state.effectiveVirtualElapsedMs,
      minimumTimestampMs - activityStartedAtMs,
    ),
  });
  scheduleSimulatorPersistence();
}
