import type { ActivityMode, TrackPoint } from '../../store/useSessionStore';
import { useTrackingStore } from '../../store/useTrackingStore';
import {
  discardActiveHike,
  listActiveHikes,
  readActiveHikeTail,
  resumeHikeTrack,
  startHikeTrack,
} from '../../services/hikeTrackWriter';
import { deleteRemoteSession, deleteRemoteSessionByClientId } from '../../services/sessionService';
import { BACKGROUND_LOCATION_TASK, persistBackgroundContext } from '../../services/backgroundLocationTask';
import { useAppStore } from '../../store/useAppStore';
import {
  calculateActivityStats,
  newSegmentId,
  type SegmentedTrackPoint,
} from './activityContracts';
import {
  getActivityRegistry,
  getUnfinishedActivity,
  registerUnfinishedActivity,
  tombstoneActivity,
  updateUnfinishedActivity,
} from './activityRegistry';
import { recordMemoryEvidence } from '../memory/services/recordMemoryEvidence';
import { removePending } from '../../services/pendingSyncStore';
import type { ActivityLocationSource } from '../activitySimulator/types';
import { activityTimestampForSource } from '../activitySimulator/simulatorTime';

export interface RecoverableActivity {
  sessionId: string;
  clientActivityId: string;
  remoteId?: number | null;
  userId: string;
  ownerGeneration: string;
  activityMode: ActivityMode;
  startedAt: number;
  distanceM: number;
  durationS: number;
  pointCount: number;
  saveEligible: boolean;
  lastPointAt: number;
  locationProviderSource?: ActivityLocationSource;
}

/** One-time bounded migration from the former file-only discovery model. */
export async function ensureUnfinishedActivityRegistry(userId: string): Promise<void> {
  if (!userId || userId === 'guest' || userId === 'unknown') return;
  const registry = await getActivityRegistry(userId);
  if (registry.unfinished) return;
  const terminalIds = new Set([
    ...registry.completed.map(item => item.clientActivityId),
    ...registry.tombstones.map(item => item.clientActivityId),
  ]);
  const candidates = (await listActiveHikes())
    .filter(meta => !meta.ended_at)
    // Unscoped legacy journals cannot be safely attributed after an account
    // switch. Preserve them on disk for explicit migration/support tooling,
    // but never expose or upload them under whichever user logs in next.
    .filter(meta => String(meta.user_id ?? '') === userId)
    // A process can die after local completion/ACK but before journal rename.
    // Registry lifecycle is authoritative; never resurrect that stale active
    // artifact as an unfinished Activity.
    .filter(meta => !terminalIds.has(meta.session_id))
    .sort((a, b) => (b.last_ts ?? b.started_at) - (a.last_ts ?? a.started_at));
  const chosen = candidates[0];
  if (!chosen) return;
  const points = await readActiveHikeTail(chosen.session_id);
  if (points.length === 0) return;
  const ownerGeneration = chosen.owner_generation ?? newSegmentId(`${chosen.session_id}-owner`);
  const currentSegmentId = points[points.length - 1]?.segmentId ?? 'legacy-0';
  await registerUnfinishedActivity({
    clientActivityId: chosen.session_id,
    serverActivityId: chosen.remote_id ?? null,
    userId,
    activityMode: chosen.activity_mode,
    startedAt: chosen.started_at,
    lastMeaningfulAt: chosen.last_ts ?? chosen.started_at,
    liveOwnerGeneration: ownerGeneration,
    currentSegmentId,
    nextSegmentStartReason: 'process-recovery',
    locationProviderSource: chosen.location_source ?? 'real',
    lifecycle: 'unfinished',
  });
}

function toTrackPoint(point: any, sessionId: string): SegmentedTrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed ?? null,
    t: point.t,
    segmentId: point.segmentId ?? 'legacy-0',
    ...(point.segmentStartReason ? { segmentStartReason: point.segmentStartReason } : {}),
    source: point.src === 'sim'
      ? 'simulator'
      : point.src === 'bg' ? 'background' : point.src === 'slc' ? 'significant-change' : 'foreground',
  };
}

