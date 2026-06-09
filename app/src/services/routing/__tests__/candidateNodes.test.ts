/**
 * candidateNodes unit tests.
 *
 * Pure-logic tests for the candidate-target computation.
 */

import {
  computeCandidates,
  findNearestCandidate,
} from '../candidateNodes';
import type { RouteNodeAnchor } from '../routeNodeAnchors';
import { TrailGraph } from '../graph/TrailGraph';
import { PointCloudIndex, IndexedPoint } from '../corridor/PointCloudIndex';

function makeGraph(
  nodes: Array<{ id: string; lng: number; lat: number; neighbors: string[]; weight?: number }>,
): TrailGraph {
  const g = new TrailGraph();
  for (const n of nodes) {
    g.meta.set(n.id, {
      id: n.id,
      lng: n.lng,
      lat: n.lat,
      trailIds: ['t1'],
    });
    g.nodes.set(n.id, {
      id: n.id,
      edges: n.neighbors.map(to => ({ to, weight: n.weight ?? 100 })),
    });
  }
  return g;
}

function makeIndex(points: Array<{ lng: number; lat: number }>): PointCloudIndex {
  const indexed: IndexedPoint[] = points.map((p, i) => ({
    lng: p.lng,
    lat: p.lat,
    source: 'original',
    refId: `p${i}`,
  }));
  return new PointCloudIndex(indexed);
}

describe('computeCandidates — intersection source', () => {
  it('returns empty when trailGraph is null', () => {
    const sel: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.78,
      lat: -41.29,
      workingPointIdx: 1,
      graphNodeId: 'B',
      id: 'int-B',
    };
    const result = computeCandidates({
      selected: sel,
      allAnchors: [sel],
      workingPoints: [
        { lng: 174.77, lat: -41.28 },
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null,
      walkedIndex: makeIndex([{ lng: 174.78, lat: -41.29 }]),
      corridorRadiusM: 1000,
    });
    expect(result).toHaveLength(0);
  });

  it('returns empty when source is at an endpoint position (idx=0 or last)', () => {
    const graph = makeGraph([
      { id: 'B', lng: 174.78, lat: -41.29, neighbors: ['C'] },
      { id: 'C', lng: 174.79, lat: -41.30, neighbors: ['B'] },
    ]);
    const sel: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.78,
      lat: -41.29,
      workingPointIdx: 0, // endpoint position — invalid for intersection
      graphNodeId: 'B',
      id: 'int-B',
    };
    const result = computeCandidates({
      selected: sel,
      allAnchors: [sel],
      workingPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: graph,
      walkedIndex: makeIndex([{ lng: 174.78, lat: -41.29 }]),
      corridorRadiusM: 1000,
    });
    expect(result).toHaveLength(0);
  });

  it('filters candidates with Dijkstra cost > 1km', () => {
    // B (source) → C (cost 100m, in range), → D (cost 1500m via B→D edge, OUT of range)
    const graph = makeGraph([
      { id: 'B', lng: 174.785, lat: -41.295, neighbors: ['C', 'D'] },
      { id: 'C', lng: 174.79, lat: -41.30, neighbors: ['B'], weight: 100 },
      { id: 'D', lng: 174.80, lat: -41.30, neighbors: ['B'], weight: 1500 },
    ]);
    // Override edges: B→C weight 100, B→D weight 1500
    graph.nodes.set('B', {
      id: 'B',
      edges: [
        { to: 'C', weight: 100 },
        { to: 'D', weight: 1500 },
      ],
    });
    graph.nodes.set('C', { id: 'C', edges: [{ to: 'B', weight: 100 }] });
    graph.nodes.set('D', { id: 'D', edges: [{ to: 'B', weight: 1500 }] });

    const walkedPts = [
      { lng: 174.78, lat: -41.29 },
      { lng: 174.785, lat: -41.295 },
      { lng: 174.79, lat: -41.30 },
      // densely cover the prev/next-to-anchor straight lines
      { lng: 174.7825, lat: -41.2925 },
      { lng: 174.7875, lat: -41.2975 },
    ];

    const sourceAnchor: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.785,
      lat: -41.295,
      workingPointIdx: 1,
      graphNodeId: 'B',
      id: 'int-B',
    };
    const candidateC: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.79,
      lat: -41.30,
      workingPointIdx: -1, // off-route candidate
      graphNodeId: 'C',
      id: 'int-C',
    };
    const candidateD: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.80,
      lat: -41.30,
      workingPointIdx: -1,
      graphNodeId: 'D',
      id: 'int-D',
    };
    const result = computeCandidates({
      selected: sourceAnchor,
      allAnchors: [sourceAnchor, candidateC, candidateD],
      workingPoints: [
        { lng: 174.78, lat: -41.29 }, // prev
        { lng: 174.785, lat: -41.295 }, // source = B
        { lng: 174.79, lat: -41.30 }, // next
      ],
      trailGraph: graph,
      walkedIndex: makeIndex(walkedPts),
      corridorRadiusM: 1000, // 1km corridor
    });
    // C is in graph-cost range (100m); D is filtered (1500m > 1km).
    const ids = result.map(a => a.id);
    expect(ids).toContain('int-C');
    expect(ids).not.toContain('int-D');
  });
});

