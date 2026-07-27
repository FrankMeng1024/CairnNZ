/**
 * useMarkLikeStore — Friend System v1 / Sprint 68 / STORY-00533
 *
 * Session-only Like state for the v1 Detail Sheet. NOT mock — this is the
 * spec'd v1 product behavior per v4 §4.12:
 *   - Tap ❤ → red fill + count +1 (visible in this app session only)
 *   - Cold restart → like state gone, button restored
 *   - NO HTTP, NO DB write — local Set only
 *
 * v1.1 will wire to the production `POST /api/markers/:id/vote` endpoint
 * (already live for community marks; see MarkerDetailScreen). This v1 store
 * exists so the UI surface in Story-532 has a real toggle to bind against,
 * without coupling the friend-system flow to v1.1's vote contract.
 *
 * Implementation: Zustand. Storage = none (`Set` lives in memory; lost on
 * unmount of the Zustand provider, which happens on app process kill).
 */

import { create } from 'zustand';

interface MarkLikeState {
  /** Set of mark ids the viewer has liked this session. */
  liked: ReadonlyArray<string>;

  /** Toggle the like state for a mark. Idempotent — calling twice returns
   *  the original state. Returns the new liked status for that mark. */
  toggle: (markId: string) => boolean;
  // O1 batch 40: isLiked, reset removed — 0 external callers confirmed by grep audit.
}

export const useMarkLikeStore = create<MarkLikeState>((set, get) => ({
  liked: [],
  toggle: (markId) => {
    const set_ = new Set(get().liked);
    if (set_.has(markId)) {
      set_.delete(markId);
      set({ liked: [...set_] });
      return false;
    }
    set_.add(markId);
    set({ liked: [...set_] });
    return true;
  },
}));
