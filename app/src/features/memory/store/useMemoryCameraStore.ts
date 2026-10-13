import { create } from 'zustand';
import { storage } from '../../../store/storage';

export interface ManualMemoryCity {
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

function key(ownerId: string) {
  return `${KEY_PREFIX}${ownerId}`;
}

function validCity(value: any): value is ManualMemoryCity {
  return value && typeof value.cityId === 'string'
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
    set({ ownerId, hydrated: false, manualCity: null });
    let manualCity: ManualMemoryCity | null = null;
    try {
      const raw = await storage.getItem(key(ownerId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.ownerId === ownerId && validCity(parsed.manualCity)) manualCity = parsed.manualCity;
      }
    } catch { /* invalid local camera state falls back to current city */ }
    if (request !== generation || get().ownerId !== ownerId) return;
    set({ manualCity, hydrated: true });
  },

  selectCity: async (manualCity) => {
    const ownerId = get().ownerId;
    if (!ownerId || !validCity(manualCity)) return;
    set({ manualCity });
    await storage.setItem(key(ownerId), JSON.stringify({ ownerId, manualCity }), { strict: true });
  },

  clearManualCity: async () => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    set({ manualCity: null });
    await storage.removeItem(key(ownerId));
  },

  reset: () => {
    generation += 1;
    set({ ownerId: null, hydrated: false, manualCity: null });
  },
}));
