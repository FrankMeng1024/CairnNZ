import type { TrackingSession, TrackPoint } from '../../store/useSessionStore';
import { useSessionStore } from '../../store/useSessionStore';
import type { PendingHike } from '../../services/pendingSyncStore';
import { completeActivity } from './activityRegistry';

/**
 * Roll a verified completion intent forward after a crash at any local Save
 * phase. The pending snapshot is the commit record; summary/trace and registry
 * writes are deterministic idempotent projections of that record.
 */
export async function reconcileCompletedActivityIntent(
  ownerUserId: string,
  intent: PendingHike,
): Promise<TrackingSession> {
  if (!ownerUserId || intent.userId !== ownerUserId) {
    throw new Error('activity_completion_owner_mismatch');
  }
  const payload = intent.payload;
  const trace: TrackPoint[] = payload.route_points.map(point => ({
    lat: point.lat,
    lng: point.lng,
    t: point.t,
    ...(point.segment_id ? { segmentId: point.segment_id } : {}),
    ...(point.segment_start_reason ? { segmentStartReason: point.segment_start_reason } : {}),
  }));
  const summary = intent.summary;
  const startedAt = summary?.startedAt ?? intent.startedAt ?? intent.createdAt;
  const endedAt = summary?.endedAt ?? new Date(payload.end_time).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    throw new Error('activity_completion_time_invalid');
  }
  const completedLocal: TrackingSession = {
    id: intent.localId,
    clientActivityId: intent.localId,
    remoteId: intent.remoteId ?? undefined,
    serverActivityId: intent.remoteId ?? undefined,
    activityMode: intent.activityMode,
    regionCode: 'nz',
    startedAt,
    endedAt,
    durationS: summary?.durationS ?? payload.duration_s,
    distanceM: summary?.distanceM ?? payload.distance_m,
    elevationGainM: summary?.elevationGainM ?? 0,
    trackPoints: trace,
    markerIds: [...(summary?.markerIds ?? [])],
    name: summary?.name ?? payload.name ?? undefined,
    syncState: 'pending',
  };

  // Phase 2 is a complete durable Detail projection. If phase 3 fails, this
  // remains visible and the same intent retries completeActivity on relaunch.
  await useSessionStore.getState().addSession(completedLocal, ownerUserId);
  await completeActivity({
    clientActivityId: intent.localId,
    serverActivityId: intent.remoteId ?? null,
    userId: ownerUserId,
    activityMode: intent.activityMode,
    startedAt,
    endedAt,
    lifecycle: 'completed_local',
    syncState: 'pending',
  });
  return completedLocal;
}
