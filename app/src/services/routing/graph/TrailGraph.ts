/**
 * TrailGraph — Build a navigable graph from DOC trail polylines.
 *
 * Each trail polyline becomes a chain of edges between consecutive vertices.
 * Junction detection: vertices within JUNCTION_THRESHOLD_M of each other
 * are merged into one logical node via union-find (Sprint 66 Fix-17 C1:
 * naive single-pass O(N²) lacked transitivity — A↔B and B↔C did not
 * imply A↔C).
 *
 * Spatial index (kdbush) accelerates the merge from O(N²) to O(N log N)
 * (Sprint 66 Fix-19 C3).
 *
 * Sprint 66 Wave 3.
 */

import KDBush from 'kdbush';
import { dijkstra, reconstructPath, GraphNode } from '../graph/Dijkstra';
import { densify, flattenGeometryToParts, haversineMeters, LngLat } from '../corridor/PolylineSampler';
import { metersToDegrees } from '../corridor/PointCloudIndex';
import type { DOCTrailFeature } from '../doctrails/DOCTrailsTypes';

const DENSIFY_INTERVAL_M = 10;
const JUNCTION_THRESHOLD_M = 30;
const MAX_GRAPH_NODES = 500; // Plan v3.1 §18 NOT VIABLE fallback cap

export interface TrailNodeMeta {
  id: string;
  lng: number;
  lat: number;
  /** Trails passing through this node (for source attribution). */
  trailIds: string[];
}

// ── Union-Find (disjoint-set) ──────────────────────────────────────────
// Lightweight inline implementation to avoid a new dependency.
class UnionFind {
  private parent: number[];
  private rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path compression
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // union by rank
    if (this.rank[rootA] < this.rank[rootB]) {
      this.parent[rootA] = rootB;
    } else if (this.rank[rootA] > this.rank[rootB]) {
      this.parent[rootB] = rootA;
    } else {
      this.parent[rootB] = rootA;
      this.rank[rootA]++;
    }
  }
}

export class TrailGraph {
  /** Map nodeId → GraphNode (adjacency lists). */
  nodes: Map<string, GraphNode> = new Map();
  /** Map nodeId → metadata (lng/lat/trailIds). */
  meta: Map<string, TrailNodeMeta> = new Map();
  /** True if graph hit MAX_GRAPH_NODES cap. Sprint 66 Fix-18 (C2): caller MUST surface. */
  truncated: boolean = false;

