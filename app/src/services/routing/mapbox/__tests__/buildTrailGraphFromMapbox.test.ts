/**
 * buildTrailGraphFromMapbox unit tests.
 *
 * Round-trip: synthesise an ExtractResult → build TrailGraph → assert that
 * a junction has degree ≥ 3 in the resulting graph.
 */

import { buildTrailGraphFromMapbox } from '../buildTrailGraphFromMapbox';
import type { ExtractResult, MapboxWay } from '../MapboxJunctionExtractor';

function makeWay(id: string, coords: [number, number][], klass: string = 'path'): MapboxWay {
  return { id, klass, coords: coords.map(([lng, lat]) => ({ lng, lat })) };
}

describe('buildTrailGraphFromMapbox', () => {
  it('produces a non-empty TrailGraph from one way', () => {
    const extract: ExtractResult = {
      ok: true,
      junctions: [],
      ways: [
        makeWay('w1', [
          [174.78, -41.3],
          [174.79, -41.3],
          [174.8, -41.3],
        ]),
      ],
      diagnostics: {
        rawFeatureCount: 1,
        rawVertexCount: 3,
        extractMs: 10,
        bboxArea: 0,
      },
    };
    const g = buildTrailGraphFromMapbox(extract);
    expect(g.nodes.size).toBeGreaterThan(0);
    expect(g.meta.size).toBe(g.nodes.size);
  });

  it('produces a graph node with degree ≥ 3 at a T-junction', () => {
    const j: [number, number] = [174.79, -41.3];
    const extract: ExtractResult = {
      ok: true,
      junctions: [],
      ways: [
        makeWay('a', [[174.78, -41.3], j]),
        makeWay('b', [j, [174.8, -41.3]]),
        makeWay('c', [j, [174.79, -41.29]]),
      ],
      diagnostics: {
        rawFeatureCount: 3,
        rawVertexCount: 6,
        extractMs: 10,
        bboxArea: 0,
      },
    };
    const g = buildTrailGraphFromMapbox(extract);
    // Find a node within 50m of the junction coord; assert its degree.
    let foundDegree = 0;
    for (const [, meta] of g.meta) {
      const dLat = (meta.lat - j[1]) * 111000;
      const dLng =
        (meta.lng - j[0]) * 111000 * Math.cos((j[1] * Math.PI) / 180);
      const distM = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distM < 50) {
        const node = g.nodes.get(meta.id);
        if (node) {
          foundDegree = Math.max(foundDegree, node.edges.length);
        }
      }
    }
    expect(foundDegree).toBeGreaterThanOrEqual(3);
  });

  it('produces an empty graph when ways list is empty', () => {
    const extract: ExtractResult = {
      ok: true,
      junctions: [],
      ways: [],
      diagnostics: {
        rawFeatureCount: 0,
        rawVertexCount: 0,
        extractMs: 5,
        bboxArea: 0,
      },
    };
    const g = buildTrailGraphFromMapbox(extract);
    expect(g.nodes.size).toBe(0);
  });
});
