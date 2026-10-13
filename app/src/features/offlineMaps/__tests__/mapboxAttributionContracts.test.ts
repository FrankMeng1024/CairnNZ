import fs from 'fs';
import path from 'path';

const SOURCE_ROOT = path.resolve(__dirname, '../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.join(SOURCE_ROOT, relativePath), 'utf8');
}

describe('Mapbox attribution contracts', () => {
  test('no production map hides the Mapbox logo or attribution control', () => {
    const mapFiles = [
      'features/memory/components/MemoryMap.tsx',
      'features/offlineMaps/OfflineMapsScreen.tsx',
      'features/plant/components/PinAdjustStep.tsx',
      'screens/HikingMap.tsx',
      'screens/MapHistoryScreen.tsx',
      'screens/MarkerDetailScreen.tsx',
      'screens/PublicCairnDetailScreen.tsx',
      'screens/OrderedRouteEditorScreen.tsx',
    ];
    for (const file of mapFiles) {
      const text = source(file);
      expect(text).not.toMatch(/(?:logoEnabled|attributionEnabled)\s*=\s*{false}/);
      expect(text).toMatch(/logoEnabled(?:\s|=)/);
      expect(text).toMatch(/attributionEnabled(?:\s|=)/);
    }
  });

  test('offline copy never claims road refinement or Activity truth is in the tile pack', () => {
    const text = source('features/offlineMaps/OfflineMapsScreen.tsx');
    expect(text).toContain('Road refinement, sharing, public Cairns and server sync still wait for connectivity.');
    expect(text).toContain('does not change canonical Activity geometry');
    expect(text).not.toContain('estimatedSizeMB');
  });

  test('offline selector shares Standard theme config while downloads retain a truthful device gate', () => {
    const text = source('features/offlineMaps/OfflineMapsScreen.tsx');
    expect(text).toContain("getMapStyleForTheme('outdoors', mapTheme)");
    expect(text).toContain('buildStandardConfig(mapTheme)');
    expect(text).toContain('<StyleImport');
    expect(text).toContain('day, dusk and night map theme');
    expect(text).toContain('physical iPhone proves Standard labels');
  });

  test('Activity-start download handoff is default-off, fire-and-forget and after tracking publication', () => {
    const tracking = source('store/useTrackingStore.ts');
    const trackingPublished = tracking.indexOf("status: 'tracking'");
    const featureGate = tracking.indexOf('offlineMapsFeatureEnabled()', trackingPublished);
    const pauseCall = tracking.indexOf('void offlineMapService.pauseForActivityStart()', featureGate);
    expect(trackingPublished).toBeGreaterThan(-1);
    expect(featureGate).toBeGreaterThan(trackingPublished);
    expect(pauseCall).toBeGreaterThan(featureGate);
    expect(tracking.slice(featureGate, pauseCall)).not.toContain('await offlineMapService');
  });
});