/**
 * Find the one registered unfinished Activity. Exact-ID lookup is authoritative;
 * the mode form remains only as a backward-compatible screen adapter.
 */
export async function findRecoverableActivity(
  query: ActivityMode | { clientActivityId: string; userId: string },
): Promise<RecoverableActivity | null> {
  const currentUserId = typeof query === 'string'
    ? String(useAppStore.getState().user?.id ?? '')
    : query.userId;
  if (!currentUserId) return null;
  const registered = await getUnfinishedActivity(currentUserId);
  const exactId = typeof query === 'string' ? registered?.clientActivityId : query.clientActivityId;
  const mode = typeof query === 'string' ? query : registered?.activityMode;
  if (!exactId) return null;
  const candidates = (await listActiveHikes())
    .filter(meta => meta.session_id === exactId)
    .filter(meta => String(meta.user_id ?? '') === currentUserId)
    .sort((a, b) => (b.last_ts ?? b.started_at) - (a.last_ts ?? a.started_at));

  for (const meta of candidates) {
    const rawPoints = await readActiveHikeTail(meta.session_id);
    const points = rawPoints.map(point => toTrackPoint(point, meta.session_id));
    const lastPointAt = points[points.length - 1]?.t ?? meta.last_ts ?? meta.started_at;
    const stats = calculateActivityStats(points);
    const eligibility = (await import('./activityContracts')).saveEligibility(points, stats.distanceM);
    return {
      sessionId: meta.session_id,
      clientActivityId: meta.session_id,
      remoteId: meta.remote_id ?? null,
      userId: currentUserId,
      ownerGeneration: meta.owner_generation ?? registered?.liveOwnerGeneration ?? 'legacy',
      activityMode: meta.activity_mode ?? mode ?? 'hiking',
      startedAt: meta.started_at,
      distanceM: stats.distanceM,
      durationS: stats.activeDurationS,
      pointCount: points.length,
      saveEligible: eligibility.eligible,
      lastPointAt,
      locationProviderSource: meta.location_source ?? registered?.locationProviderSource ?? 'real',
    };
  }
  // Registry commit precedes native source activation. If the process died in
  // that narrow interval, there may be no journal/meta yet; keep the truthful
  // zero-point Activity recoverable with Save disabled.
  if (registered && registered.clientActivityId === exactId) {
    return {
      sessionId: registered.clientActivityId,
      clientActivityId: registered.clientActivityId,
      remoteId: registered.serverActivityId,
      userId: registered.userId,
      ownerGeneration: registered.liveOwnerGeneration,
      activityMode: registered.activityMode,
      startedAt: registered.startedAt,
      distanceM: 0,
      durationS: 0,
      pointCount: 0,
      saveEligible: false,
      lastPointAt: registered.lastMeaningfulAt,
      locationProviderSource: registered.locationProviderSource ?? 'real',
    };
  }
  return null;
}

