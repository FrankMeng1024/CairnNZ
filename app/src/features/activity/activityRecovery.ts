import type { ActivityMode, TrackPoint } from '../../store/useSessionStore';
import { useTrackingStore } from '../../store/useTrackingStore';
import {
  discardActiveHike,
  listActiveHikes,
  readActiveHikeTail,
  releaseHikeTrackFinishSeal,
  resumeHikeTrack,
  startHikeTrack,
} from '../../services/hikeTrackWriter';
import { deleteRemoteSession, deleteRemoteSessionByClientId } from '../../services/sessionService';
import { BACKGROUND_LOCATION_TASK, persistBackgroundContext } from '../../services/backgroundLocationTask';
import { useAppStore } from '../../store/useAppStore';
import {
  calculateLifecycleDurationMs,
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
import {
  flushRecordedMemoryEvidence,
  recordMemoryEvidence,
} from '../memory/services/recordMemoryEvidence';
import { readPendingReadonly, removePending } from '../../services/pendingSyncStore';
import type { ActivityLocationSource } from '../activitySimulator/types';
import { activityFreshnessNow, activityTimestampForSource } from '../activitySimulator/simulatorTime';
import { endSimulatorProvider } from '../activitySimulator/activityLocationProvider';
import { appendSimulatorLog } from '../activitySimulator/simulatorLog';
import type { ActivityRouteReference } from '../route/routeContracts';
import {
  captureStableAccountEpoch,
  isStableAccountEpoch,
} from '../../services/accountTransitionAuthority';

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
  borrowedRouteReference?: ActivityRouteReference;
}

interface ActivityRecoveryAuthority {
  userId: string;
  accountEpoch: number;
}

function currentAccountOwns(userId: string): boolean {
  const state = useAppStore.getState();
  return state.isLoggedIn !== false && String(state.user?.id ?? '') === userId;
}

function captureRecoveryAuthority(userId: string): ActivityRecoveryAuthority | null {
  const accountEpoch = captureStableAccountEpoch();
  if (accountEpoch === null || !currentAccountOwns(userId)) return null;
  return { userId, accountEpoch };
}

function recoveryAuthorityCurrent(authority: ActivityRecoveryAuthority): boolean {
  return isStableAccountEpoch(authority.accountEpoch) && currentAccountOwns(authority.userId);
}

async function registeredActivityStillCurrent(
  activity: Pick<RecoverableActivity, 'userId' | 'clientActivityId' | 'ownerGeneration'>,
  authority: ActivityRecoveryAuthority,
): Promise<boolean> {
  if (!recoveryAuthorityCurrent(authority)) return false;
  const registered = await getUnfinishedActivity(activity.userId);
  return recoveryAuthorityCurrent(authority)
    && registered?.clientActivityId === activity.clientActivityId
    && registered.userId === activity.userId
    && registered.liveOwnerGeneration === activity.ownerGeneration;
}

function publishRecoveredBorrowedRoute(reference?: ActivityRouteReference): void {
  try {
    // Lazy import avoids making Route-store initialization part of the
    // headless Activity recovery discovery path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useRouteStore } = require('../../store/useRouteStore');
    useRouteStore.setState({
      activityRouteReference: reference ? {
        ...reference,
        points: reference.points.map(point => ({ ...point })),
      } : null,
    });
  } catch { /* Route presentation is unavailable in this runtime. */ }
}

/** One-time bounded migration from the former file-only discovery model. */
export async function ensureUnfinishedActivityRegistry(userId: string): Promise<void> {
  if (!userId || userId === 'guest' || userId === 'unknown') return;
  const authority = captureRecoveryAuthority(userId);
  if (!authority) return;
  const registry = await getActivityRegistry(userId);
  if (!recoveryAuthorityCurrent(authority)) return;
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
  if (!recoveryAuthorityCurrent(authority)) return;
  const chosen = candidates[0];
  if (!chosen) return;
  const points = await readActiveHikeTail(chosen.session_id);
  if (!recoveryAuthorityCurrent(authority)) return;
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
  }, { shouldCommit: () => recoveryAuthorityCurrent(authority) });
}

