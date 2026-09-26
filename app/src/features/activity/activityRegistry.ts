import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityMode } from '../../store/useSessionStore';
import type { SegmentStartReason } from './activityContracts';
import type { ActivityLocationSource } from '../activitySimulator/types';
import type { ActivityRouteReference } from '../route/routeContracts';

export type ActivityLifecycle = 'unfinished' | 'completed_local' | 'discarded';
export type ActivitySyncState = 'pending' | 'syncing' | 'sync_error' | 'synced';

export interface UnfinishedActivityRecord {
  clientActivityId: string;
  serverActivityId: number | null;
  userId: string;
  activityMode: ActivityMode;
  startedAt: number;
  lastMeaningfulAt: number;
  /** Frozen lifecycle time accumulated before the current tracking interval. */
  activeDurationMs?: number;
  /** Provider-clock start of the open tracking interval; null while paused. */
  activeSinceMs?: number | null;
  liveOwnerGeneration: string;
  currentSegmentId: string;
  nextSegmentStartReason?: SegmentStartReason;
  /** Local diagnostic/recovery metadata; never changes server Activity shape. */
  locationProviderSource?: ActivityLocationSource;
  /**
   * Immutable geometry from a previously authorized friend Route. This is
   * retained only while this Activity is unfinished so process recovery does
   * not erase the hiker's sole safety reference mid-outing.
   */
  borrowedRouteReference?: ActivityRouteReference;
  lifecycle: 'unfinished';
}

export interface CompletedActivityRecord {
  clientActivityId: string;
  serverActivityId: number | null;
  userId: string;
  activityMode: ActivityMode;
  startedAt: number;
  endedAt: number;
  lifecycle: 'completed_local';
  syncState: ActivitySyncState;
  /** Retained locally so post-completion sync diagnostics remain correlated. */
  locationProviderSource?: ActivityLocationSource;
  acknowledgedAt?: number;
}

export interface ActivityTombstone {
  clientActivityId: string;
  serverActivityId: number | null;
  userId: string;
  lifecycle: 'discarded';
  discardedAt: number;
}

export interface ActivityRegistrySnapshot {
  version: 1;
  unfinished: UnfinishedActivityRecord | null;
  /** Additional exact-ID server conflicts, resolved one at a time. */
  recoveryQueue: UnfinishedActivityRecord[];
  completed: CompletedActivityRecord[];
  tombstones: ActivityTombstone[];
}

const EMPTY: ActivityRegistrySnapshot = {
  version: 1, unfinished: null, recoveryQueue: [], completed: [], tombstones: [],
};
const keyFor = (userId: string) => `@cairn:activity_registry:v1:${userId}`;
let writeTail: Promise<void> = Promise.resolve();

function cloneEmpty(): ActivityRegistrySnapshot {
  return { version: 1, unfinished: null, recoveryQueue: [], completed: [], tombstones: [] };
}

function validUserId(userId: string): boolean {
  return !!userId && userId !== 'unknown' && userId !== 'guest';
}

async function read(userId: string): Promise<ActivityRegistrySnapshot> {
  if (!validUserId(userId)) return cloneEmpty();
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return cloneEmpty();
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('activity_registry_corrupt');
  }
  const validUnfinished = parsed?.unfinished == null || (
    parsed.unfinished.lifecycle === 'unfinished'
    && typeof parsed.unfinished.clientActivityId === 'string'
    && parsed.unfinished.userId === userId
    && (parsed.unfinished.activityMode === 'hiking' || parsed.unfinished.activityMode === 'running')
  );
  const validCompleted = Array.isArray(parsed?.completed) && parsed.completed.every((item: any) => (
    item?.lifecycle === 'completed_local'
    && typeof item.clientActivityId === 'string'
    && item.userId === userId
  ));
  const validTombstones = Array.isArray(parsed?.tombstones) && parsed.tombstones.every((item: any) => (
    item?.lifecycle === 'discarded'
    && typeof item.clientActivityId === 'string'
    && item.userId === userId
  ));
  const recoveryQueue = parsed?.recoveryQueue ?? [];
  const validRecoveryQueue = Array.isArray(recoveryQueue) && recoveryQueue.every((item: any) => (
    item?.lifecycle === 'unfinished'
    && typeof item.clientActivityId === 'string'
    && item.userId === userId
    && (item.activityMode === 'hiking' || item.activityMode === 'running')
  ));
  if (!parsed || parsed.version !== 1 || !validUnfinished || !validRecoveryQueue
    || !validCompleted || !validTombstones) {
    throw new Error('activity_registry_corrupt');
  }
  return {
    version: 1,
    unfinished: parsed.unfinished ?? null,
    recoveryQueue,
    completed: parsed.completed,
    tombstones: parsed.tombstones,
  };
}

