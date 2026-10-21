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

const activeSessionByKey = new Map<string, string>();
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
  activeSessionByKey.set(key, sessionId);
}

export function releasePlantDraftSession(key: string, sessionId: string): void {
  if (activeSessionByKey.get(key) === sessionId) activeSessionByKey.delete(key);
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
    const active = activeSessionByKey.get(key);
    if (active != null && active !== sessionId) return false;
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
    const active = activeSessionByKey.get(key);
    if (active != null && active !== actingSessionId) return false;
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
  activeSessionByKey.clear();
  operationByKey.clear();
}
