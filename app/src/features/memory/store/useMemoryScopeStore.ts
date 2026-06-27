/**
 * useMemoryScopeStore — Friend System v1 / Sprint 70 / STORY-00539
 *
 * Memory tab scope: 'mine' or 'friends'.
 *
 * 'mine'    = viewer's own fog + own marks (existing v346 pipeline)
 * 'friends' = viewer's fog UNION subscribed-friend fogs (Story-541) +
 *             friend-tier + Public marks visible per iron law 1
 *
 * State lives in its own tiny store so FogLayer + MarkLayer + the
 * Memory top-bar toggle all share one source of truth without prop
 * drilling through MemoryScreen.
 *
 * Default: 'mine' — first visit shows the viewer's own fog only.
 * No persistence: scope resets to 'mine' on app restart per product
 * (the social view is a deliberate switch, not a habit).
 */
import { create } from 'zustand';

export type MemoryScope = 'mine' | 'friends';

interface MemoryScopeState {
  scope: MemoryScope;
  setScope: (s: MemoryScope) => void;
}

export const useMemoryScopeStore = create<MemoryScopeState>((set) => ({
  scope: 'mine',
  setScope: (s) => set({ scope: s }),
}));
