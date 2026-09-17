import type { Marker } from '../../store/useMarkerStore';
import type { TrackingSession } from '../../store/useSessionStore';
import type { ActivityRouteState } from './activityRouteState';

export type ActivityDetailNoticeKind = 'local' | 'sync' | 'gap' | 'route-review';

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
      title: 'Loading saved route',
      detail: 'Your Activity summary is available while its route opens.',
    });
  } else if (state.localReadiness === 'unavailable') {
    notices.push({
      kind: 'local',
      title: 'Route unavailable',
      detail: 'The Activity is saved, but this device does not have enough route geometry to display it.',
    });
  }

  if (state.serverSync === 'pending') {
    notices.push({
      kind: 'sync',
      title: 'Waiting to sync',
      detail: 'Saved on this iPhone. You can keep using this Activity offline.',
    });
  } else if (state.serverSync === 'syncing') {
    notices.push({
      kind: 'sync',
      title: 'Syncing Activity',
      detail: 'The local Activity remains available while Cairn sends it.',
    });
  } else if (state.serverSync === 'error') {
    notices.push({
      kind: 'sync',
      title: 'Retry sync',
      detail: 'The Activity is safe on this iPhone, but server sync needs another try.',
      action: 'retry-sync',
    });
  }

  if (state.localReadiness === 'ready' && state.routeReadiness === 'missing_section') {
    notices.push({
      kind: 'gap',
      title: 'Missing section',
      detail: 'The Activity keeps this gap disconnected. A new Route can use one recorded section or an explicit reconnect.',
    });
  } else if (state.localReadiness === 'ready' && state.routeReadiness === 'needs_review') {
    notices.push({
      kind: 'route-review',
      title: 'Route needs review',
      detail: 'The recorded path is usable, but some sections have limited map or trail evidence.',
    });
  }

  return notices;
}
