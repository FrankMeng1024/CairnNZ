/**
 * useMarkerStore — local marker (flag) persistence + backend sync.
 *
 * Architecture:
 * - Local MMKV cache is write-through (every mutation saves locally)
 * - Backend sync is additive: loadFromBackend() merges server markers
 * - Offline tolerance: local mutations queue and sync on next online
 *
 * Field mapping: backend `text` ↔ frontend `note`
 * ID convention: backend returns integer insertId; stored as string
 */
import { create } from 'zustand';
import { storage } from './storage';
import { generateId } from '../utils/geo';
import { authenticatedFetch } from '../services/apiService';
import { enqueue, makeOp, uuidv4 } from '../services/offlineQueue';
import { debugLogger } from '../services/debugLogger';
import { crashLogger } from '../services/crashLogger';
import type { MarkerType } from '../data/mockData';

export type MarkerPermission = 'personal' | 'group' | 'public';

export interface Marker {
  id: string;
  type: MarkerType;
  regionCode: string;      // e.g. 'nz' — frontend concept, not in backend
  lat: number;
  lng: number;
  note: string;            // backend field: text
  authorId: string;        // 'local' for offline; userId for synced
  createdAt: number;       // Unix ms
  permission: MarkerPermission;
  sessionId?: string;      // which tracking session this was planted in
  synced?: boolean;        // true = exists in backend, false = local-only
  alt?: number;
  approximate?: boolean;   // true if placed with stale/no GPS signal
  gpsAgeS?: number;        // seconds since last GPS fix when placed
  // PRD3 E-019 — user-attached photos. v1 has no upload UI, but the field
  // exists so backend rows and types are forward-compatible. Photos are
  // displayed inline in the marker detail sheet when present.
  photoUrls?: string[];
  // v80 #45 — optional 5s voice memo. Stored as a local file:// URI in
  // FileSystem.documentDirectory. NOT uploaded to backend in v80 (next
  // iteration will add cloud upload + cross-device sync). The recording
  // file is preserved across app restarts via the AsyncStorage marker
  // persistence — the URI string itself, the m4a file lives on disk.
  voiceMemoUri?: string;
  voiceMemoDurationMs?: number;
  // v0.2.4 Part 2 A2.2 — 双源持久化(用户原话:"AR plant 没用 arkit 世界坐标 用的是 GPS")
  // Plant 时同时存 ARKit world XYZ + arOrigin 快照,re-spawn 时优先用 ARKit
  // (前提:当前 arOrigin 跟 plant 时 arOrigin 偏差 < 5m,否则 fallback GPS+raycast)
  // 旧 marker 这些字段为 undefined,走 fallback 路径,行为不变
  arkitX?: number;
  arkitY?: number;
  arkitZ?: number;
  arOriginLat?: number;     // plant 时 arOrigin 快照 lat
  arOriginLng?: number;     // plant 时 arOrigin 快照 lng
}

