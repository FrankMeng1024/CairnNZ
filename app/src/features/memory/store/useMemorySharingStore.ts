import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';
import { cairnText } from '../../../i18n/runtime';

export interface MemoryFriendGrant {
  friend_id: string;
  friend_name: string;
  enabled: boolean;
  coverage_scope: 'full_history_delayed_v1' | null;
  consent_version: number;
  effective_at: string | null;
}

interface State {
  ownerId: string | null;
  grants: MemoryFriendGrant[];
  delaySeconds: number;
  loading: boolean;
  grantsLoading: boolean;
  grantPendingIds: string[];
  grantErrors: Record<string, string>;
  error: string | null;
  load: (ownerId: string) => Promise<void>;
  setGrant: (friendId: string, enabled: boolean) => Promise<boolean>;
  reset: () => void;
}

// Fences late account-A replies after reset/logout. The server remains the
// authority; this only prevents an old in-flight read or failed optimistic
// mutation from repopulating account-B's local sharing UI.
let sessionGeneration = 0;

export const useMemorySharingStore = create<State>((set, get) => ({
  ownerId: null,
  grants: [],
  delaySeconds: 1800,
  loading: false,
  grantsLoading: false,
  grantPendingIds: [],
  grantErrors: {},
  error: null,

  load: async (ownerId) => {
    const normalizedOwnerId = String(ownerId || '');
    if (!normalizedOwnerId) {
      sessionGeneration += 1;
      set({ ownerId: null, grants: [], loading: false, grantsLoading: false, grantPendingIds: [], grantErrors: {}, error: null });
      return;
    }
    if (get().ownerId !== normalizedOwnerId) {
      sessionGeneration += 1;
      set({ ownerId: normalizedOwnerId, grants: [], loading: false, grantsLoading: false, grantPendingIds: [], grantErrors: {}, error: null });
    }
    if (get().loading) return;
    const requestGeneration = sessionGeneration;
    set({ loading: true, grantsLoading: true, error: null });
    const grantsTask = (async () => {
      try {
        const response = await authenticatedFetch('/api/friend-sharing/grants', { expectedUserId: normalizedOwnerId });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (requestGeneration !== sessionGeneration || get().ownerId !== normalizedOwnerId) return;
        set({
          grants: Array.isArray(body.grants) ? body.grants : [],
          delaySeconds: Number(body.delay_seconds ?? 1800),
          grantsLoading: false,
          error: null,
        });
      } catch {
        if (requestGeneration !== sessionGeneration || get().ownerId !== normalizedOwnerId) return;
        set({ grantsLoading: false, error: cairnText('memory.use-memory-sharing-store.connect-to-manage-sharing') });
      }
    })();
    await grantsTask;
    if (requestGeneration === sessionGeneration && get().ownerId === normalizedOwnerId) set({ loading: false });
  },

  setGrant: async (friendId, enabled) => {
    const ownerId = get().ownerId;
    if (!ownerId) return false;
    if (get().grantPendingIds.includes(friendId)) return false;
    const requestGeneration = sessionGeneration;
    const previous = get().grants;
    const previousEnabled = previous.find(grant => grant.friend_id === friendId)?.enabled ?? false;
    set({
      grants: previous.map(grant => grant.friend_id === friendId ? { ...grant, enabled } : grant),
      grantPendingIds: [...get().grantPendingIds, friendId],
      grantErrors: Object.fromEntries(Object.entries(get().grantErrors).filter(([id]) => id !== friendId)),
    });
    try {
      const response = await authenticatedFetch(`/api/friend-sharing/grants/${encodeURIComponent(friendId)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
        expectedUserId: ownerId,
      });
      if (!response.ok) throw new Error('sharing_update_failed');
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      const body = await response.json().catch(() => ({}));
      set({
        grants: get().grants.map(grant => grant.friend_id === friendId
          ? { ...grant, enabled: Boolean(body.enabled), coverage_scope: body.coverage_scope ?? grant.coverage_scope }
          : grant),
        grantPendingIds: get().grantPendingIds.filter(id => id !== friendId),
      });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({
        grants: get().grants.map(grant => grant.friend_id === friendId ? { ...grant, enabled: previousEnabled } : grant),
        grantPendingIds: get().grantPendingIds.filter(id => id !== friendId),
        grantErrors: { ...get().grantErrors, [friendId]: cairnText('memory.sharing.update-failed') },
      });
      return false;
    }
  },

  reset: () => {
    sessionGeneration += 1;
    set({ ownerId: null, grants: [], delaySeconds: 1800, loading: false, grantsLoading: false, grantPendingIds: [], grantErrors: {}, error: null });
  },
}));
