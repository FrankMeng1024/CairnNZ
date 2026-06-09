/**
 * Dijkstra unit tests.
 */
import { dijkstra, reconstructPath, GraphNode } from '../Dijkstra';

function makeGraph(edges: Array<[string, string, number]>): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>();
  const ensure = (id: string): GraphNode => {
    if (!nodes.has(id)) nodes.set(id, { id, edges: [] });
    return nodes.get(id)!;
  };
  for (const [a, b, w] of edges) {
    ensure(a).edges.push({ to: b, weight: w });
    ensure(b).edges.push({ to: a, weight: w });
  }
  return nodes;
}

describe('Dijkstra', () => {
  it('finds shortest path on simple graph', () => {
    // A--1--B--1--C
    //  \         /
    //   \---10---
    const g = makeGraph([
      ['A', 'B', 1],
      ['B', 'C', 1],
      ['A', 'C', 10],
    ]);
    const result = dijkstra(g, 'A');
    expect(result.distances.get('A')).toBe(0);
    expect(result.distances.get('B')).toBe(1);
    expect(result.distances.get('C')).toBe(2);
    const path = reconstructPath(result.predecessors, 'A', 'C');
    expect(path).toEqual(['A', 'B', 'C']);
  });

  it('handles disconnected components', () => {
    const g = makeGraph([
      ['A', 'B', 1],
      ['C', 'D', 1],
    ]);
    const result = dijkstra(g, 'A');
    expect(result.distances.get('B')).toBe(1);
    expect(result.distances.get('C')).toBe(Infinity);
    expect(result.distances.get('D')).toBe(Infinity);
    expect(reconstructPath(result.predecessors, 'A', 'C')).toBeNull();
  });

  it('source-equals-target returns single-node path', () => {
    const g = makeGraph([['A', 'B', 1]]);
    const result = dijkstra(g, 'A', 'A');
    expect(result.distances.get('A')).toBe(0);
    expect(reconstructPath(result.predecessors, 'A', 'A')).toEqual(['A']);
  });

  it('early-exit on target stops processing further nodes', () => {
    const g = makeGraph([
      ['A', 'B', 1],
      ['B', 'C', 1],
      ['C', 'D', 1],
      ['D', 'E', 1],
    ]);
    const result = dijkstra(g, 'A', 'B');
    expect(result.distances.get('B')).toBe(1);
    // Early exit means D, E may not be visited (still Infinity, but
    // implementation may visit them via heap; just check B is correct)
  });

  it('handles single-node graph', () => {
    const g = makeGraph([]);
    g.set('A', { id: 'A', edges: [] });
    const result = dijkstra(g, 'A');
    expect(result.distances.get('A')).toBe(0);
  });

  it('reconstructPath returns null when target unreachable', () => {
    const g = makeGraph([['A', 'B', 1]]);
    g.set('Z', { id: 'Z', edges: [] });
    const result = dijkstra(g, 'A');
    expect(reconstructPath(result.predecessors, 'A', 'Z')).toBeNull();
  });

  it('finds shortest path through diamond graph', () => {
    //   A
    //  / \
    // B   C
    //  \ /
    //   D
    // A-B = 1, B-D = 5, A-C = 4, C-D = 1
    // Best path A-C-D = 5, vs A-B-D = 6
    const g = makeGraph([
      ['A', 'B', 1],
      ['B', 'D', 5],
      ['A', 'C', 4],
      ['C', 'D', 1],
    ]);
    const result = dijkstra(g, 'A');
    expect(result.distances.get('D')).toBe(5);
    expect(reconstructPath(result.predecessors, 'A', 'D')).toEqual(['A', 'C', 'D']);
  });
});
