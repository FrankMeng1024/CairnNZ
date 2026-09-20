import { create } from 'zustand';

export type MemoryScope = 'self' | 'combined' | 'friend';

interface MemoryScopeState {
  scope: MemoryScope;
  selectedFriendId: string | null;
  setScope: (scope: MemoryScope, selectedFriendId?: string | null) => void;
}

export const useMemoryScopeStore = create<MemoryScopeState>((set) => ({
  scope: 'self',
  selectedFriendId: null,
  setScope: (scope, selectedFriendId = null) => set({
    scope,
    selectedFriendId: scope === 'friend' ? selectedFriendId : null,
  }),
}));
