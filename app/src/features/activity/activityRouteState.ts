import type { TrackPoint, TrackingSession } from '../../store/useSessionStore';
import { segmentTrace } from './activityContracts';

export type ActivityLocalReadiness = 'ready' | 'loading' | 'unavailable';
export type ActivityServerSync = 'synced' | 'pending' | 'syncing'
  | 'retryable_error' | 'auth_required' | 'action_required' | 'dependency';
export type ActivityFinalEnhancement = 'base' | 'refining' | 'enhanced' | 'limited' | 'unknown';
export type ActivityRouteReadiness = 'ready' | 'needs_review' | 'missing_section' | 'unavailable';
export type ActivityManualAction = 'none' | 'keep_or_snap' | 'choose_or_reconnect';

export interface ActivityRouteState {
  localReadiness: ActivityLocalReadiness;
  serverSync: ActivityServerSync;
  finalEnhancement: ActivityFinalEnhancement;
  routeReadiness: ActivityRouteReadiness;
  manualAction: ActivityManualAction;
  realSegmentCount: number;
  gapCount: number;
}

export function deriveActivityRouteState(args: {
  session: Pick<TrackingSession, 'syncState' | 'syncFailureKind' | 'finalGeometryState'>;
  trackPoints: ReadonlyArray<TrackPoint> | null;
}): ActivityRouteState {
  const { session, trackPoints } = args;
  const localReadiness = trackPoints === null
    ? 'loading'
    : trackPoints.length >= 2 ? 'ready' : 'unavailable';
  const trace = trackPoints ? segmentTrace(trackPoints) : { segments: [], gaps: [] };
  const realSegments = trace.segments.filter(segment => segment.length >= 2);
  const serverSync: ActivityServerSync = session.syncState === 'pending'
    ? 'pending'
    : session.syncState === 'syncing'
      ? 'syncing'
      : session.syncState === 'sync_error'
        ? session.syncFailureKind === 'auth_required'
          ? 'auth_required'
          : session.syncFailureKind === 'action_required'
            ? 'action_required'
            : session.syncFailureKind === 'dependency'
              ? 'dependency'
              : 'retryable_error'
        : 'synced';
  const finalEnhancement: ActivityFinalEnhancement = session.finalGeometryState === 'base_ready'
    ? 'base'
    : session.finalGeometryState === 'refining'
      ? 'refining'
      : session.finalGeometryState === 'enhanced'
        ? 'enhanced'
        : session.finalGeometryState === 'limited_evidence' ? 'limited' : 'unknown';

  let routeReadiness: ActivityRouteReadiness = 'unavailable';
  let manualAction: ActivityManualAction = 'none';
  if (localReadiness === 'ready') {
    if (trace.gaps.length > 0 || realSegments.length > 1) {
      routeReadiness = 'missing_section';
      manualAction = 'choose_or_reconnect';
    } else if (finalEnhancement === 'limited') {
      routeReadiness = 'needs_review';
      manualAction = 'keep_or_snap';
    } else {
      // Base Final is route-usable. Network availability is never the gate.
      routeReadiness = 'ready';
    }
  }
  return {
    localReadiness,
    serverSync,
    finalEnhancement,
    routeReadiness,
    manualAction,
    realSegmentCount: realSegments.length,
    gapCount: trace.gaps.length,
  };
}

export function activityRouteStateCopy(state: ActivityRouteState): {
  savedLabel: string;
  syncLabel: string | null;
  routeLabel: string;
  routeDetail: string;
} {
  const savedLabel = state.localReadiness === 'ready'
    ? 'Activity saved'
    : state.localReadiness === 'loading' ? 'Loading saved activity…' : 'Activity route unavailable';
  const syncLabel = state.serverSync === 'pending'
    ? 'Waiting to sync'
    : state.serverSync === 'syncing'
      ? 'Syncing activity…'
      : state.serverSync === 'retryable_error' ? 'Sync interrupted · tap to retry'
        : state.serverSync === 'auth_required' ? 'Sign in to sync this saved Activity'
          : state.serverSync === 'action_required' ? 'Saved on this device · sync needs review'
            : state.serverSync === 'dependency' ? 'Saved on this device · another Activity needs resolution'
              : null;
  if (state.routeReadiness === 'missing_section') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: 'Missing section',
      routeDetail: 'Your Activity keeps the GPS gap. You can choose a recorded section or explicitly reconnect a new Route.',
    };
  }
  if (state.routeReadiness === 'needs_review') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: 'Route needs review',
      routeDetail: 'The recorded path is usable, but some sections have limited map or trail evidence.',
    };
  }
  if (state.routeReadiness === 'ready') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: 'Route ready',
      routeDetail: 'Ready to save and edit as an independent Route.',
    };
  }
  return {
    savedLabel,
    syncLabel,
    routeLabel: 'Route unavailable',
    routeDetail: 'There is not enough recorded geometry to create a Route.',
  };
}