describe('computeCandidates — endpoint source', () => {
  it('returns intersection anchors as trim candidates', () => {
    const sel: RouteNodeAnchor = {
      kind: 'endpoint-start',
      lng: 174.78,
      lat: -41.29,
      workingPointIdx: 0,
      id: 'endpoint-start',
    };
    const intB: RouteNodeAnchor = {
      kind: 'intersection',
      lng: 174.785,
      lat: -41.295,
      workingPointIdx: 1,
      graphNodeId: 'B',
      id: 'int-B',
    };
    const result = computeCandidates({
      selected: sel,
      allAnchors: [sel, intB],
      workingPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.785, lat: -41.295 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null, // not needed for endpoint candidates
      walkedIndex: null,
      corridorRadiusM: 1000,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('int-B');
  });

  it('returns trim-restore-start anchors when source is endpoint-start', () => {
    const sel: RouteNodeAnchor = {
      kind: 'endpoint-start',
      lng: 174.78,
      lat: -41.29,
      workingPointIdx: 0,
      id: 'endpoint-start',
    };
    const restoreA: RouteNodeAnchor = {
      kind: 'trim-restore-start',
      lng: 174.77,
      lat: -41.28,
      originalPointIdx: 0,
      id: 'restore-start-0',
    };
    const restoreB: RouteNodeAnchor = {
      kind: 'trim-restore-end',
      lng: 174.80,
      lat: -41.31,
      originalPointIdx: 5,
      id: 'restore-end-5',
    };
    const result = computeCandidates({
      selected: sel,
      allAnchors: [sel, restoreA, restoreB],
      workingPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null,
      walkedIndex: null,
      corridorRadiusM: 1000,
    });
    // endpoint-start picks up trim-restore-start, NOT trim-restore-end.
    expect(result.map(a => a.id)).toEqual(['restore-start-0']);
  });

  it('returns trim-restore-end anchors when source is endpoint-end', () => {
    const sel: RouteNodeAnchor = {
      kind: 'endpoint-end',
      lng: 174.79,
      lat: -41.30,
      workingPointIdx: 1,
      id: 'endpoint-end',
    };
    const restoreA: RouteNodeAnchor = {
      kind: 'trim-restore-start',
      lng: 174.77,
      lat: -41.28,
      originalPointIdx: 0,
      id: 'restore-start-0',
    };
    const restoreB: RouteNodeAnchor = {
      kind: 'trim-restore-end',
      lng: 174.80,
      lat: -41.31,
      originalPointIdx: 5,
      id: 'restore-end-5',
    };
    const result = computeCandidates({
      selected: sel,
      allAnchors: [sel, restoreA, restoreB],
      workingPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null,
      walkedIndex: null,
      corridorRadiusM: 1000,
    });
    expect(result.map(a => a.id)).toEqual(['restore-end-5']);
  });
});

describe('findNearestCandidate', () => {
  const candidates: RouteNodeAnchor[] = [
    {
      kind: 'intersection',
      lng: 174.78,
      lat: -41.29,
      workingPointIdx: 1,
      graphNodeId: 'A',
      id: 'a',
    },
    {
      kind: 'intersection',
      lng: 174.79,
      lat: -41.30,
      workingPointIdx: 2,
      graphNodeId: 'B',
      id: 'b',
    },
  ];

  it('returns null when nothing is within snap radius', () => {
    const result = findNearestCandidate(candidates, 174.85, -41.35, 100);
    expect(result).toBeNull();
  });

  it('returns the nearest candidate within snap radius', () => {
    // Drop very close to A (174.78, -41.29) — should snap to A.
    const result = findNearestCandidate(candidates, 174.78001, -41.29001, 100);
    expect(result?.id).toBe('a');
  });

  it('handles empty candidate list', () => {
    expect(findNearestCandidate([], 174.78, -41.29, 100)).toBeNull();
  });
});
