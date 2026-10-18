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