function toTrackPoint(point: Awaited<ReturnType<typeof readActiveHikeTail>>[number]): SegmentedTrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.accuracy,
    verticalAccuracy: point.verticalAccuracy,
    speed: point.speed ?? null,
    course: point.course,
    t: point.t,
    segmentId: point.segmentId ?? 'legacy-0',
    ...(point.segmentStartReason ? { segmentStartReason: point.segmentStartReason } : {}),
    source: point.source,
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
  const authority = captureRecoveryAuthority(currentUserId);
  if (!authority) return null;
  const registered = await getUnfinishedActivity(currentUserId);
  if (!recoveryAuthorityCurrent(authority) || !registered || registered.userId !== currentUserId) return null;
  const exactId = registered.clientActivityId;
  if (typeof query !== 'string' && query.clientActivityId !== exactId) return null;
  const mode = typeof query === 'string' ? query : registered.activityMode;
  let pendingFinish: Awaited<ReturnType<typeof readPendingReadonly>>;
  try {
    pendingFinish = await readPendingReadonly(exactId);
  } catch {
    // Storage uncertainty is not proof that a Finish payload is absent.
    return null;
  }
  if (!recoveryAuthorityCurrent(authority)) return null;
  if (pendingFinish) {
    // Completion recovery is owned by the sync daemon. Discovery is read-only:
    // any retained outbox (including a different/corrupt owner) keeps the
    // terminal fence closed instead of being relabelled as resumable.
    return null;
  } else {
    // Crash after installing the Finish fence but before writing any pending
    // payload: no completion authority exists, so safely reopen this exact
    // unfinished owner for Resume/Save.
    const released = await releaseHikeTrackFinishSeal(
      exactId,
      registered.liveOwnerGeneration,
      { shouldContinue: () => recoveryAuthorityCurrent(authority) },
    );
    if (!released || !recoveryAuthorityCurrent(authority)) return null;
  }
  const candidates = (await listActiveHikes())
    .filter(meta => meta.session_id === exactId)
    .filter(meta => String(meta.user_id ?? '') === currentUserId)
    .sort((a, b) => (b.last_ts ?? b.started_at) - (a.last_ts ?? a.started_at));
  if (!recoveryAuthorityCurrent(authority)) return null;

  for (const meta of candidates) {
    const rawPoints = await readActiveHikeTail(meta.session_id);
    if (!recoveryAuthorityCurrent(authority)) return null;
    const points = rawPoints.map(toTrackPoint);
    const lastPointAt = points[points.length - 1]?.t ?? meta.last_ts ?? meta.started_at;
    const stats = calculateActivityStats(points);
    const locationProviderSource = meta.location_source ?? registered?.locationProviderSource ?? 'real';
    const hasLifecycleClock = Number.isFinite(registered?.activeDurationMs)
      || Number.isFinite(registered?.activeSinceMs);
    const recoveredDurationS = hasLifecycleClock
      ? Math.floor(calculateLifecycleDurationMs({
          accumulatedMs: Number(registered?.activeDurationMs ?? 0),
          activeSinceMs: Number.isFinite(registered?.activeSinceMs)
            ? Number(registered?.activeSinceMs)
            : null,
          nowMs: activityFreshnessNow(locationProviderSource),
        }) / 1000)
      : stats.activeDurationS;
    const eligibility = (await import('./activityContracts')).saveEligibility(points, stats.distanceM);
    if (!recoveryAuthorityCurrent(authority)) return null;
    return {
      sessionId: meta.session_id,
      clientActivityId: meta.session_id,
      remoteId: meta.remote_id ?? null,
      userId: currentUserId,
      ownerGeneration: meta.owner_generation ?? registered?.liveOwnerGeneration ?? 'legacy',
      activityMode: meta.activity_mode ?? mode ?? 'hiking',
      startedAt: meta.started_at,
      distanceM: stats.distanceM,
      durationS: recoveredDurationS,
      pointCount: points.length,
      saveEligible: eligibility.eligible,
      lastPointAt,
      locationProviderSource,
      borrowedRouteReference: registered?.clientActivityId === exactId
        ? registered.borrowedRouteReference
        : undefined,
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
      durationS: Number.isFinite(registered.activeDurationMs) || Number.isFinite(registered.activeSinceMs)
        ? Math.floor(calculateLifecycleDurationMs({
            accumulatedMs: Number(registered.activeDurationMs ?? 0),
            activeSinceMs: Number.isFinite(registered.activeSinceMs)
              ? Number(registered.activeSinceMs)
              : null,
            nowMs: activityFreshnessNow(registered.locationProviderSource ?? 'real'),
          }) / 1000)
        : 0,
      pointCount: 0,
      saveEligible: false,
      lastPointAt: registered.lastMeaningfulAt,
      locationProviderSource: registered.locationProviderSource ?? 'real',
      borrowedRouteReference: registered.borrowedRouteReference,
    };
  }
  return null;
}

