/**
 * Dijkstra — Single-source shortest path on weighted graph.
 *
 * SPIKE-066-B 草稿 (will move to app/src/services/routing/graph/Dijkstra.ts)
 *
 * Time complexity: O((V + E) log V) using binary heap.
 *
 * For Cairn corridor query (~300 nodes, ~3 neighbors each):
 *   ~300 nodes × log(300) ≈ ~2500 heap ops + ~900 edge relaxations
 *   Expected: 20-50ms on iPhone 12 Hermes (target <100ms)
 */

import { BinaryHeap } from './BinaryHeap';
import { logDijkstraDuration, logDijkstraNodeCountP95 } from '../editAnalytics';

export interface GraphNode {
  id: string;
  // Adjacency: list of { to, weight }
  edges: Array<{ to: string; weight: number }>;
}

export interface DijkstraResult {
  /** Map node id → shortest distance from source. Infinity if unreachable. */
  distances: Map<string, number>;
  /** Map node id → predecessor on shortest path. null = source or unreachable. */
  predecessors: Map<string, string | null>;
}

/**
 * Run Dijkstra from sourceId.
 *
 * @param nodes  Map<nodeId, GraphNode>
 * @param sourceId  Starting node ID
 * @param earlyExitTargetId  Optional. Stop search when this target is finalized (faster).
 */
export function dijkstra(
  nodes: Map<string, GraphNode>,
  sourceId: string,
  earlyExitTargetId?: string,
): DijkstraResult {
  const t0 = Date.now();
  const distances = new Map<string, number>();
  const predecessors = new Map<string, string | null>();
  const visited = new Set<string>();

  // Initialize
  for (const id of nodes.keys()) {
    distances.set(id, Infinity);
    predecessors.set(id, null);
  }
  distances.set(sourceId, 0);

  const heap = new BinaryHeap<string>((id) => id);
  heap.push(sourceId, 0);

  let edgeCount = 0;
  while (!heap.isEmpty()) {
    const u = heap.pop();
    if (u == null) break;
    if (visited.has(u)) continue;
    visited.add(u);

    if (earlyExitTargetId && u === earlyExitTargetId) break;

    const node = nodes.get(u);
    if (!node) continue;

    const distU = distances.get(u)!;
    for (const edge of node.edges) {
      edgeCount++;
      if (visited.has(edge.to)) continue;
      const newDist = distU + edge.weight;
      const oldDist = distances.get(edge.to) ?? Infinity;
      if (newDist < oldDist) {
        distances.set(edge.to, newDist);
        predecessors.set(edge.to, u);
        heap.decreaseKey(edge.to, newDist);
      }
    }
  }

  // Sprint 66 Fix-14 (C-NEW-2): Telemetry for Spike B perf claim verification
  // and Sprint 67 NOT-VIABLE-B fallback decision (node-cap > 500 trigger).
  const ms = Date.now() - t0;
  logDijkstraDuration({ nodeCount: nodes.size, edgeCount, ms });
  logDijkstraNodeCountP95({ nodeCount: nodes.size });

  return { distances, predecessors };
}

/**
 * Reconstruct shortest path from source → target.
 * Returns null if no path exists.
 */
export function reconstructPath(
  predecessors: Map<string, string | null>,
  sourceId: string,
  targetId: string,
): string[] | null {
  if (sourceId === targetId) return [sourceId];
  const path: string[] = [];
  let current: string | null = targetId;
  while (current != null && current !== sourceId) {
    path.unshift(current);
    current = predecessors.get(current) ?? null;
  }
  if (current !== sourceId) return null; // unreachable
  path.unshift(sourceId);
  return path;
}
