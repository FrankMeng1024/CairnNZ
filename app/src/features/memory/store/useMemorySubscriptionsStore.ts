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
  /** Last raw HTTP status from a mutation, for UI to map 409 → paywall trigger. */
  // O1 batch 37: lastMutationStatus removed — 0 external readers; callers use the return value directly.

  load: () => Promise<boolean>;
  /** Returns server status code so caller can branch on 201/403/409. */
  subscribe: (friendId: number) => Promise<number>;
  unsubscribe: (friendId: number) => Promise<number>;
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
  // O1 batch 37: lastMutationStatus removed

  load: async () => {
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
    if (get().loading) return false;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useAppStore } = require('../../../store/useAppStore');
    const viewerAtStart = String(useAppStore.getState().user?.id ?? '');
    if (!viewerAtStart) return false;
    const generationAtStart = subscriptionGeneration;
    // A routine sources refresh (including opening the picker) must not erase
    // a still-valid, short-lived server proof. Focus/account transitions can
    // deliberately call suspendVisibility() before this read; a successful
    // reconciliation restores only matching unexpired projections, while a
    // failed read leaves that explicit hard fence in place.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useFriendMemoryStore } = require('./useFriendMemoryStore');
    set({ loading: true, error: null });
    try {
      const [res, sourcesResponse] = await Promise.all([
        authenticatedFetch('/api/memory-subscriptions', { expectedUserId: viewerAtStart }),
        authenticatedFetch('/api/friend-sharing/sources', { expectedUserId: viewerAtStart }),
      ]);
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
          error: `Could not load Memory friends (HTTP ${res.status}).`,
        });
        // The sources endpoint is the grant authority. Even if the parallel
        // subscriptions list failed, consume a successful source response so
        // a revoke/version rotation still fences geometry immediately.
        if (nextSources) {
          await useFriendMemoryStore.getState().reconcileAuthorizedSources(nextSources);
        }
        return false;
      }
      const data = await res.json();
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return false;
      set({
        limit: data.limit == null ? Number.POSITIVE_INFINITY : Number(data.limit),
        subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
        ...(nextSources ? {
          availableSources: reconcileAvailableMemorySources(previousSources, nextSources),
        } : {}),
        loading: false,
        error: sourcesBody ? null : `Could not refresh available friends (HTTP ${sourcesResponse.status}).`,
      });
      // A durable Fog cache is never self-authorizing. A fresh sources read
      // purges revoked/version-stale rows and restores proof only for an
      // unexpired in-memory projection from the exact same grant. If this
      // routine read fails, an already valid server-issued proof remains
      // usable only until its own expiry timer; a caller-applied hard fence
      // remains fenced because there is no successful reconciliation.
      if (nextSources) {
        await useFriendMemoryStore.getState().reconcileAuthorizedSources(nextSources);
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
    try {
      const res = await authenticatedFetch('/api/memory-subscriptions', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId }),
        expectedUserId: viewerAtStart,
      });
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return 0;
      if (res.ok) {
        // Optimistic update: add locally from friendStore instead of
        // re-fetching — avoids an extra round-trip that caused visible
        // lag when tapping friends in the pick modal.
        const { useFriendStore } = require('../../../store/useFriendStore');
        const friend = useFriendStore.getState().friends.find(
          (f: { id: string; name: string }) => Number(f.id) === friendId,
        );
        const newSub = {
          friend_id: friendId,
          friend_name: friend?.name ?? String(friendId),
          subscribed_at: new Date().toISOString(),
        };
        if (!get().subscriptions.some(subscription => Number(subscription.friend_id) === friendId)) {
          set({ subscriptions: [...get().subscriptions, newSub] });
        }
        set({
          availableSources: get().availableSources.map(source =>
            Number(source.friend_id) === friendId ? { ...source, selected: true } : source),
        });
      }
      return res.status;
    } catch {
      return 0;
    }
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
    useFriendMemoryStore.getState().invalidateFriend(friendId);
    try {
      const res = await authenticatedFetch(`/api/memory-subscriptions/${friendId}`, {
        method: 'DELETE',
        expectedUserId: viewerAtStart,
      });
      if (generationAtStart !== subscriptionGeneration
        || String(useAppStore.getState().user?.id ?? '') !== viewerAtStart) return 0;
      if (res.ok) {
        set({ subscriptions: get().subscriptions.filter((s) => s.friend_id !== friendId) });
        set({
          availableSources: get().availableSources.map(source =>
            Number(source.friend_id) === friendId ? { ...source, selected: false } : source),
        });
        await useFriendMemoryStore.getState().purgeFriend(friendId, viewerAtStart);
      }
      return res.status;
    } catch {
      return 0;
    }
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
    });
  },

  reset: () => {
    subscriptionGeneration += 1;
    set({
      limit: Number.POSITIVE_INFINITY,
      subscriptions: [],
      availableSources: [],
      loading: false,
      error: null,
      // O1 batch 37: lastMutationStatus removed
    });
  },
}));
