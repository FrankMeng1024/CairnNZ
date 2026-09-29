import { storage } from '../../store/storage';

export type ActivityMapboxPhase = 'live' | 'final' | 'passive' | 'preview' | 'reload';
export type ActivityMapboxRequestKind = 'map-matching' | 'walking-directions';

export interface ActivityMapboxPermitRequest {
  phase: ActivityMapboxPhase;
  kind: ActivityMapboxRequestKind;
  fingerprint: string;
  reason: string;
}

export interface ActivityMapboxPermit {
  allowed: boolean;
  receiptId?: string;
  reason: 'allowed' | 'phase-zero-network' | 'deduplicated' | 'backoff' | 'budget' | 'concurrency';
}

export interface ActivityMapboxCompletion {
  receiptId: string;
  result: 'ok' | 'http' | 'timeout' | 'aborted' | 'network-error' | 'disused';
  httpStatus?: number | null;
  bytes?: number;
  durationMs: number;
  retryAfterMs?: number | null;
}

interface PersistedRequest {
  receiptId: string;
  fingerprint: string;
  phase: ActivityMapboxPhase;
  kind: ActivityMapboxRequestKind;
  attemptedAtMs: number;
  result: ActivityMapboxCompletion['result'] | 'in-flight';
  httpStatus: number | null;
  retryAtMs: number | null;
  bytes: number;
  durationMs: number;
  reason: string;
}

interface PersistedGovernorState {
  v: 1;
  ownerUserId: string;
  clientActivityId: string;
  startedAtMs: number;
  recordedDurationMs: number;
  requests: PersistedRequest[];
}

export interface ActivityMapboxUsageSnapshot {
  liveMatchingInvocations: number;
  finalMatchingInvocations: number;
  directionsInvocations: number;
  passiveInvocations: number;
  previewInvocations: number;
  reloadInvocations: number;
  failedInvocations: number;
  abortedInvocations: number;
  timeoutInvocations: number;
  disusedInvocations: number;
  retriedInvocations: number;
  bytes: number;
  durationMs: number;
  matchingLimit: number;
  liveMatchingLimit: number;
  finalMatchingLimit: number;
  directionsLimit: number;
  hardMatchingCeiling: number;
}

const ROOT = 'cairn:activity-mapbox-governor:v1:';
const stateFlights = new Map<string, Promise<void>>();
const activeReceipts = new Map<string, { stateKey: string }>();
const activeByActivity = new Map<string, number>();

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}

function storageKey(ownerUserId: string, clientActivityId: string): string {
  // Keep the owner segment reversible so account deletion can prove and
  // remove every persisted request receipt. This is local app storage, not a
  // telemetry identifier; hashing here previously made privacy purge blind.
  return `${ROOT}${encodeURIComponent(ownerUserId)}:${clientActivityId}`;
}

function limits(recordedDurationMs: number) {
  const hours = Math.max(1 / 6, recordedDurationMs / 3_600_000);
  const liveMatchingLimit = Math.max(2, Math.ceil(hours * 10));
  const finalMatchingLimit = Math.max(4, Math.ceil(hours * 20));
  const matchingLimit = Math.max(6, Math.ceil(hours * 30));
  return {
    liveMatchingLimit,
    finalMatchingLimit,
    matchingLimit,
    hardMatchingCeiling: 60,
    directionsLimit: 2,
  };
}

async function mutate<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = stateFlights.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const chained = previous.catch(() => undefined).then(() => next);
  stateFlights.set(key, chained);
  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (stateFlights.get(key) === chained) stateFlights.delete(key);
  }
}

async function load(args: {
  ownerUserId: string;
  clientActivityId: string;
  startedAtMs: number;
  recordedDurationMs: number;
}): Promise<PersistedGovernorState> {
  const raw = await storage.getItem(storageKey(args.ownerUserId, args.clientActivityId));
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as PersistedGovernorState;
      if (parsed?.v === 1
        && parsed.ownerUserId === args.ownerUserId
        && parsed.clientActivityId === args.clientActivityId
        && Array.isArray(parsed.requests)) {
        return {
          ...parsed,
          recordedDurationMs: Math.max(parsed.recordedDurationMs || 0, args.recordedDurationMs),
          requests: parsed.requests.slice(-128).map((request, index) => ({
            ...request,
            receiptId: request.receiptId || `legacy:${request.attemptedAtMs}:${index}`,
          })),
        };
      }
    } catch { /* replace malformed local governor state conservatively */ }
  }
  return {
    v: 1,
    ownerUserId: args.ownerUserId,
    clientActivityId: args.clientActivityId,
    startedAtMs: args.startedAtMs,
    recordedDurationMs: args.recordedDurationMs,
    requests: [],
  };
}

function usage(state: PersistedGovernorState): ActivityMapboxUsageSnapshot {
  const invoked = state.requests.filter(request => request.result !== 'in-flight' || request.attemptedAtMs > 0);
  const matching = invoked.filter(request => request.kind === 'map-matching');
  const counts = limits(state.recordedDurationMs);
  const attemptsByFingerprint = new Map<string, number>();
  let retriedInvocations = 0;
  for (const request of invoked) {
    const prior = attemptsByFingerprint.get(request.fingerprint) ?? 0;
    if (prior > 0) retriedInvocations += 1;
    attemptsByFingerprint.set(request.fingerprint, prior + 1);
  }
  return {
    liveMatchingInvocations: matching.filter(request => request.phase === 'live').length,
    finalMatchingInvocations: matching.filter(request => request.phase === 'final').length,
    directionsInvocations: invoked.filter(request => request.kind === 'walking-directions').length,
    passiveInvocations: invoked.filter(request => request.phase === 'passive').length,
    previewInvocations: invoked.filter(request => request.phase === 'preview').length,
    reloadInvocations: invoked.filter(request => request.phase === 'reload').length,
    failedInvocations: invoked.filter(request => request.result !== 'ok' && request.result !== 'in-flight').length,
    abortedInvocations: invoked.filter(request => request.result === 'aborted').length,
    timeoutInvocations: invoked.filter(request => request.result === 'timeout').length,
    disusedInvocations: invoked.filter(request => request.result === 'disused').length,
    retriedInvocations,
    bytes: invoked.reduce((sum, request) => sum + Math.max(0, request.bytes || 0), 0),
    durationMs: invoked.reduce((sum, request) => sum + Math.max(0, request.durationMs || 0), 0),
    ...counts,
  };
}

