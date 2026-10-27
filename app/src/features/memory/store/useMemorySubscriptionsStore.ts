/**
 * useMemorySubscriptionsStore — explicit Friends Memory source selection.
 *
 * Memory tab friend-source state, backed by the existing endpoints
 *   GET    /api/memory-subscriptions       → { limit, count, subscriptions[] }
 *   POST   /api/memory-subscriptions       body { friend_id }
 *   DELETE /api/memory-subscriptions/:fid
 *
 * Local slice mirrors what the server has so UI doesn't blink. There is no
 * paid five-friend cap in the accepted product contract.
 */
import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';
import { storage } from '../../../store/storage';
import {
  classifyFriendMemoryFailure,
  friendMemoryPresentationFailure,
  memoryOperationFailure,
  type FriendMemoryFailure,
  type MemoryOperationFailure,
} from '../services/friendMemoryFailure';
import { cairnText } from '../../../i18n/runtime';

interface MemorySubscription {
  friend_id: number;
  friend_name: string;
  subscribed_at?: string;
}

export interface AvailableMemorySource {
  friend_id: string;
  friend_name: string;
  selected: boolean;
  authorization_version: number;
  grant_epoch?: string | null;
  friendship_episode_id?: string | null;
  friendship_episode_uuid?: string | null;
  effective_at: string;
  sharing_status: 'not_shared' | 'shared_empty' | 'shared';
  coverage_scope: 'full_history_delayed_v1' | null;
}

interface State {
  limit: number;        // Infinity when the server returns the uncapped contract.
  subscriptions: MemorySubscription[];
  availableSources: AvailableMemorySource[];
  loading: boolean;
  error: string | null;
  /** Selection intent is immediate UI authority. Failed transport keeps the
   * intent queued for the center-map Retry; authorization rejection is the
   * only response that may fail closed and remove it. */
  selectionPending: Record<string, 'select' | 'deselect'>;
  selectionError: FriendMemoryFailure | null;
  selectionLastFailure: MemoryOperationFailure | null;
  authorityValidatedAtMs: number;
  /** Last raw HTTP status from a mutation, for UI to map 409 → paywall trigger. */
  // O1 batch 37: lastMutationStatus removed — 0 external readers; callers use the return value directly.

  load: (force?: boolean) => Promise<boolean>;
  /** Returns server status code so caller can branch on 201/403/409. */
  subscribe: (friendId: number) => Promise<number>;
  unsubscribe: (friendId: number) => Promise<number>;
  retrySelectionIntents: () => Promise<boolean>;
  /** Convenience selector — does this user count as picked? */
  isSubscribed: (friendId: number) => boolean;
  /** Account-fenced local removal used by unfriend intent. A fresh server
   * load is the only way to restore a failed optimistic removal. */
  removeFriendLocally: (friendId: number | string) => void;
  /** BUG-010 fix: reset slice on user switch (called from useMarkerStore
   *  clearMarkers / hydrate). Prevents prior user's subscriptions leaking
   *  into a new session. */
  reset: () => void;
}

let subscriptionGeneration = 0;
const selectionMutationGenerations = new Map<string, number>();
const selectionCommitGenerations = new Map<string, number>();
const selectionCommitAuthorities = new Map<string, string>();
const selectionMutationTails = new Map<string, Promise<void>>();
const selectionIntentPersistenceTails = new Map<string, Promise<void>>();
const selectionIntentPersistenceSequences = new Map<string, number>();
const selectionIntentPersistenceSnapshots = new Map<string, Record<string, 'select' | 'deselect'>>();
type SelectionOrderState = { chainId: string; sequences: Record<string, number> };
const selectionOrderStates = new Map<string, SelectionOrderState>();
const selectionOrderAllocationTails = new Map<string, Promise<void>>();
const SELECTION_INTENT_PREFIX = 'cairn:memory-selection-intent:v1:';
const SELECTION_ORDER_PREFIX = 'cairn:memory-selection-order:v1:';
const AUTHORITY_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
export const MEMORY_SELECTION_REQUEST_TIMEOUT_MS = 10_000;
export const MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS = 2_000;
export const MEMORY_SELECTION_INTENT_WRITE_TIMEOUT_MS = 2_000;
const activeSelectionControllers = new Set<AbortController>();

type SelectionGenerationFence = Map<string, string>;

function selectionUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function selectionCausalToken(friendId: string): string {
  return `${selectionMutationGenerations.get(friendId) ?? 0}:${selectionCommitGenerations.get(friendId) ?? 0}`;
}

function captureSelectionGenerationFence(): SelectionGenerationFence {
  const ids = new Set([
    ...selectionMutationGenerations.keys(),
    ...selectionCommitGenerations.keys(),
  ]);
  return new Map([...ids].map(id => [id, selectionCausalToken(id)]));
}

function selectionChangedAfter(
  fence: SelectionGenerationFence,
  friendId: string | number,
): boolean {
  const id = String(friendId);
  return selectionCausalToken(id) !== (fence.get(id) ?? '0:0');
}

function markSelectionCommit(friendId: number, authorityKey?: string): void {
  const id = String(friendId);
  selectionCommitGenerations.set(id, (selectionCommitGenerations.get(id) ?? 0) + 1);
  if (authorityKey) selectionCommitAuthorities.set(id, authorityKey);
  else selectionCommitAuthorities.delete(id);
}

function sourceAuthorityKey(source: AvailableMemorySource | undefined): string {
  if (!source) return 'missing';
  return [
    source.friend_id,
    source.grant_epoch ?? 'no-grant',
    source.friendship_episode_id ?? 'no-episode',
    source.friendship_episode_uuid ?? 'no-episode-uuid',
    source.authorization_version,
    source.coverage_scope ?? 'no-scope',
    source.sharing_status === 'not_shared' ? 'not-shared' : 'authorized',
  ].join('|');
}

