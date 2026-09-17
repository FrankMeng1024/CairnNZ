import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Trails personal journey library screen contracts', () => {
  const trails = read('src/screens/RoutesScreen.tsx');
  const detail = read('src/screens/MapHistoryScreen.tsx');
  const navigation = read('src/navigation/RootNavigator.tsx');
  const routeStore = read('src/store/useRouteStore.ts');

  test('normal Trails has exactly Activities and Routes as first-class families', () => {
    const tabs = trails.slice(trails.indexOf('const TABS'), trails.indexOf('function SearchField'));
    expect(tabs).toContain("{ key: 'activities', label: 'Activities' }");
    expect(tabs).toContain("{ key: 'routes', label: 'Routes' }");
    expect(tabs).not.toMatch(/Friends|Cairns|Flags|Mine/);
    expect(navigation).toContain("Routes: { initialTab?: 'routes' | 'activities' }");
  });

  test('friend and Cairn discovery are not mounted in personal Trails', () => {
    expect(trails).not.toContain('circleRoutes');
    expect(trails).not.toContain('circleMarkers');
    expect(trails).not.toContain('ScopeTabBar');
    expect(trails).not.toContain('FlagsTab');
    expect(trails).not.toContain('MarkCard');
  });

  test('rows open real Detail directly with no redundant long-press View sheet', () => {
    expect(trails).toContain("nav.navigate('MapHistory', { sessionId: item.id })");
    expect(trails).toContain("nav.navigate('MapHistory', { routeId: item.id })");
    expect(trails).not.toContain('onLongPress');
    expect(trails).not.toContain('ActivitySheet');
    expect(trails).not.toContain('RouteSheet');
  });

  test('Activities use grouped virtualized history and progressive discovery controls', () => {
    expect(trails).toContain('<SectionList');
    expect(trails).toContain('groupActivitiesByMonth(filtered)');
    expect(trails).toContain('ACTIVITY_DISCOVERY_THRESHOLD');
    expect(trails).toContain('initialNumToRender={16}');
    expect(trails).toContain('windowSize={9}');
  });

  test('only failed object sync becomes visible library chrome', () => {
    expect(trails).toContain('hasActivitySyncIssue(session)');
    expect(trails).toContain('hasRouteSyncIssue(route)');
    expect(trails).toContain('<SyncBadge state="failed"');
    expect(trails).not.toContain("state={route.syncState}");
    expect(trails).not.toContain('Saved locally');
  });

  test('Route loading failure keeps local Routes meaningful instead of claiming true empty', () => {
    expect(trails).toContain('Routes on this device are still available.');
    expect(trails).toContain('routesLoadError');
    expect(trails).toContain('trails-routes-unavailable');
    expect(routeStore).toContain('routesLoading: true');
  });

  test('Route Detail is use-first and enters a truthful preselected Hike/Run map flow', () => {
    expect(detail).toContain('route-use-action');
    expect(detail).toContain("nav.navigate('Hiking', { routeId: ready.id })");
    expect(detail).toContain("nav.navigate('Running', { routeId: ready.id })");
    expect(detail.indexOf('route-use-action')).toBeLessThan(detail.indexOf('accessibilityLabel="Edit route"'));
    expect(read('src/screens/HikingScreen.tsx')).toContain('This Route is shown on the map for reference.');
    expect(read('src/screens/RunningScreen.tsx')).toContain('This Route is shown on the map for reference.');
    expect(read('src/screens/HikingMap.tsx')).toContain('id="planned-route-line"');
  });

  test('Activity Save as Route lands on canonical Route Detail after local creation', () => {
    const editor = read('src/screens/RouteEditorScreen.tsx');
    const success = editor.slice(
      editor.indexOf('if (!targetId && savedRouteId)'),
      editor.indexOf('// Editing an existing route'),
    );
    expect(success).toContain("{ name: 'MapHistory', params: { routeId: savedRouteId } }");
    expect(success).not.toContain("{ name: 'RouteEditor', params: { routeId: savedRouteId } }");
    expect(detail).toContain('activity-save-as-route');
    expect(detail).toContain('routeDraftOpening');
    expect(editor).toContain('if (saving) return;');
    expect(editor).toContain('disabled={!canSaveView}');
  });

  test('Activity deletion does not cascade into Memory, Cairns, or independent Routes', () => {
    const sessionStore = read('src/store/useSessionStore.ts');
    const deletion = sessionStore.slice(
      sessionStore.indexOf('deleteSession: async (id)'),
      sessionStore.indexOf('getSessions: () =>', sessionStore.indexOf('deleteSession: async (id)')),
    );
    expect(deletion).toContain('tombstoneActivity');
    expect(deletion).not.toMatch(/useMarkerStore|deleteMarker|useRouteStore|deleteRoute|useMemoryStore|resetMemory/);
    expect(detail).toContain('Cairns, independent Routes, and Memory already earned stay in place.');
  });

  test('parameterless legacy MapHistory redirects to the one Trails library', () => {
    expect(detail).toContain('function TrailsIndexRedirect()');
    expect(detail).toContain("nav.replace('Routes', { initialTab: 'activities' })");
    expect(detail).toContain('return hasObjectTarget ? <MapHistoryObjectScreen /> : <TrailsIndexRedirect />');
  });

  test('record/page/control colors come from the shared Day/Sunset/Night theme roles', () => {
    expect(trails).toContain('useVisualTheme()');
    expect(trails).toContain('theme.recordSurface');
    expect(trails).toContain('theme.inputSurface');
    expect(trails).toContain('<SegmentedControl');
    expect(trails).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
