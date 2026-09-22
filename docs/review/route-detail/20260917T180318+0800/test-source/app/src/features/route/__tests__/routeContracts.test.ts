import fs from 'fs';
import path from 'path';
import {
  cloneActivityRouteReference,
  routeCanBeUsed,
  routeMatchesIdentity,
  routeOriginLines,
} from '../routeContracts';
import type { Route } from '../../../store/useRouteStore';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

function route(overrides: Partial<Route> = {}): Route {
  return {
    id: 'local-route',
    clientRouteId: 'local-route',
    remoteId: '42',
    name: 'Ridge Route',
    createdAt: 1,
    updatedAt: 2,
    points: [{ lat: -45, lng: 168 }, { lat: -45.001, lng: 168.001 }],
    waypoints: [],
    distanceM: 140,
    elevationGainM: 10,
    runCount: 0,
    isActive: false,
    ...overrides,
  };
}

describe('Route product contracts', () => {
  test('local, server, and client identities resolve one owned Route', () => {
    const value = route();
    expect(routeMatchesIdentity(value, 'local-route')).toBe(true);
    expect(routeMatchesIdentity(value, '42')).toBe(true);
    expect(routeMatchesIdentity(value, 'someone-else')).toBe(false);
  });

  test('Activity origin, creation adjustment, later edit, and Gap remain distinct', () => {
    const lines = routeOriginLines(route({
      creationOrigin: 'activity',
      originGeometryHash: 'activity-hash',
      createdGeometryHash: 'created-hash',
      geometryEditedSinceCreation: true,
      originActivityGapReconnected: true,
    }));
    expect(lines).toEqual([
      'Created from an Activity',
      'Adjusted when this Route was created',
      'Edited since creation',
      'Includes a planned connection across a missing Activity section',
    ]);
    expect(routeOriginLines(route({ creationOrigin: 'legacy_unknown' }))).toEqual(['Origin not recorded']);
  });

  test('the Activity reference is a deep geometry snapshot and never starts recording', () => {
    const source = route();
    const snapshot = cloneActivityRouteReference(source, 123);
    source.points[0].lat = 0;
    expect(snapshot.points[0].lat).toBe(-45);
    expect(snapshot.capturedAt).toBe(123);
    expect(routeCanBeUsed(source)).toBe(true);
    expect(routeCanBeUsed(route({ points: [] }))).toBe(false);
  });
});

describe('Route Detail / editor / use source contracts', () => {
  const detail = read('src/screens/MapHistoryScreen.tsx');
  const editor = read('src/screens/RouteEditorScreen.tsx');
  const overlay = read('src/components/map/EditOverlayV274.tsx');
  const hike = read('src/screens/HikingScreen.tsx');
  const run = read('src/screens/RunningScreen.tsx');

  test('Detail owns Use, Edit, acknowledged rename/delete, origin, and explicit unavailable states', () => {
    expect(detail).toContain('routeMatchesIdentity(item, targetRouteId)');
    expect(detail).toContain("'Route unavailable'");
    expect(detail).toContain('await useRouteStore.getState().updateRoute');
    expect(detail).toContain('await useRouteStore.getState().deleteRoute');
    expect(detail).toContain('routeOriginLines(selectedRoute)');
    expect(detail).toContain('title="Use this Route"');
    expect(detail).toContain('testID="route-use-hike"');
    expect(detail).toContain('testID="route-use-run"');
    expect(detail).toContain("tracking.status !== 'idle'");
    expect(detail).not.toContain('shown on the map for guidance');
  });

  test('editor separates Apply from durable Save and guards unsaved exit', () => {
    expect(overlay).toContain("saveLabel = 'Apply to draft'");
    expect(editor).toContain('saveLabel="Apply to draft"');
    expect(editor).toContain('>Save Route</Text>');
    expect(editor).toContain("addListener('beforeRemove'");
    expect(editor).toContain("'Discard Route changes?'");
    expect(editor).not.toContain('TODO route settings');
  });

  test('Hike and Run receive a selected Route reference without auto-start or follower activation', () => {
    for (const source of [hike, run]) {
      expect(source).toContain('captureActivityRouteReference(selectedRoute)');
      expect(source).toContain('This Route is shown on the map for reference.');
      expect(source).not.toContain('setFollowingRoute(');
    }
    expect(detail).toContain("nav.navigate('Running', { routeId: ready.id })");
    expect(detail).toContain("nav.navigate('Hiking', { routeId: ready.id })");
  });

  test('all three surfaces use shared semantic theme roles', () => {
    expect(detail).toContain('useVisualTheme()');
    expect(editor).toContain('useVisualTheme()');
    expect(hike).toContain('useVisualTheme()');
    expect(run).toContain('useVisualTheme()');
    expect(detail).toContain('visualTheme.surfaceElevated');
    expect(editor).toContain('visualTheme.surfaceElevated');
  });
});