function boundedSelectionRequest(
  path: string,
  options: RequestInit & { expectedUserId: string },
  readJson: boolean,
  controller = new AbortController(),
): Promise<{ response: Response; body: any }> {
  activeSelectionControllers.add(controller);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MEMORY_SELECTION_REQUEST_TIMEOUT_MS);
    (timeout as any)?.unref?.();
    const cleanup = () => {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      activeSelectionControllers.delete(controller);
    };
    const finish = (callback: (value: any) => void, value: any) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, Object.assign(new Error(timedOut
      ? 'Memory selection authority request timed out'
      : 'Memory selection authority request cancelled'), {
      name: 'AbortError',
      code: timedOut ? 'MEMORY_SELECTION_REQUEST_TIMEOUT' : 'REQUEST_CANCELLED',
      timedOut,
    }));
    controller.signal.addEventListener('abort', onAbort, { once: true });
    void authenticatedFetch(path, {
      ...options,
      signal: controller.signal,
    }).then(async response => {
      let body: any = null;
      if (readJson) {
        try {
          body = await response.json();
        } catch (error) {
          // Successful authority reads have a strict JSON contract. Error
          // responses may have an empty/provider body; their HTTP status is
          // still sufficient for typed mutation handling.
          if (response.ok) {
            throw invalidAuthorityPayload(path.includes('friend-sharing/sources')
              ? 'sources'
              : options.method
                ? 'selection'
                : 'subscriptions');
          }
        }
      }
      finish(resolve, { response, body });
    }, error => finish(reject, error)).catch(error => finish(reject, error));
  });
}

function boundedSelectionIntentRead(
  userId: string,
): Promise<Record<string, 'select' | 'deselect'>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('Memory selection intent restore timed out'), {
        code: 'MEMORY_SELECTION_INTENT_READ_TIMEOUT',
        timedOut: true,
      }));
    }, MEMORY_SELECTION_INTENT_READ_TIMEOUT_MS);
    (timeout as any)?.unref?.();
    void readSelectionIntents(userId).then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function selectionIntentKey(userId: string): string {
  return `${SELECTION_INTENT_PREFIX}${userId}`;
}

function selectionOrderKey(userId: string): string {
  return `${SELECTION_ORDER_PREFIX}${userId}`;
}

function parseSelectionOrderState(raw: string | null): SelectionOrderState | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.chainId !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(value.chainId)
      || !value.sequences || typeof value.sequences !== 'object'
      || Array.isArray(value.sequences)) return null;
    const sequences = Object.fromEntries(Object.entries(value.sequences)
      .filter(([id, sequence]) => /^\d+$/.test(id)
        && Number.isSafeInteger(Number(sequence))
        && Number(sequence) >= 0)
      .map(([id, sequence]) => [id, Number(sequence)]));
    return { chainId: value.chainId, sequences };
  } catch {
    return null;
  }
}

function boundedStorageOperation<T>(
  operation: Promise<T>,
  code: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('Memory selection authority storage timed out'), {
        code,
        timedOut: true,
      }));
    }, MEMORY_SELECTION_INTENT_WRITE_TIMEOUT_MS);
    (timer as any)?.unref?.();
    void operation.then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function allocateSelectionOrder(
  userId: string,
  friendId: number,
): Promise<{ chainId: string; sequence: number; requestId: string }> {
  let resolveResult!: (value: { chainId: string; sequence: number; requestId: string }) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<{ chainId: string; sequence: number; requestId: string }>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const previous = selectionOrderAllocationTails.get(userId) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    try {
      let current = selectionOrderStates.get(userId);
      if (!current) {
        const reader = typeof (storage as any).getItemStrict === 'function'
          ? (storage as any).getItemStrict(selectionOrderKey(userId))
          : storage.getItem(selectionOrderKey(userId));
        current = parseSelectionOrderState(await boundedStorageOperation(
          Promise.resolve(reader),
          'MEMORY_SELECTION_ORDER_READ_TIMEOUT',
        )) ?? { chainId: selectionUuid(), sequences: {} };
      }
      const id = String(friendId);
      const next: SelectionOrderState = {
        chainId: current.chainId,
        sequences: {
          ...current.sequences,
          [id]: (current.sequences[id] ?? 0) + 1,
        },
      };
      // Publish the monotonic reservation in memory before the strict durable
      // write. A timed-out native write never dispatches HTTP; if it completes
      // late after a newer reservation, repair the durable value.
      selectionOrderStates.set(userId, next);
      const writer = storage.setItem(
        selectionOrderKey(userId),
        JSON.stringify(next),
        { strict: true },
      );
      try {
        await boundedStorageOperation(writer, 'MEMORY_SELECTION_ORDER_WRITE_TIMEOUT');
      } catch (error) {
        void writer.then(() => {
          const latest = selectionOrderStates.get(userId);
          if (latest && latest !== next) {
            void storage.setItem(selectionOrderKey(userId), JSON.stringify(latest), { strict: true });
          }
        }, () => undefined);
        throw error;
      }
      resolveResult({
        chainId: next.chainId,
        sequence: next.sequences[id],
        requestId: selectionUuid(),
      });
    } catch (error) {
      rejectResult(error);
    }
  });
  const tail = work.then(() => undefined, () => undefined);
  selectionOrderAllocationTails.set(userId, tail);
  void tail.finally(() => {
    if (selectionOrderAllocationTails.get(userId) === tail) {
      selectionOrderAllocationTails.delete(userId);
    }
  });
  return result;
}

function adoptSelectionOrderFloor(
  userId: string,
  friendId: number,
  chainId: unknown,
  sequence: unknown,
): Promise<boolean> {
  const floor = Number(sequence);
  if (typeof chainId !== 'string'
    || !Number.isSafeInteger(floor)
    || floor < 0) return Promise.resolve(false);
  let resolveResult!: (value: boolean) => void;
  const result = new Promise<boolean>(resolve => { resolveResult = resolve; });
  const previous = selectionOrderAllocationTails.get(userId) ?? Promise.resolve();
  const work = previous.catch(() => undefined).then(async () => {
    let current: SelectionOrderState | null | undefined = selectionOrderStates.get(userId);
    if (!current) {
      const reader = typeof (storage as any).getItemStrict === 'function'
        ? (storage as any).getItemStrict(selectionOrderKey(userId))
        : storage.getItem(selectionOrderKey(userId));
      current = parseSelectionOrderState(await boundedStorageOperation(
        Promise.resolve(reader),
        'MEMORY_SELECTION_ORDER_READ_TIMEOUT',
      )) ?? null;
    }
    // A response from another client chain cannot establish ordering for this
    // device. Only the exact durable chain may advance its own lower bound.
    if (!current || current.chainId !== chainId) {
      resolveResult(false);
      return;
    }
    const id = String(friendId);
    if ((current.sequences[id] ?? 0) >= floor) {
      selectionOrderStates.set(userId, current);
      resolveResult(true);
      return;
    }
    const next: SelectionOrderState = {
      chainId: current.chainId,
      sequences: { ...current.sequences, [id]: floor },
    };
    selectionOrderStates.set(userId, next);
    await boundedStorageOperation(
      storage.setItem(selectionOrderKey(userId), JSON.stringify(next), { strict: true }),
      'MEMORY_SELECTION_ORDER_WRITE_TIMEOUT',
    );
    resolveResult(true);
  }).catch(() => resolveResult(false));
  const tail = work.then(() => undefined, () => undefined);
  selectionOrderAllocationTails.set(userId, tail);
  void tail.finally(() => {
    if (selectionOrderAllocationTails.get(userId) === tail) {
      selectionOrderAllocationTails.delete(userId);
    }
  });
  return result;
}