  /**
   * Build from a list of DOC trail features.
   * Trails are densified, then junction merge runs via kdbush + union-find.
   */
  static fromTrails(trails: DOCTrailFeature[]): TrailGraph {
    const g = new TrailGraph();

    // Step 1: collect vertices per trail-PART (post-merge audit FUNC-010:
    // each MultiLineString part is densified separately so no fake edges
    // bridge real-world gaps between parts).
    //
    // v3-audit (ARCH-010): trailId is the PART identifier (trackId:partIdx),
    // not the feature trackId. A real T-junction inside a single
    // MultiLineString feature (two parts touching at an interior point)
    // is now allowed to merge across parts because their trailIds differ.
    // Without this, all parts of one DOC feature shared the same trackId
    // and the cross-trail-only junction rule prevented the merge,
    // leaving the parts as disjoint graph islands.
    interface RawVertex {
      lng: number;
      lat: number;
      trailId: string;       // unique per part (trackId:partIdx)
      featureTrackId: string; // original DOC OBJECTID, retained for meta
    }
    const trailParts: RawVertex[][] = [];
    for (const trail of trails) {
      const parts = flattenGeometryToParts(trail.geometry);
      parts.forEach((part, partIdx) => {
        if (part.length < 2) return;
        const dense = densify(part, DENSIFY_INTERVAL_M);
        const partTrailId = `${trail.trackId}:${partIdx}`;
        trailParts.push(
          dense.map(p => ({
            lng: p.lng,
            lat: p.lat,
            trailId: partTrailId,
            featureTrackId: trail.trackId,
          })),
        );
      });
    }
    const allVerts: RawVertex[] = trailParts.flat();
    if (allVerts.length === 0) return g;

    // Step 2: build kdbush spatial index over all vertices
    // (Fix-19 C3: O(N²) → O(N log N))
    const kd = new KDBush(allVerts.length);
    for (const v of allVerts) kd.add(v.lng, v.lat);
    kd.finish();

    // Step 3: union-find merge for junctions
    // (Fix-17 C1: ensures transitivity — A↔B + B↔C ⇒ A↔C in same set)
    //
    // Important: only merge vertices from DIFFERENT trail PARTS (trailId
    // is per-part). Densified points within one part are 10m apart by
    // design and would collapse the entire part into one node if
    // union-find treated them as junctions.
    //
    // v3-audit (ARCH-013): per-vertex radiusDeg using each query point's
    // own latitude — global meanLat over-fetches at lat extremes and
    // can degrade the merge to near-O(N²) on datasets spanning >10° lat.
    const uf = new UnionFind(allVerts.length);
    for (let i = 0; i < allVerts.length; i++) {
      const a = allVerts[i];
      const radiusDeg = metersToDegrees(JUNCTION_THRESHOLD_M, a.lat);
      const candidates = kd.within(a.lng, a.lat, radiusDeg);
      for (const j of candidates) {
        if (j <= i) continue;
        const b = allVerts[j];
        if (a.trailId === b.trailId) continue;
        if (haversineMeters(a, b) <= JUNCTION_THRESHOLD_M) {
          uf.union(i, j);
        }
      }
    }

    // Step 4: assign one logical node per union-find root
    // Truncation: if # of distinct roots > MAX_GRAPH_NODES, route the
    // overflow into a single shared "truncated-tail" bucket node so that
    // long parts beyond the cap remain CONNECTED (over-merged but
    // reachable), instead of becoming silent islands the Dijkstra
    // can never traverse.
    //
    // v2-audit (ARCH-005): old logic skipped vertex emission for any
    // truncated root, then step 5 dropped any edge with a truncated
    // endpoint. A long single trail-part beyond the cap had every
    // consecutive pair (i, i+1) with at least one truncated side, so the
    // entire post-cap section was disconnected. Now we route overflow
    // roots to a shared bucket node; consecutive vertices in the same
    // part still have edges (via the bucket).
    const rootToNodeId = new Map<number, string>();
    const nodeIdForIdx = new Map<number, string>(); // i → nodeId (string)
    let nextNodeIdNum = 0;
    const TRUNCATED_BUCKET_ID = 'tnTRUNC';
    for (let i = 0; i < allVerts.length; i++) {
      const root = uf.find(i);
      let nodeId = rootToNodeId.get(root);
      if (!nodeId) {
        if (g.nodes.size >= MAX_GRAPH_NODES) {
          g.truncated = true;
          // Lazily create the truncated bucket node on first overflow.
          // It pools every overflow vertex's coordinates into a single
          // logical node — coordinates are arbitrary (use the first
          // overflow vertex), and trailIds accumulate.
          if (!g.nodes.has(TRUNCATED_BUCKET_ID)) {
            const v = allVerts[i];
            g.meta.set(TRUNCATED_BUCKET_ID, {
              id: TRUNCATED_BUCKET_ID,
              lng: v.lng,
              lat: v.lat,
              trailIds: [v.featureTrackId],
            });
            g.nodes.set(TRUNCATED_BUCKET_ID, { id: TRUNCATED_BUCKET_ID, edges: [] });
          } else {
            const m = g.meta.get(TRUNCATED_BUCKET_ID);
            const v = allVerts[i];
            if (m && !m.trailIds.includes(v.featureTrackId)) m.trailIds.push(v.featureTrackId);
          }
          rootToNodeId.set(root, TRUNCATED_BUCKET_ID);
          nodeIdForIdx.set(i, TRUNCATED_BUCKET_ID);
          continue;
        }
        nodeId = `tn${nextNodeIdNum++}`;
        rootToNodeId.set(root, nodeId);
        const v = allVerts[i];
        g.meta.set(nodeId, { id: nodeId, lng: v.lng, lat: v.lat, trailIds: [v.featureTrackId] });
        g.nodes.set(nodeId, { id: nodeId, edges: [] });
      } else {
        // Add this featureTrackId to the existing node's trails (deduped).
        const meta = g.meta.get(nodeId);
        const v = allVerts[i];
        if (meta && !meta.trailIds.includes(v.featureTrackId)) meta.trailIds.push(v.featureTrackId);
      }
      nodeIdForIdx.set(i, nodeId);
    }

    // Step 5: build edges within each trail PART's vertex sequence
    // (post-merge audit FUNC-010: only consecutive vertices inside a part
    // get an edge — gaps between MultiLineString parts produce no edge).
    //
    // v2-audit (ARCH-005): when one or both endpoints map to the
    // truncated bucket, we still emit an edge (with conservative weight
    // 0 between same-bucket vertices, or the haversine weight when
    // crossing into the bucket). This preserves connectivity at the
    // expense of routing precision near the cap — acceptable per the
    // truncated flag's design intent.
    // v5-audit (FUNC-004): removed dead partTouchedBucket /
    // partEmittedNonSelfEdge tracking. shortestPath bucket-reject is
    // the safety net — fully-bucketed parts are correctly unreachable
    // by Dijkstra (refused at the entry/exit guards) so no extra
    // bookkeeping is needed.
    let vertCursor = 0;
    for (const partV of trailParts) {
      for (let i = 1; i < partV.length; i++) {
        const aIdx = vertCursor + i - 1;
        const bIdx = vertCursor + i;
        const aId = nodeIdForIdx.get(aIdx);
        const bId = nodeIdForIdx.get(bIdx);
        if (!aId || !bId) continue;
        if (aId === bId) continue;
        const aMeta = g.meta.get(aId);
        const bMeta = g.meta.get(bId);
        if (!aMeta || !bMeta) continue;
        const isTruncEdge = aId === TRUNCATED_BUCKET_ID || bId === TRUNCATED_BUCKET_ID;
        const w = isTruncEdge
          ? haversineMeters(partV[i - 1], partV[i])
          : haversineMeters(aMeta, bMeta);
        const aNode = g.nodes.get(aId)!;
        const bNode = g.nodes.get(bId)!;
        if (!aNode.edges.find(e => e.to === bId)) aNode.edges.push({ to: bId, weight: w });
        if (!bNode.edges.find(e => e.to === aId)) bNode.edges.push({ to: aId, weight: w });
      }
      vertCursor += partV.length;
    }

    return g;
  }

