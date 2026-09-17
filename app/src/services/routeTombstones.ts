import AsyncStorage from '@react-native-async-storage/async-storage';

export interface RouteTombstone {
  clientRouteId: string;
  remoteId?: string;
  deletedAt: number;
  remoteDeleted?: boolean;
  lastAttemptAt?: number;
  lastErrorCode?: string;
}

const keyFor = (userId: string) => `@cairn:route_tombstones:v1:${userId}`;
let mutationTail: Promise<void> = Promise.resolve();

async function read(userId: string): Promise<RouteTombstone[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('route_tombstones_corrupt');
  return parsed.filter((item): item is RouteTombstone => Boolean(
    item && typeof item === 'object'
    && typeof (item as RouteTombstone).clientRouteId === 'string'
    && typeof (item as RouteTombstone).deletedAt === 'number',
  ));
}

async function afterMutations(): Promise<void> {
  await mutationTail.catch(() => undefined);
}

export async function tombstoneRoute(
  userId: string,
  clientRouteId: string,
  remoteId?: string,
): Promise<RouteTombstone> {
  if (!userId || !clientRouteId) throw new Error('route_tombstone_identity_required');
  let committed!: RouteTombstone;
  const operation = mutationTail.catch(() => undefined).then(async () => {
    const records = await read(userId);
    const existing = records.find(item => item.clientRouteId === clientRouteId);
    committed = existing
      ? { ...existing, remoteId: remoteId ?? existing.remoteId }
      : { clientRouteId, remoteId, deletedAt: Date.now(), remoteDeleted: false };
    const next = [committed, ...records.filter(item => item.clientRouteId !== clientRouteId)];
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
    if (!(await read(userId)).some(item => item.clientRouteId === clientRouteId)) {
      throw new Error('route_tombstone_verify_failed');
    }
  });
  mutationTail = operation;
  await operation;
  return committed;
}

export async function listRouteTombstones(userId: string): Promise<RouteTombstone[]> {
  if (!userId) return [];
  await afterMutations();
  return read(userId);
}

export async function isRouteTombstoned(userId: string, clientRouteId: string): Promise<boolean> {
  return (await listRouteTombstones(userId)).some(item => item.clientRouteId === clientRouteId);
}

export async function markRouteRemoteDeleted(userId: string, clientRouteId: string): Promise<void> {
  const operation = mutationTail.catch(() => undefined).then(async () => {
    const records = await read(userId);
    const next = records.map(item => item.clientRouteId === clientRouteId
      ? { ...item, remoteDeleted: true, lastAttemptAt: Date.now(), lastErrorCode: undefined }
      : item);
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  });
  mutationTail = operation;
  await operation;
}

export async function markRouteRemoteDeletePending(
  userId: string,
  clientRouteId: string,
  errorCode: string,
): Promise<void> {
  const operation = mutationTail.catch(() => undefined).then(async () => {
    const records = await read(userId);
    const next = records.map(item => item.clientRouteId === clientRouteId
      ? {
          ...item,
          remoteDeleted: false,
          lastAttemptAt: Date.now(),
          lastErrorCode: errorCode.slice(0, 80),
        }
      : item);
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
  });
  mutationTail = operation;
  await operation;
}
