import { haversineM } from '../../utils/geo';
import type { ActivityMode, TrackPoint } from '../../store/useSessionStore';
import { useTrackingStore } from '../../store/useTrackingStore';
import {
  discardActiveHike,
  listActiveHikes,
  readActiveHikeTail,
  resumeHikeTrack,
} from '../../services/hikeTrackWriter';
import { deleteRemoteSession } from '../../services/sessionService';
import { BACKGROUND_LOCATION_TASK } from '../../services/backgroundLocationTask';

export interface RecoverableActivity {
  sessionId: string;
  remoteId?: number | null;
  activityMode: ActivityMode;
  startedAt: number;
  distanceM: number;
  durationS: number;
  lastPointAt: number;
}

const RECOVERY_WINDOW_MS = 72 * 60 * 60_000;

function toTrackPoint(point: any): TrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed ?? null,
    t: point.t,
  };
}

function distanceFor(points: TrackPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineM(points[index - 1], points[index]);
  }
  return total;
}

/** Find the newest local crash-safe recording for exactly one activity mode. */
export async function findRecoverableActivity(mode: ActivityMode): Promise<RecoverableActivity | null> {
  const cutoff = Date.now() - RECOVERY_WINDOW_MS;
  const candidates = (await listActiveHikes())
    .filter(meta => meta.activity_mode === mode && (meta.last_ts ?? meta.started_at) > cutoff)
    .sort((a, b) => (b.last_ts ?? b.started_at) - (a.last_ts ?? a.started_at));

  for (const meta of candidates) {
    const rawPoints = await readActiveHikeTail(meta.session_id);
    if (rawPoints.length === 0) continue;
    const points = rawPoints.map(toTrackPoint);
    const lastPointAt = points[points.length - 1].t;
    return {
      sessionId: meta.session_id,
      remoteId: meta.remote_id ?? null,
      activityMode: mode,
      startedAt: meta.started_at,
      distanceM: distanceFor(points),
      durationS: Math.max(1, Math.floor((lastPointAt - meta.started_at) / 1000)),
      lastPointAt,
    };
  }
  return null;
}

/** Restore the same writer/store contract for Hiking and Running. */
export async function restoreRecoverableActivity(activity: RecoverableActivity): Promise<boolean> {
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
  if (rawPoints.length === 0) return false;
  const points = rawPoints.map(toTrackPoint);
  const last = points[points.length - 1];
  useTrackingStore.setState({
    sessionId: activity.sessionId,
    remoteSessionId: activity.remoteId ?? null,
    trackPoints: points,
    trackPointsSmoothed: points,
    trackPointsRaw: points,
    startedAt: activity.startedAt,
    status: 'paused',
    isFinishing: false,
    startError: null,
    distanceM: distanceFor(points),
    durationS: Math.max(1, Math.floor((last.t - activity.startedAt) / 1000)),
    activityMode: activity.activityMode,
    lastCoordinate: {
      lat: last.lat,
      lng: last.lng,
      alt: last.alt,
      accuracy: last.accuracy,
      speed: last.speed,
    },
    lastCoordinateTime: last.t,
    lastFixTimestamp: last.t,
  });
  await resumeHikeTrack(activity.sessionId);
  await useTrackingStore.getState().resumeTracking();
  return useTrackingStore.getState().status === 'tracking';
}

export async function discardRecoverableActivity(activity: RecoverableActivity): Promise<void> {
  await discardActiveHike(activity.sessionId);
  if (activity.remoteId) await deleteRemoteSession(activity.remoteId);
}