function persistSelectionIntents(
  userId: string,
  pending: Record<string, 'select' | 'deselect'>,
): void {
  if (!userId) return;
  const snapshot = { ...pending };
  const sequence = (selectionIntentPersistenceSequences.get(userId) ?? 0) + 1;
  selectionIntentPersistenceSequences.set(userId, sequence);
  selectionIntentPersistenceSnapshots.set(userId, snapshot);
  const previous = selectionIntentPersistenceTails.get(userId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    // A queued write superseded before it reaches storage has no authority to
    // overwrite the latest durable selection intent.
    if (selectionIntentPersistenceSequences.get(userId) !== sequence) return;
    const storageWrite = Object.keys(snapshot).length === 0
      ? storage.removeItem(selectionIntentKey(userId))
      : storage.setItem(selectionIntentKey(userId), JSON.stringify(snapshot));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>(resolve => {
      timer = setTimeout(() => resolve('timeout'), MEMORY_SELECTION_INTENT_WRITE_TIMEOUT_MS);
      (timer as any)?.unref?.();
    });
    const result = await Promise.race([
      storageWrite.then(() => 'written' as const, () => 'failed' as const),
      timeout,
    ]);
    if (timer) clearTimeout(timer);
    if (result === 'timeout') {
      // Release this queue. If the abandoned native write later completes
      // after a newer write, repair the durable value with the newest known
      // snapshot. The late result never updates in-memory authority.
      void storageWrite.then(() => {
        if (selectionIntentPersistenceSequences.get(userId) !== sequence) {
          persistSelectionIntents(
            userId,
            selectionIntentPersistenceSnapshots.get(userId) ?? {},
          );
        }
      }, () => undefined);
    }
  });
  const tail = write.then(() => undefined, () => undefined);
  selectionIntentPersistenceTails.set(userId, tail);
  void tail.finally(() => {
    if (selectionIntentPersistenceTails.get(userId) === tail) {
      selectionIntentPersistenceTails.delete(userId);
    }
  });
}

async function readSelectionIntents(userId: string): Promise<Record<string, 'select' | 'deselect'>> {
  try {
    const raw = await storage.getItem(selectionIntentKey(userId));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, 'select' | 'deselect'] => (
      /^\d+$/.test(entry[0]) && (entry[1] === 'select' || entry[1] === 'deselect')
    )));
  } catch {
    return {};
  }
}

function enqueueSelectionMutation<T>(friendId: number, operation: () => Promise<T>): Promise<T> {
  const key = String(friendId);
  const previous = selectionMutationTails.get(key);
  const current = previous
    ? previous.catch(() => undefined).then(operation)
    : operation();
  const tail = current.then(() => undefined, () => undefined);
  selectionMutationTails.set(key, tail);
  void tail.finally(() => {
    if (selectionMutationTails.get(key) === tail) selectionMutationTails.delete(key);
  });
  return current;
}

function nextSelectionMutationGeneration(friendId: number): number {
  const key = String(friendId);
  const next = (selectionMutationGenerations.get(key) ?? 0) + 1;
  selectionMutationGenerations.set(key, next);
  return next;
}

function applyPendingSelectionIntents(
  subscriptions: MemorySubscription[],
  sources: AvailableMemorySource[],
  pending: Record<string, 'select' | 'deselect'>,
): { subscriptions: MemorySubscription[]; sources: AvailableMemorySource[] } {
  const nextSubscriptions = [...subscriptions];
  for (const [friendIdKey, intent] of Object.entries(pending)) {
    const friendId = Number(friendIdKey);
    const source = sources.find(item => Number(item.friend_id) === friendId);
    const index = nextSubscriptions.findIndex(item => Number(item.friend_id) === friendId);
    if (intent === 'select' && index < 0 && source?.sharing_status !== 'not_shared') {
      nextSubscriptions.push({ friend_id: friendId, friend_name: source?.friend_name ?? friendIdKey });
    } else if (intent === 'deselect' && index >= 0) {
      nextSubscriptions.splice(index, 1);
    }
  }
  return {
    subscriptions: nextSubscriptions,
    // `subscriptions` is immediate checkbox intent. `source.selected` remains
    // the most recent server-confirmed selection and must not be rewritten by
    // an unacknowledged local intent: Friend geometry uses that distinction
    // as a fail-closed visibility boundary.
    sources,
  };
}

function rollbackCancelledSelection(
  state: Pick<State, 'subscriptions' | 'availableSources' | 'selectionPending'>,
  friendId: number,
): Pick<State, 'subscriptions' | 'availableSources' | 'selectionPending'> {
  const id = String(friendId);
  const source = state.availableSources.find(item => String(item.friend_id) === id);
  const serverConfirmed = source?.selected === true && source.sharing_status !== 'not_shared';
  const current = state.subscriptions.find(item => Number(item.friend_id) === friendId);
  const selectionPending = { ...state.selectionPending };
  delete selectionPending[id];
  return {
    subscriptions: serverConfirmed
      ? current
        ? state.subscriptions
        : [...state.subscriptions, {
            friend_id: friendId,
            friend_name: source?.friend_name ?? id,
          }]
      : state.subscriptions.filter(item => Number(item.friend_id) !== friendId),
    availableSources: state.availableSources,
    selectionPending,
  };
}

