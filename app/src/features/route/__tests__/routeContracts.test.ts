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
    expect(routeCanBeUsed(route({
      resolutionState: 'continuous',
      orderedDraft: {
        schemaVersion: 1,
        draftId: 'repair',
        ownerId: '1',
        revision: 0,
        origin: 'activity',
        parts: [],
        gaps: [{ id: 'gap', afterPartId: 'a', reason: 'activity-gap' }],
      },
    }))).toBe(false);
  });
});

describe('Route Detail / editor / use source contracts', () => {
  const detail = read('src/screens/MapHistoryScreen.tsx');
  const editor = read('src/screens/OrderedRouteEditorScreen.tsx');
  const overlay = read('src/components/map/RouteDrawOverlay.tsx');
  const hike = read('src/screens/HikingScreen.tsx');
  const run = read('src/screens/RunningScreen.tsx');

  test('Detail owns direct Use, Edit, acknowledged rename/delete, source, and explicit unavailable states', () => {
    expect(detail).toContain('routeMatchesIdentity(item, targetRouteId)');
    // REVISE_WITH_REASON: UI copy is keyed at source and English remains in
    // the single catalog rather than Route component literals.
    expect(detail).toContain("cairnText('map-history-screen.route-unavailable')");
    expect(detail).toContain('await useRouteStore.getState().updateRoute');
    expect(detail).toContain('await useRouteStore.getState().deleteRoute');
    expect(detail).toContain('routeSourceLabel(selectedRoute)');
    expect(detail).toContain('testID="route-use-action"');
    expect(detail).toContain("void useSelectedRoute('hiking')");
    expect(detail).toContain("void useSelectedRoute('running')");
    expect(detail).toContain("tracking.status !== 'idle'");
    expect(detail).not.toContain('shown on the map for guidance');
  });

  test('Route sharing is friend-directed snapshot delivery and unresolved gaps stay blocked', () => {
    expect(detail).toContain("title={cairnText('map-history-screen.send-an-independent-route')}");
    expect(detail).toContain('shareRouteSnapshot(serverRouteId, recipients, attempt.key)');
    expect(detail).toContain("cairnText('map-history-screen.delivery-was-not-confirmed-retry-uses-the')");
    expect(detail).toContain('key: attempt.key');
    expect(detail).toContain("signature: `${serverRouteId}|${failedRecipients.join(',')}`");
    expect(detail).toContain('disabled={!routeCanBeUsed(selectedRoute)}');
    expect(detail).toContain('route-unresolved-gap-notice');
    expect(detail).not.toContain('Share Activity');
  });

  test('editor keeps Draw/Point transactional, recoverable, and separate from Activity truth', () => {
    expect(overlay).toContain("onCancel('gesture-interrupted', capture)");
    expect(overlay).toContain('onStroke(points, capture)');
    expect(overlay).toContain('samples: rawSamplesRef.current.map');
    expect(editor).toContain('testID="ordered-route-save"');
    expect(editor).not.toContain('saveRoutePlannerDraft({');
    expect(editor).toContain('loadActivityFinalArtifact(ownerId, clientActivityId)');
    expect(editor).toContain('createImportedOrderedDraft');
    expect(editor).toContain("cairnText('ordered-route-editor-screen.this-route-changed-while-the-edit-was')");
    expect(editor).toContain('rawTarget: selection.rawTarget');
    expect(editor).toContain('effectiveTarget: selection.effectiveTarget');
    expect(editor).toContain('animateAcceptedPoint(committedPart?.points ?? points');
    expect(editor).toContain('animateAcceptedPoint(addedPart?.points ?? points');
    expect(editor).toContain('userCameraInteractionGenerationRef.current === userCameraGenerationAtRequest');
    expect(editor).toContain('routeGrowthPaintedSampleRef.current');
    expect(editor).toContain('canonicalOverlap: true');
    expect(editor).toContain('hiddenPartId={routeGrowthAnimation?.canonicalOverlap ? undefined');
    expect(editor).not.toContain('loadRoutePlannerDraft(');
    expect(editor).toContain('useRouteStore.getState().routes.find');
    expect(editor).toContain('invalidatePendingOperation();');
    expect(editor).toContain("nav.replace('MapHistory', { routeId: savedId })");
    expect(editor).toContain('scopeOverride={planningMemoryScope} opacityScale={0.42}');
    expect(overlay).toContain('<Polyline');
    expect(overlay).toContain('.maxPointers(1)');
    expect(editor).not.toContain('startTracking(');
  });

  test('Detail uses ordinary metrics and direct compact Hike/Run actions without a mode confirmation modal', () => {
    expect(detail).toContain("cairnText('map-history-screen.use-for-hike')");
    expect(detail).toContain("cairnText('map-history-screen.use-for-run')");
    expect(detail).not.toContain('title="Use this Route"');
    expect(detail).not.toContain('route-use-hike');
    expect(detail).not.toContain('route-use-run');
    expect(detail).not.toContain('selectedRoute.points.length ||');
    expect(detail).not.toContain('>points</Text>');
  });

  test('Hike and Run select the Route pre-start and capture its recording reference only inside Start', () => {
    for (const [source, referenceKey] of [
      [hike, 'hiking-screen.this-route-is-shown-on-the-map'],
      [run, 'running-screen.this-route-is-shown-on-the-map'],
    ] as const) {
      expect(source).toContain('captureActivityRouteReference(selectedRoute)');
      expect(source).toContain(`cairnText('${referenceKey}')`);
      expect(source).not.toContain('setFollowingRoute(');
      const startHandler = Math.max(
        source.indexOf('async function handleStart()'),
        source.indexOf('const handleStartHike = async () =>'),
      );
      const capture = source.indexOf('captureActivityRouteReference(selectedRoute)', startHandler);
      const startTracking = source.indexOf('await startTracking(', capture);
      expect(startHandler).toBeGreaterThanOrEqual(0);
      expect(capture).toBeGreaterThan(startHandler);
      expect(startTracking).toBeGreaterThan(capture);
    }
    expect(detail).toContain("nav.navigate(mode === 'running' ? 'Running' : 'Hiking', { routeId: ready.id })");
  });

  test('all three surfaces use shared semantic theme roles', () => {
    expect(detail).toContain('useVisualTheme()');
    expect(editor).toContain('useVisualTheme()');
    expect(hike).toContain('useVisualTheme()');
    expect(run).toContain('useVisualTheme()');
    expect(detail).toContain('visualTheme.surfaceElevated');
    expect(editor).toContain('theme.surfaceElevated');
    expect(detail).toContain('<CanonicalRouteLayer');
    expect(editor).toContain('<CanonicalRouteLayer');
    expect(detail).toContain('canonicalRouteGeometry(selectedRoute)');
    expect(editor).toContain('canonicalRouteGeometry({ orderedDraft: displayDraft })');
  });

  test('Editor and Detail retain canonical route truth and optional Fog cannot own route visibility', () => {
    const canonicalLayer = read('src/components/map/CanonicalRouteLayer.tsx');
    const fogLayer = read('src/features/memory/components/FogLayer.tsx');
    expect(canonicalLayer).toContain('buildReliableRouteDisplayGeometry');
    expect(canonicalLayer).toContain('display.baseLines.map');
    expect(canonicalLayer).toContain('role: \'canonical-safety\'');
    expect(canonicalLayer).toContain('aboveLayerID={aboveLayerID}');
    expect(canonicalLayer).toContain('repeat-turn-cap');
    expect(editor).toContain("ORDERED_ROUTE_FOG_BOUNDARY_LAYER_ID = 'ordered-route-fog-boundary'");
    expect(editor).toContain('aboveLayerID={ORDERED_ROUTE_FOG_BOUNDARY_LAYER_ID}');
    expect(editor).toContain('slot="top"');
    expect(editor).toContain('belowLayerID={ORDERED_ROUTE_FOG_BOUNDARY_LAYER_ID}');
    expect(editor).not.toContain("ROUTE_ABOVE_OPTIONAL_MEMORY_LAYER_ID = 'memory-overlap-edge'");
    expect(fogLayer).toContain('id="memory-overlap-edge"');
    expect(fogLayer).toContain('slot={slot}');
    expect(fogLayer).toContain('belowLayerID={belowLayerID}');
  });
});