  /**
   * Snap an arbitrary lng/lat to the nearest graph node.
   * O(N) — for small graphs (≤500 nodes) this is fine.
   *
   * v3-audit (FUNC-005): never snap to the truncated bucket — its
   * coords are arbitrary (the first overflow vertex's lng/lat) and
   * snapping to it would teleport routes by potentially many km.
   */
  snapToGraph(lng: number, lat: number): { nodeId: string; distance: number } | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const m of this.meta.values()) {
      if (m.id === 'tnTRUNC') continue;
      const d = haversineMeters({ lng, lat }, { lng: m.lng, lat: m.lat });
      if (d < bestDist) {
        bestDist = d;
        bestId = m.id;
      }
    }
    if (!bestId) return null;
    return { nodeId: bestId, distance: bestDist };
  }

  /**
   * Compute shortest path between two graph nodes.
   * Returns ordered list of LngLat (geometry of the path).
   *
   * v3-audit (FUNC-005): if the path traverses the truncated bucket
   * node, the bucket's stored coords are arbitrary and the resulting
   * geometry would teleport across hundreds of meters or km. Refuse
   * such paths so the caller (DualSourceRouter) falls back to Mapbox
   * or straight-line, which give honest geometry.
   */
  shortestPath(fromId: string, toId: string): LngLat[] | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) return null;
    if (fromId === 'tnTRUNC' || toId === 'tnTRUNC') return null;
    const result = dijkstra(this.nodes, fromId, toId);
    const ids = reconstructPath(result.predecessors, fromId, toId);
    if (!ids) return null;
    if (ids.includes('tnTRUNC')) return null;
    const out: LngLat[] = [];
    for (const id of ids) {
      const m = this.meta.get(id);
      if (m) out.push({ lng: m.lng, lat: m.lat });
    }
    return out;
  }

  size(): number {
    return this.nodes.size;
  }
}
