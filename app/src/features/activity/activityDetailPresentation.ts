import type { Marker } from '../../store/useMarkerStore';
import type { TrackingSession } from '../../store/useSessionStore';
import type { ActivityRouteState } from './activityRouteState';
import { cairnText } from '../../i18n/runtime';

export type ActivityDetailNoticeKind = 'local' | 'sync' | 'gap' | 'route-review' | 'route-refinement';

export interface ActivityDetailNotice {
  kind: ActivityDetailNoticeKind;
  title: string;
  detail: string;
  action?: 'retry-sync';
}

/** Resolve every supported Activity identity without changing its stable local ID. */
export function activityMatchesTarget(
  session: Pick<TrackingSession, 'id' | 'clientActivityId' | 'remoteId' | 'serverActivityId'>,
  targetId: string,
): boolean {
  return session.id === targetId
    || session.clientActivityId === targetId
    || String(session.remoteId ?? '') === targetId
    || String(session.serverActivityId ?? '') === targetId;
}

/** Historical Run pace derived only from persisted Activity metrics. */
export function formatAverageActivityPace(
  durationS: number,
  distanceM: number,
  imperial: boolean,
): string {
  const unitM = imperial ? 1609.344 : 1000;
  if (!(durationS > 0) || distanceM < 20) return '--';
  const secondsPerUnit = durationS / (distanceM / unitM);
  if (!Number.isFinite(secondsPerUnit) || secondsPerUnit <= 0) return '--';
  const roundedSeconds = Math.round(secondsPerUnit);
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function activityMetricLabels(mode: TrackingSession['activityMode']): [string, string, string] {
  return mode === 'running'
    ? ['Distance', 'Active Time', 'Average Pace']
    : ['Distance', 'Active Time', 'Elevation'];
}

function markerStableIds(marker: Marker): string[] {
  return [marker.id, marker.clientCairnId, marker.serverCairnId, marker.localId]
    .filter((value): value is string => Boolean(value));
}

/**
 * Activity-linked Cairns require explicit provenance. Geographic proximity is
 * deliberately absent: a nearby Cairn is not evidence that it came from this
 * Activity.
 */
export function linkedCairnsForActivity(
  markers: ReadonlyArray<Marker>,
  session: Pick<TrackingSession, 'id' | 'clientActivityId' | 'markerIds'>,
): Marker[] {
  const activityIds = new Set([session.id, session.clientActivityId].filter(Boolean));
  const recordedMarkerIds = new Set(session.markerIds ?? []);
  return markers.filter(marker => {
    const explicitOrigin = marker.originActivityClientId ?? marker.sessionId;
    if (explicitOrigin && activityIds.has(explicitOrigin)) return true;
    return markerStableIds(marker).some(id => recordedMarkerIds.has(id));
  });
}

/** Normal success is silent; only user-relevant exceptions become chrome. */
export function activityDetailNotices(state: ActivityRouteState): ActivityDetailNotice[] {
  const notices: ActivityDetailNotice[] = [];
  if (state.localReadiness === 'loading') {
    notices.push({
      kind: 'local',
      title: cairnText('activity.activity-detail-presentation.loading-saved-route'),
      detail: cairnText('activity.activity-detail-presentation.your-activity-summary-is-available-while-its'),
    });
  } else if (state.localReadiness === 'unavailable') {
    notices.push({
      kind: 'local',
      title: cairnText('activity.activity-detail-presentation.route-unavailable'),
      detail: cairnText('activity.activity-detail-presentation.the-activity-is-saved-but-this-device'),
    });
  }

  if (state.serverSync === 'pending') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.waiting-to-sync'),
      detail: cairnText('activity.activity-detail-presentation.saved-on-this-iphone-you-can-keep'),
    });
  } else if (state.serverSync === 'syncing') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.syncing-activity'),
      detail: cairnText('activity.activity-detail-presentation.the-local-activity-remains-available-while-cairn'),
    });
  } else if (state.serverSync === 'retryable_error') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.retry-sync'),
      detail: cairnText('activity.activity-detail-presentation.the-activity-is-safe-on-this-iphone'),
      action: 'retry-sync',
    });
  } else if (state.serverSync === 'auth_required') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.sign-in-to-sync'),
      detail: cairnText('activity.activity-detail-presentation.the-activity-is-safe-on-this-device'),
      action: 'retry-sync',
    });
  } else if (state.serverSync === 'action_required') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.activity-saved-sync-needs-review'),
      detail: cairnText('activity.activity-detail-presentation.cairn-kept-the-complete-local-activity-and'),
    });
  } else if (state.serverSync === 'dependency') {
    notices.push({
      kind: 'sync',
      title: cairnText('activity.activity-detail-presentation.activity-saved-another-activity-is-unresolved'),
      detail: cairnText('activity.activity-detail-presentation.resolve-the-other-unfinished-activity-before-retrying'),
    });
  }

  if (state.localReadiness === 'ready' && state.roadRefinementPending) {
    notices.push({
      kind: 'route-refinement',
      title: cairnText('activity.activity-detail-presentation.route-ready'),
      detail: cairnText('activity.activity-detail-presentation.road-refinement-will-continue-when-online'),
    });
  } else if (state.localReadiness === 'ready' && state.finalEnhancement === 'enhanced') {
    notices.push({
      kind: 'route-refinement',
      title: cairnText('activity.activity-detail-presentation.route-refined'),
      detail: cairnText('activity.activity-detail-presentation.cairn-selected-the-improved-route-for-this'),
    });
  }

  if (state.localReadiness === 'ready' && state.routeReadiness === 'missing_section') {
    notices.push({
      kind: 'gap',
      title: cairnText('activity.activity-detail-presentation.missing-section'),
      detail: cairnText('activity.activity-detail-presentation.the-activity-keeps-this-gap-disconnected-a'),
    });
  } else if (state.localReadiness === 'ready' && state.routeReadiness === 'needs_review') {
    notices.push({
      kind: 'route-review',
      title: cairnText('activity.activity-detail-presentation.route-needs-review'),
      detail: cairnText('activity.activity-detail-presentation.the-recorded-path-is-usable-but-some'),
    });
  }

  return notices;
}
