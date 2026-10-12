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
  grants: MemoryFriendGrant[];
  delaySeconds: number;
  privatePlaces: MemoryPrivatePlace[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
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
  grants: [],
  delaySeconds: 1800,
  privatePlaces: [],
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    const requestGeneration = sessionGeneration;
    set({ loading: true, error: null });
    try {
      const [grantsResponse, placesResponse] = await Promise.all([
        authenticatedFetch('/api/friend-sharing/grants'),
        authenticatedFetch('/api/friend-sharing/private-places'),
      ]);
      if (!grantsResponse.ok || !placesResponse.ok) throw new Error('sharing_unavailable');
      const grants = await grantsResponse.json();
      const places = await placesResponse.json();
      if (requestGeneration !== sessionGeneration) return;
      set({
        grants: Array.isArray(grants.grants) ? grants.grants : [],
        delaySeconds: Number(grants.delay_seconds ?? 1800),
        privatePlaces: Array.isArray(places.private_places) ? places.private_places : [],
        loading: false,
      });
    } catch {
      if (requestGeneration !== sessionGeneration) return;
      set({ loading: false, error: 'Connect to manage sharing.' });
    }
  },

  setGrant: async (friendId, enabled) => {
    const requestGeneration = sessionGeneration;
    const previous = get().grants;
    set({
      grants: previous.map(grant => grant.friend_id === friendId ? { ...grant, enabled } : grant),
      loading: true,
      error: null,
    });
    try {
      const response = await authenticatedFetch(`/api/friend-sharing/grants/${encodeURIComponent(friendId)}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('sharing_update_failed');
      if (requestGeneration !== sessionGeneration) return false;
      set({
        loading: false,
      });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration) return false;
      set({ grants: previous, loading: false, error: 'Connect and try again. Your previous sharing choices are unchanged.' });
      return false;
    }
  },

  applyGrantSelection: async (friendIds) => {
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
      });
      if (!response.ok) throw new Error('sharing_bulk_update_failed');
      if (requestGeneration !== sessionGeneration) return false;
      set({ loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration) return false;
      set({ grants: previous, loading: false, error: 'Connect and try again. Your previous sharing choices are unchanged.' });
      return false;
    }
  },

  addPrivatePlace: async (lat, lng, label) => {
    const requestGeneration = sessionGeneration;
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/private-places', {
        method: 'POST',
        body: JSON.stringify({ lat, lng, radius_m: 250, label }),
      });
      if (!response.ok) throw new Error('private_place_failed');
      const place = await response.json();
      if (requestGeneration !== sessionGeneration) return false;
      set({ privatePlaces: [place, ...get().privatePlaces], loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration) return false;
      set({ loading: false, error: 'Could not protect this place. Connect and try again.' });
      return false;
    }
  },

  removePrivatePlace: async (id) => {
    const requestGeneration = sessionGeneration;
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch(`/api/friend-sharing/private-places/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('private_place_remove_failed');
      if (requestGeneration !== sessionGeneration) return false;
      set({ privatePlaces: get().privatePlaces.filter(place => place.id !== id), loading: false });
      return true;
    } catch {
      if (requestGeneration !== sessionGeneration) return false;
      set({ loading: false, error: 'Could not update protected places.' });
      return false;
    }
  },

  reset: () => {
    sessionGeneration += 1;
    set({ grants: [], delaySeconds: 1800, privatePlaces: [], loading: false, error: null });
  },
}));
