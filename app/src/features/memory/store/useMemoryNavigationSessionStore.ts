import { create } from 'zustand';
import type { PreparedMemoryCoverage } from './usePreparedMemoryCoverageStore';
import type { VisitedPoint } from './useMemoryStore';

export type FrozenMemoryCamera = {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
  actionId: number;
};

type MemoryNavigationSessionState = {
  sessionId: string | null;
  ownerId: string | null;
  mineCoverage: PreparedMemoryCoverage | null;
  localOverlayPoints: VisitedPoint[];
  localOverlayPinned: boolean;
  camera: FrozenMemoryCamera | null;
  selectedCityId: string | null;
  scope: 'self' | 'combined';
  selectedFriendIds: string[];
  begin: (ownerId: string, localOverlayPoints: VisitedPoint[], localOverlayReady?: boolean) => string;
  pinLocalOverlay: (ownerId: string, localOverlayPoints: VisitedPoint[]) => void;
  pinMine: (ownerId: string, expectedSessionId: string | null, coverage: PreparedMemoryCoverage) => void;
  setCamera: (ownerId: string, camera: FrozenMemoryCamera) => void;
  setPresentation: (ownerId: string, input: {
    selectedCityId: string | null;
    scope: 'self' | 'combined';
    selectedFriendIds: string[];
  }) => void;
  end: (sessionId: string) => void;
  reset: () => void;
};

let sequence = 0;

/**
 * Owns references for one Memory navigation flow. It intentionally pins the
 * existing immutable snapshot/point arrays rather than copying coordinates or
 * creating a second coverage framework. Cairns/detail push above Memory, so
 * focus changes do not end this route-owned session.
 */
export const useMemoryNavigationSessionStore = create<MemoryNavigationSessionState>((set, get) => ({
  sessionId: null,
  ownerId: null,
  mineCoverage: null,
  localOverlayPoints: [],
  localOverlayPinned: false,
  camera: null,
  selectedCityId: null,
  scope: 'self',
  selectedFriendIds: [],

  begin: (ownerId, localOverlayPoints, localOverlayReady = true) => {
    const current = get();
    if (current.sessionId && current.ownerId === ownerId) return current.sessionId;
    const sessionId = `memory-session-${++sequence}`;
    set({
      sessionId,
      ownerId,
      mineCoverage: null,
      localOverlayPoints: localOverlayPoints.slice(),
      localOverlayPinned: localOverlayReady,
      camera: null,
      selectedCityId: null,
      scope: 'self',
      selectedFriendIds: [],
    });
    return sessionId;
  },

  pinLocalOverlay: (ownerId, localOverlayPoints) => {
    const current = get();
    if (!current.sessionId || current.ownerId !== ownerId || current.localOverlayPinned) return;
    set({ localOverlayPoints: localOverlayPoints.slice(), localOverlayPinned: true });
  },

  pinMine: (ownerId, expectedSessionId, coverage) => {
    const current = get();
    if (!current.sessionId
      || current.sessionId !== expectedSessionId
      || current.ownerId !== ownerId
      || current.mineCoverage) return;
    set({ mineCoverage: coverage });
  },

  setCamera: (ownerId, camera) => {
    if (get().ownerId !== ownerId || !get().sessionId) return;
    const prior = get().camera;
    if (prior && camera.actionId < prior.actionId) return;
    set({ camera });
  },

  setPresentation: (ownerId, input) => {
    if (get().ownerId !== ownerId || !get().sessionId) return;
    set({
      selectedCityId: input.selectedCityId,
      scope: input.scope,
      selectedFriendIds: [...new Set(input.selectedFriendIds.map(String))].sort(),
    });
  },

  end: (sessionId) => {
    if (get().sessionId !== sessionId) return;
    set({
      sessionId: null,
      ownerId: null,
      mineCoverage: null,
      localOverlayPoints: [],
      localOverlayPinned: false,
      camera: null,
      selectedCityId: null,
      scope: 'self',
      selectedFriendIds: [],
    });
  },

  reset: () => set({
    sessionId: null,
    ownerId: null,
    mineCoverage: null,
    localOverlayPoints: [],
    localOverlayPinned: false,
    camera: null,
    selectedCityId: null,
    scope: 'self',
    selectedFriendIds: [],
  }),
}));
