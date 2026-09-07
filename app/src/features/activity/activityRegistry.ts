import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityMode } from '../../store/useSessionStore';
import type { SegmentStartReason } from './activityContracts';
import type { ActivityLocationSource } from '../activitySimulator/types';

export type ActivityLifecycle = 'unfinished' | 'completed_local' | 'discarded';
export type ActivitySyncState = 'pending' | 'syncing' | 'sync_error' | 'synced';

export interface UnfinishedActivityRecord {
  clientActivityId: string;
  serverActivityId: number | null;
  userId: string;
  activityMode: ActivityMode;
  startedAt: number;
  lastMeaningfulAt: number;
  liveOwnerGeneration: string;
  currentSegmentId: string;
  nextSegmentStartReason?: SegmentStartReason;
  /** Local diagnostic/recovery metadata; never changes server Activity shape. */
  locationProviderSource?: ActivityLocationSource;
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
  completed: CompletedActivityRecord[];
  tombstones: ActivityTombstone[];
}

const EMPTY: ActivityRegistrySnapshot = { version: 1, unfinished: null, completed: [], tombstones: [] };
const keyFor = (userId: string) => `@cairn:activity_registry:v1:${userId}`;
let writeTail: Promise<void> = Promise.resolve();

function cloneEmpty(): ActivityRegistrySnapshot {
  return { version: 1, unfinished: null, completed: [], tombstones: [] };
}

function validUserId(userId: string): boolean {
  return !!userId && userId !== 'unknown' && userId !== 'guest';
}

async function read(userId: string): Promise<ActivityRegistrySnapshot> {
  if (!validUserId(userId)) return cloneEmpty();
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    if (!raw) return cloneEmpty();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return cloneEmpty();
    return {
      version: 1,
      unfinished: parsed.unfinished ?? null,
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
    };
  } catch {
    return cloneEmpty();
  }
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

export async function registerUnfinishedActivity(record: UnfinishedActivityRecord): Promise<void> {
  await mutate(record.userId, (snapshot) => {
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

export async function updateUnfinishedActivity(
  userId: string,
  clientActivityId: string,
  patch: Partial<Omit<UnfinishedActivityRecord, 'clientActivityId' | 'userId' | 'lifecycle'>>,
): Promise<boolean> {
  let updated = false;
  await mutate(userId, (snapshot) => {
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
  await mutate(record.userId, (snapshot) => ({
    ...snapshot,
    unfinished: snapshot.unfinished?.clientActivityId === record.clientActivityId
      ? null
      : snapshot.unfinished,
    completed: [record, ...snapshot.completed.filter((item) => item.clientActivityId !== record.clientActivityId)],
  }));
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
}): Promise<void> {
  await mutate(args.userId, (snapshot) => {
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
      unfinished: snapshot.unfinished?.clientActivityId === args.clientActivityId ? null : snapshot.unfinished,
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