async function mutate(
  userId: string,
  fn: (snapshot: ActivityRegistrySnapshot) => ActivityRegistrySnapshot,
): Promise<ActivityRegistrySnapshot> {
  if (!validUserId(userId)) throw new Error('activity_registry_user_required');
  let result = EMPTY;
  const run = writeTail.then(async () => {
    result = fn(await read(userId));
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(result));
  });
  writeTail = run.catch(() => {});
  await run;
  return result;
}

export async function getActivityRegistry(userId: string): Promise<ActivityRegistrySnapshot> {
  await writeTail.catch(() => {});
  return read(userId);
}

export async function getUnfinishedActivity(userId: string): Promise<UnfinishedActivityRecord | null> {
  return (await getActivityRegistry(userId)).unfinished;
}

export async function registerUnfinishedActivity(
  record: UnfinishedActivityRecord,
  options: { shouldCommit?: () => boolean } = {},
): Promise<void> {
  await mutate(record.userId, (snapshot) => {
    if (options.shouldCommit && !options.shouldCommit()) throw new Error('activity_owner_changed');
    const current = snapshot.unfinished;
    if (current && current.clientActivityId !== record.clientActivityId) {
      throw new Error('unfinished_activity_exists');
    }
    if (snapshot.tombstones.some((item) => item.clientActivityId === record.clientActivityId)) {
      throw new Error('activity_tombstoned');
    }
    return { ...snapshot, unfinished: record };
  });
}

/** Replace only the tentative Start that received an authoritative conflict. */
export async function replaceUnfinishedActivity(
  userId: string,
  expectedClientActivityId: string,
  replacement: UnfinishedActivityRecord,
): Promise<boolean> {
  let replaced = false;
  await mutate(userId, (snapshot) => {
    if (snapshot.unfinished?.clientActivityId !== expectedClientActivityId) return snapshot;
    if (replacement.userId !== userId) throw new Error('activity_registry_owner_mismatch');
    if (snapshot.tombstones.some(item => item.clientActivityId === replacement.clientActivityId)) {
      throw new Error('activity_tombstoned');
    }
    replaced = true;
    return { ...snapshot, unfinished: replacement };
  });
  return replaced;
}

/**
 * Preserve every server-reported unfinished identity without merging by title
 * or silently discarding all but one. The existing recovery UI resolves the
 * head; terminal actions promote the next exact record.
 */
export async function replaceUnfinishedActivityQueue(
  userId: string,
  expectedClientActivityId: string,
  replacements: UnfinishedActivityRecord[],
): Promise<boolean> {
  let replaced = false;
  await mutate(userId, (snapshot) => {
    if (snapshot.unfinished?.clientActivityId !== expectedClientActivityId) return snapshot;
    const terminalIds = new Set([
      ...snapshot.completed.map(item => item.clientActivityId),
      ...snapshot.tombstones.map(item => item.clientActivityId),
    ]);
    const unique = replacements.filter((item, index, all) => (
      item.userId === userId
      && item.lifecycle === 'unfinished'
      && !terminalIds.has(item.clientActivityId)
      && all.findIndex(other => other.clientActivityId === item.clientActivityId) === index
    ));
    if (unique.length === 0) return snapshot;
    replaced = true;
    return { ...snapshot, unfinished: unique[0], recoveryQueue: unique.slice(1) };
  });
  return replaced;
}

