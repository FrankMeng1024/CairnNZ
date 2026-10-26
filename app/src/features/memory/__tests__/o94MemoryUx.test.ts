import fs from 'node:fs';
import path from 'node:path';
import { booleanPointInPolygon, multiPolygon, point } from '@turf/turf';
import {
  DAY_VISUAL_THEME,
  NIGHT_VISUAL_THEME,
  SUNSET_VISUAL_THEME,
} from '../../../components/tokens';
import {
  CURRENT_LOCATION_DOT_STYLE,
  CURRENT_LOCATION_RING_STYLE,
} from '../../../components/map/currentLocationMarkerStyle';
import {
  resolveMemoryCityCameraTarget,
  visibleCoverageAnchor,
  type MemoryCityCoverageSource,
} from '../services/memoryCityCameraTarget';
import { memoryFogTransitionIsVisiblyPending } from '../services/memoryEntryPresentation';

const appRoot = path.resolve(__dirname, '../../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');
const geometry = (west: number, south: number, east: number, north: number) => ({
  type: 'MultiPolygon' as const,
  coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]],
});

describe('O94 Memory UX contracts', () => {
  test('a retained authorized Fog scene never presents camera-only work as Loading shared map', () => {
    expect(memoryFogTransitionIsVisiblyPending({
      readinessKey: 'owner|combined|viewport:new-camera|mine:v7|friends:31:4:v9|authority-ready:yes',
      readyReadinessKey: 'owner|combined|viewport:old-camera|mine:v7|friends:31:4:v9|authority-ready:yes',
      retainsDisplayedScene: true,
    })).toBe(false);
    expect(memoryFogTransitionIsVisiblyPending({
      readinessKey: 'owner|combined:31,32|viewport:same|mine:v7|friends:31:4:v9,32:1:v2|authority-ready:yes',
      readyReadinessKey: 'owner|combined:31|viewport:same|mine:v7|friends:31:4:v9|authority-ready:yes',
      retainsDisplayedScene: true,
    })).toBe(true);
    expect(memoryFogTransitionIsVisiblyPending({
      readinessKey: 'new-selection',
      readyReadinessKey: 'old-selection',
      retainsDisplayedScene: false,
    })).toBe(true);
    expect(memoryFogTransitionIsVisiblyPending({
      readinessKey: 'already-ready',
      readyReadinessKey: 'already-ready',
      retainsDisplayedScene: false,
    })).toBe(false);
  });

  test('Beijing Friends-only navigation uses visible authorized geometry, not its coarse city centre', () => {
    const beijingBbox: [number, number, number, number] = [115.7, 39.4, 117.4, 41.1];
    const friendCoverage = geometry(116.31, 39.89, 116.33, 39.91);
    const sources: MemoryCityCoverageSource[] = [{
      source: 'friends', sourceId: 'friend-31', regionId: 'beijing',
      regionAnchor: [116.55, 40.25], geometry: friendCoverage,
    }];
    const target = resolveMemoryCityCameraTarget({ cityId: 'beijing', bbox: beijingBbox, sources });
    expect(target).toMatchObject({ source: 'friends', sourceId: 'friend-31', zoom: 14 });
    expect(target?.center).not.toEqual([116.55, 40.25]);
    expect(booleanPointInPolygon(point(target!.center), multiPolygon(friendCoverage.coordinates))).toBe(true);
  });

  test('Mine coverage wins over Friends and uses its recent authorized coverage anchor', () => {
    const bbox: [number, number, number, number] = [115.7, 39.4, 117.4, 41.1];
    const sources: MemoryCityCoverageSource[] = [
      { source: 'friends', sourceId: 'friend-31', regionId: 'beijing', geometry: geometry(116.31, 39.89, 116.33, 39.91) },
      { source: 'mine', sourceId: 'mine-v4', regionId: 'beijing', regionAnchor: [116.42, 39.94], geometry: geometry(116.4, 39.92, 116.44, 39.96) },
    ];
    expect(resolveMemoryCityCameraTarget({ cityId: 'beijing', bbox, sources })).toEqual({
      center: [116.42, 39.94], source: 'mine', sourceId: 'mine-v4', zoom: 14,
    });
  });

  test('multiple Mine clusters keep the latest valid Mine anchor and multiple Friends resolve deterministically', () => {
    const bbox: [number, number, number, number] = [115.7, 39.4, 117.4, 41.1];
    const mineWithSeparatedClusters = {
      type: 'MultiPolygon' as const,
      coordinates: [
        geometry(116.10, 39.70, 116.12, 39.72).coordinates[0],
        geometry(116.80, 40.20, 116.82, 40.22).coordinates[0],
      ],
    };
    expect(resolveMemoryCityCameraTarget({ cityId: 'beijing', bbox, sources: [
      { source: 'mine', sourceId: 'mine-v8', regionId: 'beijing', regionAnchor: [116.81, 40.21], geometry: mineWithSeparatedClusters },
      { source: 'friends', sourceId: 'friend-a', regionId: 'beijing', geometry: geometry(116.3, 39.8, 116.32, 39.82) },
    ] })).toMatchObject({ center: [116.81, 40.21], source: 'mine' });

    const reversedFriends: MemoryCityCoverageSource[] = [
      { source: 'friends', sourceId: 'friend-z', regionId: 'beijing', geometry: geometry(116.7, 40, 116.72, 40.02) },
      { source: 'friends', sourceId: 'friend-a', regionId: 'beijing', geometry: geometry(116.3, 39.8, 116.32, 39.82) },
    ];
    const first = resolveMemoryCityCameraTarget({ cityId: 'beijing', bbox, sources: reversedFriends });
    const second = resolveMemoryCityCameraTarget({ cityId: 'beijing', bbox, sources: [...reversedFriends].reverse() });
    expect(first?.sourceId).toBe('friend-a');
    expect(second).toEqual(first);
  });

  test('concave coverage gets an actual on-coverage target and absent coverage never falls back to city centre', () => {
    const bbox: [number, number, number, number] = [0, 0, 10, 10];
    const concave = {
      type: 'MultiPolygon' as const,
      coordinates: [[[[1, 1], [9, 1], [9, 3], [3, 3], [3, 9], [1, 9], [1, 1]]]],
    };
    const anchor = visibleCoverageAnchor(concave, bbox, [6, 6]);
    expect(anchor).not.toEqual([6, 6]);
    expect(booleanPointInPolygon(point(anchor!), multiPolygon(concave.coordinates))).toBe(true);
    expect(resolveMemoryCityCameraTarget({ cityId: 'empty', bbox, sources: [] })).toBeNull();
  });

  test.each([DAY_VISUAL_THEME, SUNSET_VISUAL_THEME, NIGHT_VISUAL_THEME])(
    '$mode uses three distinct, visible, non-opaque filled categories',
    theme => {
      expect(new Set([
        theme.mapMineMemoryFill,
        theme.mapFriendMemoryFill,
        theme.mapMemoryOverlapFill,
      ]).size).toBe(3);
      expect(theme.mapMineMemoryOpacity).toBeGreaterThanOrEqual(0.3);
      expect(theme.mapFriendMemoryOpacity).toBeGreaterThanOrEqual(0.3);
      expect(theme.mapMemoryOverlapOpacity).toBeGreaterThanOrEqual(0.35);
      expect(theme.mapMineMemoryOpacity).toBeLessThanOrEqual(0.4);
      expect(theme.mapFriendMemoryOpacity).toBeLessThanOrEqual(0.4);
      expect(theme.mapMemoryOverlapOpacity).toBeLessThanOrEqual(0.4);
    },
  );

  test('Cairns and scope controls share exact shell height and the label remains catalog-owned', () => {
    const screen = read('src/features/memory/screens/MemoryScreen.tsx');
    const toggle = read('src/features/memory/components/MemoryScopeToggle.tsx');
    expect(screen).toContain('height: MEMORY_TOP_CONTROL_HEIGHT');
    expect(toggle).toContain('height: MEMORY_TOP_CONTROL_HEIGHT');
    expect(screen).toContain("cairnText('memory.memory-screen.cairns')");
    expect(screen).toContain("nav.navigate('AllCairns')");
  });

  test('Memory and Route consume the same current-device location marker style', () => {
    const memory = read('src/features/memory/components/MemoryMap.tsx');
    const route = read('src/screens/OrderedRouteEditorScreen.tsx');
    const web = read('src/features/memory/services/mapboxAdapter.web.tsx');
    for (const source of [memory, route]) {
      expect(source).toContain('style={CURRENT_LOCATION_RING_STYLE}');
      expect(source).toContain('style={CURRENT_LOCATION_DOT_STYLE}');
    }
    expect(web).toContain('backgroundColor: CURRENT_LOCATION_DOT_STYLE.circleColor');
    expect(web).toContain('border: `2px solid ${CURRENT_LOCATION_RING_STYLE.circleColor}`');
    expect(CURRENT_LOCATION_RING_STYLE.circleColor).toBe('#FFFFFF');
    expect(CURRENT_LOCATION_DOT_STYLE.circleColor).toBe('rgba(51, 181, 229, 1)');
  });
});
