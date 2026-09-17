import type { Route } from '../../../store/useRouteStore';
import type { TrackingSession } from '../../../store/useSessionStore';
import {
  ACTIVITY_DISCOVERY_THRESHOLD,
  activityDateLabel,
  activityDisplayName,
  filterActivities,
  filterRoutes,
  groupActivitiesByMonth,
  hasActivitySyncIssue,
  hasRouteSyncIssue,
  routeModeLabel,
} from '../trailsLibrary';

const activity = (id: string, startedAt: number, mode: 'hiking' | 'running' = 'hiking', name?: string): TrackingSession => ({
  id,
  activityMode: mode,
  regionCode: 'nz',
  startedAt,
  endedAt: startedAt + 3_600_000,
  durationS: 3_600,
  distanceM: 5_000,
  elevationGainM: 200,
  trackPoints: [],
  markerIds: [],
  name,
  syncState: 'synced',
});

const route = (id: string, updatedAt: number, name: string): Route => ({
  id,
  name,
  createdAt: updatedAt,
  updatedAt,
  points: [],
  waypoints: [],
  distanceM: 5_000,
  elevationGainM: 200,
  runCount: 0,
  isActive: false,
  syncState: 'synced',
});

describe('Trails personal journey library projection', () => {
  it('keeps only Activities and Routes as first-class tab identifiers', () => {
    expect(['activities', 'routes']).toHaveLength(2);
    expect(['activities', 'routes']).not.toContain('friends');
    expect(['activities', 'routes']).not.toContain('flags');
    expect(ACTIVITY_DISCOVERY_THRESHOLD).toBe(8);
  });

  it('filters Activities by user-facing name or movement mode and keeps recent first', () => {
    const sessions = [
      activity('old-hike', 1, 'hiking', 'Ridge after rain'),
      activity('new-run', 3, 'running', 'Harbour morning'),
      activity('new-hike', 2, 'hiking', 'Forest return'),
    ];
    expect(filterActivities(sessions, '', 'hiking').map(item => item.id)).toEqual(['new-hike', 'old-hike']);
    expect(filterActivities(sessions, 'run', 'all').map(item => item.id)).toEqual(['new-run']);
    expect(filterActivities(sessions, 'ridge', 'all').map(item => item.id)).toEqual(['old-hike']);
  });

  it('groups a 300-Activity history into stable recent-first month sections', () => {
    const sessions = Array.from({ length: 300 }, (_, index) => (
      activity(`activity-${index}`, Date.UTC(2026, 8 - (index % 9), 20 - (index % 15)))
    )).sort((a, b) => b.startedAt - a.startedAt);
    const sections = groupActivitiesByMonth(sessions, 'en-NZ');
    expect(sections.reduce((count, section) => count + section.data.length, 0)).toBe(300);
    expect(sections[0].key > sections[sections.length - 1].key).toBe(true);
    expect(sections.every(section => section.data.every((item, index, data) => index === 0 || data[index - 1].startedAt >= item.startedAt))).toBe(true);
  });

  it('uses calm recognition labels and locale-aware relative dates', () => {
    const now = new Date(2026, 8, 13, 12).getTime();
    expect(activityDisplayName(activity('a', now, 'running'))).toBe('Run');
    expect(activityDateLabel(now, now, 'en-NZ')).toBe('Today');
    expect(activityDateLabel(now - 86_400_000, now, 'en-NZ')).toBe('Yesterday');
  });

  it('searches owned Routes by name and communicates future-intent mode', () => {
    const routes = [route('older', 1, 'Milford Foreshore'), route('newer', 2, 'Kepler return')];
    routes[0].activityMode = 'hiking';
    routes[1].activityMode = 'running';
    expect(filterRoutes(routes, '').map(item => item.id)).toEqual(['newer', 'older']);
    expect(filterRoutes(routes, 'milford').map(item => item.id)).toEqual(['older']);
    expect(routeModeLabel(routes[0])).toBe('Hike route');
    expect(routeModeLabel(routes[1])).toBe('Run route');
  });

  it('surfaces only failed sync as a library exception', () => {
    const pendingActivity = activity('pending', 1);
    pendingActivity.syncState = 'pending';
    const failedActivity = activity('failed', 2);
    failedActivity.syncState = 'sync_error';
    const pendingRoute = route('pending-route', 1, 'Pending');
    pendingRoute.syncState = 'pending';
    const failedRoute = route('failed-route', 2, 'Failed');
    failedRoute.syncState = 'failed';
    expect(hasActivitySyncIssue(pendingActivity)).toBe(false);
    expect(hasActivitySyncIssue(failedActivity)).toBe(true);
    expect(hasRouteSyncIssue(pendingRoute)).toBe(false);
    expect(hasRouteSyncIssue(failedRoute)).toBe(true);
  });
});
