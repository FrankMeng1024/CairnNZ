import { queryWebShapeSourcePressFeatures } from '../services/mapboxAdapterWebPress';

describe('web ShapeSource press bridge', () => {
  it('queries only mounted child layers and returns only the owning source', () => {
    const map = {
      getLayer: jest.fn((id: string) => id !== 'missing'),
      queryRenderedFeatures: jest.fn(() => [
        { source: 'acquired-cairn-clusters', properties: { cluster_id: 8 } },
        { source: 'memory-fog-src', properties: { cairnFogKind: 'fog' } },
      ]),
    };

    expect(queryWebShapeSourcePressFeatures(
      map,
      { x: 120, y: 240 },
      ['acquired-cairn-cluster-circles', 'missing'],
      'acquired-cairn-clusters',
    )).toEqual([{ source: 'acquired-cairn-clusters', properties: { cluster_id: 8 } }]);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
      { x: 120, y: 240 },
      { layers: ['acquired-cairn-cluster-circles'] },
    );
  });

  it('fails closed when no owned layer can be queried', () => {
    const map = {
      getLayer: jest.fn(() => false),
      queryRenderedFeatures: jest.fn(),
    };

    expect(queryWebShapeSourcePressFeatures(map, { x: 0, y: 0 }, ['missing'], 'source')).toEqual([]);
    expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
  });
});
