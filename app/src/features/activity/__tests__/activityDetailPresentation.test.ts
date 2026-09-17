import type { Marker } from '../../../store/useMarkerStore';
import type { TrackingSession } from '../../../store/useSessionStore';
import {
  activityDetailNotices,
  activityMatchesTarget,
  activityMetricLabels,
  formatAverageActivityPace,
  linkedCairnsForActivity,
} from '../activityDetailPresentation';
import { deriveActivityRouteState } from '../activityRouteState';

const session: TrackingSession = {
  id: 'local-activity',
  clientActivityId: 'activity-client-id',
  remoteId: 42,
  activityMode: 'hiking',
  regionCode: 'nz',
  startedAt: 1,
  endedAt: 2,
  durationS: 3600,
  distanceM: 6000,
  elevationGainM: 300,
  trackPoints: [],
  markerIds: ['legacy-explicit-cairn'],
};

const marker = (overrides: Partial<Marker>): Marker => ({
  id: 'cairn',
  type: 'cairn',
  regionCode: 'nz',
  lat: -44.67,
  lng: 167.92,
  note: '',
  authorId: 'owner',
  createdAt: 1,
  permission: 'personal',
  ...overrides,
});

describe('Activity Detail presentation contract', () => {
  test('Finish/local and Trails/server identities resolve to the same Activity', () => {
    expect(activityMatchesTarget(session, 'local-activity')).toBe(true);
    expect(activityMatchesTarget(session, 'activity-client-id')).toBe(true);
    expect(activityMatchesTarget(session, '42')).toBe(true);
    expect(activityMatchesTarget(session, 'unrelated')).toBe(false);
  });

  test('Hike and Run use historical-summary labels and Average Pace', () => {
    expect(activityMetricLabels('hiking')).toEqual(['Distance', 'Active Time', 'Elevation']);
    expect(activityMetricLabels('running')).toEqual(['Distance', 'Active Time', 'Average Pace']);
    expect(formatAverageActivityPace(1800, 5000, false)).toBe('6:00');
    expect(formatAverageActivityPace(1800, 0, false)).toBe('--');
  });

  test('links Cairns only through explicit provenance or recorded membership', () => {
    const exactOrigin = marker({ id: 'origin', originActivityClientId: 'activity-client-id' });
    const recordedMembership = marker({ id: 'legacy-explicit-cairn' });
    const nearbyOnly = marker({ id: 'nearby-only', lat: -44.67001, lng: 167.92001 });
    const differentOrigin = marker({ id: 'different', originActivityClientId: 'another-activity' });

    expect(linkedCairnsForActivity(
      [exactOrigin, recordedMembership, nearbyOnly, differentOrigin],
      session,
    ).map(item => item.id)).toEqual(['origin', 'legacy-explicit-cairn']);
  });

  test('normal success is quiet while offline, failure and Gap remain explicit', () => {
    const points = [
      { lat: -44, lng: 168, t: 1, segmentId: 'a' },
      { lat: -44.001, lng: 168, t: 2, segmentId: 'a' },
    ];
    const success = deriveActivityRouteState({
      session: { syncState: 'synced', finalGeometryState: 'base_ready' },
      trackPoints: points,
    });
    expect(activityDetailNotices(success)).toEqual([]);

    const exception = deriveActivityRouteState({
      session: { syncState: 'sync_error', finalGeometryState: 'enhanced' },
      trackPoints: [...points, { lat: -44.002, lng: 168, t: 3, segmentId: 'b' }],
    });
    expect(activityDetailNotices(exception)).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Retry sync', action: 'retry-sync' }),
      expect.objectContaining({ title: 'Missing section' }),
    ]));
    expect(activityDetailNotices(exception).map(item => item.detail).join(' '))
      .not.toMatch(/more map detail|refining.*background/i);
  });
});
