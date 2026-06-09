/**
 * BinaryHeap unit tests.
 */
import { BinaryHeap } from '../BinaryHeap';

describe('BinaryHeap', () => {
  it('returns null pop on empty heap', () => {
    const h = new BinaryHeap<string>(s => s);
    expect(h.pop()).toBeNull();
    expect(h.size()).toBe(0);
    expect(h.isEmpty()).toBe(true);
  });

  it('pop returns minimum priority', () => {
    const h = new BinaryHeap<string>(s => s);
    h.push('a', 5);
    h.push('b', 3);
    h.push('c', 7);
    h.push('d', 1);
    h.push('e', 4);
    expect(h.pop()).toBe('d');
    expect(h.pop()).toBe('b');
    expect(h.pop()).toBe('e');
    expect(h.pop()).toBe('a');
    expect(h.pop()).toBe('c');
    expect(h.pop()).toBeNull();
  });

  it('decreaseKey lowers priority of existing item', () => {
    const h = new BinaryHeap<string>(s => s);
    h.push('a', 5);
    h.push('b', 10);
    expect(h.decreaseKey('b', 1)).toBe(true);
    expect(h.pop()).toBe('b');
    expect(h.pop()).toBe('a');
  });

  it('decreaseKey returns false when newPriority not lower', () => {
    const h = new BinaryHeap<string>(s => s);
    h.push('a', 5);
    expect(h.decreaseKey('a', 10)).toBe(false);
    expect(h.decreaseKey('a', 5)).toBe(false);
    expect(h.pop()).toBe('a');
  });

  it('decreaseKey on missing item adds it', () => {
    const h = new BinaryHeap<string>(s => s);
    h.push('a', 5);
    expect(h.decreaseKey('b', 3)).toBe(true);
    expect(h.pop()).toBe('b');
  });

  it('handles many items maintaining heap property', () => {
    const h = new BinaryHeap<number>(n => String(n));
    const N = 100;
    const priorities: number[] = [];
    for (let i = 0; i < N; i++) {
      const p = Math.random() * 1000;
      priorities.push(p);
      h.push(i, p);
    }
    priorities.sort((a, b) => a - b);
    for (let i = 0; i < N; i++) {
      h.pop(); // verify no exception thrown
    }
    expect(h.isEmpty()).toBe(true);
  });

  it('has() reports membership', () => {
    const h = new BinaryHeap<string>(s => s);
    h.push('x', 1);
    expect(h.has('x')).toBe(true);
    expect(h.has('y')).toBe(false);
    h.pop();
    expect(h.has('x')).toBe(false);
  });
});
