import fs from 'node:fs';
import path from 'node:path';

const read = (relative: string) => fs.readFileSync(path.resolve(__dirname, '..', '..', relative), 'utf8');

describe('Owner 13 root-cause source contracts', () => {
  test('Memory entry exposes Cairn Library without renaming the technical route', () => {
    const memory = read('features/memory/screens/MemoryScreen.tsx');
    expect(memory).toContain('Open Cairn Library');
    expect(memory).toContain('>Cairn Library</Text>');
    expect(memory).not.toContain('Open All Cairns');
    expect(memory).toContain("nav.navigate('AllCairns')");
  });

  test('Cairn rows reuse the shared library surface and do not add a second circular pin background', () => {
    const library = read('screens/AllCairnsScreen.tsx');
    expect(library).toContain('LibraryRecordSurface');
    expect(library).toContain('LibrarySearchField');
    expect(library).toContain('LibraryFilterRow');
    expect(library).not.toContain('styles.rowIcon, { backgroundColor');
  });

  test('Trails shares Search-first compact controls across Activities and Routes', () => {
    const trails = read('screens/RoutesScreen.tsx');
    expect(trails).toContain('LibrarySearchField');
    expect(trails).toContain('LibraryFilterRow');
    expect(trails).not.toContain('flexBasis: 220');
    expect(trails.indexOf('testID="route-search"')).toBeLessThan(trails.indexOf('testID="route-ownership-filter"'));
  });

  test('Route editor owns explicit modes, one context slot and no retired floating/multistroke copy', () => {
    const editor = read('screens/OrderedRouteEditorScreen.tsx');
    for (const mode of ['Browse', 'DrawArmed', 'Drawing', 'MatchPending', 'AwaitFreehandChoice', 'PointTargeting', 'TrimPreview', 'Saving']) {
      expect(editor).toContain(`'${mode}'`);
    }
    expect(editor).toContain('testID="route-context-slot"');
    expect(editor).toContain('testID="route-name-save-row"');
    expect(editor).toContain('testID="route-undo"');
    expect(editor).not.toContain('route-point-add-here');
    expect(editor).not.toContain('Draw is still active');
    expect(editor).not.toContain('Ready to save');
    expect(editor).not.toContain('Keep as drawn');
    expect(editor).not.toContain('Add here');
  });

  test('Web Mapbox consumes native-style ornament positions using genuine controls', () => {
    const adapter = read('features/memory/services/mapboxAdapter.web.tsx');
    expect(adapter).toContain('AttributionControl');
    expect(adapter).toContain('logoPosition={webControlPosition');
    expect(adapter).toContain('applyLogoOffset(event.target, logoPosition)');
    expect(adapter).toContain('attributionControl={false}');
    expect(adapter).not.toMatch(/margin(?:Top|Bottom|Left|Right)/);

    const history = read('screens/MapHistoryScreen.tsx');
    expect(history).toContain('HISTORY_ROUTE_ORNAMENT_CLEARANCE = 336');
    expect(history).toContain('ornamentBottomClearance={Math.min(H * 0.68, 580) + Spacing.sm}');
    expect(history).not.toContain('mapOrnamentsAbove(196)');
  });
});
