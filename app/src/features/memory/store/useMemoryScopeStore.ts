import { create } from 'zustand';

export type MemoryScope = 'self' | 'combined';

interface MemoryScopeState {
  ownerUserId: string | null;
  scope: MemoryScope;
  activateOwner: (ownerUserId: string | null) => void;
  setScope: (scope: MemoryScope) => void;
}

export const useMemoryScopeStore = create<MemoryScopeState>((set) => ({
  ownerUserId: null,
  scope: 'self',
  activateOwner: (ownerUserId) => set((state) => (
    state.ownerUserId === ownerUserId
      ? state
      : { ownerUserId, scope: 'self' }
  )),
  setScope: (scope) => set({ scope }),
}));

/** Snapshot only when a new Route workspace is created. The editor must keep
 * its own scope after this call; later Memory toggles must not overwrite an
 * active editing session. */
export function memoryScopeForNewRoute(ownerUserId: string | number | null | undefined): MemoryScope {
  const state = useMemoryScopeStore.getState();
  const normalizedOwner = ownerUserId == null ? null : String(ownerUserId);
  return normalizedOwner && state.ownerUserId === normalizedOwner ? state.scope : 'self';
}