/** Restore the same writer/store contract for Hiking and Running. */
export async function loadRecoverableActivity(activity: RecoverableActivity): Promise<boolean> {
  const authority = captureRecoveryAuthority(activity.userId);
  if (!authority || !await registeredActivityStillCurrent(activity, authority)) return false;
  // A jetsam-recovered task can still be registered with CoreLocation.
  // Stop it before rebuilding the store, then resumeTracking establishes
  // exactly one source for the current AppState.
  try {
    const Location = await import('expo-location');
    if (!recoveryAuthorityCurrent(authority)) return false;
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      if (!recoveryAuthorityCurrent(authority)) return false;
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (!recoveryAuthorityCurrent(authority)) return false;
    }
  } catch { /* unavailable on Web/simulator; resume still owns foreground */ }
  if (!recoveryAuthorityCurrent(authority)) return false;
  const rawPoints = await readActiveHikeTail(activity.sessionId);
  if (!recoveryAuthorityCurrent(authority)) return false;
  const points = rawPoints.map(toTrackPoint);
  const last = points[points.length - 1] ?? null;
  const stats = calculateActivityStats(points);
  // Keep the journal/registry generation unchanged while presenting the
  // recovered Activity as paused. `resumeTracking` performs the strict,
  // durable generation rollover before it re-enables a location source.
  // Saving the preserved portion therefore seals the same generation that is
  // already present in metadata, eliminating an unreleasable crash window.
  const recoveredOwnerGeneration = activity.ownerGeneration;
  const recoverySegmentId = newSegmentId(activity.sessionId);
  const locationProviderSource = activity.locationProviderSource ?? 'real';
  if (points.length > 0) {
    await resumeHikeTrack(activity.sessionId, {
      shouldContinue: () => recoveryAuthorityCurrent(authority),
    });
  } else {
    await startHikeTrack(activity.sessionId, {
      started_at: activity.startedAt,
      activity_mode: activity.activityMode,
      user_id: activity.userId,
      owner_generation: recoveredOwnerGeneration,
      remote_id: activity.remoteId ?? undefined,
      location_source: locationProviderSource,
    }, { shouldContinue: () => recoveryAuthorityCurrent(authority) });
  }
  if (!recoveryAuthorityCurrent(authority)) return false;
  const backgroundFenced = await persistBackgroundContext(
    null,
    false,
    null,
    { shouldContinue: () => recoveryAuthorityCurrent(authority) },
  );
  if (!backgroundFenced || !recoveryAuthorityCurrent(authority)) return false;
  const registryUpdated = await updateUnfinishedActivity(activity.userId, activity.sessionId, {
    liveOwnerGeneration: recoveredOwnerGeneration,
    currentSegmentId: recoverySegmentId,
    nextSegmentStartReason: 'process-recovery',
    activeDurationMs: Math.max(0, activity.durationS * 1000),
    activeSinceMs: null,
  }, { shouldCommit: () => recoveryAuthorityCurrent(authority) });
  if (!registryUpdated || !recoveryAuthorityCurrent(authority)) return false;
  publishRecoveredBorrowedRoute(activity.borrowedRouteReference);
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
    durationS: activity.durationS,
    activeDurationAccumulatedMs: Math.max(0, activity.durationS * 1000),
    activeDurationStartedAtMs: null,
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
    latestSourceLocationTime: last?.t ?? null,
    latestSourceKind: last?.source === 'background' || last?.source === 'significant-change'
      ? 'background'
      : last ? 'foreground' : null,
    foregroundRecoveryUntilMs: null,
    latestSourceCoordinate: last ? { ...last, t: last.t } : null,
    liveOwnerGeneration: recoveredOwnerGeneration,
    liveOwnerAcceptAfterMs: activityTimestampForSource(
      locationProviderSource,
      Date.now(),
      last?.t ?? activity.startedAt,
    ),
    currentSegmentId: recoverySegmentId,
    pendingSegmentStartReason: 'process-recovery',
    locationProviderSource,
  });
  // Reconcile Activity evidence that was journaled before a prior process
  // death but may not yet have reached the Memory store.
  for (const point of points) {
    if (!recoveryAuthorityCurrent(authority)) return false;
    await recordMemoryEvidence({
      lat: point.lat,
      lng: point.lng,
      atMs: point.t,
      source: locationProviderSource === 'simulator' ? 'simulator_test' : 'activity_real',
      ownerUserId: activity.userId,
      durability: 'deferred',
      sourceActivityClientId: activity.clientActivityId,
      sourceSegmentId: point.segmentId,
      horizontalAccuracyM: point.accuracy ?? undefined,
      continuityState: 'accepted',
    });
  }
  if (points.length > 0) {
    if (!recoveryAuthorityCurrent(authority)) return false;
    await flushRecordedMemoryEvidence();
  }
  if (!recoveryAuthorityCurrent(authority)) return false;
  appendSimulatorLog('ACTIVITY_RECOVERY', 'activity_recovery_loaded', {
    providerSource: locationProviderSource,
    pointCount: points.length,
    recoverySegmentId,
    saveEligible: activity.saveEligible,
  }, {
    userId: activity.userId,
    clientActivityId: activity.clientActivityId,
    coordinateSource: 'none',
  });
  return true;
}

