import type { ActivityMode, TrackPoint, TrackingSession } from '../../store/useSessionStore';

export interface ActivityFinishSavedResult {
  status: 'saved-local';
  localCommit: 'committed';
  clientActivityId: string;
  activityMode: ActivityMode;
  startedAt: number;
  durationS: number;
  distanceM: number;
  elevationGainM: number;
  trackPoints: TrackPoint[];
  syncState: 'synced' | 'pending';
  finalGeometryState: NonNullable<TrackingSession['finalGeometryState']>;
  finalGeometryRevision: number;
  finalGeometryFingerprint: string;
}

export interface ActivityFinishRecoverableFailureResult {
  status: 'recoverable-failure';
  localCommit: 'not-committed';
  clientActivityId: string;
  reason: 'eligibility-changed' | 'local-commit-failed';
}

export type ActivityFinishResult = ActivityFinishSavedResult | ActivityFinishRecoverableFailureResult;

export function activityFinishResultFromSession(
  session: TrackingSession,
): ActivityFinishSavedResult | null {
  const clientActivityId = session.clientActivityId ?? session.id;
  const finalGeometryRevision = session.finalGeometryRevision;
  const finalGeometryFingerprint = session.finalGeometryFingerprint;
  if (!clientActivityId
    || session.trackPoints.length < 2
    || finalGeometryRevision == null
    || !finalGeometryFingerprint) return null;
  return {
    status: 'saved-local',
    localCommit: 'committed',
    clientActivityId,
    activityMode: session.activityMode,
    startedAt: session.startedAt,
    durationS: session.durationS,
    distanceM: session.distanceM,
    elevationGainM: session.elevationGainM,
    trackPoints: session.trackPoints,
    syncState: session.syncState === 'synced' ? 'synced' : 'pending',
    finalGeometryState: session.finalGeometryState ?? 'base_ready',
    finalGeometryRevision,
    finalGeometryFingerprint,
  };
}
