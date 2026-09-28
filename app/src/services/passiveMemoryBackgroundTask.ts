import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { appendSimulatorLog, flushSimulatorLogs } from '../features/activitySimulator/simulatorLog';
import {
  createPassiveMemoryContinuityState,
  reducePassiveMemoryObservation,
} from '../features/memory/services/passiveMemoryContinuity';
import { passiveBackgroundMemoryCapability } from '../features/memory/services/passiveMemoryCapability';
import { recordMemoryEvidence } from '../features/memory/services/recordMemoryEvidence';
import { passiveMemoryRevocationKey } from '../features/memory/services/passiveMemoryAuthority';
import type { RealGpsContinuityState, RealGpsObservation } from '../features/activity/realGpsContinuity';

export const PASSIVE_MEMORY_BACKGROUND_TASK = 'cairn-passive-memory-location-v1';
export const PASSIVE_MEMORY_ACTIVE_KEY = 'cairn:passive-memory:active:v1';
export const PASSIVE_MEMORY_CONTEXT_KEY = 'cairn:passive-memory:context:v1';
// Mirrored from backgroundLocationTask without importing that top-level native
// registrar into the passive headless runtime. The Activity live bit is the
// durable priority authority; `1` always preempts Passive Memory.
const ACTIVITY_ACTIVE_KEY = 'cairn_bg_hike_active';

export interface DurablePassiveMemoryContext {
  v: 1;
  ownerUserId: string;
  epoch: string;
  /** Native TaskManager is a physical provider. Simulator has no headless
   * runtime and therefore never receives a durable background lease. */
  source: 'real';
  consentVersion: 1;
  acceptAfterMs: number;
  latestObservationTimestampMs: number | null;
  rawOrdinal: number;
  continuityState: RealGpsContinuityState;
}

