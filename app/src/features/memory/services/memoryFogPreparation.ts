/**
 * Account/content keyed single-flight coordinator shared by Home prewarm and
 * the visible FogLayer. It owns no geometry and mounts no Mapbox component.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function memoryFogPreparationKey(accountId: string, contentSignature: string): string {
  return `${accountId}\u0000${contentSignature}`;
}

export function runSharedMemoryFogPreparation<T>(
  accountId: string,
  contentSignature: string,
  task: () => Promise<T>,
  options?: { retryAfterEmpty?: boolean },
): Promise<T> {
  const key = memoryFogPreparationKey(accountId, contentSignature);
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    if (!options?.retryAfterEmpty) return existing;
    return existing.then(result => result == null
      ? runSharedMemoryFogPreparation(accountId, contentSignature, task)
      : result);
  }
  const run = Promise.resolve().then(task).finally(() => {
    if (inFlight.get(key) === run) inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

export function memoryFogPreparationInFlightForTest(accountId: string, contentSignature: string): boolean {
  return inFlight.has(memoryFogPreparationKey(accountId, contentSignature));
}
