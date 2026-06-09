/**
 * routeNodeAnchors unit tests.
 *
 * Pure-logic tests — no React, no Mapbox. Constructs a synthetic
 * TrailGraph by directly populating its nodes/meta maps to exercise
 * the snap-to-graph + degree filter + endpoint exclusion + trim-restore
 * derivation paths.
 */

import { computeRouteNodeAnchors } from '../routeNodeAnchors';
import { TrailGraph } from '../graph/TrailGraph';

/**
 * Build a TrailGraph stub with the given nodes + edges.
 * Each node is { id, lng, lat, neighbors: nodeId[] }.
 */
function makeGraph(
  nodes: Array<{ id: string; lng: number; lat: number; neighbors: string[] }>,
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
      edges: n.neighbors.map(to => ({ to, weight: 1 })),
    });
  }
  return g;
}

describe('computeRouteNodeAnchors', () => {
  it('returns empty when workingPoints has fewer than 2 points', () => {
    const result = computeRouteNodeAnchors({
      workingPoints: [{ lng: 174.78, lat: -41.29 }],
      originalPoints: [{ lng: 174.78, lat: -41.29 }],
      trailGraph: null,
    });
    expect(result).toHaveLength(0);
  });

  it('returns just the two endpoints when trailGraph is null', () => {
    const result = computeRouteNodeAnchors({
      workingPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      originalPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null,
    });
    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe('endpoint-start');
    expect(result[1].kind).toBe('endpoint-end');
  });

  it('returns endpoints + intersection nodes (degree>=3) only', () => {
    // Route polyline passes through 3 graph nodes: A (degree 1, dead end),
    // B (degree 3, real junction), C (degree 2, pass-through). Only B
    // should surface as an intersection anchor.
    const graph = makeGraph([
      { id: 'A', lng: 174.78, lat: -41.29, neighbors: ['B'] },
      { id: 'B', lng: 174.785, lat: -41.295, neighbors: ['A', 'C', 'D'] },
      { id: 'C', lng: 174.79, lat: -41.30, neighbors: ['B', 'E'] },
      { id: 'D', lng: 174.78, lat: -41.30, neighbors: ['B'] },
      { id: 'E', lng: 174.80, lat: -41.30, neighbors: ['C'] },
    ]);

    const result = computeRouteNodeAnchors({
      workingPoints: [
        { lng: 174.78, lat: -41.29 }, // = A (endpoint-start)
        { lng: 174.785, lat: -41.295 }, // = B (intersection, degree 3)
        { lng: 174.79, lat: -41.30 }, // = C (endpoint-end, degree 2 but endpoint)
      ],
      originalPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.785, lat: -41.295 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: graph,
    });

    // Expect: endpoint-start, endpoint-end, and intersection-B.
    // B is far enough from both endpoints (>50m) so endpoint-exclusion
    // should NOT filter it out. Compute distances:
    //   A→B: ~640m at lat -41.29 (0.005° lng × ~83km/° + 0.005° lat × 111km/° → diag ~590m)
    // So B passes both endpoint distance checks.
    expect(result.find(a => a.kind === 'endpoint-start')).toBeDefined();
    expect(result.find(a => a.kind === 'endpoint-end')).toBeDefined();
    const intersections = result.filter(a => a.kind === 'intersection');
    expect(intersections).toHaveLength(1);
    expect(intersections[0].graphNodeId).toBe('B');
  });

  it('excludes intersections within 50m of either endpoint', () => {
    // B (degree 3) sits ~10m from the start endpoint — should be filtered.
    const graph = makeGraph([
      { id: 'A', lng: 174.78, lat: -41.29, neighbors: ['B'] },
      { id: 'B', lng: 174.78001, lat: -41.29001, neighbors: ['A', 'C', 'D'] },
      { id: 'C', lng: 174.79, lat: -41.30, neighbors: ['B'] },
      { id: 'D', lng: 174.78, lat: -41.30, neighbors: ['B'] },
    ]);

    const result = computeRouteNodeAnchors({
      workingPoints: [
        { lng: 174.78, lat: -41.29 }, // start
        { lng: 174.78001, lat: -41.29001 }, // ~ B (close to start)
        { lng: 174.79, lat: -41.30 }, // end
      ],
      originalPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.78001, lat: -41.29001 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: graph,
    });
    const intersections = result.filter(a => a.kind === 'intersection');
    // B was filtered (too close to start endpoint).
    expect(intersections).toHaveLength(0);
  });

  it('does NOT duplicate when polyline passes through same junction multiple times', () => {
    // Loop route: A → B → C → B → D. B appears twice on the polyline
    // but should produce only ONE intersection anchor.
    const graph = makeGraph([
      { id: 'A', lng: 174.78, lat: -41.29, neighbors: ['B'] },
      { id: 'B', lng: 174.785, lat: -41.295, neighbors: ['A', 'C', 'D'] },
      { id: 'C', lng: 174.79, lat: -41.30, neighbors: ['B'] },
      { id: 'D', lng: 174.80, lat: -41.30, neighbors: ['B'] },
    ]);

    const result = computeRouteNodeAnchors({
      workingPoints: [
        { lng: 174.78, lat: -41.29 }, // A (start)
        { lng: 174.785, lat: -41.295 }, // B
        { lng: 174.79, lat: -41.30 }, // C (interior point)
        { lng: 174.785, lat: -41.295 }, // B again
        { lng: 174.80, lat: -41.30 }, // D (end)
      ],
      originalPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.785, lat: -41.295 },
        { lng: 174.79, lat: -41.30 },
        { lng: 174.785, lat: -41.295 },
        { lng: 174.80, lat: -41.30 },
      ],
      trailGraph: graph,
    });
    const bAnchors = result.filter(
      a => a.kind === 'intersection' && a.graphNodeId === 'B',
    );
    expect(bAnchors).toHaveLength(1);
    // C is interior with degree 2 — not an intersection by spec.
    expect(result.filter(a => a.graphNodeId === 'C')).toHaveLength(0);
  });

  it('emits trim-restore-start anchors when current start is not at originalPoints[0]', () => {
    // workingPoints starts at originalPoints[2] — first 2 original points
    // were trimmed off and become trim-restore-start candidates.
    const original = [
      { lng: 174.78, lat: -41.29 }, // 0 — trimmed
      { lng: 174.781, lat: -41.291 }, // 1 — trimmed
      { lng: 174.782, lat: -41.292 }, // 2 — current start
      { lng: 174.783, lat: -41.293 }, // 3 — current end
    ];
    const result = computeRouteNodeAnchors({
      workingPoints: [original[2], original[3]],
      originalPoints: original,
      trailGraph: null,
    });
    const restoreStarts = result.filter(a => a.kind === 'trim-restore-start');
    expect(restoreStarts).toHaveLength(2);
    expect(restoreStarts[0].originalPointIdx).toBe(0);
    expect(restoreStarts[1].originalPointIdx).toBe(1);
    // Trim-restore-end should be empty (current end is originalPoints[last]).
    expect(result.filter(a => a.kind === 'trim-restore-end')).toHaveLength(0);
  });

  it('emits trim-restore-end anchors when current end is not at originalPoints[last]', () => {
    const original = [
      { lng: 174.78, lat: -41.29 }, // 0 — current start
      { lng: 174.781, lat: -41.291 }, // 1 — current end
      { lng: 174.782, lat: -41.292 }, // 2 — trimmed
      { lng: 174.783, lat: -41.293 }, // 3 — trimmed
    ];
    const result = computeRouteNodeAnchors({
      workingPoints: [original[0], original[1]],
      originalPoints: original,
      trailGraph: null,
    });
    const restoreEnds = result.filter(a => a.kind === 'trim-restore-end');
    expect(restoreEnds).toHaveLength(2);
    expect(restoreEnds[0].originalPointIdx).toBe(2);
    expect(restoreEnds[1].originalPointIdx).toBe(3);
    expect(result.filter(a => a.kind === 'trim-restore-start')).toHaveLength(0);
  });

  it('skips trim-restore anchors when workingPoints[0] does not match any originalPoints (e.g. midpoint replacement inserted non-original geometry)', () => {
    // workingPoints[0] is a non-original point — findIndexNear returns null,
    // trim-restore-start/end are not emitted.
    const result = computeRouteNodeAnchors({
      workingPoints: [
        { lng: 999.999, lat: -41.29 }, // not in originalPoints
        { lng: 174.79, lat: -41.30 },
      ],
      originalPoints: [
        { lng: 174.78, lat: -41.29 },
        { lng: 174.79, lat: -41.30 },
      ],
      trailGraph: null,
    });
    expect(result.filter(a => a.kind === 'trim-restore-start')).toHaveLength(0);
    expect(result.filter(a => a.kind === 'trim-restore-end')).toHaveLength(0);
  });
});
