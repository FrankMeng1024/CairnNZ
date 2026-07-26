/**
 * useMemorySubscriptionsStore — Friend System v1 / Sprint 70 / STORY-00540
 *
 * Memory tab 5-friend pick state, backed by Sprint 67 backend endpoints
 *   GET    /api/memory-subscriptions       → { limit, count, subscriptions[] }
 *   POST   /api/memory-subscriptions       body { friend_id }
 *   DELETE /api/memory-subscriptions/:fid
 *
 * Local slice mirrors what the server has so UI doesn't blink. Trigger
 * on the server enforces the 5-cap (race-safe SELECT...FOR UPDATE);
 * client also displays the cap visually as 🔒 on the 6th+ friend.
 */
import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';

interface MemorySubscription {
  friend_id: number;
  friend_name: string;
  subscribed_at?: string;
}

interface State {
  limit: number;        // server-side memory_subscription_limit (default 5)
  subscriptions: MemorySubscription[];
  loading: boolean;
  error: string | null;
  /** Last raw HTTP status from a mutation, for UI to map 409 → paywall trigger. */
  // O1 batch 37: lastMutationStatus removed — 0 external readers; callers use the return value directly.

  load: () => Promise<void>;
  /** Returns server status code so caller can branch on 201/403/409. */
  subscribe: (friendId: number) => Promise<number>;
  unsubscribe: (friendId: number) => Promise<number>;
  /** Convenience selector — does this user count as picked? */
  isSubscribed: (friendId: number) => boolean;
  /** BUG-010 fix: reset slice on user switch (called from useMarkerStore
   *  clearMarkers / hydrate). Prevents prior user's subscriptions leaking
   *  into a new session. */
  reset: () => void;
}

export const useMemorySubscriptionsStore = create<State>((set, get) => ({
  limit: 5,
  subscriptions: [],
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
    if (get().loading) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useMarkerStore } = require('../../../store/useMarkerStore');
    const viewerAtStart: string | null = useMarkerStore.getState().userId;
    set({ loading: true, error: null });
    try {
      const res = await authenticatedFetch('/api/memory-subscriptions');
      const viewerNow: string | null = useMarkerStore.getState().userId;
      if (viewerNow !== viewerAtStart) {
        // User switched during the fetch — drop response, leave reset()'s
        // empty slice intact. Do not flag as error; this is correct discard.
        set({ loading: false });
        return;
      }
      if (!res.ok) { set({ loading: false, error: `HTTP ${res.status}` }); return; }
      const data = await res.json();
      // Re-check viewer after the json() await — another potential yield point.
      const viewerAfterJson: string | null = useMarkerStore.getState().userId;
      if (viewerAfterJson !== viewerAtStart) {
        set({ loading: false });
        return;
      }
      set({
        limit: data.limit ?? 5,
        subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [],
        loading: false,
      });
    } catch (e: any) {
      set({ loading: false, error: String(e?.message ?? e).slice(0, 120) });
    }
  },

  subscribe: async (friendId) => {
    try {
      const res = await authenticatedFetch('/api/memory-subscriptions', {
        method: 'POST',
        body: JSON.stringify({ friend_id: friendId }),
      });
      if (res.ok) {
        // Re-fetch to get the canonical row (name + email).
        await get().load();
      }
      return res.status;
    } catch {
      return 0;
    }
  },

  unsubscribe: async (friendId) => {
    try {
      const res = await authenticatedFetch(`/api/memory-subscriptions/${friendId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        set({ subscriptions: get().subscriptions.filter((s) => s.friend_id !== friendId) });
      }
      return res.status;
    } catch {
      return 0;
    }
  },

  isSubscribed: (friendId) =>
    get().subscriptions.some((s) => s.friend_id === friendId),

  reset: () =>
    set({
      limit: 5,
      subscriptions: [],
      loading: false,
      error: null,
      // O1 batch 37: lastMutationStatus removed
    }),
}));