export type StartConflictDisposition =
  | 'recoverable-unfinished'
  | 'completed-local'
  | 'discarded'
  | 'stale-speculative'
  | 'lifecycle-conflict';

/**
 * Reconcile the server singleton returned by Start without changing an
 * Activity's terminal lifecycle. In particular, a completed-local Activity
 * that is still waiting for its final Save acknowledgement must never be
 * resurrected as unfinished (and therefore exposed to Discard).
 */
export async function reconcileStartConflict(
  userId: string,
  expectedSpeculativeClientActivityId: string,
  replacement: UnfinishedActivityRecord,
): Promise<StartConflictDisposition> {
  let disposition: StartConflictDisposition = 'stale-speculative';
  await mutate(userId, (snapshot) => {
    if (replacement.userId !== userId) throw new Error('activity_registry_owner_mismatch');
    if (snapshot.unfinished?.clientActivityId === replacement.clientActivityId) {
      disposition = 'recoverable-unfinished';
      return {
        ...snapshot,
        unfinished: { ...snapshot.unfinished, serverActivityId: replacement.serverActivityId },
      };
    }
    if (snapshot.unfinished?.clientActivityId !== expectedSpeculativeClientActivityId) return snapshot;

    const completedIndex = snapshot.completed.findIndex(
      item => item.clientActivityId === replacement.clientActivityId,
    );
    const tombstoneIndex = snapshot.tombstones.findIndex(
      item => item.clientActivityId === replacement.clientActivityId,
    );
    if (completedIndex >= 0 && tombstoneIndex >= 0) {
      // Preserve both contradictory terminal records for support/recovery. The
      // speculative Start is safe to release, but neither terminal claim is
      // silently selected or destroyed.
      disposition = 'lifecycle-conflict';
      return { ...snapshot, unfinished: null };
    }
    if (completedIndex >= 0) {
      disposition = 'completed-local';
      return {
        ...snapshot,
        unfinished: null,
        completed: snapshot.completed.map((item, index) => index === completedIndex
          ? { ...item, serverActivityId: replacement.serverActivityId }
          : item),
      };
    }
    if (tombstoneIndex >= 0) {
      disposition = 'discarded';
      return {
        ...snapshot,
        unfinished: null,
        tombstones: snapshot.tombstones.map((item, index) => index === tombstoneIndex
          ? { ...item, serverActivityId: replacement.serverActivityId }
          : item),
      };
    }

    disposition = 'recoverable-unfinished';
    return { ...snapshot, unfinished: replacement };
  });
  return disposition;
}

export async function updateUnfinishedActivity(
  userId: string,
  clientActivityId: string,
  patch: Partial<Omit<UnfinishedActivityRecord, 'clientActivityId' | 'userId' | 'lifecycle'>>,
  options: { shouldCommit?: () => boolean } = {},
): Promise<boolean> {
  let updated = false;
  await mutate(userId, (snapshot) => {
    if (options.shouldCommit && !options.shouldCommit()) throw new Error('activity_owner_changed');
    if (snapshot.unfinished?.clientActivityId !== clientActivityId) return snapshot;
    updated = true;
    return { ...snapshot, unfinished: { ...snapshot.unfinished, ...patch } };
  });
  return updated;
}

export type ActivityServerMappingTarget = 'unfinished' | 'completed' | 'tombstoned' | 'missing';

/**
 * Persist a late server-shell acknowledgement without changing lifecycle or
 * sync state. In particular, a completed-local Activity remains pending until
 * its full Save payload is acknowledged.
 */
