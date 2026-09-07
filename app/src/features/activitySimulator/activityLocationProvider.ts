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

export function selectedActivityLocationSource(): ActivityLocationSource {
  return simulatorRuntimeAuthorized() && useActivitySimulatorStore.getState().enabled
    ? 'simulator'
    : 'real';
}

export async function prepareSimulatorProvider(userId: string): Promise<boolean> {
  if (!activitySimulatorBuildCapable || !simulatorRuntimeAuthorized() || !userId) return false;
  if (useActivitySimulatorStore.getState().hydratedUserId !== userId) {
    await hydrateActivitySimulatorForUser(userId);
  }
  const state = useActivitySimulatorStore.getState();
  return state.enabled
    && state.hydratedUserId === userId
    && Number.isFinite(state.current.lat)
    && Number.isFinite(state.current.lng);
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

export async function endSimulatorProvider(
  reason: 'completed' | 'discarded' | 'account-switch' | 'start-failed',
): Promise<void> {
  await activitySimulatorEngine.endActivity(reason);
}

export function isSimulatorProviderBound(clientActivityId?: string | null): boolean {
  return activitySimulatorEngine.isActivityBound(clientActivityId);
}

/** Current synthetic physical fix for normal foreground consumers such as Plant. */
export function readTrustedSimulatorLocation(): {
  lat: number;
  lng: number;
  altitudeM: number;
  accuracyM: number;
  timestamp: number;
} | null {
  if (!simulatorRuntimeAuthorized()) return null;
  const state = useActivitySimulatorStore.getState();
  if (!state.enabled || state.signal !== 'normal') return null;
  return {
    lat: state.current.lat,
    lng: state.current.lng,
    altitudeM: state.altitudeM,
    accuracyM: simulatorAccuracyMeters(state),
    timestamp: state.boundActivityClientId && state.virtualTimestampMs > 0
      ? state.virtualTimestampMs
      : Date.now(),
  };
}
