import AsyncStorage from '@react-native-async-storage/async-storage';

const keyFor = (userId: string) => `@cairn:marker_tombstones:v1:${userId}`;

// Tombstones are protection against resurrection, not a disposable cache.
// Serialize the complete read/modify/write boundary so two deletes cannot both
// read the same old array and let the later write erase the earlier tombstone.
let mutationTail: Promise<void> = Promise.resolve();

async function readIds(userId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId));
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('marker_tombstones_corrupt');
  }
  return parsed;
}

async function afterPendingMutations(): Promise<void> {
  // Observe failures without poisoning every later mutation. The mutation that
  // failed still rejects its caller; subsequent reads must wait for it to end.
  await mutationTail.catch(() => undefined);
}

export async function tombstoneMarker(userId: string, clientCairnId: string): Promise<void> {
  if (!userId || !clientCairnId) return;
  const operation = mutationTail.catch(() => undefined).then(async () => {
    const ids = await readIds(userId);
    if (ids.includes(clientCairnId)) return;
    const next = [clientCairnId, ...ids];
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(next));
    const verified = await readIds(userId);
    if (!verified.includes(clientCairnId)) throw new Error('marker_tombstone_verify_failed');
  });
  mutationTail = operation;
  await operation;
}

export async function isMarkerTombstoned(userId: string, clientCairnId: string): Promise<boolean> {
  if (!userId || !clientCairnId) return false;
  await afterPendingMutations();
  return (await readIds(userId)).includes(clientCairnId);
}

export async function listMarkerTombstones(userId: string): Promise<string[]> {
  if (!userId) return [];
  await afterPendingMutations();
  return readIds(userId);
}
