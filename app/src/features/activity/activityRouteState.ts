import type { TrackPoint, TrackingSession } from '../../store/useSessionStore';
import { segmentTrace } from './activityContracts';
import { cairnText } from '../../i18n/runtime';

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
  roadRefinementPending: boolean;
}

export function deriveActivityRouteState(args: {
  session: Pick<TrackingSession, 'syncState' | 'syncFailureKind' | 'finalGeometryState' | 'roadRefinementPending'>;
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
    roadRefinementPending: session.roadRefinementPending === true,
  };
}

export function activityRouteStateCopy(state: ActivityRouteState): {
  savedLabel: string;
  syncLabel: string | null;
  routeLabel: string;
  routeDetail: string;
} {
  const savedLabel = state.localReadiness === 'ready'
    ? cairnText('activity.activity-route-state.activity-saved')
    : state.localReadiness === 'loading' ? cairnText('activity.activity-route-state.loading-saved-activity') : cairnText('activity.activity-route-state.activity-route-unavailable');
  const syncLabel = state.serverSync === 'pending'
    ? cairnText('activity.activity-route-state.waiting-to-sync')
    : state.serverSync === 'syncing'
      ? cairnText('activity.activity-route-state.syncing-activity')
      : state.serverSync === 'retryable_error' ? cairnText('activity.activity-route-state.sync-interrupted-tap-to-retry')
        : state.serverSync === 'auth_required' ? cairnText('activity.activity-route-state.sign-in-to-sync-this-saved-activity')
          : state.serverSync === 'action_required' ? cairnText('activity.activity-route-state.saved-on-this-device-sync-needs-review')
            : state.serverSync === 'dependency' ? cairnText('activity.activity-route-state.saved-on-this-device-another-activity-needs')
              : null;
  if (state.routeReadiness === 'missing_section') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: cairnText('activity.activity-route-state.missing-section'),
      routeDetail: cairnText('activity.activity-route-state.your-activity-keeps-the-gps-gap-you'),
    };
  }
  if (state.routeReadiness === 'needs_review') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: cairnText('activity.activity-route-state.route-needs-review'),
      routeDetail: cairnText('activity.activity-route-state.the-recorded-path-is-usable-but-some'),
    };
  }
  if (state.routeReadiness === 'ready') {
    return {
      savedLabel,
      syncLabel,
      routeLabel: cairnText('activity.activity-route-state.route-ready'),
      routeDetail: cairnText('activity.activity-route-state.ready-to-save-and-edit-as-an'),
    };
  }
  return {
    savedLabel,
    syncLabel,
    routeLabel: cairnText('activity.activity-route-state.route-unavailable'),
    routeDetail: cairnText('activity.activity-route-state.there-is-not-enough-recorded-geometry-to'),
  };
}
