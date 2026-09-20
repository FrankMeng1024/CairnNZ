import {
  executeCairnCommit,
  resetCairnCommitForNewContext,
  type CairnCommitGate,
} from '../cairnCommitBoundary';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Personal Cairn single-flight transaction boundary', () => {
  test('Run same-tick double tap performs one durable attempt and one UUID-producing commit', async () => {
    const gate: CairnCommitGate = { current: null };
    const durable = deferred<{ markerId: string }>();
    const commit = jest.fn(() => durable.promise);
    const feedback = jest.fn();
    const first = executeCairnCommit({
      gate,
      commit,
      isContextCurrent: () => true,
      onCommittedCurrent: feedback,
      releaseOnCommittedCurrent: true,
    });
    const second = executeCairnCommit({
      gate,
      commit,
      isContextCurrent: () => true,
      onCommittedCurrent: feedback,
      releaseOnCommittedCurrent: true,
    });

    expect(commit).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe('ignored');
    durable.resolve({ markerId: 'only-cairn' });
    await expect(first).resolves.toBe('committed-current');
    expect(feedback).toHaveBeenCalledTimes(1);
    expect(gate.current).toBeNull();
  });

  test('a true pre-commit failure releases the exact attempt for one retry', async () => {
    const gate: CairnCommitGate = { current: null };
    const failure = jest.fn();
    const commit = jest.fn()
      .mockRejectedValueOnce(new Error('storage full'))
      .mockResolvedValueOnce({ markerId: 'retry-cairn' });
    const options = {
      gate,
      commit,
      isContextCurrent: () => true,
      onPreCommitFailure: failure,
      releaseOnCommittedCurrent: true,
    };

    await expect(executeCairnCommit(options)).resolves.toBe('precommit-failed-current');
    expect(gate.current).toBeNull();
    await expect(executeCairnCommit(options)).resolves.toBe('committed-current');
    expect(commit).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledTimes(1);
  });

  test('an owner change while failure handling awaits cannot publish or unlock the stale attempt', async () => {
    const gate: CairnCommitGate = { current: null };
    const failureHandling = deferred<void>();
    let current = true;
    const lockChanges = jest.fn();
    const committing = executeCairnCommit({
      gate,
      commit: async () => { throw new Error('storage full'); },
      isContextCurrent: () => current,
      onLockChange: lockChanges,
      onPreCommitFailure: async () => failureHandling.promise,
      releaseOnCommittedCurrent: true,
    });
    await Promise.resolve();
    current = false;
    failureHandling.resolve();

    await expect(committing).resolves.toBe('precommit-failed-stale');
    expect(gate.current).not.toBeNull();
    expect(lockChanges.mock.calls).toEqual([[true]]);
  });

  test('durable acceptance after S1 becomes S2 produces no stale link or feedback and cannot unlock S1', async () => {
    const gate: CairnCommitGate = { current: null };
    const durable = deferred<{ markerId: string }>();
    let current = true;
    const link = jest.fn();
    const feedback = jest.fn();
    const committing = executeCairnCommit({
      gate,
      commit: () => durable.promise,
      isContextCurrent: () => current,
      onCommittedCurrent: async result => {
        link(result.markerId);
        feedback('saved');
      },
      releaseOnCommittedCurrent: true,
    });
    current = false;
    durable.resolve({ markerId: 'late-s1-cairn' });

    await expect(committing).resolves.toBe('committed-stale');
    expect(link).not.toHaveBeenCalled();
    expect(feedback).not.toHaveBeenCalled();
    expect(gate.current).not.toBeNull();
    resetCairnCommitForNewContext(gate);
    expect(gate.current).toBeNull();
  });

  test('post-commit navigation failure remains committed and never invokes retryable failure handling', async () => {
    const gate: CairnCommitGate = { current: null };
    const retryableFailure = jest.fn();
    const postCommitFailure = jest.fn();

    await expect(executeCairnCommit({
      gate,
      commit: async () => ({ markerId: 'committed-cairn' }),
      isContextCurrent: () => true,
      onCommittedCurrent: () => { throw new Error('navigation gone'); },
      onPreCommitFailure: retryableFailure,
      onPostCommitFailure: postCommitFailure,
      releaseOnCommittedCurrent: false,
    })).resolves.toBe('committed-side-effect-failed');
    expect(retryableFailure).not.toHaveBeenCalled();
    expect(postCommitFailure).toHaveBeenCalledWith(expect.any(Error));
    expect(gate.current).not.toBeNull();
  });
});
