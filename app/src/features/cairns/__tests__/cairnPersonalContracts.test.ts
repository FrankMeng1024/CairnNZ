import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('Own Cairn Detail and personal All Cairns contracts', () => {
  const detail = read('src/screens/MarkerDetailScreen.tsx');
  const library = read('src/screens/AllCairnsScreen.tsx');
  const memory = read('src/features/memory/screens/MemoryScreen.tsx');
  const activity = read('src/screens/MapHistoryScreen.tsx');
  const navigation = read('src/navigation/RootNavigator.tsx');
  const markerStore = read('src/store/useMarkerStore.ts');
  const deleteDialog = read('src/features/cairns/CairnDeleteDialog.tsx');
  const webMapbox = read('src/features/memory/services/mapboxAdapter.web.tsx');
  const libraryControls = read('src/components/LibraryControls.tsx');
  const catalog = read('src/i18n/cairnText.ts');

  test('Memory exposes a normal All Cairns route outside map/location branches', () => {
    expect(navigation).toContain('revisionIdsByMarker?: Record<string, string>');
    expect(navigation).toContain('<Stack.Screen name="AllCairns" component={AllCairnsScreen} />');
    expect(memory).toContain('testID="memory-all-cairns-entry"');
    expect(memory).toContain("nav.navigate('AllCairns')");
    expect(memory.indexOf('memory-all-cairns-entry')).toBeLessThan(memory.indexOf('{mapMayBeShown && persistentCoord ?'));
  });

  test('All Cairns is own-only, recent-first, searchable and opens the authoritative Detail', () => {
    expect(library).toContain('markersForVisibleWorkspace(storedMarkers, debugMode)');
    expect(library).toContain('mergeOwnedCairns(markers, remoteMarkers)');
    // REVISE_WITH_REASON: source contracts follow stable keys; the exact
    // product wording remains asserted at the sole editable catalog.
    expect(library).toContain("cairnText('all-cairns-screen.search-names-and-notes')");
    expect(catalog).toContain("'en-NZ': 'Search names and notes'");
    expect(library).toContain('testID="all-cairns-filter"');
    // REVISE_WITH_REASON: locale-live labels are built inside the screen so a
    // language switch does not freeze module-scope English.
    expect(library).toContain('options={audienceFilters}');
    for (const key of ['all', 'only-me', 'friends', 'public']) {
      expect(library).toContain(`cairnText('all-cairns-screen.${key}')`);
    }
    expect(libraryControls).toContain('testID={`${testID}-${option.key}`}');
    expect(library).toContain('all-cairns-sort');
    expect(library).toContain('(b.createdAt ?? 0) - (a.createdAt ?? 0)');
    expect(library).not.toMatch(/updatedAt.*sort|sort.*updatedAt/);
    expect(library).toContain("nav.navigate('MarkerDetail', { markerId: id })");
    expect(library).not.toMatch(/circleMarkers|publicMarkers|loadPublicMarkers|bbox/);
    expect(markerStore).toContain('/api/markers/library?');
  });

  test('standalone and unavailable Activity provenance remain truthful', () => {
    expect(detail).toContain('testID="cairn-left-here-context"');
    expect(detail).toContain("cairnText('marker-detail-screen.left-here-value', { dateStr: dateStr })");
    expect(detail).toContain('testID="cairn-source-activity-unavailable"');
    expect(detail).toContain("cairnText('marker-detail-screen.activity-link-unavailable')");
    expect(catalog).toContain("'en-NZ': 'Activity link unavailable'");
  });

  test('owner acknowledgement is a restrained aggregate with no discoverer or visit details', () => {
    expect(markerStore).toContain('thanksCount: row.thanks_count == null ? undefined : Number(row.thanks_count)');
    expect(detail).toContain('testID="cairn-owner-thanks-acknowledgement"');
    expect(detail).toContain("Number(marker.thanksCount ?? 0) > 0");
    expect(detail).toContain("cairnText('marker-detail-screen.1-thanks-received')");
    expect(detail).not.toMatch(/thanks.*discoverer|thanks.*observed_at|thanks.*acquired_at/i);
  });

  test('incomplete retrieval never claims a global search-empty result', () => {
    expect(library).toContain("coverage === 'complete' ? cairnText('all-cairns-screen.no-matching-cairns') : cairnText('all-cairns-screen.no-matches-in-available-cairns')");
    expect(library).toContain("cairnText('all-cairns-screen.showing-downloaded-cairns-some-older-cairns-may')");
    expect(library).toContain("cairnText('all-cairns-screen.showing-cairns-available-on-this-iphone-full')");
    expect(markerStore).toContain("libraryError: 'server-upgrade-required'");
  });

  test('Activity and list rows both use MarkerDetail with stable explicit identity', () => {
    expect(activity).toContain("nav.navigate('MarkerDetail', { markerId: marker.id })");
    expect(activity).toContain('linkedCairnsForActivity(markers, selectedSession)');
    expect(detail).toContain('cairnMatchesIdentity(candidate, markerId)');
    expect(detail).toContain("String(markerStoreOwnerId ?? '') === String(userId)");
    expect(detail).not.toContain('distanceTo');
  });

  test('Detail edits only supported content and preserves drafts on failure or close', () => {
    expect(detail).toContain('showTypePicker={false}');
    expect(detail).toContain('showVisibilityPicker');
    expect(detail).toContain('disableVisibilityPublic');
    expect(detail).toContain('permission: editPermission');
    expect(detail).toContain("cairnText('marker-detail-screen.changes-were-not-saved-your-draft-is')");
    expect(detail).toContain("cairnText('marker-detail-screen.discard-changes')");
    expect(detail).toContain('disabled={!editDirty || Boolean(publicEditBlock)}');
    expect(detail).toContain("cairnText('marker-detail-screen.this-cairn-has-no-activity-source-so')");
    expect(detail).toContain("cairnText('marker-detail-screen.saving-creates-a-new-version-it-can')");
    expect(detail).toContain('cairn-edit-public-block');
  });

  test('delete confirmation states non-cascade semantics and truthful queued deletion', () => {
    expect(deleteDialog).toContain("cairnText('cairns.cairn-delete-dialog.it-disappears-from-your-collection-and-cannot')");
    expect(detail).toContain("result.remoteState === 'queued'");
    [
      detail,
      activity,
      read('src/screens/HikingScreen.tsx'),
      read('src/features/memory/components/CairnPinsLayer.tsx'),
    ].forEach(caller => expect(caller).toContain('<CairnDeleteDialog'));
    const deletion = markerStore.slice(
      markerStore.indexOf('deleteMarker: async (id)'),
      markerStore.indexOf('hideMark: async', markerStore.indexOf('deleteMarker: async (id)')),
    );
    expect(deletion).toContain('tombstoneMarker');
    expect(deletion).toContain("remoteState: 'queued'");
    expect(deletion).not.toMatch(/useSessionStore|useRouteStore|useMemoryStore|resetMemory/);
    expect(deleteDialog).toContain("actions: { gap: Spacing.md }");
    expect(deleteDialog).not.toContain("flexDirection: 'row'");
  });

  test('Cairn edit uses protected Back while the map detail uses map-readable Back', () => {
    expect(detail).toContain('<BackButton variant="mapInline" />');
    expect(detail).toContain('testID="cairn-edit-back"');
    expect(detail).toContain('onPress={requestCloseEdit}');
    expect(detail).not.toContain('onClose={requestCloseEdit}');
  });

  test('Detail map is optional, has legal ornaments, and never exposes raw coordinate copy', () => {
    expect(detail).toContain("cairnText('marker-detail-screen.map-unavailable')");
    expect(detail).toContain("cairnText('marker-detail-screen.your-cairn-is-still-available')");
    expect(detail).toMatch(/attributionEnabled\s+logoEnabled/);
    expect(detail).not.toContain('marker.lat.toFixed');
    expect(detail).not.toContain('marker.lng.toFixed');
    expect(webMapbox).toContain('WEB_MAPBOX_AVAILABLE');
    expect(webMapbox).toContain('available: WEB_MAPBOX_AVAILABLE');
  });

  test('personal surfaces consume shared three-theme roles and components', () => {
    expect(detail).toContain('useVisualTheme()');
    expect(detail).toContain('<BottomSheetFrame');
    expect(detail).toContain('<ModalCard');
    expect(detail).toContain('<ContentSurface');
    expect(library).toContain('useVisualTheme()');
    expect(library).toContain('<ContentSurface');
    expect(library).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });

  test('opening or editing a Cairn does not touch the recording lifecycle', () => {
    expect(detail).not.toMatch(/useTrackingStore|stopTracking|pauseTracking|resumeTracking/);
    expect(library).not.toMatch(/useTrackingStore|stopTracking|pauseTracking|resumeTracking/);
  });

  test('Simulator Cairns stay in the isolated QA workspace and all live owner callers use its selector', () => {
    const plant = read('src/screens/PlantScreen.tsx');
    const workspace = read('src/features/cairns/cairnWorkspace.ts');
    const siblingCallers = [
      library,
      detail,
      read('src/screens/HikingScreen.tsx'),
      read('src/screens/MapHistoryScreen.tsx'),
      read('src/features/memory/components/MemoryMap.tsx'),
      read('src/features/memory/components/CairnPinsLayer.tsx'),
    ];
    expect(plant).toContain("qaProvenance: final.locationProvenance === 'simulator_test'");
    expect(markerStore).toContain("if (data.qaProvenance === 'simulator_test')");
    expect(markerStore).toContain("throw new Error('simulator_cairn_requires_qa_workspace')");
    expect(markerStore).toContain("if (current.qaProvenance === 'simulator_test')");
    expect(workspace).toContain("marker.qaProvenance !== 'simulator_test' || qaWorkspaceActive");
    siblingCallers.slice(0, 5).forEach(caller => expect(caller).toContain('markersForVisibleWorkspace'));
    expect(siblingCallers[5]).toContain('useMarkerStore((s) => s.markers)');
    const qaBranch = markerStore.slice(
      markerStore.indexOf("if (data.qaProvenance === 'simulator_test')"),
      markerStore.indexOf('const payload: MarkerCreatePayload'),
    );
    expect(qaBranch).not.toMatch(/offlineMarkers\.saveLocal|authenticatedFetch/);
  });
});
