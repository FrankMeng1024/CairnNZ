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
      'screens/RouteEditorScreen.tsx',
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
});