export function createActivityMapboxRequestGovernor(args: {
  ownerUserId: string;
  clientActivityId: string;
  startedAtMs: number;
  recordedDurationMs: number;
  now?: () => number;
}) {
  const key = storageKey(args.ownerUserId, args.clientActivityId);
  const now = args.now ?? Date.now;
  return {
    async authorize(request: ActivityMapboxPermitRequest): Promise<ActivityMapboxPermit> {
      if (request.phase === 'passive' || request.phase === 'preview' || request.phase === 'reload') {
        return { allowed: false, reason: 'phase-zero-network' };
      }
      if ((activeByActivity.get(key) ?? 0) >= 2) return { allowed: false, reason: 'concurrency' };
      return mutate(key, async () => {
        if ((activeByActivity.get(key) ?? 0) >= 2) {
          return { allowed: false, reason: 'concurrency' };
        }
        const state = await load(args);
        const atMs = now();
        const previous = [...state.requests].reverse().find(item => item.fingerprint === request.fingerprint);
        if (previous) {
          if (previous.result === 'ok' || previous.httpStatus === 401 || previous.httpStatus === 403) {
            return { allowed: false, reason: 'deduplicated' };
          }
          if (previous.retryAtMs == null || previous.retryAtMs > atMs) {
            return { allowed: false, reason: 'backoff' };
          }
        }
        const snapshot = usage(state);
        if (request.kind === 'walking-directions') {
          if (snapshot.directionsInvocations >= snapshot.directionsLimit) {
            return { allowed: false, reason: 'budget' };
          }
        } else {
          const totalMatching = snapshot.liveMatchingInvocations + snapshot.finalMatchingInvocations;
          if (totalMatching >= Math.min(snapshot.matchingLimit, snapshot.hardMatchingCeiling)
            || (request.phase === 'live' && snapshot.liveMatchingInvocations >= snapshot.liveMatchingLimit)
            || (request.phase === 'final' && snapshot.finalMatchingInvocations >= snapshot.finalMatchingLimit)) {
            return { allowed: false, reason: 'budget' };
          }
        }
        const receiptId = `${atMs}:${hash(`${request.fingerprint}:${Math.random()}`)}`;
        const entry: PersistedRequest = {
          receiptId,
          fingerprint: request.fingerprint,
          phase: request.phase,
          kind: request.kind,
          attemptedAtMs: atMs,
          result: 'in-flight',
          httpStatus: null,
          retryAtMs: atMs + 60_000,
          bytes: 0,
          durationMs: 0,
          reason: request.reason,
        };
        // Every actual invocation remains in the ledger. A retry consumes
        // budget too, even when it repeats the same evidence fingerprint.
        state.requests = [...state.requests, entry].slice(-128);
        await storage.setItem(key, JSON.stringify(state), { strict: true });
        activeReceipts.set(receiptId, { stateKey: key });
        activeByActivity.set(key, (activeByActivity.get(key) ?? 0) + 1);
        return { allowed: true, receiptId, reason: 'allowed' };
      });
    },

    async complete(completion: ActivityMapboxCompletion): Promise<void> {
      const receipt = activeReceipts.get(completion.receiptId);
      if (!receipt || receipt.stateKey !== key) return;
      activeReceipts.delete(completion.receiptId);
      activeByActivity.set(key, Math.max(0, (activeByActivity.get(key) ?? 1) - 1));
      await mutate(key, async () => {
        const state = await load(args);
        const entry = state.requests.find(item => item.receiptId === completion.receiptId);
        if (!entry) return;
        const status = completion.httpStatus ?? null;
        const permanentAuthFailure = status === 401 || status === 403;
        entry.result = completion.result;
        entry.httpStatus = status;
        entry.bytes = Math.max(0, completion.bytes ?? 0);
        entry.durationMs = Math.max(0, completion.durationMs);
        entry.retryAtMs = completion.result === 'ok' || permanentAuthFailure
          ? null
          : now() + Math.max(1_000, completion.retryAfterMs ?? 60_000);
        await storage.setItem(key, JSON.stringify(state), { strict: true });
      });
    },

    /** Release a permit when cancellation wins before fetch dispatch. It is
     * not an invocation and therefore must not consume privacy/cost budget. */
    async releaseUndispatched(receiptId: string): Promise<void> {
      const receipt = activeReceipts.get(receiptId);
      if (!receipt || receipt.stateKey !== key) return;
      activeReceipts.delete(receiptId);
      activeByActivity.set(key, Math.max(0, (activeByActivity.get(key) ?? 1) - 1));
      await mutate(key, async () => {
        const state = await load(args);
        state.requests = state.requests.filter(item => item.receiptId !== receiptId);
        await storage.setItem(key, JSON.stringify(state), { strict: true });
      });
    },

    async snapshot(): Promise<ActivityMapboxUsageSnapshot> {
      return usage(await load(args));
    },
  };
}

export type ActivityMapboxRequestGovernor = ReturnType<typeof createActivityMapboxRequestGovernor>;
