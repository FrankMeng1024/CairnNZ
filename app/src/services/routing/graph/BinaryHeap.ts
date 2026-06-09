/**
 * BinaryHeap — Min-heap priority queue for Dijkstra.
 *
 * SPIKE-066-B 草稿 (will move to app/src/services/routing/graph/BinaryHeap.ts)
 *
 * Operations:
 *   - push(item, priority): O(log n)
 *   - pop(): returns lowest-priority item, O(log n)
 *   - decreaseKey(item, newPriority): O(log n) — required for Dijkstra optimization
 *   - size(): O(1)
 *   - isEmpty(): O(1)
 *
 * Index map for decreaseKey: O(1) lookup of item position in heap array.
 */

interface HeapEntry<T> {
  item: T;
  priority: number;
}

export class BinaryHeap<T> {
  private heap: HeapEntry<T>[] = [];
  // Map item → index in heap array (for decreaseKey).
  // Caller must provide stable item key (e.g., string).
  private indexMap: Map<string, number> = new Map();
  private getKey: (item: T) => string;

  constructor(getKey: (item: T) => string) {
    this.getKey = getKey;
  }

  size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  push(item: T, priority: number): void {
    const key = this.getKey(item);
    // v4-audit (ARCH-006): mirror decreaseKey's behavior when the key
    // already exists. Old code unconditionally appended + overwrote
    // indexMap, leaving the prior heap slot orphaned and breaking pop
    // ordering for that key.
    const existingIdx = this.indexMap.get(key);
    if (existingIdx !== undefined) {
      const existing = this.heap[existingIdx];
      if (priority < existing.priority) {
        existing.priority = priority;
        this.siftUp(existingIdx);
      } else if (priority > existing.priority) {
        existing.priority = priority;
        this.siftDown(existingIdx);
      }
      return;
    }
    this.heap.push({ item, priority });
    const idx = this.heap.length - 1;
    this.indexMap.set(key, idx);
    this.siftUp(idx);
  }

  pop(): T | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    this.indexMap.delete(this.getKey(top.item));
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.indexMap.set(this.getKey(last.item), 0);
      this.siftDown(0);
    }
    return top.item;
  }

  /** Returns true if the priority was decreased (or item was added). */
  decreaseKey(item: T, newPriority: number): boolean {
    const key = this.getKey(item);
    const idx = this.indexMap.get(key);
    if (idx === undefined) {
      // Not in heap — push it
      this.push(item, newPriority);
      return true;
    }
    if (newPriority >= this.heap[idx].priority) {
      return false; // No improvement
    }
    this.heap[idx].priority = newPriority;
    this.siftUp(idx);
    return true;
  }

  has(item: T): boolean {
    return this.indexMap.has(this.getKey(item));
  }

  private siftUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[parentIdx].priority <= this.heap[idx].priority) break;
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  private siftDown(idx: number): void {
    const n = this.heap.length;
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      if (left < n && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }
      if (right < n && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }
      if (smallest === idx) break;
      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const a = this.heap[i];
    const b = this.heap[j];
    this.heap[i] = b;
    this.heap[j] = a;
    this.indexMap.set(this.getKey(a.item), j);
    this.indexMap.set(this.getKey(b.item), i);
  }
}