/** Restore and begin a fresh recording segment for this exact Activity. */
export async function restoreRecoverableActivity(activity: RecoverableActivity): Promise<boolean> {
  if (!await loadRecoverableActivity(activity)) return false;
  const authority = captureRecoveryAuthority(activity.userId);
  if (!authority || !await registeredActivityStillCurrent(activity, authority)) return false;
  await useTrackingStore.getState().resumeTracking();
  return recoveryAuthorityCurrent(authority) && useTrackingStore.getState().status === 'tracking';
}

/** Finalize the preserved portion without resuming live GPS. */
export async function saveRecoverableActivity(
  activity: RecoverableActivity,
  sessionName?: string,
): Promise<boolean> {
  if (!await loadRecoverableActivity(activity)) return false;
  const authority = captureRecoveryAuthority(activity.userId);
  if (!authority || !await registeredActivityStillCurrent(activity, authority)) return false;
  return useTrackingStore.getState().stopTracking(sessionName);
}

export async function discardRecoverableActivity(activity: RecoverableActivity): Promise<void> {
  const authority = captureRecoveryAuthority(activity.userId);
  if (!authority) {
    throw new Error('activity_discard_owner_mismatch');
  }
  const registry = await getActivityRegistry(activity.userId);
  if (!recoveryAuthorityCurrent(authority)
    || registry.unfinished?.clientActivityId !== activity.clientActivityId
    || registry.unfinished.liveOwnerGeneration !== activity.ownerGeneration) {
    // Recovery UI can become stale while a pending Save or sync acknowledgement
    // advances lifecycle. Only the exact currently-unfinished identity may be
    // discarded; completed-local and tombstoned records are immutable here.
    throw new Error('activity_discard_not_unfinished');
  }
  // The Activity journal is the crash-recoverable Memory intent. Disable the
  // headless lease first, then reconcile every accepted real point before the
  // journal can be tombstoned/deleted. If Memory persistence fails, Discard
  // fails closed and the recoverable Activity remains available to retry.
  const fenced = await persistBackgroundContext(
    null,
    false,
    null,
    { shouldContinue: () => recoveryAuthorityCurrent(authority) },
  );
  if (!fenced) throw new Error('activity_discard_background_fence_failed');
  const acceptedPoints = await readActiveHikeTail(activity.sessionId);
  if (!recoveryAuthorityCurrent(authority)) throw new Error('activity_discard_owner_mismatch');
  for (const point of acceptedPoints) {
    if (!recoveryAuthorityCurrent(authority)) throw new Error('activity_discard_owner_mismatch');
    await recordMemoryEvidence({
      lat: point.lat,
      lng: point.lng,
      atMs: point.t,
      source: activity.locationProviderSource === 'simulator' ? 'simulator_test' : 'activity_real',
      ownerUserId: activity.userId,
      durability: 'deferred',
      sourceActivityClientId: activity.clientActivityId,
      sourceSegmentId: point.segmentId,
      horizontalAccuracyM: point.accuracy ?? undefined,
      continuityState: 'accepted',
    });
  }
  if (acceptedPoints.length > 0) {
    if (!recoveryAuthorityCurrent(authority)) throw new Error('activity_discard_owner_mismatch');
    await flushRecordedMemoryEvidence();
  }
  if (!recoveryAuthorityCurrent(authority)) throw new Error('activity_discard_owner_mismatch');
  await tombstoneActivity({
    userId: activity.userId,
    clientActivityId: activity.clientActivityId,
    serverActivityId: activity.remoteId,
  }, { shouldCommit: () => recoveryAuthorityCurrent(authority) });
  if (recoveryAuthorityCurrent(authority)) publishRecoveredBorrowedRoute();
  await removePending(activity.clientActivityId, activity.userId);
  await discardActiveHike(activity.sessionId);
  // Install the server-side business tombstone even when a numeric shell is
  // known. This makes any reordered/lost start, append or finish retry a no-op.
  if (recoveryAuthorityCurrent(authority)) {
    const cancelled = await deleteRemoteSessionByClientId(activity.clientActivityId, activity.userId);
    if (!cancelled && activity.remoteId && recoveryAuthorityCurrent(authority)) {
      await deleteRemoteSession(activity.remoteId, activity.userId);
    }
  }
  if (activity.locationProviderSource === 'simulator' && recoveryAuthorityCurrent(authority)) {
    appendSimulatorLog('ACTIVITY_RECOVERY', 'simulator_recovery_discarded', {
      pointCount: acceptedPoints.length,
    }, {
      userId: activity.userId,
      clientActivityId: activity.clientActivityId,
      coordinateSource: 'none',
    });
    await endSimulatorProvider('discarded');
  }
}
