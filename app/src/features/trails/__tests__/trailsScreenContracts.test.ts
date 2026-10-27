import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Trails personal journey library screen contracts', () => {
  const trails = read('src/screens/RoutesScreen.tsx');
  const detail = read('src/screens/MapHistoryScreen.tsx');
  const navigation = read('src/navigation/RootNavigator.tsx');
  const routeStore = read('src/store/useRouteStore.ts');
  const libraryControls = read('src/components/LibraryControls.tsx');

  test('normal Trails has exactly Activities and Routes as first-class families', () => {
    const tabs = trails.slice(trails.indexOf('const TABS'), trails.indexOf('function LibraryIntro'));
    // REVISE_WITH_REASON: UI copy now belongs to the catalog; retain the product-structure assertion.
    expect(tabs).toContain("{ key: 'activities', get label() { return cairnText('routes-screen.activities'); } }");
    expect(tabs).toContain("{ key: 'routes', get label() { return cairnText('routes-screen.routes'); } }");
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
    expect(trails).toContain("sessionId: item.id");
    expect(trails).toContain("activityBackContext: 'activities'");
    expect(trails).toContain("nav.navigate('MapHistory', { routeId: item.id })");
    expect(trails).not.toContain('onLongPress');
    expect(trails).not.toContain('ActivitySheet');
    expect(trails).not.toContain('RouteSheet');
  });

  test('Activities use grouped virtualized history and visible discovery controls', () => {
    expect(trails).toContain('<SectionList');
    expect(trails).toContain('groupActivitiesByMonth(filtered)');
    expect(trails).toContain('testID="activity-discovery-tools"');
    expect(trails).toContain('testID="activity-search"');
    expect(trails).toContain('testID="activity-mode-filter"');
    expect(trails).toContain('initialNumToRender={16}');
    expect(trails).toContain('windowSize={9}');
    expect(trails).toContain('groupRoutesByMonth(visible)');
  });

  test('only failed object sync becomes visible library chrome', () => {
    expect(trails).toContain('hasActivitySyncIssue(session)');
    expect(trails).toContain('hasRouteSyncIssue(route)');
    expect(trails).toContain('<SyncBadge state="failed"');
    expect(trails).not.toContain("state={route.syncState}");
    expect(trails).not.toContain('Saved locally');
  });

  test('Route loading failure keeps local Routes meaningful instead of claiming true empty', () => {
    // REVISE_WITH_REASON: assert the stable message identity, not mutable en-NZ wording.
    expect(trails).toContain("cairnText('routes-screen.couldn-t-check-the-server-routes-on')");
    expect(trails).toContain('routesLoadError');
    expect(trails).toContain('trails-routes-unavailable');
    expect(routeStore).toContain('routesLoading: true');
  });

  test('Route Detail keeps direct Hike/Run/Edit actions and enters a truthful preselected map flow', () => {
    expect(detail).toContain('route-use-action');
    expect(detail).toContain('route-use-run-action');
    expect(detail).toContain('route-share-action');
    expect(detail).toContain('route-delete-action');
    expect(detail).toContain("nav.navigate(mode === 'running' ? 'Running' : 'Hiking', { routeId: ready.id })");
    expect(detail).not.toContain('title="Use this Route"');
    expect(detail.indexOf('route-use-action')).toBeLessThan(detail.indexOf("accessibilityLabel={cairnText('map-history-screen.edit-route')}") );
    expect(detail).not.toContain('route-detail-header-more');
    expect(detail).not.toContain('route-detail-more-menu');
    expect(read('src/screens/HikingScreen.tsx')).toContain("cairnText('hiking-screen.this-route-is-shown-on-the-map')");
    expect(read('src/screens/RunningScreen.tsx')).toContain("cairnText('running-screen.this-route-is-shown-on-the-map')");
    expect(read('src/screens/HikingMap.tsx')).toContain('id="planned-route-line"');
  });

  test('Activity conversion is reachable from Detail and Routes and saves an independent Route', () => {
    const editor = read('src/screens/OrderedRouteEditorScreen.tsx');
    expect(trails).toContain("createStep === 'source' ? 'route-create-source' : 'route-activity-picker'");
    expect(trails).toContain('testID="route-create-activity"');
    expect(trails).toContain("leaveCreateFlow({\n                    creationSource: 'activity',\n                    fromSessionId: session.id,\n                    creationSessionId: createRouteCreationSessionId(),");
    expect(trails).toContain('onClosed={finishCreateTransition}');
    expect(detail).toContain('testID="activity-create-route"');
    expect(detail).toContain("creationSource: 'activity'");
    expect(detail).toContain('fromSessionId: selectedSession.id');
    expect(detail).toContain('creationSessionId: createRouteCreationSessionId()');
    expect(detail).toContain("cairnText('map-history-screen.creates-a-separate-editable-copy-this-activity')");
    expect(detail).not.toContain('Save as Route');
    expect(editor).toContain('createImportedOrderedDraft');
    expect(editor).toContain("nav.replace('MapHistory', { routeId: savedId })");
  });

  test('Routes use one All/Mine/Received collection and a distinct inline Create action', () => {
    expect(trails).toContain("useState<'all' | 'mine' | 'received'>('all')");
    expect(trails).toContain("{ key: 'received', label: cairnText('routes-screen.received') }");
    expect(trails).toContain('testID="route-ownership-filter"');
    expect(trails).toContain('style={[styles.inlineCreateButton');
    expect(trails).not.toContain('My Routes');
    expect(trails).not.toContain('Shared Routes');
  });

  test('Activity deletion does not cascade into Memory, Cairns, or independent Routes', () => {
    const sessionStore = read('src/store/useSessionStore.ts');
    const deletion = sessionStore.slice(
      sessionStore.indexOf('deleteSession: async (id)'),
      sessionStore.indexOf('getSessions: () =>', sessionStore.indexOf('deleteSession: async (id)')),
    );
    expect(deletion).toContain('tombstoneActivity');
    expect(deletion).not.toMatch(/useMarkerStore|deleteMarker|useRouteStore|deleteRoute|useMemoryStore|resetMemory/);
    expect(detail).toContain("cairnText('map-history-screen.this-removes-the-activity-record-cairns-independent')");
  });

  test('parameterless legacy MapHistory redirects to the one Trails library', () => {
    expect(detail).toContain('function TrailsIndexRedirect()');
    expect(detail).toContain("nav.replace('Routes', { initialTab: 'activities' })");
    expect(detail).toContain('return hasObjectTarget ? <MapHistoryObjectScreen /> : <TrailsIndexRedirect />');
  });

  test('record/page/control colors come from the shared Day/Sunset/Night theme roles', () => {
    expect(trails).toContain('useVisualTheme()');
    expect(trails).toContain('theme.recordSurface');
    expect(libraryControls).toContain('theme.inputSurface');
    expect(libraryControls).toContain('theme.recordSurface');
    expect(trails).toContain('<SegmentedControl');
    expect(trails).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
    expect(libraryControls).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