let ownershipTail: Promise<void> = Promise.resolve();
async function withOwnership<T>(operation: () => Promise<T>): Promise<T> {
  const previous = ownershipTail.catch(() => undefined);
  let release!: () => void;
  ownershipTail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function acquirePassiveMemoryLease(args: {
  ownerUserId: string;
  epoch: string;
  source: 'real';
  acceptAfterMs: number;
  continuityState?: RealGpsContinuityState;
  rawOrdinal?: number;
}): Promise<DurablePassiveMemoryContext> {
  return withOwnership(async () => {
    if (await AsyncStorage.getItem(ACTIVITY_ACTIVE_KEY) === '1') {
      await AsyncStorage.setItem(PASSIVE_MEMORY_ACTIVE_KEY, '0');
      await AsyncStorage.removeItem(PASSIVE_MEMORY_CONTEXT_KEY);
      throw new Error('passive_memory_preempted_by_activity');
    }
    if ((await AsyncStorage.getItem(passiveMemoryRevocationKey(args.epoch))) === args.epoch) {
      throw new Error('passive_memory_epoch_revoked');
    }
    const context: DurablePassiveMemoryContext = {
      v: 1,
      ownerUserId: args.ownerUserId,
      epoch: args.epoch,
      source: args.source,
      consentVersion: 1,
      acceptAfterMs: args.acceptAfterMs,
      latestObservationTimestampMs: args.continuityState?.latestObservationTimestamp ?? null,
      rawOrdinal: Math.max(0, Math.floor(args.rawOrdinal ?? 0)),
      continuityState: args.continuityState ?? createPassiveMemoryContinuityState(),
    };
    await AsyncStorage.setItem(PASSIVE_MEMORY_CONTEXT_KEY, JSON.stringify(context));
    if ((await AsyncStorage.getItem(passiveMemoryRevocationKey(args.epoch))) === args.epoch) {
      await AsyncStorage.removeItem(PASSIVE_MEMORY_CONTEXT_KEY);
      throw new Error('passive_memory_epoch_revoked');
    }
    // Enable last so a headless callback cannot observe partial owner state.
    await AsyncStorage.setItem(PASSIVE_MEMORY_ACTIVE_KEY, '1');
    return context;
  });
}

/** Close logical evidence admission without waiting for the serialized native
 * start/stop lifecycle. The tombstone is per epoch, so stale cleanup cannot
 * affect a newer real-source owner. */
export async function revokePassiveMemoryEvidenceAdmission(expectedEpoch: string): Promise<void> {
  if (!expectedEpoch) return;
  await AsyncStorage.setItem(passiveMemoryRevocationKey(expectedEpoch), expectedEpoch);
}

export async function releasePassiveMemoryLease(expectedEpoch?: string): Promise<boolean> {
  if (expectedEpoch) await revokePassiveMemoryEvidenceAdmission(expectedEpoch);
  return withOwnership(async () => {
    const raw = await AsyncStorage.getItem(PASSIVE_MEMORY_CONTEXT_KEY);
    const context = raw ? JSON.parse(raw) as DurablePassiveMemoryContext : null;
    if (expectedEpoch && context && context.epoch !== expectedEpoch) return false;
    // Disable first. Late native callbacks can no longer acquire authority.
    await AsyncStorage.setItem(PASSIVE_MEMORY_ACTIVE_KEY, '0');
    await AsyncStorage.removeItem(PASSIVE_MEMORY_CONTEXT_KEY);
    return true;
  });
}

async function currentContext(): Promise<DurablePassiveMemoryContext | null> {
  try {
    if ((await AsyncStorage.getItem(ACTIVITY_ACTIVE_KEY)) === '1') return null;
    if ((await AsyncStorage.getItem(PASSIVE_MEMORY_ACTIVE_KEY)) !== '1') return null;
    const raw = await AsyncStorage.getItem(PASSIVE_MEMORY_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DurablePassiveMemoryContext & { source?: 'real' };
    const context = parsed?.source == null
      // v1 contexts predating explicit provenance were created only by the
      // physical Expo provider. Normalize them truthfully during migration.
      ? { ...parsed, source: 'real' as const }
      : parsed;
    const structurallyValid = context?.v === 1
      && context.consentVersion === 1
      && context.source === 'real'
      && typeof context.ownerUserId === 'string'
      && typeof context.epoch === 'string';
    if (!structurallyValid) return null;
    if ((await AsyncStorage.getItem(passiveMemoryRevocationKey(context.epoch))) === context.epoch) return null;
    return context;
  } catch {
    return null;
  }
}

export async function readPassiveMemoryContext(): Promise<DurablePassiveMemoryContext | null> {
  return currentContext();
}

export async function startPassiveMemoryBackgroundUpdates(
  context: DurablePassiveMemoryContext,
): Promise<boolean> {
  return withOwnership(async () => {
    const authorityCurrent = async () => {
      const current = await currentContext();
      return current?.epoch === context.epoch
        && current.ownerUserId === context.ownerUserId
        && current.source === 'real'
        && context.source === 'real';
    };
    if (!passiveBackgroundMemoryCapability().supported || !await authorityCurrent()) return false;
    const permission = await Location.getBackgroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED || !await authorityCurrent()) return false;
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(PASSIVE_MEMORY_BACKGROUND_TASK);
    if (!await authorityCurrent()) return false;
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(PASSIVE_MEMORY_BACKGROUND_TASK, {
        accuracy: Location.Accuracy.Balanced,
        distanceInterval: 15,
        timeInterval: 15_000,
        deferredUpdatesDistance: 30,
        deferredUpdatesInterval: 15_000,
        pausesUpdatesAutomatically: true,
        activityType: Location.ActivityType.Fitness,
        showsBackgroundLocationIndicator: false,
        foregroundService: Platform.OS === 'android' ? {
          notificationTitle: 'Cairn Memory is active',
          notificationBody: 'Recording explored places while you walk',
          notificationColor: '#5D7C46',
        } : undefined,
      });
      // Permission, OFF/logout, a new passive epoch, or Activity can change
      // while native start is unresolved. Revalidate before claiming success.
      if (!await authorityCurrent()) {
        await Location.stopLocationUpdatesAsync(PASSIVE_MEMORY_BACKGROUND_TASK).catch(() => undefined);
        return false;
      }
    }
    appendSimulatorLog('PROVIDER', 'passive_memory_background_started_v1', {
      epochSuffix: context.epoch.slice(-8),
      distanceIntervalM: 15,
      deferredUpdatesDistanceM: 30,
      deferredUpdatesIntervalMs: 15_000,
    }, { userId: context.ownerUserId, coordinateSource: 'none', force: true });
    return true;
  });
}

export async function stopPassiveMemoryBackgroundUpdates(expectedEpoch?: string): Promise<void> {
  if (expectedEpoch) await revokePassiveMemoryEvidenceAdmission(expectedEpoch);
  await withOwnership(async () => {
    const raw = await AsyncStorage.getItem(PASSIVE_MEMORY_CONTEXT_KEY).catch(() => null);
    let current: DurablePassiveMemoryContext | null = null;
    try { current = raw ? JSON.parse(raw) as DurablePassiveMemoryContext : null; } catch {}
    // An obsolete cleanup is not authorized to stop the newer epoch's native
    // task. Lease and native stop share this same serialized boundary.
    if (expectedEpoch && current && current.epoch !== expectedEpoch) return;
    await AsyncStorage.setItem(PASSIVE_MEMORY_ACTIVE_KEY, '0');
    await AsyncStorage.removeItem(PASSIVE_MEMORY_CONTEXT_KEY);
    try {
      if (await Location.hasStartedLocationUpdatesAsync(PASSIVE_MEMORY_BACKGROUND_TASK)) {
        await Location.stopLocationUpdatesAsync(PASSIVE_MEMORY_BACKGROUND_TASK);
      }
    } catch { /* unavailable native task is already stopped */ }
  });
}

