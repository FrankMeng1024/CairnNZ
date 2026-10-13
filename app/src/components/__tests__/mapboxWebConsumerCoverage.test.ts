import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(appRoot, relative), 'utf8');

describe('real Mapbox Web consumer coverage', () => {
  const activityMap = read('src/screens/HikingMap.tsx');
  const history = read('src/screens/MapHistoryScreen.tsx');
  const adapter = read('src/features/memory/services/mapboxAdapter.web.tsx');
  const navigation = read('src/navigation/RootNavigator.tsx');
  const acquiredClusters = read('src/features/memory/components/AcquiredCairnClusterLayer.tsx');

  test('Hike and Run maps use the real Web adapter while preserving RNMapbox native', () => {
    expect(activityMap).toContain("Platform.OS === 'web'");
    expect(activityMap).toContain("require('../features/memory/services/mapboxAdapter.web').makeWebMapboxAdapter()");
    expect(activityMap).toContain("require('@rnmapbox/maps')");
    expect(activityMap).toContain('Mapbox?.available !== false');
  });

  test('Activity and Route detail use the same real renderer split', () => {
    expect(history).toContain("Platform.OS === 'web'");
    expect(history).toContain("require('../features/memory/services/mapboxAdapter.web').makeWebMapboxAdapter()");
    expect(history).toContain("require('@rnmapbox/maps')");
    expect(history).toContain('Mapbox?.available !== false');
    expect(history).toContain('route.params?.sharedDeliveryId');
  });

  test('Web MarkerView maps Cairn view annotations to a real Mapbox marker', () => {
    expect(adapter).toContain('export function MarkerView');
    expect(adapter).toContain('<Marker longitude={coordinate[0]} latitude={coordinate[1]} anchor="center">');
    expect(adapter).toContain('MarkerView,');
    expect(adapter).not.toContain('MarkerView: NoopComponent');
  });

  test('Web camera supports the detail-screen fitBounds contract', () => {
    expect(adapter).toContain('fitBounds: (northEast, southWest, padding = 0, animationDuration = 0)');
    expect(adapter).toContain('inner.fitBounds([southWest, northEast]');
  });

  test('Web QA bridge can seed each production Mine/Friends authority independently', () => {
    expect(navigation).toContain('stores.useMemorySubscriptionsStore');
    expect(navigation).toContain('stores.useFriendMemoryStore');
    expect(navigation).toContain('stores.useMemoryScopeStore');
  });

  test('acquired Cairn Mapbox clusters resolve presentation from active theme tokens', () => {
    expect(acquiredClusters).toContain('const theme = useVisualTheme()');
    expect(acquiredClusters).toContain('circleColor: theme.primary');
    expect(acquiredClusters).toContain('circleStrokeColor: theme.surfaceElevated');
    expect(acquiredClusters).toContain('textColor: theme.onPrimary');
    expect(acquiredClusters).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(adapter).toContain("typeof clusterMaxZoomLevel === 'number' ? { clusterMaxZoom: clusterMaxZoomLevel }");
    expect(adapter).toContain('clusterProperties ? { clusterProperties }');
    expect(adapter).toContain('const filterProps = filter ? { filter: filter as any } : {}');
    expect(adapter).not.toContain('filter={filter as any}');
    expect(adapter).toContain("if (key === 'lineEmissiveStrength') continue");
  });
});
