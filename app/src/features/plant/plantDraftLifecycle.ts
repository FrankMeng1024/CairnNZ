export type PlantDraftScope =
  | { kind: 'standalone' }
  | {
      kind: 'activity';
      clientActivityId: string;
      ownerGeneration: string;
      activityMode: 'hiking' | 'running';
    };

export interface PlantDraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// This is intentionally an authority fence, not merely a mounted-screen map.
// Releasing the newest editor must not let a delayed failure from an older
// editor regain write authority after the newest editor has closed.
const latestSessionByKey = new Map<string, string>();
const operationByKey = new Map<string, Promise<unknown>>();

function encoded(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_');
}

export function plantDraftScopeId(scope: PlantDraftScope): string {
  if (scope.kind === 'standalone') return 'standalone';
  return [
    'activity',
    encoded(scope.clientActivityId),
    encoded(scope.ownerGeneration),
    scope.activityMode,
  ].join(':');
}

export function plantDraftStorageKey(ownerUserId: string, scope: PlantDraftScope): string {
  return `cairn:plant:draft:v5:${ownerUserId}:${plantDraftScopeId(scope)}`;
}

export function legacyPlantDraftStorageKey(ownerUserId: string): string {
  return `cairn:plant:draft:v3:${ownerUserId}`;
}

export function claimPlantDraftSession(key: string, sessionId: string): void {
  latestSessionByKey.set(key, sessionId);
}

export function releasePlantDraftSession(key: string, sessionId: string): void {
  // Keep the latest session as a monotonic in-process fence. Its final
  // unmount/background flush is still allowed, while any superseded session
  // remains unable to overwrite or remove the newer envelope. A genuine app
  // restart clears this map and the next editor explicitly adopts a stored
  // draft under a fresh session id.
  if (latestSessionByKey.get(key) !== sessionId) return;
}

function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationByKey.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  operationByKey.set(key, current);
  void current.finally(() => {
    if (operationByKey.get(key) === current) operationByKey.delete(key);
  }).catch(() => undefined);
  return current;
}

export async function readPlantDraft(storage: PlantDraftStorage, key: string): Promise<string | null> {
  return enqueue(key, () => storage.getItem(key));
}

export async function persistPlantDraft(
  storage: PlantDraftStorage,
  key: string,
  sessionId: string,
  serializedEnvelope: string,
): Promise<boolean> {
  return enqueue(key, async () => {
    if (latestSessionByKey.get(key) !== sessionId) return false;
    await storage.setItem(key, serializedEnvelope);
    return true;
  });
}

export async function removePlantDraftIfSessionMatches(
  storage: PlantDraftStorage,
  key: string,
  expectedStoredSessionId: string,
  actingSessionId: string,
): Promise<boolean> {
  return enqueue(key, async () => {
    if (latestSessionByKey.get(key) !== actingSessionId) return false;
    const raw = await storage.getItem(key);
    if (!raw) return true;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.sessionId !== expectedStoredSessionId) return false;
    } catch {
      return false;
    }
    await storage.removeItem(key);
    return true;
  });
}

export async function removeLegacyDraftIfUnchanged(
  storage: PlantDraftStorage,
  key: string,
  expectedRaw: string,
): Promise<boolean> {
  return enqueue(key, async () => {
    const current = await storage.getItem(key);
    if (current !== expectedRaw) return false;
    await storage.removeItem(key);
    return true;
  });
}

export function resetPlantDraftLifecycleForTests(): void {
  latestSessionByKey.clear();
  operationByKey.clear();
}