/** Restore the same writer/store contract for Hiking and Running. */
export async function loadRecoverableActivity(activity: RecoverableActivity): Promise<boolean> {
  // A jetsam-recovered task can still be registered with CoreLocation.
  // Stop it before rebuilding the store, then resumeTracking establishes
  // exactly one source for the current AppState.
  try {
    const Location = await import('expo-location');
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch { /* unavailable on Web/simulator; resume still owns foreground */ }
  const rawPoints = await readActiveHikeTail(activity.sessionId);
  const points = rawPoints.map(point => toTrackPoint(point, activity.sessionId));
  const last = points[points.length - 1] ?? null;
  const stats = calculateActivityStats(points);
  const newOwnerGeneration = newSegmentId(`${activity.sessionId}-owner`);
  const recoverySegmentId = newSegmentId(activity.sessionId);
  const locationProviderSource = activity.locationProviderSource ?? 'real';
  useTrackingStore.setState({
    sessionId: activity.sessionId,
    ownerUserId: activity.userId,
    remoteSessionId: activity.remoteId ?? null,
    trackPoints: points,
    trackPointsSmoothed: points,
    trackPointsRaw: points,
    startedAt: activity.startedAt,
    status: 'paused',
    isFinishing: false,
    startError: null,
    distanceM: stats.distanceM,
    durationS: stats.activeDurationS,
    elevationGainM: stats.elevationGainM,
    activityMode: activity.activityMode,
    lastCoordinate: last ? {
      lat: last.lat,
      lng: last.lng,
      alt: last.alt,
      accuracy: last.accuracy,
      speed: last.speed,
    } : null,
    lastCoordinateTime: last?.t ?? null,
    lastFixTimestamp: last?.t ?? null,
    liveOwnerGeneration: newOwnerGeneration,
    liveOwnerAcceptAfterMs: activityTimestampForSource(
      locationProviderSource,
      Date.now(),
      last?.t ?? activity.startedAt,
    ),
    currentSegmentId: recoverySegmentId,
    pendingSegmentStartReason: 'process-recovery',
    locationProviderSource,
  });
  if (points.length > 0) {
    await resumeHikeTrack(activity.sessionId);
  } else {
    await startHikeTrack(activity.sessionId, {
      started_at: activity.startedAt,
      activity_mode: activity.activityMode,
      user_id: activity.userId,
      owner_generation: newOwnerGeneration,
      remote_id: activity.remoteId ?? undefined,
      location_source: locationProviderSource,
    });
  }
  await persistBackgroundContext(null, false);
  await updateUnfinishedActivity(activity.userId, activity.sessionId, {
    liveOwnerGeneration: newOwnerGeneration,
    currentSegmentId: recoverySegmentId,
    nextSegmentStartReason: 'process-recovery',
  });
  // Reconcile Activity evidence that was journaled before a prior process
  // death but may not yet have reached the Memory store.
  for (const point of points) {
    await recordMemoryEvidence({
      lat: point.lat,
      lng: point.lng,
      atMs: point.t,
      source: 'reconciliation',
      ownerUserId: activity.userId,
    });
  }
  return true;
}

/** Restore and begin a fresh recording segment for this exact Activity. */
export async function restoreRecoverableActivity(activity: RecoverableActivity): Promise<boolean> {
  if (!await loadRecoverableActivity(activity)) return false;
  await useTrackingStore.getState().resumeTracking();
  return useTrackingStore.getState().status === 'tracking';
}

/** Finalize the preserved portion without resuming live GPS. */
export async function saveRecoverableActivity(
  activity: RecoverableActivity,
  sessionName?: string,
): Promise<boolean> {
  if (!await loadRecoverableActivity(activity)) return false;
  return useTrackingStore.getState().stopTracking(sessionName);
}

export async function discardRecoverableActivity(activity: RecoverableActivity): Promise<void> {
  if (String(useAppStore.getState().user?.id ?? '') !== activity.userId) {
    throw new Error('activity_discard_owner_mismatch');
  }
  // The Activity journal is the crash-recoverable Memory intent. Disable the
  // headless lease first, then reconcile every accepted real point before the
  // journal can be tombstoned/deleted. If Memory persistence fails, Discard
  // fails closed and the recoverable Activity remains available to retry.
  const fenced = await persistBackgroundContext(null, false);
  if (!fenced) throw new Error('activity_discard_background_fence_failed');
  const acceptedPoints = await readActiveHikeTail(activity.sessionId);
  for (const point of acceptedPoints) {
    await recordMemoryEvidence({
      lat: point.lat,
      lng: point.lng,
      atMs: point.t,
      source: 'reconciliation',
      ownerUserId: activity.userId,
    });
  }
  await tombstoneActivity({
    userId: activity.userId,
    clientActivityId: activity.clientActivityId,
    serverActivityId: activity.remoteId,
  });
  await removePending(activity.clientActivityId, activity.userId);
  await discardActiveHike(activity.sessionId);
  // Install the server-side business tombstone even when a numeric shell is
  // known. This makes any reordered/lost start, append or finish retry a no-op.
  const cancelled = await deleteRemoteSessionByClientId(activity.clientActivityId);
  if (!cancelled && activity.remoteId) await deleteRemoteSession(activity.remoteId);
}
