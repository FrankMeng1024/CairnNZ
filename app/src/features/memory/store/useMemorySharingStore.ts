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

interface State {
  enabled: boolean;
  policyEpoch: number;
  enabledAt: string | null;
  privatePlaces: MemoryPrivatePlace[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  addPrivatePlace: (lat: number, lng: number, label?: string) => Promise<boolean>;
  removePrivatePlace: (id: number) => Promise<boolean>;
  reset: () => void;
}

export const useMemorySharingStore = create<State>((set, get) => ({
  enabled: false,
  policyEpoch: 1,
  enabledAt: null,
  privatePlaces: [],
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const [policyResponse, placesResponse] = await Promise.all([
        authenticatedFetch('/api/friend-sharing/policy'),
        authenticatedFetch('/api/friend-sharing/private-places'),
      ]);
      if (!policyResponse.ok || !placesResponse.ok) throw new Error('sharing_unavailable');
      const policy = await policyResponse.json();
      const places = await placesResponse.json();
      set({
        enabled: Boolean(policy.enabled),
        policyEpoch: Number(policy.policy_epoch ?? 1),
        enabledAt: policy.enabled_at ?? null,
        privatePlaces: Array.isArray(places.private_places) ? places.private_places : [],
        loading: false,
      });
    } catch {
      set({ loading: false, error: 'Connect to manage sharing.' });
    }
  },

  setEnabled: async (enabled) => {
    const previous = get().enabled;
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/policy', {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error('sharing_update_failed');
      const policy = await response.json();
      set({
        enabled: Boolean(policy.enabled),
        policyEpoch: Number(policy.policy_epoch ?? get().policyEpoch),
        enabledAt: policy.enabled_at ?? null,
        loading: false,
      });
      return true;
    } catch {
      set({ enabled: previous, loading: false, error: 'Connect and try again. Your previous setting is unchanged.' });
      return false;
    }
  },

  addPrivatePlace: async (lat, lng, label) => {
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch('/api/friend-sharing/private-places', {
        method: 'POST',
        body: JSON.stringify({ lat, lng, radius_m: 250, label }),
      });
      if (!response.ok) throw new Error('private_place_failed');
      const place = await response.json();
      set({ privatePlaces: [place, ...get().privatePlaces], loading: false });
      return true;
    } catch {
      set({ loading: false, error: 'Could not protect this place. Connect and try again.' });
      return false;
    }
  },

  removePrivatePlace: async (id) => {
    set({ loading: true, error: null });
    try {
      const response = await authenticatedFetch(`/api/friend-sharing/private-places/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('private_place_remove_failed');
      set({ privatePlaces: get().privatePlaces.filter(place => place.id !== id), loading: false });
      return true;
    } catch {
      set({ loading: false, error: 'Could not update protected places.' });
      return false;
    }
  },

  reset: () => set({ enabled: false, policyEpoch: 1, enabledAt: null, privatePlaces: [], loading: false, error: null }),
}));
