/**
 * MapboxJunctionExtractor unit tests.
 *
 * Pure-logic tests with a mock mapRef that returns canned FeatureCollection
 * fixtures. Verifies junction degree, fingerprint stability, allowed-class
 * filter, and graceful failure modes.
 */

import { extractJunctions } from '../MapboxJunctionExtractor';

function makeMapRef(features: any[], zoom: number = 15) {
  return {
    current: {
      getZoom: async () => zoom,
      querySourceFeatures: async () => ({ features }),
    },
  };
}

const BBOX = { west: 174.77, south: -41.31, east: 174.81, north: -41.28 };

function lineFeature(coords: number[][], cls: string, id?: string | number) {
  const f: any = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: { class: cls },
  };
  if (id !== undefined) f.id = id;
  return f;
}

describe('extractJunctions — happy paths', () => {
  it('detects a T-junction (degree 3)', async () => {
    // 3 paths meeting at (174.79, -41.30).
    const j: [number, number] = [174.79, -41.3];
    const features = [
      lineFeature([[174.78, -41.3], j], 'path', 'a'),
      lineFeature([j, [174.8, -41.3]], 'path', 'b'),
      lineFeature([j, [174.79, -41.29]], 'path', 'c'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000, // disable densify so test stays simple
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.junctions).toHaveLength(1);
    expect(res.junctions[0].degree).toBe(3);
    // Fingerprint id reflects 5-decimal coord
    expect(res.junctions[0].id).toBe('mj_174.79_-41.3');
  });

  it('detects a 4-way crossing (degree 4)', async () => {
    const j: [number, number] = [174.79, -41.3];
    const features = [
      lineFeature([[174.78, -41.3], j], 'path', 'a'),
      lineFeature([j, [174.8, -41.3]], 'path', 'b'),
      lineFeature([j, [174.79, -41.29]], 'path', 'c'),
      lineFeature([[174.79, -41.31], j], 'path', 'd'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.junctions).toHaveLength(1);
    expect(res.junctions[0].degree).toBe(4);
  });

  it('emits no junction for an isolated 2-vertex segment', async () => {
    const features = [lineFeature([[174.78, -41.3], [174.79, -41.3]], 'path', 'a')];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.junctions).toHaveLength(0);
  });

  it('passes through 2-vertex feature without subsampling (length <= subsample limit)', async () => {
    // v218: extractor no longer densifies — it subsamples long parts and
    // passes short ones through untouched. A 2-vertex line stays 2 vertices.
    const features = [
      lineFeature([[174.79, -41.3], [174.79, -41.2991]], 'path', 'a'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 10,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ways).toHaveLength(1);
    expect(res.ways[0].coords.length).toBe(2);
  });

  it('subsamples long parts to <=51 vertices', async () => {
    // 200-vertex part should subsample to ~50 + tail = at most 51.
    const longCoords: number[][] = [];
    for (let i = 0; i < 200; i++) {
      longCoords.push([174.79 + i * 0.00001, -41.3]);
    }
    const features = [lineFeature(longCoords, 'path', 'big')];
    const res = await extractJunctions(makeMapRef(features), BBOX);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ways).toHaveLength(1);
    expect(res.ways[0].coords.length).toBeLessThanOrEqual(51);
    // first + last preserved
    expect(res.ways[0].coords[0]).toEqual({ lng: 174.79, lat: -41.3 });
    const lastIn = longCoords[longCoords.length - 1];
    const lastOut = res.ways[0].coords[res.ways[0].coords.length - 1];
    expect(lastOut.lng).toBeCloseTo(lastIn[0], 6);
    expect(lastOut.lat).toBeCloseTo(lastIn[1], 6);
  });

  it('fingerprint is stable across small float perturbation in 7th decimal', async () => {
    // Two ways meet at "the same" junction but their endpoint coords differ
    // in the 7th decimal place. 5-decimal fingerprint should still merge.
    const j1: [number, number] = [174.79, -41.3];
    const j2: [number, number] = [174.7900001, -41.3000002];
    const features = [
      lineFeature([[174.78, -41.3], j1], 'path', 'a'),
      lineFeature([j2, [174.8, -41.3]], 'path', 'b'),
      lineFeature([j1, [174.79, -41.29]], 'path', 'c'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.junctions).toHaveLength(1);
    expect(res.junctions[0].degree).toBe(3);
  });

  it('respects minDegree option (degree 2 → endpoints become junctions)', async () => {
    const j: [number, number] = [174.79, -41.3];
    const features = [
      lineFeature([[174.78, -41.3], j], 'path', 'a'),
      lineFeature([j, [174.8, -41.3]], 'path', 'b'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
      minDegree: 2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The shared midpoint hits 2 ways.
    const central = res.junctions.find(p => p.id === 'mj_174.79_-41.3');
    expect(central).toBeDefined();
    expect(central!.degree).toBe(2);
  });
});

describe('extractJunctions — class filter', () => {
  it('drops motorway features by default', async () => {
    const features = [
      lineFeature([[174.78, -41.3], [174.8, -41.3]], 'motorway', 'm1'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no-features');
  });

  it('drops trunk / motorway_link / ferry / golf / *_rail / construction by default', async () => {
    const blocked = [
      'motorway',
      'motorway_link',
      'trunk',
      'trunk_link',
      'ferry',
      'golf',
      'aerialway',
      'major_rail',
      'minor_rail',
      'service_rail',
      'construction',
    ];
    for (const klass of blocked) {
      const features = [
        lineFeature([[174.78, -41.3], [174.8, -41.3]], klass, `${klass}-1`),
      ];
      const res = await extractJunctions(makeMapRef(features), BBOX);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error).toBe('no-features');
    }
  });

  it('keeps primary / secondary / tertiary / street / pedestrian / path / track / footway / cycleway / service / *_link by default', async () => {
    const kept = [
      'primary',
      'primary_link',
      'secondary',
      'secondary_link',
      'tertiary',
      'tertiary_link',
      'street',
      'street_limited',
      'service',
      'pedestrian',
      'path',
      'track',
      'footway',
      'cycleway',
      'unclassified', // not in our blacklist → kept
      'residential',
      'living_street',
    ];
    for (const klass of kept) {
      const features = [
        lineFeature([[174.78, -41.3], [174.8, -41.3]], klass, `${klass}-1`),
      ];
      const res = await extractJunctions(makeMapRef(features), BBOX, {
        densifyIntervalM: 1000,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.ways).toHaveLength(1);
      expect(res.ways[0].klass).toBe(klass);
    }
  });

  it('keeps configured allowed classes (allowlist mode overrides blacklist)', async () => {
    const features = [
      lineFeature([[174.78, -41.3], [174.8, -41.3]], 'major', 'x'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      allowedClasses: ['major'],
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ways).toHaveLength(1);
  });

  it('allowlist mode drops everything not in the list (even if not in default blacklist)', async () => {
    // 'primary' would be kept under default blacklist, but allowlist=['path']
    // limits to path only.
    const features = [
      lineFeature([[174.78, -41.3], [174.79, -41.3]], 'primary', 'a'),
      lineFeature([[174.79, -41.3], [174.8, -41.3]], 'path', 'b'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      allowedClasses: ['path'],
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ways).toHaveLength(1);
    expect(res.ways[0].klass).toBe('path');
  });

  it('detects junctions across mixed road classes (city scenario)', async () => {
    // Real urban scenario: a primary road meets a residential street meets
    // a footway at the same junction — should produce degree=3 anchor.
    const j: [number, number] = [174.79, -41.3];
    const features = [
      lineFeature([[174.78, -41.3], j], 'primary', 'p1'),
      lineFeature([j, [174.8, -41.3]], 'residential', 'r1'),
      lineFeature([j, [174.79, -41.29]], 'footway', 'f1'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.junctions).toHaveLength(1);
    expect(res.junctions[0].degree).toBe(3);
  });

  it('keeps unknown future classes (forward-compat with new Mapbox class values)', async () => {
    // Future class Mapbox might add — should be kept (forward-compat
    // guarantee of the blacklist approach).
    const features = [
      lineFeature([[174.78, -41.3], [174.8, -41.3]], 'unknown_future_class', 'x'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ways).toHaveLength(1);
  });
});

describe('extractJunctions — failure modes', () => {
  it('returns no-map-ref when mapRef is null', async () => {
    const res = await extractJunctions(null, BBOX);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no-map-ref');
  });

  it('returns no-map-ref when mapRef.current is null', async () => {
    const res = await extractJunctions({ current: null }, BBOX);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no-map-ref');
  });

  it('returns zoom-too-low when getZoom resolves below threshold', async () => {
    const ref = makeMapRef([], 12);
    const res = await extractJunctions(ref, BBOX, { minZoom: 14 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('zoom-too-low');
  });

  it('returns no-features when querySourceFeatures returns empty', async () => {
    const res = await extractJunctions(makeMapRef([]), BBOX);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('no-features');
  });

  it('returns query-failed when querySourceFeatures throws', async () => {
    const ref = {
      current: {
        getZoom: async () => 15,
        querySourceFeatures: async () => {
          throw new Error('Mapbox SDK boom');
        },
      },
    };
    const res = await extractJunctions(ref, BBOX);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('query-failed');
    expect(res.detail).toContain('Mapbox SDK boom');
  });

  it('returns vertex-cap-exceeded when raw vertex count exceeds maxVertexCount', async () => {
    // v218: extractor no longer densifies; it subsamples each part to
    // ~50 vertices. So a single feature can no longer trip the cap on
    // its own (subsample bounds it). To trigger the cap, feed many
    // features whose summed subsampled-vertex count exceeds the cap.
    // With maxVertexCount=100 and per-feature subsample limit ~50, we
    // need at least 3 features.
    const features = [];
    for (let f = 0; f < 5; f++) {
      const longCoords: number[][] = [];
      for (let i = 0; i < 200; i++) {
        longCoords.push([174.79 + i * 0.00001, -41.3 + f * 0.0001]);
      }
      features.push(lineFeature(longCoords, 'path', `big-${f}`));
    }
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      maxVertexCount: 100,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('vertex-cap-exceeded');
  });
});

describe('extractJunctions — diagnostics', () => {
  it('reports diagnostics for successful extraction', async () => {
    const features = [
      lineFeature([[174.78, -41.3], [174.79, -41.3]], 'path', 'a'),
      lineFeature([[174.79, -41.3], [174.8, -41.3]], 'path', 'b'),
    ];
    const res = await extractJunctions(makeMapRef(features), BBOX, {
      densifyIntervalM: 1000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.diagnostics.rawFeatureCount).toBe(2);
    expect(res.diagnostics.rawVertexCount).toBeGreaterThan(0);
    expect(res.diagnostics.extractMs).toBeGreaterThanOrEqual(0);
    expect(res.diagnostics.bboxArea).toBeGreaterThan(0);
  });
});
