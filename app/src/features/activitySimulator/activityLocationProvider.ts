import type { ActivityCoordinate } from '../../store/useTrackingStore';
import type { ActivityMode } from '../../store/useSessionStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import {
  activitySimulatorEngine,
  type SimulatorCanonicalSample,
  type SimulatorPipelineDecision,
} from './activitySimulatorEngine';
import { activitySimulatorBuildCapable, isActivitySimulatorAuthorized } from './capability';
import { hydrateActivitySimulatorForUser, useActivitySimulatorStore } from './useActivitySimulatorStore';
import { simulatorAccuracyMeters } from './useActivitySimulatorStore';
import type { ActivityLocationSource, SimulatorActivityLease } from './types';
import { alignSimulatorClockForRecovery } from './simulatorTime';

export interface ActivityProviderContext {
  clientActivityId: string;
  ownerUserId: string;
  ownerGeneration: string;
  activityMode: ActivityMode;
  segmentId: string;
  startedAt: number;
  acceptAfterMs?: number | null;
}

export type CanonicalActivitySink = (
  coordinate: ActivityCoordinate,
  timestamp: number,
) => Promise<SimulatorPipelineDecision>;

export function simulatorRuntimeAuthorized(): boolean {
  return isActivitySimulatorAuthorized(useSettingsStore.getState().debugMode);
}

export function resolveActivityLocationSource(
  buildCapable: boolean,
  debugMode: boolean,
  simulatorEnabled: boolean,
): ActivityLocationSource {
  return buildCapable && debugMode && simulatorEnabled ? 'simulator' : 'real';
}

export function selectedActivityLocationSource(): ActivityLocationSource {
  return resolveActivityLocationSource(
    activitySimulatorBuildCapable,
    useSettingsStore.getState().debugMode,
    useActivitySimulatorStore.getState().enabled,
  );
}

export async function prepareSimulatorProvider(userId: string): Promise<boolean> {
  if (!activitySimulatorBuildCapable || !simulatorRuntimeAuthorized() || !userId) return false;
  if (useActivitySimulatorStore.getState().hydratedUserId !== userId) {
    await hydrateActivitySimulatorForUser(userId);
  }
  const state = useActivitySimulatorStore.getState();
  const ready = state.enabled
    && state.startConfigured
    && state.hydratedUserId === userId
    && Number.isFinite(state.current.lat)
    && Number.isFinite(state.current.lng);
  if (!ready && state.enabled && !state.startConfigured) {
    state.setLastFailure('Set a Simulator start point before starting the Activity.');
  }
  return ready;
}

function leaseFrom(context: ActivityProviderContext): SimulatorActivityLease {
  return {
    clientActivityId: context.clientActivityId,
    ownerUserId: context.ownerUserId,
    ownerGeneration: context.ownerGeneration,
    mode: context.activityMode,
    segmentId: context.segmentId,
  };
}

export function activateSimulatorProvider(
  context: ActivityProviderContext,
  sink: CanonicalActivitySink,
  resume = false,
): boolean {
  if (!simulatorRuntimeAuthorized()) return false;
  const wrapped = async (sample: SimulatorCanonicalSample) =>
    sink({
      lat: sample.lat,
      lng: sample.lng,
      alt: sample.alt,
      accuracy: sample.accuracy,
      speed: sample.speed,
      clientActivityId: sample.clientActivityId,
      ownerGeneration: sample.ownerGeneration,
      segmentId: sample.segmentId,
      segmentStartReason: sample.segmentStartReason,
      source: 'simulator',
    }, sample.timestamp);
  if (resume) {
    // A new JS process has no in-memory engine lease. Rebind the persisted
    // Activity identity first, then advance (never rewind) to the newest
    // durable journal/ownership timestamp.
    useActivitySimulatorStore.getState().bindActivity(
      context.ownerUserId,
      context.clientActivityId,
      context.startedAt,
    );
    alignSimulatorClockForRecovery(
      context.acceptAfterMs ?? context.startedAt,
      context.startedAt,
    );
    activitySimulatorEngine.resumeActivity(leaseFrom(context), wrapped);
  } else {
    activitySimulatorEngine.bindActivity(leaseFrom(context), wrapped, context.startedAt);
  }
  return true;
}

export function pauseSimulatorProvider(): void {
  activitySimulatorEngine.pauseActivity();
}

export async function pauseSimulatorProviderForCorrection(): Promise<void> {
  await activitySimulatorEngine.pauseForCorrection();
}

export function restoreSimulatorProviderTail(args: {
  coordinate: { lat: number; lng: number };
  altitudeM: number;
  virtualTimestampMs: number;
  segmentId: string;
}): void {
  activitySimulatorEngine.restoreCommittedTail(args);
}

export async function reacquireSimulatorProviderAt(
  coordinate: { lat: number; lng: number },
  segmentId: string,
  nextSignal: Exclude<import('./types').SimulatorSignal, 'lost'> = 'normal',
): Promise<void> {
  await activitySimulatorEngine.reacquireAt(coordinate, segmentId, nextSignal);
}

export async function endSimulatorProvider(
  reason: 'completed' | 'discarded' | 'account-switch' | 'start-failed',
): Promise<void> {
  await activitySimulatorEngine.endActivity(reason);
}

export function isSimulatorProviderBound(clientActivityId?: string | null): boolean {
  return activitySimulatorEngine.isActivityBound(clientActivityId);
}

/** Last canonically accepted synthetic fix for foreground consumers such as Plant. */
export function readTrustedSimulatorLocation(): {
  lat: number;
  lng: number;
  altitudeM: number;
  accuracyM: number;
  timestamp: number;
} | null {
  if (!simulatorRuntimeAuthorized()) return null;
  const state = useActivitySimulatorStore.getState();
  if (!state.enabled || !state.startConfigured || state.signal === 'lost') return null;
  try {
    // Dynamic resolution avoids a store initialization cycle. A hidden Lost
    // position and an unaccepted Poor/teleport sample are never Cairn input.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('../../store/useTrackingStore').useTrackingStore.getState();
    if (
      tracking.locationProviderSource !== 'simulator'
      || !tracking.lastCoordinate
      || tracking.lastCoordinateTime === null
    ) return null;
    return {
      lat: tracking.lastCoordinate.lat,
      lng: tracking.lastCoordinate.lng,
      altitudeM: tracking.lastCoordinate.alt ?? state.altitudeM,
      accuracyM: tracking.lastCoordinate.accuracy ?? simulatorAccuracyMeters(state),
      timestamp: tracking.lastCoordinateTime,
    };
  } catch {
    return null;
  }
}