const STORAGE_KEY_PREFIX = 'cairn_markers';

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}_${userId}`;
}

// v118: persistent ARKit origin. Cairn world positions are computed as
// (lat, lng) deltas relative to a single origin captured the first time
// the user plants in AR. Using a persistent origin (not a fresh GPS read
// every session) eliminates the 5-15m inter-session drift that made
// markers visibly jump between AR sessions on the same spot.
const AR_ORIGIN_KEY_PREFIX = 'cairn_ar_origin_v1';
function arOriginKey(userId: string): string {
  return `${AR_ORIGIN_KEY_PREFIX}_${userId}`;
}

/** Convert backend row → frontend Marker */
function fromBackend(row: {
  id: number | string;
  type: string;
  text: string;
  lat: number;
  lng: number;
  alt?: number | null;
  permission: string;
  approximate?: number | boolean | null;
  created_at: string;
}): Marker {
  return {
    id: String(row.id),
    type: row.type as MarkerType,
    regionCode: 'nz',           // default — backend doesn't store this
    lat: row.lat,
    lng: row.lng,
    note: row.text || '',
    alt: row.alt ?? undefined,
    authorId: 'server',
    createdAt: new Date(row.created_at).getTime(),
    permission: (row.permission as MarkerPermission) || 'personal',
    synced: true,
    approximate: row.approximate === true || row.approximate === 1 || false,
  };
}

interface MarkerState {
  markers: Marker[];
  userId: string | null;
  syncing: boolean;
  /** v118: persistent AR origin (captured once on first plant per user).
   *  null until first plant. All cairns are positioned in ARKit world
   *  space via (lat, lng) deltas from this origin, so it must NOT change
   *  between AR sessions or markers will appear to jump 5-15m.
   *  v0.2.4 R2.3: lowAccuracy 标记此 origin 是不是在 GPS accuracy 10-25m 范围
   *  锁的(室内 / urban canyon)。下游 unityCairnSpawn 看到 true 时收紧 Tier-A
   *  阈值(5m → 2m),否则低精度 origin 反算 cairn 会飘 15m+。 */
  arOrigin: { lat: number; lng: number; alt: number | null; lowAccuracy?: boolean } | null;
  addMarker: (marker: Omit<Marker, 'id' | 'createdAt'>) => Promise<Marker>;
  updateMarker: (id: string, updates: Partial<Omit<Marker, 'id' | 'createdAt'>>) => Promise<void>;
  deleteMarker: (id: string) => Promise<void>;
  clearMarkers: () => void;
  getMarkersForRegion: (regionCode: string) => Marker[];
  hydrate: (userId: string) => Promise<void>;
  loadFromBackend: () => Promise<void>;
  /** v118: set the AR origin if not yet set. Called from ViroAROverlay
   *  when the first GPS fix arrives in a new AR session AND no origin
   *  exists yet. Subsequent calls are no-ops. */
  setArOriginIfMissing: (origin: { lat: number; lng: number; alt: number | null; lowAccuracy?: boolean }) => void;
  /** v118: clear the AR origin (used when the user wipes all markers). */
  clearArOrigin: () => void;
}

export const useMarkerStore = create<MarkerState>((set, get) => ({
  markers: [],
  userId: null,
  syncing: false,
  arOrigin: null,

  addMarker: async (data) => {
    // Optimistic local create
    const localId = generateId();
    const marker: Marker = {
      ...data,
      id: localId,
      createdAt: Date.now(),
      synced: false,
    };
    set((s) => {
      const next = [...s.markers, marker];
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    // Debug logger: marker_placed
    debugLogger.log({
      ts: Date.now(),
      event: 'marker_placed',
      marker_id: localId,
      type: String(data.type),
      lat: data.lat,
      lon: data.lng,
      accuracy_m: null,
      text_length: (data.note ?? '').length,
      permission: (data.permission ?? 'personal') as 'personal' | 'group' | 'public',
    });

    // Sync to backend. v78 #7: on transient failure, enqueue for retry
    // with idempotency key. Local marker remains usable (synced=false).
    const opId = uuidv4();
    const body = {
      type: data.type,
      text: data.note,
      lat: data.lat,
      lng: data.lng,
      alt: data.alt,
      permission: data.permission,
      approximate: data.approximate || false,
    };
    try {
      const res = await authenticatedFetch('/api/markers', {
        method: 'POST',
        body: JSON.stringify({ ...body, client_op_id: opId }),
      });
      if (res.ok) {
        const serverMarker = await res.json();
        // Replace local optimistic id with server id
        set((s) => {
          const next = s.markers.map((m) =>
            m.id === localId
              ? { ...m, id: String(serverMarker.id), synced: true }
              : m
          );
          if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
          return { markers: next };
        });
        return { ...marker, id: String(serverMarker.id), synced: true };
      }
      // 5xx / 401: enqueue for retry. 4xx (other): give up.
      if (res.status >= 500 || res.status === 401) {
        await enqueue(makeOp('marker_create', '/api/markers', 'POST', body, opId));
      }
    } catch {
      // Network failure — enqueue for retry on next online/foreground.
      await enqueue(makeOp('marker_create', '/api/markers', 'POST', body, opId));
    }
    return marker;
  },

  updateMarker: async (id, updates) => {
    set((s) => {
      const next = s.markers.map((m) => m.id === id ? { ...m, ...updates } : m);
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    // Sync to backend (text, permission, type are updatable)
    const backendUpdates: Record<string, string> = {};
    if (updates.note !== undefined) backendUpdates.text = updates.note;
    if (updates.permission !== undefined) backendUpdates.permission = updates.permission;
    if (updates.type !== undefined) backendUpdates.type = updates.type;
    if (Object.keys(backendUpdates).length === 0) return;

    try {
      await authenticatedFetch(`/api/markers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(backendUpdates),
      });
    } catch {
      // Network failure — local update persisted, backend will be stale until next sync
    }
  },

  deleteMarker: async (id) => {
    crashLogger.breadcrumb(`marker:delete:start id=${id}`);
    set((s) => {
      const next = s.markers.filter((m) => m.id !== id);
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    try {
      const res = await authenticatedFetch(`/api/markers/${id}`, { method: 'DELETE' });
      crashLogger.breadcrumb(`marker:delete:remote ok=${res.ok} id=${id}`);
    } catch (err) {
      crashLogger.breadcrumb(`marker:delete:remote-error ${String(err).slice(0, 80)}`);
    }
  },

  clearMarkers: () => {
    set({ markers: [], userId: null });
  },

  getMarkersForRegion: (regionCode) => {
    return get().markers.filter((m) => m.regionCode === regionCode);
  },

  loadFromBackend: async () => {
    set({ syncing: true });
    try {
      const res = await authenticatedFetch('/api/markers');
      if (!res.ok) return;
      const rows = await res.json();
      const serverMarkers: Marker[] = rows.map(fromBackend);

      set((s) => {
        // Merge: server markers replace any with same id, keep local-only
        const localOnly = s.markers.filter((m) => !m.synced);
        const merged = [
          ...serverMarkers,
          ...localOnly.filter((lo) => !serverMarkers.some((sm) => sm.id === lo.id)),
        ];
        if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(merged));
        return { markers: merged, syncing: false };
      });
    } catch {
      set({ syncing: false });
    }
  },

  hydrate: async (userId: string) => {
    // 1. Load from local cache first (instant)
    const key = storageKey(userId);
    const raw = await storage.getItem(key);
    if (raw) {
      try {
        const markers: Marker[] = JSON.parse(raw);
        set({ markers, userId });
      } catch {
        storage.removeItem(key);
        set({ markers: [], userId });
      }
    } else {
      set({ markers: [], userId });
    }
    // v118: hydrate persistent AR origin too.
    const oRaw = await storage.getItem(arOriginKey(userId));
    if (oRaw) {
      try {
        const o = JSON.parse(oRaw);
        if (o && typeof o.lat === 'number' && typeof o.lng === 'number') {
          set({ arOrigin: { lat: o.lat, lng: o.lng, alt: o.alt ?? null, lowAccuracy: !!o.lowAccuracy } });
        }
      } catch {
        storage.removeItem(arOriginKey(userId));
      }
    } else {
      set({ arOrigin: null });
    }
    // 2. Then fetch from backend (async, updates state when done)
    get().loadFromBackend();
  },

  setArOriginIfMissing: (origin) => {
    const cur = get().arOrigin;
    if (cur) return; // origin already locked — never overwrite
    const userId = get().userId;
    const lowAccuracy = !!origin.lowAccuracy;
    set({ arOrigin: { lat: origin.lat, lng: origin.lng, alt: origin.alt ?? null, lowAccuracy } });
    if (userId) {
      storage.setItem(arOriginKey(userId), JSON.stringify({ ...origin, lowAccuracy }));
    }
    crashLogger.breadcrumb(`ar:origin:locked lat=${origin.lat.toFixed(6)} lng=${origin.lng.toFixed(6)} lowAcc=${lowAccuracy}`);
  },

  clearArOrigin: () => {
    const userId = get().userId;
    set({ arOrigin: null });
    if (userId) storage.removeItem(arOriginKey(userId));
    crashLogger.breadcrumb('ar:origin:cleared');
  },
}));