export async function handlePassiveMemoryBackgroundTask({ data, error }: { data: any; error: any }): Promise<void> {
  await withOwnership(async () => {
    const context = await currentContext();
    if (!context || context.source !== 'real' || !passiveBackgroundMemoryCapability().supported) return;
    const locations = Array.isArray(data?.locations) ? data.locations : [];
    if (error) {
      appendSimulatorLog('ERROR', 'passive_memory_background_source_error_v1', {
        errorCode: String(error).slice(0, 120),
        batchCount: locations.length,
        epochSuffix: context.epoch.slice(-8),
      }, { userId: context.ownerUserId, coordinateSource: 'none', force: true });
      await flushSimulatorLogs(context.ownerUserId).catch(() => undefined);
      return;
    }
    let continuity = context.continuityState ?? createPassiveMemoryContinuityState();
    let rawOrdinal = Math.max(0, context.rawOrdinal || 0);
    let latestTimestamp = Math.max(
      context.acceptAfterMs - 1,
      context.latestObservationTimestampMs ?? 0,
      continuity.latestObservationTimestamp ?? 0,
    );
    let acceptedCount = 0;
    let rejectedCount = 0;
    for (const location of [...locations].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))) {
      const atMs = Number(location.timestamp || Date.now());
      const coords = location.coords ?? {};
      if (!Number.isFinite(atMs) || atMs < context.acceptAfterMs || atMs <= latestTimestamp) continue;
      if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) continue;
      latestTimestamp = atMs;
      rawOrdinal += 1;
      const observation: RealGpsObservation = {
        lat: Number(coords.latitude),
        lng: Number(coords.longitude),
        t: atMs,
        accuracy: Number.isFinite(coords.accuracy) ? Number(coords.accuracy) : null,
        verticalAccuracy: Number.isFinite(coords.altitudeAccuracy) ? Number(coords.altitudeAccuracy) : null,
        altitude: Number.isFinite(coords.altitude) ? Number(coords.altitude) : null,
        speed: Number.isFinite(coords.speed) ? Number(coords.speed) : null,
        course: Number.isFinite(coords.heading) ? Number(coords.heading) : null,
        source: 'background',
        observationId: `${context.epoch.slice(-8)}:${rawOrdinal}`,
        rawOrdinal,
      };
      // Receipt checkpoint occurs before journal/projection work.
      appendSimulatorLog('LOCATION', 'passive_memory_observation_received_v1', {
        rawOrdinal,
        sampleTimestamp: atMs,
        callbackReceiptMs: Date.now(),
        callbackDelayMs: Math.max(0, Date.now() - atMs),
        horizontalAccuracyM: observation.accuracy,
        epochSuffix: context.epoch.slice(-8),
      }, { userId: context.ownerUserId, coordinateSource: 'none', force: true });
      const reduced = reducePassiveMemoryObservation(continuity, observation, Date.now());
      continuity = reduced.state;
      if (reduced.accepted.length === 0) {
        rejectedCount += 1;
        continue;
      }
      for (const point of reduced.accepted) {
        const stillCurrent = await currentContext();
        if (!stillCurrent || stillCurrent.epoch !== context.epoch
          || stillCurrent.ownerUserId !== context.ownerUserId) return;
        await recordMemoryEvidence({
          lat: point.lat,
          lng: point.lng,
          atMs: point.t,
          source: 'passive_real',
          ownerUserId: context.ownerUserId,
          horizontalAccuracyM: point.accuracy ?? undefined,
          continuityState: 'accepted',
          ownerAuthority: 'durable_passive_lease',
          ownerAuthorityEpoch: context.epoch,
        });
        acceptedCount += 1;
      }
    }
    const current = await currentContext();
    if (!current || current.epoch !== context.epoch || current.ownerUserId !== context.ownerUserId) return;
    await AsyncStorage.setItem(PASSIVE_MEMORY_CONTEXT_KEY, JSON.stringify({
      ...context,
      latestObservationTimestampMs: latestTimestamp || null,
      rawOrdinal,
      continuityState: continuity,
    }));
    appendSimulatorLog('MEMORY_EVIDENCE', 'passive_memory_background_batch_v1', {
      batchCount: locations.length,
      acceptedCount,
      rejectedCount,
      epochSuffix: context.epoch.slice(-8),
    }, { userId: context.ownerUserId, coordinateSource: 'none', force: true });
    await flushSimulatorLogs(context.ownerUserId).catch(() => undefined);
  });
}

let registered = false;
if (Platform.OS === 'ios' || Platform.OS === 'android') {
  try {
    // Top-level registration is required for headless delivery.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    if (!TaskManager.isTaskDefined(PASSIVE_MEMORY_BACKGROUND_TASK)) {
      TaskManager.defineTask(PASSIVE_MEMORY_BACKGROUND_TASK, handlePassiveMemoryBackgroundTask);
    }
    registered = true;
  } catch { /* Expo Go/web/rollback build */ }
}

export async function registerPassiveMemoryBackgroundTask(): Promise<boolean> {
  if (registered) return true;
  try {
    const TaskManager = await import('expo-task-manager');
    if (!TaskManager.isTaskDefined(PASSIVE_MEMORY_BACKGROUND_TASK)) {
      TaskManager.defineTask(PASSIVE_MEMORY_BACKGROUND_TASK, handlePassiveMemoryBackgroundTask);
    }
    registered = true;
    return true;
  } catch {
    return false;
  }
}
