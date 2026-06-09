// SPIKE-066-B benchmark — Self-implemented Dijkstra on Node.js
// Pure JS version of BinaryHeap + Dijkstra for benchmarking.

class BinaryHeap {
  constructor() {
    this.heap = [];
    this.indexMap = new Map();
  }
  size() { return this.heap.length; }
  isEmpty() { return this.heap.length === 0; }

  push(item, priority) {
    this.heap.push({ item, priority });
    const idx = this.heap.length - 1;
    this.indexMap.set(item, idx);
    this.siftUp(idx);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop();
    this.indexMap.delete(top.item);
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indexMap.set(last.item, 0);
      this.siftDown(0);
    }
    return top.item;
  }

  decreaseKey(item, newPriority) {
    const idx = this.indexMap.get(item);
    if (idx === undefined) {
      this.push(item, newPriority);
      return true;
    }
    if (newPriority >= this.heap[idx].priority) return false;
    this.heap[idx].priority = newPriority;
    this.siftUp(idx);
    return true;
  }

  siftUp(idx) {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[parentIdx].priority <= this.heap[idx].priority) break;
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  siftDown(idx) {
    const n = this.heap.length;
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  swap(i, j) {
    const a = this.heap[i], b = this.heap[j];
    this.heap[i] = b; this.heap[j] = a;
    this.indexMap.set(a.item, j); this.indexMap.set(b.item, i);
  }
}

function dijkstra(nodes, sourceId, earlyExitTargetId) {
  const distances = new Map();
  const predecessors = new Map();
  const visited = new Set();
  for (const id of nodes.keys()) {
    distances.set(id, Infinity);
    predecessors.set(id, null);
  }
  distances.set(sourceId, 0);
  const heap = new BinaryHeap();
  heap.push(sourceId, 0);
  while (!heap.isEmpty()) {
    const u = heap.pop();
    if (u == null) break;
    if (visited.has(u)) continue;
    visited.add(u);
    if (earlyExitTargetId && u === earlyExitTargetId) break;
    const node = nodes.get(u);
    if (!node) continue;
    const distU = distances.get(u);
    for (const edge of node.edges) {
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
  return { distances, predecessors };
}

function reconstructPath(predecessors, sourceId, targetId) {
  if (sourceId === targetId) return [sourceId];
  const path = [];
  let current = targetId;
  while (current != null && current !== sourceId) {
    path.unshift(current);
    current = predecessors.get(current) ?? null;
  }
  if (current !== sourceId) return null;
  path.unshift(sourceId);
  return path;
}

function generateGraph(numNodes, avgDegree = 3) {
  const nodes = new Map();
  for (let i = 0; i < numNodes; i++) {
    nodes.set(`n${i}`, { id: `n${i}`, edges: [] });
  }
  for (let i = 0; i < numNodes - 1; i++) {
    const w = Math.random() * 1000 + 50;
    nodes.get(`n${i}`).edges.push({ to: `n${i+1}`, weight: w });
    nodes.get(`n${i+1}`).edges.push({ to: `n${i}`, weight: w });
  }
  const extraEdges = Math.floor((numNodes * avgDegree) / 2) - (numNodes - 1);
  for (let e = 0; e < extraEdges; e++) {
    const a = Math.floor(Math.random() * numNodes);
    const b = Math.floor(Math.random() * numNodes);
    if (a === b) continue;
    const w = Math.random() * 1000 + 50;
    nodes.get(`n${a}`).edges.push({ to: `n${b}`, weight: w });
    nodes.get(`n${b}`).edges.push({ to: `n${a}`, weight: w });
  }
  return nodes;
}

function bench(numNodes, runs = 100) {
  const graph = generateGraph(numNodes);
  const nodeIds = Array.from(graph.keys());
  const times = [];
  for (let r = 0; r < runs; r++) {
    const source = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    const target = nodeIds[Math.floor(Math.random() * nodeIds.length)];
    const t0 = performance.now();
    const result = dijkstra(graph, source, target);
    const path = reconstructPath(result.predecessors, source, target);
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`${numNodes} nodes (${runs} runs): P50=${p50.toFixed(2)}ms P95=${p95.toFixed(2)}ms P99=${p99.toFixed(2)}ms avg=${avg.toFixed(2)}ms`);
  return { numNodes, p50, p95, p99, avg };
}

console.log('SPIKE-066-B: Dijkstra benchmark on Node.js ' + process.version);
console.log('Hermes is typically 2-3x slower than Node.js V8.\n');
const results = [];
results.push(bench(300, 200));
results.push(bench(500, 100));
results.push(bench(1000, 100));
results.push(bench(5000, 50));
results.push(bench(10000, 30));

console.log('\n=== VIABLE 判定 ===');
console.log('Plan v3.1 standard: 300-node corridor query <100ms on iPhone 12 Hermes');
console.log('Conservative Hermes estimate: Node.js × 3');

const r300 = results[0];
const hermes_p95 = r300.p95 * 3;
console.log(`\n300-node Node.js P95: ${r300.p95.toFixed(2)}ms`);
console.log(`Estimated Hermes P95 (×3): ${hermes_p95.toFixed(2)}ms`);
console.log(`VIABLE 判定: ${hermes_p95 < 100 ? 'VIABLE ✅' : 'NEEDS OPTIMIZATION ⚠️'}`);
