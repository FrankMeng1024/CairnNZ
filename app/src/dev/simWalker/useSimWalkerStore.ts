/**
 * useSimWalkerStore — v428
 *
 * In-memory only (NOT persisted) Zustand store for the sim-walker debug overlay.
 * Cold app restart resets `active` to false and `position` to default.
 *
 * Rationale (user requirement): "关闭 app 就没了" — the sim-walker overlay
 * must not survive a cold restart even if the persistent `debugMode` flag
 * (useSettingsStore) stays true. Sim mode is a per-session opt-in, not a
 * persistent capability.
 *
 * Gate order (see HikingScreen mount site):
 *   1. useSettingsStore.debugMode === true (persistent, 5-tap toggle)
 *   2. useSimWalkerStore.active === true  (in-memory only)
 *   Both required → SimWalkerOverlay renders.
 */

import { create } from 'zustand';

export interface Position {
  x: number;
  y: number;
}

interface SimWalkerState {
  /** Overlay visible in HikingScreen. In-memory only. */
  active: boolean;
  /** Draggable overlay position (screen offset from bottom-right).
   *  Also in-memory only — no reason to persist a debug overlay position. */
  position: Position;
  /**
   * v442: the current sim-walker "start anchor" — where the ⟲ reset
   * button will snap the sim to. MemoryMap / HikingMap read this and
   * render a dashed circle around it so the user can see where they
   * will jump back to. null when sim-walker isn't started.
   */
  startAnchor: { lat: number; lng: number } | null;
  toggle: () => void;
  setActive: (v: boolean) => void;
  setPosition: (p: Position) => void;
  setStartAnchor: (a: { lat: number; lng: number } | null) => void;
  reset: () => void;
}

const DEFAULT_POSITION: Position = { x: 20, y: 20 };

export const useSimWalkerStore = create<SimWalkerState>()((set) => ({
  active: false,
  position: DEFAULT_POSITION,
  startAnchor: null,
  toggle: () => set((s) => ({ active: !s.active })),
  setActive: (active) => set({ active }),
  setPosition: (position) => set({ position }),
  setStartAnchor: (startAnchor) => set({ startAnchor }),
  reset: () => set({ active: false, position: DEFAULT_POSITION, startAnchor: null }),
}));