function resolvedFriendName(nextName: unknown, previousName?: string): string {
  const candidate = typeof nextName === 'string' ? nextName.trim() : '';
  if (candidate && !/^\d+$/.test(candidate)) return candidate;
  return previousName?.trim() || candidate;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidSubscriptionBody(value: unknown): value is {
  limit: number | null;
  subscriptions: MemorySubscription[];
} {
  if (!isRecord(value) || !Array.isArray(value.subscriptions)) return false;
  if (value.limit !== null && value.limit !== undefined
    && !Number.isFinite(Number(value.limit))) return false;
  return value.subscriptions.every((item: unknown) => isRecord(item)
    && Number.isInteger(Number(item.friend_id))
    && Number(item.friend_id) > 0
    && typeof item.friend_name === 'string');
}

function isValidSourcesBody(value: unknown): value is {
  complete?: boolean;
  sources: AvailableMemorySource[];
} {
  if (!isRecord(value) || !Array.isArray(value.sources)) return false;
  if (value.complete !== undefined && typeof value.complete !== 'boolean') return false;
  return value.sources.every((item: unknown) => isRecord(item)
    && /^\d+$/.test(String(item.friend_id))
    && typeof item.friend_name === 'string'
    && typeof item.selected === 'boolean'
    && Number.isInteger(Number(item.authorization_version))
    && ['not_shared', 'shared_empty', 'shared'].includes(String(item.sharing_status))
    && (item.coverage_scope === null || item.coverage_scope === 'full_history_delayed_v1')
    && (item.sharing_status === 'not_shared'
      ? item.coverage_scope === null
      : Number(item.authorization_version) > 0
        && typeof item.grant_epoch === 'string' && item.grant_epoch.length > 0
        && item.friendship_episode_id != null
        && (typeof item.friendship_episode_id === 'string'
          || Number.isInteger(Number(item.friendship_episode_id)))
        && String(item.friendship_episode_id).trim().length > 0
        && typeof item.effective_at === 'string'
        && Number.isFinite(Date.parse(item.effective_at))
        && item.coverage_scope === 'full_history_delayed_v1'));
}

function invalidAuthorityPayload(stage: 'sources' | 'subscriptions' | 'selection'): Error {
  return Object.assign(new Error(`Invalid Memory friends ${stage} response`), {
    code: 'INVALID_MEMORY_AUTHORITY_PAYLOAD',
    invalidPayload: true,
  });
}

function isValidOrderedSelectionAck(
  value: unknown,
  expected: {
    selected: boolean;
    chainId: string;
    sequence: number;
    requestId: string;
  },
): boolean {
  return isRecord(value)
    && value.selected === expected.selected
    && value.selection_chain_id === expected.chainId
    && Number(value.selection_sequence) === expected.sequence
    && value.selection_request_id === expected.requestId;
}

/** Preserve stable row/name identity across authorization refreshes. Status
 * accessories may update; an already resolved label such as `frank test`
 * never blanks or swaps through a numeric fallback. */
export function reconcileAvailableMemorySources(
  previous: AvailableMemorySource[],
  incoming: AvailableMemorySource[],
  complete = true,
): AvailableMemorySource[] {
  const priorById = new Map(previous.map(source => [String(source.friend_id), source]));
  const reconciled = incoming.map(source => {
    const prior = priorById.get(String(source.friend_id));
    const next = {
      ...source,
      friend_name: resolvedFriendName(source.friend_name, prior?.friend_name),
    };
    return prior
      && prior.friend_name === next.friend_name
      && prior.selected === next.selected
      && prior.authorization_version === next.authorization_version
      && prior.grant_epoch === next.grant_epoch
      && prior.friendship_episode_id === next.friendship_episode_id
      && prior.friendship_episode_uuid === next.friendship_episode_uuid
      && prior.effective_at === next.effective_at
      && prior.sharing_status === next.sharing_status
      && prior.coverage_scope === next.coverage_scope
      ? prior
      : next;
  });
  if (!complete) {
    const incomingIds = new Set(incoming.map(source => String(source.friend_id)));
    reconciled.push(...previous.filter(source => !incomingIds.has(String(source.friend_id))));
  }
  return reconciled;
}

function reconcileAuthoritySources(
  sourcesAtDispatch: AvailableMemorySource[],
  currentSources: AvailableMemorySource[],
  incomingSources: AvailableMemorySource[],
  complete: boolean,
  selectionFence: SelectionGenerationFence,
): AvailableMemorySource[] {
  const startById = new Map(sourcesAtDispatch.map(source => [String(source.friend_id), source]));
  const currentById = new Map(currentSources.map(source => [String(source.friend_id), source]));
  const reconciled = reconcileAvailableMemorySources(currentSources, incomingSources, complete);
  return reconciled.flatMap(incoming => {
    const id = String(incoming.friend_id);
    const atDispatch = startById.get(id);
    const current = currentById.get(id);
    if (!current && atDispatch && selectionChangedAfter(selectionFence, id)) return [];
    // A different grant/episode was installed after this authority read was
    // dispatched. The old response has no authority over the replacement.
    if (current && atDispatch
      && sourceAuthorityKey(current) !== sourceAuthorityKey(atDispatch)) return [current];
    // Selection intent/ACK is an independent dimension. Preserve only that
    // dimension when the grant identity is still the same; an actual revoke
    // or grant rotation from /sources continues to win immediately.
    if (current
      && selectionChangedAfter(selectionFence, id)
      && sourceAuthorityKey(current) === sourceAuthorityKey(incoming)) {
      return [current.selected === incoming.selected
        ? incoming
        : { ...incoming, selected: current.selected }];
    }
    return [incoming];
  });
}

function reconcileConfirmedSelectionRead(
  serverSubscriptions: MemorySubscription[],
  sources: AvailableMemorySource[],
  stateAtCommit: Pick<State, 'subscriptions' | 'availableSources' | 'selectionPending'>,
  selectionFence: SelectionGenerationFence,
  authorityComplete: boolean,
): { subscriptions: MemorySubscription[]; sources: AvailableMemorySource[] } {
  const confirmedById = new Map(serverSubscriptions.map(item => [String(item.friend_id), item]));
  const currentSourcesById = new Map(stateAtCommit.availableSources
    .map(source => [String(source.friend_id), source]));
  const currentSubscriptionsById = new Map(stateAtCommit.subscriptions
    .map(item => [String(item.friend_id), item]));
  const allIds = new Set([
    ...sources.map(source => String(source.friend_id)),
    ...selectionFence.keys(),
    ...selectionMutationGenerations.keys(),
  ]);
  for (const id of allIds) {
    if (!selectionChangedAfter(selectionFence, id)) continue;
    const currentSource = currentSourcesById.get(id);
    const reconciledSource = sources.find(source => String(source.friend_id) === id);
    const currentAuthority = sourceAuthorityKey(currentSource);
    const reconciledAuthority = sourceAuthorityKey(reconciledSource);
    const commitBelongsToReconciledGrant = currentAuthority === reconciledAuthority
      && selectionCommitAuthorities.get(id) === reconciledAuthority;
    if (commitBelongsToReconciledGrant
      && currentSource?.selected === true
      && currentSource.sharing_status !== 'not_shared') {
      confirmedById.set(id, currentSubscriptionsById.get(id) ?? {
        friend_id: Number(id),
        friend_name: currentSource.friend_name,
      });
    } else if (commitBelongsToReconciledGrant) {
      confirmedById.delete(id);
    }
  }
  const knownSourceIds = new Set(sources.map(source => String(source.friend_id)));
  for (const source of sources) {
    if (source.sharing_status === 'not_shared') confirmedById.delete(String(source.friend_id));
  }
  if (authorityComplete) {
    for (const id of confirmedById.keys()) {
      if (!knownSourceIds.has(id)) confirmedById.delete(id);
    }
  }
  const confirmedIds = new Set(confirmedById.keys());
  const confirmedSources = sources.map(source => {
    const selected = source.sharing_status !== 'not_shared' && confirmedIds.has(String(source.friend_id));
    return source.selected === selected ? source : { ...source, selected };
  });
  return applyPendingSelectionIntents(
    [...confirmedById.values()],
    confirmedSources,
    stateAtCommit.selectionPending,
  );
}

export const useMemorySubscriptionsStore = create<State>((set, get) => ({
  limit: Number.POSITIVE_INFINITY,
  subscriptions: [],
  availableSources: [],
  loading: false,
  error: null,
  selectionPending: {},
  selectionError: null,
  selectionLastFailure: null,
  authorityValidatedAtMs: 0,
  // O1 batch 37: lastMutationStatus removed

  load: async (force = false) => {
    // BUG-007 fix: single-flight guard. Multiple consumers (MapScreen +
    // MemoryFriendPickModal + FlagsTab Friends sub-tab) can fire load()
    // concurrently — without this guard 3 parallel HTTP requests race
    // and whichever resolves last wins. The trigger is harmless (no
    // mutation), but burns network + flickers the slice.
    //
    // BUG-013 fix (round 4): stale-load guard. Capture the viewerId at
    // load start via dynamic require (avoids module cycle with
    // useMarkerStore). If the viewer changes during the fetch (logout/
    // login), drop the response — without this, user A's in-flight
    // load() resolving after user B's hydrate() would overwrite B's
    // empty subs slice with A's data, leaking cross-session.
    if (get().loading) {
      // Join the existing authority read. Treating "already loading" as a
      // failed authorization made a returning screen abandon otherwise valid
      // work and surface a misleading Friends connection state.
      return new Promise<boolean>(resolve => {
        const unsubscribe = useMemorySubscriptionsStore.subscribe(state => {
          if (state.loading) return;
          unsubscribe();
          resolve(state.authorityValidatedAtMs > 0 && state.error == null);
        });
      });
    }
    if (!force && get().error == null && get().authorityValidatedAtMs > 0
      && Date.now() - get().authorityValidatedAtMs < AUTHORITY_REFRESH_INTERVAL_MS) return true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerAtStart = String(useAppStore.getState().user?.id ?? '');
    if (!viewerAtStart) return false;
    const generationAtStart = subscriptionGeneration;
    set({ loading: true, error: null });
    const durableIntentSelectionFence = captureSelectionGenerationFence();
    const durableIntentsPromise = boundedSelectionIntentRead(viewerAtStart);
    // A routine sources refresh (including opening the picker) must not erase
    // a still-valid, short-lived server proof. Focus/account transitions can
    // deliberately call suspendVisibility() before this read; a successful
    // reconciliation restores only matching unexpired projections, while a
    // failed read leaves that explicit hard fence in place.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendMemoryStore } = require('./useFriendMemoryStore');
    let authorityRequest: Promise<readonly [
      { response: Response; body: any },
      { response: Response; body: any },
    ]> | null = null;
    const loadControllers = new Set<AbortController>();
    const newLoadController = () => {
      const controller = new AbortController();
      loadControllers.add(controller);
      return controller;
    };
    const abortLoadRequests = () => {
      for (const controller of loadControllers) controller.abort();
      loadControllers.clear();
    };
    try {
      const sourcesAtDispatch = [...get().availableSources];
      const sourcesSelectionFence = captureSelectionGenerationFence();
      const startSourcesRequest = () => boundedSelectionRequest(
          '/api/friend-sharing/sources',
          { expectedUserId: viewerAtStart },
          true,
          newLoadController(),
        );
      let subscriptionsSelectionFence: SelectionGenerationFence | null = null;
      const startSubscriptionsRequest = () => {
        subscriptionsSelectionFence = captureSelectionGenerationFence();
        return boundedSelectionRequest(
          '/api/memory-subscriptions',
          { expectedUserId: viewerAtStart },
          true,
          newLoadController(),
        );
      };
      // /sources creates the first explicit preference row and initializes
      // default selections. On a cold authority state it must complete before
      // subscriptions is read; otherwise two individually valid responses can
      // describe different database moments. Established sessions keep the two
      // independent reads parallel and rely on the per-source causal fences.
      const initializeSourcesFirst = get().availableSources.length === 0
        && get().authorityValidatedAtMs === 0;
      authorityRequest = initializeSourcesFirst
        ? startSourcesRequest().then(async sourcesResult => [
            sourcesResult,
            await startSubscriptionsRequest(),
          ] as const)
        : (() => {
            // Preserve the established refresh dispatch order for existing
            // callers; causal fencing, not ordering, owns refresh correctness.
            const subscriptionsRequest = startSubscriptionsRequest();
            const sourcesRequest = startSourcesRequest();
            return Promise.all([sourcesRequest, subscriptionsRequest]);
          })();
      const durableIntents = Object.fromEntries(
        Object.entries(await durableIntentsPromise)
          .filter(([friendId]) => !selectionChangedAfter(durableIntentSelectionFence, friendId)),
      ) as Record<string, 'select' | 'deselect'>;
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) {
        abortLoadRequests();
        void authorityRequest.catch(() => undefined);
        return false;
      }
      if (Object.keys(durableIntents).length > 0) {
        set(state => ({
          selectionPending: { ...durableIntents, ...state.selectionPending },
        }));
      }
      const [sourcesResult, subscriptionsResult] = await authorityRequest;
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      const sourcesResponse = sourcesResult.response;
      if (sourcesResponse.ok && !isValidSourcesBody(sourcesResult.body)) {
        throw invalidAuthorityPayload('sources');
      }
      const sourcesBody = sourcesResponse.ok ? sourcesResult.body : null;
      const res = subscriptionsResult.response;
      if (res.ok && !isValidSubscriptionBody(subscriptionsResult.body)) {
        throw invalidAuthorityPayload('subscriptions');
      }
      const data = res.ok ? subscriptionsResult.body : null;
      const nextSources = sourcesBody && Array.isArray(sourcesBody.sources) ? sourcesBody.sources : null;
      const sourcesComplete = sourcesBody?.complete !== false;
      const currentState = get();
      const reconciledSources = nextSources
        ? reconcileAuthoritySources(
            sourcesAtDispatch,
            currentState.availableSources,
            nextSources,
            sourcesComplete,
            sourcesSelectionFence,
          )
        : currentState.availableSources;
      if (nextSources) {
        const deniedIds = new Set(reconciledSources
          .filter(source => source.sharing_status === 'not_shared')
          .map(source => String(source.friend_id)));
        if (sourcesComplete) {
          const authoritativeIds = new Set(reconciledSources.map(source => String(source.friend_id)));
          for (const id of Object.keys(get().selectionPending)) {
            if (!authoritativeIds.has(id)) deniedIds.add(id);
          }
        }
        const selectionPending = Object.fromEntries(Object.entries(get().selectionPending)
          .filter(([id, intent]) => intent !== 'select' || !deniedIds.has(id)));
        const subscriptions = get().subscriptions
          .filter(subscription => !deniedIds.has(String(subscription.friend_id)));
        if (Object.keys(selectionPending).length !== Object.keys(get().selectionPending).length) {
          set({ selectionPending, subscriptions });
          persistSelectionIntents(viewerAtStart, selectionPending);
        }
      }
      if (nextSources && !sourcesComplete) {
        set({
          availableSources: reconciledSources,
          loading: false,
          error: cairnText('memory.use-memory-subscriptions-store.incomplete-response'),
          authorityValidatedAtMs: 0,
        });
        await useFriendMemoryStore.getState().reconcileAuthorizedSources(
          reconciledSources,
          false,
        );
        return false;
      }
      if (!res.ok) {
        set({
          ...(nextSources ? {
            availableSources: reconciledSources,
          } : {}),
          loading: false,
          error: cairnText('memory.use-memory-subscriptions-store.could-not-load-memory-friends-http-value', { status: res.status }),
        });
        // The sources endpoint is the grant authority. Even if the parallel
        // subscriptions list failed, consume a successful source response so
        // a revoke/version rotation still fences geometry immediately.
        if (nextSources) {
          await useFriendMemoryStore.getState().reconcileAuthorizedSources(
            reconciledSources,
            sourcesComplete,
          );
        }
        return false;
      }
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      const withIntents = reconcileConfirmedSelectionRead(
        Array.isArray(data.subscriptions) ? data.subscriptions : [],
        reconciledSources,
        get(),
        subscriptionsSelectionFence ?? captureSelectionGenerationFence(),
        Boolean(nextSources) && sourcesComplete,
      );
      set({
        limit: data.limit == null ? Number.POSITIVE_INFINITY : Number(data.limit),
        subscriptions: withIntents.subscriptions,
        ...(reconciledSources.length > 0 || nextSources ? {
          availableSources: withIntents.sources,
        } : {}),
        loading: false,
        error: sourcesBody ? null : cairnText('memory.use-memory-subscriptions-store.could-not-refresh-available-friends-http-value', { status: sourcesResponse.status }),
        ...(nextSources ? { authorityValidatedAtMs: Date.now() } : {}),
      });
      // A durable Fog cache is never self-authorizing. A fresh sources read
      // purges revoked/version-stale rows and restores proof only for an
      // unexpired in-memory projection from the exact same grant. If this
      // routine read fails, an already valid server-issued proof remains
      // usable only until its own expiry timer; a caller-applied hard fence
      // remains fenced because there is no successful reconciliation.
      if (nextSources) {
        await useFriendMemoryStore.getState().reconcileAuthorizedSources(
          withIntents.sources,
          sourcesComplete,
        );
      }
      return Boolean(nextSources);
    } catch (e: any) {
      abortLoadRequests();
      void authorityRequest?.catch(() => undefined);
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      set({
        loading: false,
        error: e?.code === 'INVALID_MEMORY_AUTHORITY_PAYLOAD'
          ? cairnText('memory.use-memory-subscriptions-store.invalid-response')
          : String(e?.message ?? e).slice(0, 120),
      });
      return false;
    }
  },

  subscribe: async (friendId) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerAtStart = String(useAppStore.getState().user?.id ?? '');
    if (!viewerAtStart) return 0;
    const generationAtStart = subscriptionGeneration;
    const mutationGeneration = nextSelectionMutationGeneration(friendId);
    const source = get().availableSources.find(item => Number(item.friend_id) === friendId);
    const sourceAuthorityAtStart = sourceAuthorityKey(source);
    if (source?.sharing_status === 'not_shared') {
      const failure = memoryOperationFailure({
        httpStatus: 403,
        operation: 'memory-selection',
        stage: 'persist-select',
        targetRevision: `${friendId}:select:${mutationGeneration}`,
      });
      markSelectionCommit(friendId);
      set(state => {
        const selectionPending = { ...state.selectionPending };
        delete selectionPending[String(friendId)];
        return {
          subscriptions: state.subscriptions.filter(item => Number(item.friend_id) !== friendId),
          availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
            ? { ...item, selected: false }
            : item),
          selectionPending,
          selectionError: 'unauthorized' as const,
          selectionLastFailure: failure,
        };
      });
      persistSelectionIntents(viewerAtStart, get().selectionPending);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useFriendMemoryStore } = require('./useFriendMemoryStore');
      useFriendMemoryStore.getState().invalidateFriend(friendId);
      await useFriendMemoryStore.getState().purgeFriend(friendId, viewerAtStart);
      return 403;
    }
    const existing = get().subscriptions.find(item => Number(item.friend_id) === friendId);
    const optimistic = existing ?? {
      friend_id: friendId,
      friend_name: source?.friend_name ?? String(friendId),
      subscribed_at: new Date().toISOString(),
    };
    set(state => ({
      subscriptions: existing ? state.subscriptions : [...state.subscriptions, optimistic],
      selectionPending: { ...state.selectionPending, [String(friendId)]: 'select' },
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    }));
    persistSelectionIntents(viewerAtStart, get().selectionPending);
    return enqueueSelectionMutation(friendId, async () => {
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
        || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
      try {
        const selectionOrder = await allocateSelectionOrder(viewerAtStart, friendId);
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        const { response: res, body: responseBody } = await boundedSelectionRequest('/api/memory-subscriptions', {
          method: 'POST',
          body: JSON.stringify({
            friend_id: friendId,
            selection_chain_id: selectionOrder.chainId,
            selection_sequence: selectionOrder.sequence,
            selection_request_id: selectionOrder.requestId,
            grant_epoch: source?.grant_epoch ?? null,
            friendship_episode_id: source?.friendship_episode_id ?? null,
            authorization_version: source?.authorization_version ?? null,
            coverage_scope: source?.coverage_scope ?? null,
          }),
          expectedUserId: viewerAtStart,
        }, true);
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        const responseCode = typeof responseBody?.code === 'string' ? responseBody.code : null;
        if (res.ok && !isValidOrderedSelectionAck(responseBody, {
          selected: true,
          chainId: selectionOrder.chainId,
          sequence: selectionOrder.sequence,
          requestId: selectionOrder.requestId,
        })) {
          throw invalidAuthorityPayload('selection');
        }
        if (res.ok) {
          markSelectionCommit(friendId, sourceAuthorityAtStart);
          set(state => {
            const selectionPending = { ...state.selectionPending };
            delete selectionPending[String(friendId)];
            return {
              availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
                ? { ...item, selected: true }
                : item),
              selectionPending,
              selectionError: null,
              selectionLastFailure: null,
            };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        } else {
          const failure = memoryOperationFailure({
            httpStatus: res.status,
            operation: 'memory-selection',
            stage: 'persist-select',
            targetRevision: `${friendId}:select:${mutationGeneration}`,
          });
          if (res.status === 401 || res.status === 403 || res.status === 404
            || responseCode === 'AUTHORIZATION_CHANGED') {
            markSelectionCommit(friendId);
            set(state => {
              const selectionPending = { ...state.selectionPending };
              delete selectionPending[String(friendId)];
              return {
                subscriptions: state.subscriptions.filter(item => Number(item.friend_id) !== friendId),
                availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
                  ? { ...item, selected: false, sharing_status: 'not_shared' }
                  : item),
                selectionPending,
                selectionError: 'unauthorized' as const,
                selectionLastFailure: failure,
              };
            });
            persistSelectionIntents(viewerAtStart, get().selectionPending);
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { useFriendMemoryStore } = require('./useFriendMemoryStore');
            useFriendMemoryStore.getState().invalidateFriend(friendId);
            await useFriendMemoryStore.getState().purgeFriend(friendId, viewerAtStart);
          } else {
            if (responseCode === 'STALE_SELECTION_INTENT') {
              await adoptSelectionOrderFloor(
                viewerAtStart,
                friendId,
                responseBody?.selection_chain_id,
                responseBody?.selection_sequence,
              );
            }
            set({
              selectionError: classifyFriendMemoryFailure({ httpStatus: res.status }),
              selectionLastFailure: failure,
            });
          }
        }
        return res.status;
      } catch (error) {
        if (generationAtStart === subscriptionGeneration
          && String(useAppStore.getState().user?.id ?? '') === viewerAtStart
          && selectionMutationGenerations.get(String(friendId)) === mutationGeneration) {
          const failure = memoryOperationFailure({
            error,
            operation: 'memory-selection',
            stage: 'persist-select',
            targetRevision: `${friendId}:select:${mutationGeneration}`,
            timedOut: Boolean((error as any)?.timedOut),
            invalidPayload: Boolean((error as any)?.invalidPayload),
            cancelled: ((error as any)?.name === 'AbortError'
              || (error as any)?.code === 'REQUEST_CANCELLED')
              && !(error as any)?.timedOut,
            causeCode: (error as any)?.code,
          });
          set(state => {
            const rollback = failure.kind === 'cancelled'
              ? rollbackCancelledSelection(state, friendId)
              : {
                  subscriptions: state.subscriptions,
                  availableSources: state.availableSources,
                  selectionPending: state.selectionPending,
                };
            return {
              ...rollback,
              selectionError: failure.kind === 'cancelled'
                ? null
                : friendMemoryPresentationFailure(failure),
              selectionLastFailure: failure,
            };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        }
        return 0;
      }
    });
  },

  unsubscribe: async (friendId) => {
    // Fence the removal intent before yielding to the network. A failed
    // DELETE leaves the server subscription intact, but an older request can
    // no longer repopulate it; only a deliberate later fresh read may do so.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendMemoryStore } = require('./useFriendMemoryStore');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerAtStart = String(useAppStore.getState().user?.id ?? '');
    if (!viewerAtStart) return 0;
    const generationAtStart = subscriptionGeneration;
    const mutationGeneration = nextSelectionMutationGeneration(friendId);
    const source = get().availableSources.find(item => Number(item.friend_id) === friendId);
    const sourceAuthorityAtStart = sourceAuthorityKey(source);
    set(state => ({
      subscriptions: state.subscriptions.filter(item => Number(item.friend_id) !== friendId),
      selectionPending: { ...state.selectionPending, [String(friendId)]: 'deselect' },
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    }));
    persistSelectionIntents(viewerAtStart, get().selectionPending);
    useFriendMemoryStore.getState().hideFriend(friendId);
    return enqueueSelectionMutation(friendId, async () => {
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
        || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
      try {
        const selectionOrder = await allocateSelectionOrder(viewerAtStart, friendId);
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        const { response: res, body: responseBody } = await boundedSelectionRequest(`/api/memory-subscriptions/${friendId}`, {
          method: 'DELETE',
          body: JSON.stringify({
            selection_chain_id: selectionOrder.chainId,
            selection_sequence: selectionOrder.sequence,
            selection_request_id: selectionOrder.requestId,
            grant_epoch: source?.grant_epoch ?? null,
            friendship_episode_id: source?.friendship_episode_id ?? null,
            authorization_version: source?.authorization_version ?? null,
            coverage_scope: source?.coverage_scope ?? null,
          }),
          expectedUserId: viewerAtStart,
        }, true);
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        const responseCode = typeof responseBody?.code === 'string' ? responseBody.code : null;
        if (res.ok && !isValidOrderedSelectionAck(responseBody, {
          selected: false,
          chainId: selectionOrder.chainId,
          sequence: selectionOrder.sequence,
          requestId: selectionOrder.requestId,
        })) {
          throw invalidAuthorityPayload('selection');
        }
        if (res.ok) {
          markSelectionCommit(friendId, sourceAuthorityAtStart);
          set(state => {
            const selectionPending = { ...state.selectionPending };
            delete selectionPending[String(friendId)];
            return {
              availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
                ? { ...item, selected: false }
                : item),
              selectionPending,
              selectionError: null,
              selectionLastFailure: null,
            };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        } else {
          const failure = memoryOperationFailure({
            httpStatus: res.status,
            operation: 'memory-selection',
            stage: 'persist-deselect',
            targetRevision: `${friendId}:deselect:${mutationGeneration}`,
          });
          if (res.status === 401 || res.status === 403
            || responseCode === 'AUTHORIZATION_CHANGED') {
            // The server did not confirm the DELETE. Keep the fail-closed
            // deselect intent durable and hidden until an idempotent retry or
            // a current authority read establishes the terminal state.
            set({ selectionError: 'unauthorized' as const, selectionLastFailure: failure });
            persistSelectionIntents(viewerAtStart, get().selectionPending);
            if (responseCode === 'AUTHORIZATION_CHANGED') {
              useFriendMemoryStore.getState().invalidateFriend(friendId);
              await useFriendMemoryStore.getState().purgeFriend(friendId, viewerAtStart);
            }
          } else {
            if (responseCode === 'STALE_SELECTION_INTENT') {
              await adoptSelectionOrderFloor(
                viewerAtStart,
                friendId,
                responseBody?.selection_chain_id,
                responseBody?.selection_sequence,
              );
            }
            set({
              selectionError: classifyFriendMemoryFailure({ httpStatus: res.status }),
              selectionLastFailure: failure,
            });
          }
        }
        return res.status;
      } catch (error) {
        if (generationAtStart === subscriptionGeneration
          && String(useAppStore.getState().user?.id ?? '') === viewerAtStart
          && selectionMutationGenerations.get(String(friendId)) === mutationGeneration) {
          const failure = memoryOperationFailure({
            error,
            operation: 'memory-selection',
            stage: 'persist-deselect',
            targetRevision: `${friendId}:deselect:${mutationGeneration}`,
            timedOut: Boolean((error as any)?.timedOut),
            invalidPayload: Boolean((error as any)?.invalidPayload),
            cancelled: ((error as any)?.name === 'AbortError'
              || (error as any)?.code === 'REQUEST_CANCELLED')
              && !(error as any)?.timedOut,
            causeCode: (error as any)?.code,
          });
          set(state => {
            const rollback = failure.kind === 'cancelled'
              ? rollbackCancelledSelection(state, friendId)
              : {
                  subscriptions: state.subscriptions,
                  availableSources: state.availableSources,
                  selectionPending: state.selectionPending,
                };
            return {
              ...rollback,
              selectionError: failure.kind === 'cancelled'
                ? null
                : friendMemoryPresentationFailure(failure),
              selectionLastFailure: failure,
            };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        }
        return 0;
      }
    });
  },

  retrySelectionIntents: async () => {
    const intents = Object.entries(get().selectionPending);
    if (intents.length === 0) return true;
    const results = await Promise.all(intents.map(([friendId, intent]) => intent === 'select'
      ? get().subscribe(Number(friendId))
      : get().unsubscribe(Number(friendId))));
    return results.every((status, index) => {
      const [friendId] = intents[index];
      return ((status >= 200 && status < 300) || status === 404 || status === 409)
        && get().selectionPending[friendId] == null;
    });
  },

  isSubscribed: (friendId) =>
    get().subscriptions.some((s) => s.friend_id === friendId),

  removeFriendLocally: (friendId) => {
    const numericId = Number(friendId);
    nextSelectionMutationGeneration(numericId);
    markSelectionCommit(numericId);
    const nextPending = Object.fromEntries(Object.entries(get().selectionPending)
      .filter(([id]) => Number(id) !== numericId));
    set({
      subscriptions: get().subscriptions.filter(subscription => Number(subscription.friend_id) !== numericId),
      availableSources: get().availableSources.filter(source => Number(source.friend_id) !== numericId),
      loading: false,
      error: null,
      selectionPending: nextPending,
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerId = String(useAppStore.getState().user?.id ?? '');
    if (viewerId) persistSelectionIntents(viewerId, nextPending);
  },

  reset: () => {
    subscriptionGeneration += 1;
    for (const controller of activeSelectionControllers) controller.abort();
    activeSelectionControllers.clear();
    selectionMutationGenerations.clear();
    selectionCommitGenerations.clear();
    selectionCommitAuthorities.clear();
    selectionMutationTails.clear();
    set({
      limit: Number.POSITIVE_INFINITY,
      subscriptions: [],
      availableSources: [],
      loading: false,
      error: null,
      selectionPending: {},
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
      // O1 batch 37: lastMutationStatus removed
    });
  },
}));
