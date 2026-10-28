import { createActivityActivationQueue } from '../activityActivationQueue';

describe('Activity native activation queue', () => {
  test('a never-settling native call times out and cannot imprison recovery', async () => {
    jest.useFakeTimers();
    try {
      const timeouts: number[] = [];
      let firstLeaseCurrent: (() => boolean) | null = null;
      const queue = createActivityActivationQueue({
        timeoutMs: 5_000,
        onTimeout: generation => timeouts.push(generation),
        onError: () => undefined,
      });
      const first = queue.enqueue(async lease => {
        firstLeaseCurrent = lease.isCurrent;
        await new Promise<void>(() => undefined);
      });
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(5_001);
      await expect(first).resolves.toBeUndefined();

      let recovered = false;
      await expect(queue.enqueue(async lease => {
        expect(lease.isCurrent()).toBe(true);
        recovered = true;
      })).resolves.toBeUndefined();
      expect(recovered).toBe(true);
      expect(timeouts).toEqual([1]);
      expect(firstLeaseCurrent).not.toBeNull();
      expect((firstLeaseCurrent as unknown as () => boolean)()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a newer command fences a late older operation before it settles', async () => {
    jest.useFakeTimers();
    try {
      let release!: () => void;
      let olderStillCurrent = true;
      const queue = createActivityActivationQueue({
        timeoutMs: 5_000,
        onTimeout: () => undefined,
        onError: () => undefined,
      });
      const older = queue.enqueue(async lease => {
        await new Promise<void>(resolve => { release = resolve; });
        olderStillCurrent = lease.isCurrent();
      });
      for (let turn = 0; turn < 10 && !release; turn += 1) await Promise.resolve();
      expect(release).toBeDefined();
      const newer = queue.enqueue(async () => undefined);
      release();
      await older;
      await newer;
      expect(olderStillCurrent).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
