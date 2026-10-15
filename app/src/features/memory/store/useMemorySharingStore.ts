import { create } from 'zustand';
import { authenticatedFetch } from '../../../services/apiService';

export interface MemoryPrivatePlace {
  id: number;
  label: string | null;
  lat: number;
  lng: number;
  radius_m: number;
  created_at?: string;
}

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
  privatePlaces: MemoryPrivatePlace[];
  loading: boolean;
  grantsLoading: boolean;
  placesLoading: boolean;
  grantPendingIds: string[];
  grantErrors: Record<string, string>;
  placesError: string | null;
  error: string | null;
  load: (ownerId: string) => Promise<void>;
  setGrant: (friendId: string, enabled: boolean) => Promise<boolean>;
  applyGrantSelection: (friendIds: string[]) => Promise<boolean>;
  addPrivatePlace: (lat: number, lng: number, label?: string) => Promise<boolean>;
  removePrivatePlace: (id: number) => Promise<boolean>;
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
  privatePlaces: [],
  loading: false,
  grantsLoading: false,
  placesLoading: false,
  grantPendingIds: [],
  grantErrors: {},
  placesError: null,
  error: null,

  load: async (ownerId) => {
    const normalizedOwnerId = String(ownerId || '');
    if (!normalizedOwnerId) {
      sessionGeneration += 1;
      set({ ownerId: null, grants: [], privatePlaces: [], loading: false, grantsLoading: false, placesLoading: false, grantPendingIds: [], grantErrors: {}, placesError: null, error: null });
      return;
    }
    if (get().ownerId !== normalizedOwnerId) {
      sessionGeneration += 1;
      set({ ownerId: normalizedOwnerId, grants: [], privatePlaces: [], loading: false, grantsLoading: false, placesLoading: false, grantPendingIds: [], grantErrors: {}, placesError: null, error: null });
    }
    if (get().loading) return;
    const requestGeneration = sessionGeneration;
    set({ loading: true, grantsLoading: true, placesLoading: true, error: null, placesError: null });
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
        set({ grantsLoading: false, error: 'Connect to manage sharing.' });
      }
    })();
    const placesTask = (async () => {
      try {
        const response = await authenticatedFetch('/api/friend-sharing/private-places', { expectedUserId: normalizedOwnerId });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (requestGeneration !== sessionGeneration || get().ownerId !== normalizedOwnerId) return;
        set({ privatePlaces: Array.isArray(body.private_places) ? body.private_places : [], placesLoading: false, placesError: null });
      } catch {
        if (requestGeneration !== sessionGeneration || get().ownerId !== normalizedOwnerId) return;
        set({ placesLoading: false, placesError: 'Private-place settings are unavailable.' });
      }
    })();
    await Promise.allSettled([grantsTask, placesTask]);
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
        grantErrors: { ...get().grantErrors, [friendId]: 'Could not update. Your previous choice is unchanged.' },
      });
      return false;
    }
  },

  applyGrantSelection: async (friendIds) => {
    const ownerId = get().ownerId;
    if (!ownerId) return false;
    const requestGeneration = sessionGeneration;
    const previous = get().grants;
    const selected = new Set(friendIds);
    set({
      grants: previous.map(grant => ({ ...grant, enabled: selected.has(grant.friend_id) })),
      loading: true,
      error: null,
    });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/grants', {
        method: 'PUT',
        body: JSON.stringify({ friend_ids: [...selected] }),
        expectedUserId: ownerId,
      });
      if (!response.ok) throw new Error('sharing_bulk_update_failed');
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ grants: previous, loading: false, error: 'Connect and try again. Your previous sharing choices are unchanged.' });
      return false;
    }
  },

  addPrivatePlace: async (lat, lng, label) => {
    const ownerId = get().ownerId;
    if (!ownerId) return false;
    const requestGeneration = sessionGeneration;
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/private-places', {
        method: 'POST',
        body: JSON.stringify({ lat, lng, radius_m: 250, label }),
        expectedUserId: ownerId,
      });
      if (!response.ok) throw new Error('private_place_failed');
      const place = await response.json();
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ privatePlaces: [place, ...get().privatePlaces], loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ loading: false, error: 'Could not protect this place. Connect and try again.' });
      return false;
    }
  },

  removePrivatePlace: async (id) => {
    const ownerId = get().ownerId;
    if (!ownerId) return false;
    const requestGeneration = sessionGeneration;
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch(`/api/friend-sharing/private-places/${id}`, {
        method: 'DELETE', expectedUserId: ownerId,
      });
      if (!response.ok) throw new Error('private_place_remove_failed');
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ privatePlaces: get().privatePlaces.filter(place => place.id !== id), loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration || get().ownerId !== ownerId) return false;
      set({ loading: false, error: 'Could not update protected places.' });
      return false;
    }
  },

  reset: () => {
    sessionGeneration += 1;
    set({ ownerId: null, grants: [], delaySeconds: 1800, privatePlaces: [], loading: false, grantsLoading: false, placesLoading: false, grantPendingIds: [], grantErrors: {}, placesError: null, error: null });
  },
}));
