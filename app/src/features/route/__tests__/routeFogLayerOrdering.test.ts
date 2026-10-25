import fs from 'fs';
import path from 'path';
import { reconcileWebLayerPosition } from '../../memory/services/mapboxLayerPosition';

type Layer = { id: string };

function mutableMap(initial: string[]) {
  let layers: Layer[] = initial.map(id => ({ id }));
  const map = {
    getLayer: (id: string) => layers.find(layer => layer.id === id),
    getStyle: () => ({ layers }),
    moveLayer: jest.fn((id: string, beforeId?: string) => {
      const layer = layers.find(candidate => candidate.id === id);
      if (!layer) return;
      layers = layers.filter(candidate => candidate.id !== id);
      if (!beforeId) {
        layers.push(layer);
        return;
      }
      const before = layers.findIndex(candidate => candidate.id === beforeId);
      layers.splice(before < 0 ? layers.length : before, 0, layer);
    }),
    replaceStyle: (ids: string[]) => { layers = ids.map(id => ({ id })); },
    ids: () => layers.map(layer => layer.id),
  };
  return map;
}

describe('Route/Fog layer ownership', () => {
  const boundary = 'ordered-route-fog-boundary';
  const route = 'ordered-route-line';
  const fog = 'memory-overlap-edge';

  test('Fog absent/loading/unavailable never prevents Route ordering', () => {
    const map = mutableMap([boundary, route]);
    expect(reconcileWebLayerPosition(map, route, boundary)).toBe('already-ordered');
    expect(map.ids()).toEqual([boundary, route]);
    expect(map.moveLayer).not.toHaveBeenCalled();
  });

  test('late Fog and remounted Fog are moved below the stable boundary while Route stays above', () => {
    const map = mutableMap([boundary, route, fog]);
    expect(reconcileWebLayerPosition(map, fog, undefined, boundary)).toBe('moved');
    expect(map.ids()).toEqual([fog, boundary, route]);

    map.replaceStyle([boundary, route, fog]);
    expect(reconcileWebLayerPosition(map, fog, undefined, boundary)).toBe('moved');
    expect(reconcileWebLayerPosition(map, route, boundary)).toBe('already-ordered');
    expect(map.ids()).toEqual([fog, boundary, route]);
  });

  test('a style reload or bad layer reorder is repaired without changing the Route source', () => {
    const map = mutableMap([route, fog, boundary]);
    expect(reconcileWebLayerPosition(map, route, boundary)).toBe('moved');
    expect(reconcileWebLayerPosition(map, fog, undefined, boundary)).toBe('already-ordered');
    expect(map.ids()).toEqual([fog, boundary, route]);
    expect(reconcileWebLayerPosition(map, route, boundary)).toBe('already-ordered');
  });

  test('RNMapbox 10.3.1 native waits on relative anchors, so the app never references an optional Fog id', () => {
    const appRoot = path.resolve(__dirname, '../../../..');
    const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'node_modules/@rnmapbox/maps/package.json'), 'utf8'));
    const nativeLayer = fs.readFileSync(path.join(appRoot, 'node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXLayer.swift'), 'utf8');
    const nativeSource = fs.readFileSync(path.join(appRoot, 'node_modules/@rnmapbox/maps/ios/RNMBX/RNMBXSource.swift'), 'utf8');
    const editor = fs.readFileSync(path.join(appRoot, 'src/screens/OrderedRouteEditorScreen.tsx'), 'utf8');
    expect(packageJson.version).toBe('10.3.1');
    expect(nativeLayer).toContain('map!.waitForLayerWithID(idToWaitFor)');
    expect(nativeLayer).toContain('style.addLayer(styleLayer, layerPosition: layerPosition)');
    expect(nativeSource.indexOf('try style.addSource(source)')).toBeLessThan(nativeSource.indexOf('for layer in self.layers'));
    expect(editor.indexOf('id="ordered-route-fog-boundary-source"')).toBeLessThan(editor.indexOf('<FogLayer'));
    expect(editor.indexOf('<FogLayer')).toBeLessThan(editor.indexOf('<CanonicalRouteLayer'));
    expect(editor).not.toContain('aboveLayerID={\'memory-overlap-edge\'}');
    expect(editor).not.toContain('aboveLayerID="memory-overlap-edge"');
  });
});