export async function mapActivityServerId(
  userId: string,
  clientActivityId: string,
  serverActivityId: number,
): Promise<ActivityServerMappingTarget> {
  let target: ActivityServerMappingTarget = 'missing';
  await mutate(userId, (snapshot) => {
    if (snapshot.tombstones.some(item => item.clientActivityId === clientActivityId)) {
      target = 'tombstoned';
      return snapshot;
    }
    const unfinished = snapshot.unfinished?.clientActivityId === clientActivityId
      ? { ...snapshot.unfinished, serverActivityId }
      : snapshot.unfinished;
    if (unfinished !== snapshot.unfinished) target = 'unfinished';
    const completed = snapshot.completed.map(item => {
      if (item.clientActivityId !== clientActivityId) return item;
      target = 'completed';
      return { ...item, serverActivityId };
    });
    return { ...snapshot, unfinished, completed };
  });
  return target;
}

export async function completeActivity(record: CompletedActivityRecord): Promise<void> {
  await mutate(record.userId, (snapshot) => {
    const completingHead = snapshot.unfinished?.clientActivityId === record.clientActivityId;
    return {
      ...snapshot,
      unfinished: completingHead ? (snapshot.recoveryQueue[0] ?? null) : snapshot.unfinished,
      recoveryQueue: snapshot.recoveryQueue
        .filter((item, index) => !(completingHead && index === 0))
        .filter(item => item.clientActivityId !== record.clientActivityId),
      completed: [record, ...snapshot.completed.filter((item) => item.clientActivityId !== record.clientActivityId)],
    };
  });
}

export async function acknowledgeActivity(
  userId: string,
  clientActivityId: string,
  serverActivityId: number,
): Promise<boolean> {
  let updated = false;
  await mutate(userId, (snapshot) => ({
    ...snapshot,
    completed: snapshot.completed.map((item) => {
      if (item.clientActivityId !== clientActivityId) return item;
      updated = true;
      return { ...item, serverActivityId, syncState: 'synced', acknowledgedAt: Date.now() };
    }),
  }));
  return updated;
}

export async function updateCompletedActivitySyncState(
  userId: string,
  clientActivityId: string,
  syncState: ActivitySyncState,
): Promise<void> {
  await mutate(userId, (snapshot) => ({
    ...snapshot,
    completed: snapshot.completed.map(item =>
      item.clientActivityId === clientActivityId ? { ...item, syncState } : item,
    ),
  }));
}

export async function removeAcknowledgedActivity(userId: string, clientActivityId: string): Promise<void> {
  await mutate(userId, (snapshot) => ({
    ...snapshot,
    completed: snapshot.completed.filter((item) =>
      item.clientActivityId !== clientActivityId || item.syncState !== 'synced'),
  }));
}

export async function tombstoneActivity(args: {
  userId: string;
  clientActivityId: string;
  serverActivityId?: number | null;
}, options: { shouldCommit?: () => boolean } = {}): Promise<void> {
  await mutate(args.userId, (snapshot) => {
    if (options.shouldCommit && !options.shouldCommit()) throw new Error('activity_owner_changed');
    const existing = snapshot.tombstones.find((item) => item.clientActivityId === args.clientActivityId);
    const tombstone: ActivityTombstone = existing ?? {
      userId: args.userId,
      clientActivityId: args.clientActivityId,
      serverActivityId: args.serverActivityId ?? null,
      lifecycle: 'discarded',
      discardedAt: Date.now(),
    };
    return {
      ...snapshot,
      unfinished: snapshot.unfinished?.clientActivityId === args.clientActivityId
        ? (snapshot.recoveryQueue[0] ?? null)
        : snapshot.unfinished,
      recoveryQueue: snapshot.recoveryQueue
        .filter((item, index) => !(snapshot.unfinished?.clientActivityId === args.clientActivityId && index === 0))
        .filter(item => item.clientActivityId !== args.clientActivityId),
      completed: snapshot.completed.filter((item) => item.clientActivityId !== args.clientActivityId),
      tombstones: [tombstone, ...snapshot.tombstones.filter((item) => item.clientActivityId !== args.clientActivityId)],
    };
  });
}

export async function isActivityTombstoned(userId: string, clientActivityId: string): Promise<boolean> {
  return (await getActivityRegistry(userId)).tombstones.some((item) => item.clientActivityId === clientActivityId);
}

export function activityRegistryStorageKey(userId: string): string {
  return keyFor(userId);
}
