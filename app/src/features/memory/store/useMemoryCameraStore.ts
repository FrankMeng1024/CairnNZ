import { create } from 'zustand';
import { storage } from '../../../store/storage';

export interface ManualMemoryCity {
  /** Only owner-derived hierarchy/camera metadata may survive a launch.
   * Friend anchors remain authorized, active-session navigation only. */
  source: 'mine';
  cityId: string;
  countryId: string | null;
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
}

interface MemoryCameraState {
  ownerId: string | null;
  hydrated: boolean;
  manualCity: ManualMemoryCity | null;
  hydrate: (ownerId: string) => Promise<void>;
  selectCity: (city: ManualMemoryCity) => Promise<void>;
  clearManualCity: () => Promise<void>;
  reset: () => void;
}

const KEY_PREFIX = 'cairn:memory-camera:v1:';
let generation = 0;
let cameraMutationGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();

function enqueueCameraPersistence(task: () => Promise<void>): Promise<void> {
  persistenceQueue = persistenceQueue.catch(() => {}).then(task);
  return persistenceQueue;
}

function key(ownerId: string) {
  return `${KEY_PREFIX}${ownerId}`;
}

function validCity(value: any): value is ManualMemoryCity {
  return value && value.source === 'mine'
    && typeof value.cityId === 'string'
    && (value.countryId == null || typeof value.countryId === 'string')
    && Array.isArray(value.bbox) && value.bbox.length === 4 && value.bbox.every(Number.isFinite)
    && Array.isArray(value.center) && value.center.length === 2 && value.center.every(Number.isFinite)
    && Number.isFinite(value.zoom);
}

export const useMemoryCameraStore = create<MemoryCameraState>((set, get) => ({
  ownerId: null,
  hydrated: false,
  manualCity: null,

  hydrate: async (ownerId) => {
    const request = ++generation;
    const mutationAtStart = cameraMutationGeneration;
    set({ ownerId, hydrated: false, manualCity: null });
    let manualCity: ManualMemoryCity | null = null;
    try {
      await persistenceQueue;
      const raw = await storage.getItem(key(ownerId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.ownerId === ownerId && validCity(parsed.manualCity)) manualCity = parsed.manualCity;
      }
    } catch { /* invalid local camera state falls back to current city */ }
    if (request !== generation || mutationAtStart !== cameraMutationGeneration || get().ownerId !== ownerId) return;
    set({ manualCity, hydrated: true });
  },

  selectCity: async (manualCity) => {
    const ownerId = get().ownerId;
    if (!ownerId || !validCity(manualCity)) return;
    cameraMutationGeneration += 1;
    set({ manualCity });
    await enqueueCameraPersistence(() => storage.setItem(
      key(ownerId),
      JSON.stringify({ ownerId, manualCity }),
      { strict: true },
    ));
  },

  clearManualCity: async () => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    cameraMutationGeneration += 1;
    set({ manualCity: null });
    await enqueueCameraPersistence(() => storage.removeItem(key(ownerId)));
  },

  reset: () => {
    generation += 1;
    cameraMutationGeneration += 1;
    set({ ownerId: null, hydrated: false, manualCity: null });
  },
}));
