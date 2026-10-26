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
const selectionMutationTails = new Map<string, Promise<void>>();
const selectionIntentPersistenceTails = new Map<string, Promise<void>>();
const SELECTION_INTENT_PREFIX = 'cairn:memory-selection-intent:v1:';
const AUTHORITY_REFRESH_INTERVAL_MS = 2 * 60 * 1000;

function selectionIntentKey(userId: string): string {
  return `${SELECTION_INTENT_PREFIX}${userId}`;
}

function persistSelectionIntents(
  userId: string,
  pending: Record<string, 'select' | 'deselect'>,
): void {
  if (!userId) return;
  const previous = selectionIntentPersistenceTails.get(userId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    if (Object.keys(pending).length === 0) {
      await storage.removeItem(selectionIntentKey(userId));
    } else {
      await storage.setItem(selectionIntentKey(userId), JSON.stringify(pending));
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
    sources: sources.map(source => {
      const intent = pending[String(source.friend_id)];
      return intent ? { ...source, selected: intent === 'select' } : source;
    }),
  };
}

function resolvedFriendName(nextName: unknown, previousName?: string): string {
  const candidate = typeof nextName === 'string' ? nextName.trim() : '';
  if (candidate && !/^\d+$/.test(candidate)) return candidate;
  return previousName?.trim() || candidate;
}

/** Preserve stable row/name identity across authorization refreshes. Status
 * accessories may update; an already resolved label such as `frank test`
 * never blanks or swaps through a numeric fallback. */
export function reconcileAvailableMemorySources(
  previous: AvailableMemorySource[],
  incoming: AvailableMemorySource[],
): AvailableMemorySource[] {
  const priorById = new Map(previous.map(source => [String(source.friend_id), source]));
  return incoming.map(source => {
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
      && prior.effective_at === next.effective_at
      && prior.sharing_status === next.sharing_status
      && prior.coverage_scope === next.coverage_scope
      ? prior
      : next;
  });
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
    if (!force && get().authorityValidatedAtMs > 0
      && Date.now() - get().authorityValidatedAtMs < AUTHORITY_REFRESH_INTERVAL_MS) return true;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerAtStart = String(useAppStore.getState().user?.id ?? '');
    if (!viewerAtStart) return false;
    const generationAtStart = subscriptionGeneration;
    set({ loading: true, error: null });
    const durableIntentsPromise = readSelectionIntents(viewerAtStart);
    // A routine sources refresh (including opening the picker) must not erase
    // a still-valid, short-lived server proof. Focus/account transitions can
    // deliberately call suspendVisibility() before this read; a successful
    // reconciliation restores only matching unexpired projections, while a
    // failed read leaves that explicit hard fence in place.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendMemoryStore } = require('./useFriendMemoryStore');
    try {
      // Start authority reads immediately; durable intent hydration is local
      // bookkeeping and must not postpone the request or defeat single-flight.
      const responsePromise = Promise.all([
        authenticatedFetch('/api/memory-subscriptions', { expectedUserId: viewerAtStart }),
        authenticatedFetch('/api/friend-sharing/sources', { expectedUserId: viewerAtStart }),
      ]);
      const durableIntents = await durableIntentsPromise;
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) {
        void responsePromise.catch(() => undefined);
        return false;
      }
      if (Object.keys(durableIntents).length > 0) {
        set(state => ({
          selectionPending: { ...durableIntents, ...state.selectionPending },
        }));
      }
      const [res, sourcesResponse] = await responsePromise;
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      const sourcesBody = sourcesResponse.ok ? await sourcesResponse.json() : null;
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      const nextSources = sourcesBody && Array.isArray(sourcesBody.sources) ? sourcesBody.sources : null;
      const previousSources = get().availableSources;
      if (!res.ok) {
        set({
          ...(nextSources ? {
            availableSources: reconcileAvailableMemorySources(previousSources, nextSources),
          } : {}),
          loading: false,
          error: cairnText('memory.use-memory-subscriptions-store.could-not-load-memory-friends-http-value', { status: res.status }),
        });
        // The sources endpoint is the grant authority. Even if the parallel
        // subscriptions list failed, consume a successful source response so
        // a revoke/version rotation still fences geometry immediately.
        if (nextSources) {
          await useFriendMemoryStore.getState().reconcileAuthorizedSources(
            nextSources,
            sourcesBody?.complete !== false,
          );
        }
        return false;
      }
      const data = await res.json();
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      const reconciledSources = nextSources
        ? reconcileAvailableMemorySources(previousSources, nextSources)
        : previousSources;
      const withIntents = applyPendingSelectionIntents(
        Array.isArray(data.subscriptions) ? data.subscriptions : [],
        reconciledSources,
        get().selectionPending,
      );
      set({
        limit: data.limit == null ? Number.POSITIVE_INFINITY : Number(data.limit),
        subscriptions: withIntents.subscriptions,
        ...(nextSources ? {
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
          nextSources,
          sourcesBody?.complete !== false,
        );
      }
      return Boolean(nextSources);
    } catch (e: any) {
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      set({ loading: false, error: String(e?.message ?? e).slice(0, 120) });
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
    if (source?.sharing_status === 'not_shared') return 403;
    const existing = get().subscriptions.find(item => Number(item.friend_id) === friendId);
    const optimistic = existing ?? {
      friend_id: friendId,
      friend_name: source?.friend_name ?? String(friendId),
      subscribed_at: new Date().toISOString(),
    };
    set(state => ({
      subscriptions: existing ? state.subscriptions : [...state.subscriptions, optimistic],
      availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
        ? { ...item, selected: true }
        : item),
      selectionPending: { ...state.selectionPending, [String(friendId)]: 'select' },
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    }));
    persistSelectionIntents(viewerAtStart, get().selectionPending);
    return enqueueSelectionMutation(friendId, async () => {
      try {
        const res = await authenticatedFetch('/api/memory-subscriptions', {
          method: 'POST',
          body: JSON.stringify({ friend_id: friendId }),
          expectedUserId: viewerAtStart,
        });
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        if (res.ok || res.status === 409) {
          set(state => {
            const selectionPending = { ...state.selectionPending };
            delete selectionPending[String(friendId)];
            return { selectionPending, selectionError: null, selectionLastFailure: null };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        } else {
          const failure = memoryOperationFailure({
            httpStatus: res.status,
            operation: 'memory-selection',
            stage: 'persist-select',
            targetRevision: `${friendId}:select:${mutationGeneration}`,
          });
          if (res.status === 401 || res.status === 403) {
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
          set({
            selectionError: 'offline',
            selectionLastFailure: memoryOperationFailure({
              error,
              operation: 'memory-selection',
              stage: 'persist-select',
              targetRevision: `${friendId}:select:${mutationGeneration}`,
            }),
          });
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
    set(state => ({
      subscriptions: state.subscriptions.filter(item => Number(item.friend_id) !== friendId),
      availableSources: state.availableSources.map(item => Number(item.friend_id) === friendId
        ? { ...item, selected: false }
        : item),
      selectionPending: { ...state.selectionPending, [String(friendId)]: 'deselect' },
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    }));
    persistSelectionIntents(viewerAtStart, get().selectionPending);
    useFriendMemoryStore.getState().hideFriend(friendId);
    return enqueueSelectionMutation(friendId, async () => {
      try {
        const res = await authenticatedFetch(`/api/memory-subscriptions/${friendId}`, {
          method: 'DELETE',
          expectedUserId: viewerAtStart,
        });
        if (generationAtStart !== subscriptionGeneration
          || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart
          || selectionMutationGenerations.get(String(friendId)) !== mutationGeneration) return 0;
        if (res.ok || res.status === 404) {
          set(state => {
            const selectionPending = { ...state.selectionPending };
            delete selectionPending[String(friendId)];
            return { selectionPending, selectionError: null, selectionLastFailure: null };
          });
          persistSelectionIntents(viewerAtStart, get().selectionPending);
        } else {
          const failure = memoryOperationFailure({
            httpStatus: res.status,
            operation: 'memory-selection',
            stage: 'persist-deselect',
            targetRevision: `${friendId}:deselect:${mutationGeneration}`,
          });
          if (res.status === 401 || res.status === 403) {
            set(state => {
              const selectionPending = { ...state.selectionPending };
              delete selectionPending[String(friendId)];
              return { selectionPending, selectionError: 'unauthorized' as const, selectionLastFailure: failure };
            });
            persistSelectionIntents(viewerAtStart, get().selectionPending);
          } else {
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
          set({
            selectionError: 'offline',
            selectionLastFailure: memoryOperationFailure({
              error,
              operation: 'memory-selection',
              stage: 'persist-deselect',
              targetRevision: `${friendId}:deselect:${mutationGeneration}`,
            }),
          });
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
    return results.every(status => (status >= 200 && status < 300) || status === 404 || status === 409);
  },

  isSubscribed: (friendId) =>
    get().subscriptions.some((s) => s.friend_id === friendId),

  removeFriendLocally: (friendId) => {
    const numericId = Number(friendId);
    subscriptionGeneration += 1;
    set({
      subscriptions: get().subscriptions.filter(subscription => Number(subscription.friend_id) !== numericId),
      availableSources: get().availableSources.filter(source => Number(source.friend_id) !== numericId),
      loading: false,
      error: null,
      selectionPending: Object.fromEntries(Object.entries(get().selectionPending)
        .filter(([id]) => Number(id) !== numericId)),
      selectionError: null,
      selectionLastFailure: null,
      authorityValidatedAtMs: 0,
    });
  },

  reset: () => {
    subscriptionGeneration += 1;
    selectionMutationGenerations.clear();
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
