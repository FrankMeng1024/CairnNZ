import type { StartSessionResolution } from '../../services/sessionService';
import type { ActivityRemoteStartConflictRecord } from './activityRemoteConflictStore';

export interface ActivityRemoteStartIdentity {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
  activityMode: 'hiking' | 'running';
  startedAt: number;
}

export type ActivityRemoteStartWakeReason =
  | 'local-start'
  | 'network-online'
  | 'foreground'
  | 'periodic-flush'
  | 'process-recovery';

export type ActivityRemoteStartResult =
  | { kind: 'mapped'; serverActivityId: number; mappingTarget: string; replayedConflict: boolean }
  | {
      kind: 'conflict';
      code: string;
      existingClientActivityId: string | null;
      durable: boolean;
      deferredByDurableConflict?: boolean;
    }
  | { kind: 'unavailable'; status: number; code: string | null; retryable: boolean }
  | { kind: 'not-current' };

interface ActivityRemoteStartDependencies {
  isLocallyCurrent: () => boolean;
  start: () => Promise<StartSessionResolution>;
  persistServerMapping: (serverActivityId: number) => Promise<string>;
  persistPendingMapping: (serverActivityId: number) => Promise<void>;
  publishServerMapping: (serverActivityId: number, mappingTarget: string) => void;
  readPendingConflict?: () => Promise<ActivityRemoteStartConflictRecord | null>;
  persistConflict?: (
    conflict: Extract<StartSessionResolution, { kind: 'conflict' }>,
  ) => Promise<ActivityRemoteStartConflictRecord>;
  clearConflict?: () => Promise<void>;
  publishConflict?: (conflict: ActivityRemoteStartConflictRecord | null) => void;
  observe?: (event: {
    phase: 'attempt' | 'mapped' | 'conflict' | 'conflict-pending' | 'unavailable' | 'failed';
    wakeReason: ActivityRemoteStartWakeReason;
    elapsedMs: number;
    status?: number;
    code?: string | null;
    serverActivityId?: number;
    mappingTarget?: string;
    replayedConflict?: boolean;
  }) => void;
}

interface RemoteStartFlight {
  promise: Promise<ActivityRemoteStartResult>;
  lastAttemptAt: number;
}

const flights = new Map<string, RemoteStartFlight>();
const MIN_RETRY_INTERVAL_MS = 15_000;

function identityKey(identity: ActivityRemoteStartIdentity): string {
  return `${identity.ownerUserId}:${identity.clientActivityId}`;
}

/**
 * Reconciles the optional remote shell after local recording authority exists.
 *
 * This coordinator never starts or stops GPS, changes canonical evidence, or
 * owns Activity completion. Its only mutable output is the durable mapping
 * from the stable client Activity ID to the server ID. Concurrent wakeups
 * share one flight, and a late response may update only that captured owner's
 * durable record. The caller separately fences any mounted-store publication.
 */
export function reconcileActivityRemoteStart(
  identity: ActivityRemoteStartIdentity,
  wakeReason: ActivityRemoteStartWakeReason,
  dependencies: ActivityRemoteStartDependencies,
): Promise<ActivityRemoteStartResult> {
  const key = identityKey(identity);
  const existing = flights.get(key);
  const now = Date.now();
  if (existing) return existing.promise;

  const previousAttemptAt = lastAttempts.get(key) ?? 0;
  if (now - previousAttemptAt < MIN_RETRY_INTERVAL_MS) {
    return Promise.resolve({ kind: 'not-current' });
  }
  if (!dependencies.isLocallyCurrent()) {
    return Promise.resolve({ kind: 'not-current' });
  }
  lastAttempts.set(key, now);

  const startedAt = Date.now();
  dependencies.observe?.({ phase: 'attempt', wakeReason, elapsedMs: 0 });
  let promise!: Promise<ActivityRemoteStartResult>;
  promise = (async (): Promise<ActivityRemoteStartResult> => {
    try {
      const pendingConflict = await dependencies.readPendingConflict?.() ?? null;
      if (pendingConflict && pendingConflict.retryNotBefore > Date.now()) {
        dependencies.publishConflict?.(pendingConflict);
        dependencies.observe?.({
          phase: 'conflict-pending',
          wakeReason,
          elapsedMs: Date.now() - startedAt,
          status: 409,
          code: pendingConflict.code,
        });
        return {
          kind: 'conflict',
          code: pendingConflict.code,
          existingClientActivityId:
            pendingConflict.conflictingActivities[0]?.clientActivityId ?? null,
          durable: true,
          deferredByDurableConflict: true,
        };
      }
      const resolution = await dependencies.start();
      const matchingConflict = resolution.kind === 'conflict'
        && resolution.existing?.clientActivityId === identity.clientActivityId
        ? resolution.existing
        : resolution.kind === 'conflict'
          ? resolution.existingActivities.find(
              item => item.clientActivityId === identity.clientActivityId,
            ) ?? null
          : null;
      const serverActivityId = resolution.kind === 'started'
        ? resolution.serverActivityId
        : matchingConflict?.id ?? null;

      if (serverActivityId !== null) {
        const mappingTarget = await dependencies.persistServerMapping(serverActivityId);
        await dependencies.persistPendingMapping(serverActivityId);
        try { await dependencies.clearConflict?.(); } catch { /* mapping remains authoritative */ }
        dependencies.publishConflict?.(null);
        dependencies.publishServerMapping(serverActivityId, mappingTarget);
        const replayedConflict = resolution.kind === 'conflict';
        dependencies.observe?.({
          phase: 'mapped',
          wakeReason,
          elapsedMs: Date.now() - startedAt,
          serverActivityId,
          mappingTarget,
          replayedConflict,
        });
        return { kind: 'mapped', serverActivityId, mappingTarget, replayedConflict };
      }

      if (resolution.kind === 'conflict') {
        const durableConflict = await dependencies.persistConflict?.(resolution) ?? null;
        if (durableConflict) dependencies.publishConflict?.(durableConflict);
        dependencies.observe?.({
          phase: 'conflict',
          wakeReason,
          elapsedMs: Date.now() - startedAt,
          status: 409,
          code: resolution.code,
        });
        return {
          kind: 'conflict',
          code: resolution.code,
          existingClientActivityId: resolution.existing?.clientActivityId ?? null,
          durable: durableConflict !== null,
        };
      }

      if (resolution.kind !== 'unavailable') {
        return { kind: 'unavailable', status: 0, code: 'MALFORMED_START_STATE', retryable: true };
      }
      dependencies.observe?.({
        phase: 'unavailable',
        wakeReason,
        elapsedMs: Date.now() - startedAt,
        status: resolution.status,
        code: resolution.code,
      });
      return resolution;
    } catch (error) {
      dependencies.observe?.({
        phase: 'failed',
        wakeReason,
        elapsedMs: Date.now() - startedAt,
        code: error instanceof Error ? error.name : 'unknown',
      });
      return { kind: 'unavailable', status: 0, code: 'LOCAL_RECONCILIATION_FAILED', retryable: true };
    } finally {
      if (flights.get(key)?.promise === promise) flights.delete(key);
    }
  })();
  flights.set(key, { promise, lastAttemptAt: now });
  return promise;
}

const lastAttempts = new Map<string, number>();

export const __activityRemoteStartCoordinatorTest = {
  reset(): void {
    flights.clear();
    lastAttempts.clear();
  },
};
