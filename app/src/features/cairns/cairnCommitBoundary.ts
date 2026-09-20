/**
 * A Cairn create becomes accepted at the local outbox write, not at later UI
 * feedback or navigation. This helper keeps those phases separate while a
 * synchronous token coalesces same-tick presses.
 */
export interface CairnCommitGate {
  current: symbol | null;
}

export type CairnCommitOutcome =
  | 'ignored'
  | 'precommit-failed-current'
  | 'precommit-failed-stale'
  | 'committed-current'
  | 'committed-stale'
  | 'committed-side-effect-failed';

interface ExecuteCairnCommitOptions<T> {
  gate: CairnCommitGate;
  commit: () => Promise<T>;
  isContextCurrent: () => boolean;
  onLockChange?: (locked: boolean) => void;
  onPreCommitFailure?: (error: unknown, contextCurrent: boolean) => void | Promise<void>;
  /** Durable housekeeping (for example clearing the initiating owner's
   * retry draft) runs even when the visible owner/Activity has changed. */
  onCommitted?: (result: T) => void | Promise<void>;
  onCommittedCurrent?: (result: T) => void | Promise<void>;
  onPostCommitFailure?: (error: unknown) => void;
  /** Run may accept another deliberate Cairn after success. Full Plant owns
   * one submit and navigates away, so it retains the lock after acceptance. */
  releaseOnCommittedCurrent: boolean;
}

export async function executeCairnCommit<T>({
  gate,
  commit,
  isContextCurrent,
  onLockChange,
  onPreCommitFailure,
  onCommitted,
  onCommittedCurrent,
  onPostCommitFailure,
  releaseOnCommittedCurrent,
}: ExecuteCairnCommitOptions<T>): Promise<CairnCommitOutcome> {
  if (gate.current) return 'ignored';
  const token = Symbol('cairn-commit');
  gate.current = token;
  onLockChange?.(true);

  let result: T;
  try {
    result = await commit();
  } catch (error) {
    const contextWasCurrent = isContextCurrent();
    try {
      await onPreCommitFailure?.(error, contextWasCurrent);
    } finally {
      const contextStillCurrent = contextWasCurrent && isContextCurrent();
      if (contextStillCurrent && gate.current === token) {
        gate.current = null;
        onLockChange?.(false);
      }
    }
    return contextWasCurrent && isContextCurrent()
      ? 'precommit-failed-current'
      : 'precommit-failed-stale';
  }

  try {
    await onCommitted?.(result);
  } catch (error) {
    onPostCommitFailure?.(error);
  }

  if (!isContextCurrent()) return 'committed-stale';

  try {
    await onCommittedCurrent?.(result);
  } catch (error) {
    onPostCommitFailure?.(error);
    return 'committed-side-effect-failed';
  }

  if (releaseOnCommittedCurrent && gate.current === token) {
    gate.current = null;
    onLockChange?.(false);
  }
  return 'committed-current';
}

/** A newly rendered owner/Activity context owns a new single-flight scope.
 * The old async completion can no longer release or publish into this one. */
export function resetCairnCommitForNewContext(
  gate: CairnCommitGate,
  onLockChange?: (locked: boolean) => void,
): void {
  gate.current = null;
  onLockChange?.(false);
}
