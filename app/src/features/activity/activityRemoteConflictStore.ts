import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityMode } from '../../store/useSessionStore';
import type { RemoteUnfinishedActivity } from '../../services/sessionService';

export interface ActivityRemoteConflictIdentity {
  serverActivityId: number;
  clientActivityId: string | null;
  activityMode: ActivityMode;
  startedAt: string;
  pointCount: number;
  rawPointCount: number;
}

export interface ActivityRemoteStartConflictRecord {
  schema: 'cairn-activity-remote-start-conflict';
  version: 1;
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string | null;
  activityMode: ActivityMode;
  localStartedAt: number;
  state: 'owner-action-required';
  code: string;
  detectedAt: number;
  lastObservedAt: number;
  retryNotBefore: number;
  occurrenceCount: number;
  conflictingActivities: ActivityRemoteConflictIdentity[];
}

const KEY_PREFIX = '@cairn:activity_remote_start_conflicts:v1:';
const MAX_RECORDS_PER_OWNER = 12;
export const REMOTE_START_CONFLICT_RETRY_MS = 5 * 60_000;

let writeTail: Promise<void> = Promise.resolve();

function keyFor(ownerUserId: string): string {
  return `${KEY_PREFIX}${ownerUserId}`;
}

function validOwner(ownerUserId: string): boolean {
  return Boolean(ownerUserId && ownerUserId !== 'guest' && ownerUserId !== 'unknown');
}

function normalizeRemoteActivity(value: RemoteUnfinishedActivity): ActivityRemoteConflictIdentity {
  return {
    serverActivityId: value.id,
    clientActivityId: value.clientActivityId || null,
    activityMode: value.type,
    startedAt: value.startedAt,
    pointCount: Math.max(0, Number(value.pointCount) || 0),
    rawPointCount: Math.max(0, Number(value.rawPointCount) || 0),
  };
}

function validRecord(value: unknown, ownerUserId: string): value is ActivityRemoteStartConflictRecord {
  const record = value as Partial<ActivityRemoteStartConflictRecord> | null;
  return Boolean(record
    && record.schema === 'cairn-activity-remote-start-conflict'
    && record.version === 1
    && record.ownerUserId === ownerUserId
    && typeof record.clientActivityId === 'string'
    && (record.activityMode === 'hiking' || record.activityMode === 'running')
    && record.state === 'owner-action-required'
    && typeof record.code === 'string'
    && Number.isFinite(record.detectedAt)
    && Number.isFinite(record.lastObservedAt)
    && Number.isFinite(record.retryNotBefore)
    && Number.isFinite(record.occurrenceCount)
    && Array.isArray(record.conflictingActivities));
}

async function readOwner(ownerUserId: string): Promise<ActivityRemoteStartConflictRecord[]> {
  if (!validOwner(ownerUserId)) return [];
  const raw = await AsyncStorage.getItem(keyFor(ownerUserId));
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('activity_remote_conflict_store_corrupt');
  }
  if (!Array.isArray(parsed) || !parsed.every(item => validRecord(item, ownerUserId))) {
    throw new Error('activity_remote_conflict_store_corrupt');
  }
  return parsed;
}

async function mutateOwner(
  ownerUserId: string,
  mutation: (records: ActivityRemoteStartConflictRecord[]) => ActivityRemoteStartConflictRecord[],
): Promise<ActivityRemoteStartConflictRecord[]> {
  if (!validOwner(ownerUserId)) throw new Error('activity_remote_conflict_owner_required');
  let result: ActivityRemoteStartConflictRecord[] = [];
  const run = writeTail.then(async () => {
    result = mutation(await readOwner(ownerUserId)).slice(0, MAX_RECORDS_PER_OWNER);
    await AsyncStorage.setItem(keyFor(ownerUserId), JSON.stringify(result));
  });
  writeTail = run.catch(() => undefined);
  await run;
  return result;
}

export async function getActivityRemoteStartConflict(
  ownerUserId: string,
  clientActivityId: string,
): Promise<ActivityRemoteStartConflictRecord | null> {
  await writeTail.catch(() => undefined);
  return (await readOwner(ownerUserId)).find(
    record => record.clientActivityId === clientActivityId,
  ) ?? null;
}

export async function persistActivityRemoteStartConflict(input: {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration?: string | null;
  activityMode: ActivityMode;
  localStartedAt: number;
  code: string;
  existing: RemoteUnfinishedActivity | null;
  existingActivities: RemoteUnfinishedActivity[];
  observedAt?: number;
}): Promise<ActivityRemoteStartConflictRecord> {
  const observedAt = input.observedAt ?? Date.now();
  const remote = [input.existing, ...input.existingActivities]
    .filter((item): item is RemoteUnfinishedActivity => item !== null)
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
    .filter(item => item.clientActivityId !== input.clientActivityId)
    .map(normalizeRemoteActivity);
  let persisted: ActivityRemoteStartConflictRecord | null = null;
  await mutateOwner(input.ownerUserId, records => {
    const previous = records.find(record => record.clientActivityId === input.clientActivityId);
    persisted = {
      schema: 'cairn-activity-remote-start-conflict',
      version: 1,
      ownerUserId: input.ownerUserId,
      clientActivityId: input.clientActivityId,
      ownerGeneration: input.ownerGeneration ?? previous?.ownerGeneration ?? null,
      activityMode: input.activityMode,
      localStartedAt: input.localStartedAt,
      state: 'owner-action-required',
      code: input.code.slice(0, 80),
      detectedAt: previous?.detectedAt ?? observedAt,
      lastObservedAt: observedAt,
      retryNotBefore: observedAt + REMOTE_START_CONFLICT_RETRY_MS,
      occurrenceCount: (previous?.occurrenceCount ?? 0) + 1,
      conflictingActivities: remote.length > 0 ? remote : (previous?.conflictingActivities ?? []),
    };
    return [persisted, ...records.filter(record => record.clientActivityId !== input.clientActivityId)];
  });
  if (!persisted) throw new Error('activity_remote_conflict_persist_failed');
  return persisted;
}

export async function clearActivityRemoteStartConflict(
  ownerUserId: string,
  clientActivityId: string,
): Promise<void> {
  await mutateOwner(ownerUserId, records => records.filter(
    record => record.clientActivityId !== clientActivityId,
  ));
}

export function activityRemoteConflictStorageKey(ownerUserId: string): string {
  return keyFor(ownerUserId);
}
