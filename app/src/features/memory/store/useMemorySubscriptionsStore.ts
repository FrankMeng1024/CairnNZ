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

export interface MemorySubscription {
  friend_id: number;
  friend_name: string;
  friend_email: string;
  subscribed_at?: string;
}

interface State {
  limit: number;        // server-side memory_subscription_limit (default 5)
  subscriptions: MemorySubscription[];
  loading: boolean;
  error: string | null;
  /** Last raw HTTP status from a mutation, for UI to map 409 → paywall trigger. */
  lastMutationStatus: number | null;

  load: () => Promise<void>;
  /** Returns server status code so caller can branch on 201/403/409. */
  subscribe: (friendId: number) => Promise<number>;
  unsubscribe: (friendId: number) => Promise<number>;
  /** Convenience selector — does this user count as picked? */
  isSubscribed: (friendId: number) => boolean;
}

export const useMemorySubscriptionsStore = create<State>((set, get) => ({
  limit: 5,
  subscriptions: [],
  loading: false,
  error: null,
  lastMutationStatus: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const res = await authenticatedFetch('/api/memory-subscriptions');
      if (!res.ok) { set({ loading: false, error: `HTTP ${res.status}` }); return; }
      const data = await res.json();
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
      set({ lastMutationStatus: res.status });
      if (res.ok) {
        // Re-fetch to get the canonical row (name + email).
        await get().load();
      }
      return res.status;
    } catch {
      set({ lastMutationStatus: 0 });
      return 0;
    }
  },

  unsubscribe: async (friendId) => {
    try {
      const res = await authenticatedFetch(`/api/memory-subscriptions/${friendId}`, {
        method: 'DELETE',
      });
      set({ lastMutationStatus: res.status });
      if (res.ok) {
        set({ subscriptions: get().subscriptions.filter((s) => s.friend_id !== friendId) });
      }
      return res.status;
    } catch {
      set({ lastMutationStatus: 0 });
      return 0;
    }
  },

  isSubscribed: (friendId) =>
    get().subscriptions.some((s) => s.friend_id === friendId),
}));
