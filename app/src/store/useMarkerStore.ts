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
  // Sprint 68 STORY-00532: optional author display name. Populated by the
  // /api/circle/markers endpoint for friend-tier marks (Public marks are
  // anonymized server-side per v4 row Q — author_name returns null even
  // when the creator is a friend). Local-only / self marks have no value.
  authorName?: string | null;
  // v0.2.4 Part 2 A2.2 — 双源持久化(用户原话:"AR plant 没用 arkit 世界坐标 用的是 GPS")
  // Plant 时同时存 ARKit world XYZ + arOrigin 快照,re-spawn 时优先用 ARKit
  // (前提:当前 arOrigin 跟 plant 时 arOrigin 偏差 < 5m,否则 fallback GPS+raycast)
  // 旧 marker 这些字段为 undefined,走 fallback 路径,行为不变
  arkitX?: number;
  arkitY?: number;
  arkitZ?: number;
  arOriginLat?: number;     // plant 时 arOrigin 快照 lat
  arOriginLng?: number;     // plant 时 arOrigin 快照 lng
  /** v300: immutable copy of (type/lat/lng/note) taken the FIRST time
   *  this marker had permission='public'. Subsequent edits to the
   *  main fields do NOT touch this. Subsequent public/unpublic toggles
   *  do NOT re-snapshot. Outside viewers (friends, public) see this
   *  snapshot; the owner sees the main fields. Field is null on
   *  markers that have never been public. */
  publicSnapshot?: {
    type: MarkerType;
    lat: number;
    lng: number;
    note: string;
    snapshottedAt: number;
  } | null;
}

// v0.2.6: bumped from 'cairn_markers' → 'cairn_markers_v026'.
// Reason: title/body wire format changed (now uses U+001E separator
// instead of '\n' join), and v0.2.6 ships fresh — server-side markers
// table was truncated. Old client-side notes from prior versions would
// render incorrectly under the new splitTitleBody decoder. Bumping the
// key prefix abandons the old AsyncStorage entries in place; they
// occupy a few KB of disk but are never read.
const STORAGE_KEY_PREFIX = 'cairn_markers_v026';

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
  public_snapshot?: string | null | any;
  created_at: string;
  /** Sprint 69 STORY-00537: circle endpoint returns user_id (for tier
   *  computation) and author_name (Friend tier only — Public anonymized
   *  server-side per v4 row Q). Optional on /api/markers (own) path. */
  user_id?: number | string;
  author_name?: string | null;
}): Marker {
  // v300: backend may return public_snapshot as either a parsed object
  // (mysql2 JSON columns auto-parse) or a JSON string (some drivers /
  // older marshallers). Handle both shapes defensively.
  let publicSnapshot: Marker['publicSnapshot'] = null;
  if (row.public_snapshot != null) {
    if (typeof row.public_snapshot === 'string') {
      try { publicSnapshot = JSON.parse(row.public_snapshot); } catch { publicSnapshot = null; }
    } else {
      publicSnapshot = row.public_snapshot;
    }
  }
  return {
    id: String(row.id),
    type: row.type as MarkerType,
    regionCode: 'nz',           // default — backend doesn't store this
    lat: row.lat,
    lng: row.lng,
    note: row.text || '',
    alt: row.alt ?? undefined,
    // Sprint 69 STORY-00537: prefer real user_id when present (circle
    // endpoint provides it); fall back to 'server' for /api/markers
    // own-marker responses which don't echo user_id.
    authorId: row.user_id != null ? String(row.user_id) : 'server',
    createdAt: new Date(row.created_at).getTime(),
    permission: (row.permission as MarkerPermission) || 'personal',
    synced: true,
    approximate: row.approximate === true || row.approximate === 1 || false,
    publicSnapshot,
    // Sprint 68 STORY-00532: author display name for Friend-tier marks.
    // Sprint 67 backend nulls this for Public marks (anonymized).
    authorName: row.author_name ?? undefined,
  };
}

interface MarkerState {
  markers: Marker[];
  userId: string | null;
  syncing: boolean;
  /** Sprint 69 STORY-00537: subscribed-friend friend+public marks from
   *  GET /api/circle/markers. Separate from `markers` so Mine path stays
   *  intact; Trails Flags Friends-subtab + Map circle render both read this. */
  circleMarkers: Marker[];
  /** Loading flag for circle fetch — UI uses it for spinner state. */
  loadingCircle: boolean;
  /** BUG-009 fix (Sprint 71 post-review round 3): in-flight hide ids.
   *  Set of mark ids whose POST /api/hide is async-running. loadCircleMarkers
   *  post-filters the response to exclude these — closes the GET-vs-POST
   *  hide-race where backend hasn't committed the hidden_items row yet
   *  but the client has already wiped them locally. Cleared on POST
   *  success or failure. */
  hidingIds: ReadonlyArray<string>;
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
  /** Sprint 68 STORY-00534: hide a foreign mark from this viewer's map.
   *  Optimistic local wipe + POST /api/hide. Idempotent. */
  hideMark: (id: string) => Promise<void>;
  clearMarkers: () => void;
  getMarkersForRegion: (regionCode: string) => Marker[];
  hydrate: (userId: string) => Promise<void>;
  loadFromBackend: () => Promise<void>;
  /** Sprint 69 STORY-00537: load subscribed-friend marks (friend+public
   *  tiers) from GET /api/circle/markers. Stored in `circleMarkers`. */
  loadCircleMarkers: () => Promise<void>;
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
  // Sprint 69 STORY-00537: initial empty until first loadCircleMarkers().
  circleMarkers: [],
  loadingCircle: false,
  // BUG-009 fix: initial empty set of in-flight hide ids.
  hidingIds: [],

  addMarker: async (data) => {
    // Optimistic local create
    const localId = generateId();
    // v300: if marker is born public, snapshot immediately. Backend
    // does the same on POST so the server row will agree.
    const publicSnapshot = data.permission === 'public'
      ? {
          type: data.type,
          lat: data.lat,
          lng: data.lng,
          note: data.note,
          snapshottedAt: Date.now(),
        }
      : null;
    const marker: Marker = {
      ...data,
      id: localId,
      createdAt: Date.now(),
      synced: false,
      publicSnapshot,
    };
    set((s) => {
      const next = [...s.markers, marker];
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    // v380: plant-unlocks-memory — when a user plants a mark, also unlock
    // the fog at that point (25m radius, same as walking unlock). Pre-fix
    // a user planting a mark in fog couldn't see their own mark until they
    // also walked through that point. Per user request: planting a mark
    // should unlock at least the point itself.
    //
    // v394 directly synchronous (was setTimeout(0) which raced with React
    // commit, sometimes never ran on slow devices). recordPoint immediately
    // adds a VisitedPoint to memory store, bumps geometryVersion → FogLayer
    // rebuilds with the new unlock hole. CULL_THRESHOLD (12.5m) inside
    // recordPoint dedupes if a nearby point already exists, but in fog
    // (which is the failure case) there's no nearby point, so it inserts.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMemoryStore } = require('../features/memory/store/useMemoryStore');
      useMemoryStore.getState().recordPoint(data.lat, data.lng, Date.now());
    } catch (err) {
      console.warn('[addMarker] recordPoint failed:', err);
    }

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
        // BUG-006 fix (Sprint 71 post-review round 2): backend POST response
        // now echoes user_id (BUG-001 round 2). Use it to overwrite the
        // caller-passed authorId ('local' / 'server' literal) so the mark
        // immediately tier-tags as 'self' in the marker render — without
        // this, in-session new marks stayed authorId='local' until the next
        // app restart triggered hydrate via GET /api/markers.
        const serverAuthorId =
          serverMarker.user_id != null ? String(serverMarker.user_id) : marker.authorId;
        // Replace local optimistic id with server id + correct authorId.
        set((s) => {
          const next = s.markers.map((m) =>
            m.id === localId
              ? { ...m, id: String(serverMarker.id), authorId: serverAuthorId, synced: true }
              : m
          );
          if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
          return { markers: next };
        });
        return { ...marker, id: String(serverMarker.id), authorId: serverAuthorId, synced: true };
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
      const next = s.markers.map((m) => {
        if (m.id !== id) return m;
        // v300: if this update is the FIRST transition to public, snapshot
        // the marker's current state (including any pending changes in
        // this same updates patch). Skip if publicSnapshot already exists.
        let publicSnapshot = m.publicSnapshot;
        if (updates.permission === 'public' && publicSnapshot == null) {
          const snapType = updates.type !== undefined ? updates.type : m.type;
          const snapNote = updates.note !== undefined ? updates.note : m.note;
          publicSnapshot = {
            type: snapType,
            lat: m.lat,     // lat/lng are immutable
            lng: m.lng,
            note: snapNote,
            snapshottedAt: Date.now(),
          };
        }
        return { ...m, ...updates, publicSnapshot };
      });
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    // Sync to backend (text, permission, type are updatable). Backend
    // mirrors the same publicSnapshot-on-first-public logic so a stale
    // local row sync wouldn't reset the server-side snapshot.
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

  // Sprint 68 STORY-00534: hide-from-me cache wipe + server call.
  // Calls Sprint 67 POST /api/hide; on success the row joins hidden_items,
  // and future /api/circle/markers calls filter it server-side (LEFT JOIN).
  // The client also wipes the mark from useMarkerStore + MMKV so the mark
  // disappears immediately (no waiting for the next pull-on-focus refresh).
  // Per v4 §15 V3 review §4.2: "client-side useMarkerStore 主动 wipe".
  //
  // Optimistic strategy: wipe locally first. On HTTP failure, log + log
  // breadcrumb but DO NOT restore (the user expressed intent to hide; if
  // the next /api/circle/markers re-includes the row server-side the
  // entry will come back legitimately). Trade-off accepted because the
  // hide flow only runs after a strong confirm modal — slipping a mark
  // back into view on transient failure is worse UX than honoring intent.
  hideMark: async (id) => {
    crashLogger.breadcrumb(`marker:hide:start id=${id}`);
    set((s) => {
      // BUG-005 fix (Sprint 71 post-review): wipe from BOTH slices.
      // markers = own marks (Mine path). circleMarkers = friend-tier marks
      // loaded from /api/circle/markers (Sprint 69 Story-537). v4 row Q +
      // §15 V3 review §4.2 says "client-side useMarkerStore 主动 wipe" —
      // Story-534 originally only filtered `markers`, leaving friend marks
      // alive in `circleMarkers` until the next loadCircleMarkers() pulled
      // them again (post-hide they'd be filtered by server-side LEFT JOIN
      // hidden_items, but the in-memory slice still showed them).
      //
      // BUG-009 fix (round 3): also track this id in hidingIds set so the
      // next loadCircleMarkers() post-filters it — closes the read-after-
      // write race where GET /api/circle/markers reaches the server before
      // POST /api/hide commits to hidden_items, which would otherwise
      // resurrect the just-hidden mark.
      const nextMarkers = s.markers.filter((m) => m.id !== id);
      const nextCircle = s.circleMarkers.filter((m) => m.id !== id);
      const nextHiding = s.hidingIds.includes(id) ? s.hidingIds : [...s.hidingIds, id];
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(nextMarkers));
      return { markers: nextMarkers, circleMarkers: nextCircle, hidingIds: nextHiding };
    });

    try {
      const numericId = Number(id);
      const body = { item_type: 'mark', item_id: Number.isFinite(numericId) ? numericId : id };
      const res = await authenticatedFetch('/api/hide', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      crashLogger.breadcrumb(`marker:hide:remote ok=${res.ok} id=${id}`);
    } catch (err) {
      crashLogger.breadcrumb(`marker:hide:remote-error ${String(err).slice(0, 80)}`);
    } finally {
      // BUG-009 fix: regardless of POST outcome, clear hidingIds. On
      // success → row is in hidden_items so server filter takes over. On
      // failure → next loadCircleMarkers will refetch and the mark will
      // legitimately re-appear (we keep the local wipe per Story-534
      // optimistic policy; if server never recorded the hide, server is
      // the source of truth and the user can hide again).
      set((s) => ({ hidingIds: s.hidingIds.filter((hid) => hid !== id) }));
    }
  },

  clearMarkers: () => {
    // BUG-010 fix: also reset cross-session slices so a logout/login
    // doesn't leak prior user's circle data into the new session.
    // BUG-014 fix (round 4): also reset memory subscriptions slice via
    // dynamic require (avoids module cycle). Without this, a logout →
    // login flow that goes clearMarkers → hydrate would skip the
    // user-switch detection in hydrate (prevUserId is null after clear),
    // leaving prior user's subscriptions in-memory until next load().
    set({ markers: [], userId: null, circleMarkers: [], hidingIds: [] });
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useMemorySubscriptionsStore } = require('../features/memory/store/useMemorySubscriptionsStore');
      useMemorySubscriptionsStore.getState().reset();
    } catch (_e) {
      // Subs store not loaded (e.g. cold-start logout) — nothing to reset.
    }
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

  // Sprint 69 STORY-00537: load subscribed-friend marks from
  // GET /api/circle/markers. Stored separately from `markers` (which holds
  // only the viewer's own) so Mine path stays untouched.
  // Wire shape (Sprint 67 STORY-00528): { markers: [{ id, user_id, type,
  //   text, lat, lng, alt, permission, approximate, created_at, updated_at,
  //   author_name }] } — author_name null for Public marks (anonymized).
  loadCircleMarkers: async () => {
    // BUG-007 fix: single-flight guard.
    //
    // BUG-009 fix (round 3): in-flight hide filter via hidingIds set.
    //
    // BUG-012 fix (round 4): snapshot hidingIds at FETCH START, not after
    // res.json() resolves. Without the snapshot, an in-flight hide's
    // finally clause could run during the GET's `await res.json()` micro-
    // task boundary and clear hidingIds before the post-filter reads them,
    // resurrecting the just-hidden mark. Snapshot ensures the hide ids
    // captured at the moment of the fetch are honoured regardless of when
    // their POST finally settles.
    if (get().loadingCircle) return;
    const hidingSnapshot = new Set(get().hidingIds);
    set({ loadingCircle: true });
    try {
      const res = await authenticatedFetch('/api/circle/markers');
      if (!res.ok) { set({ loadingCircle: false }); return; }
      const data = await res.json();
      const rows: any[] = Array.isArray(data?.markers) ? data.markers : [];
      const allCircle: Marker[] = rows.map(fromBackend);
      // Apply both the start-of-fetch snapshot AND any new hides queued
      // during the fetch (defensive — captures hides that started after
      // the snapshot but before set() lands).
      const currentHiding = new Set(get().hidingIds);
      const effective = new Set([...hidingSnapshot, ...currentHiding]);
      const circle = effective.size === 0
        ? allCircle
        : allCircle.filter((m) => !effective.has(m.id));
      set({ circleMarkers: circle, loadingCircle: false });
    } catch {
      set({ loadingCircle: false });
    }
  },

  hydrate: async (userId: string) => {
    // BUG-010 fix: detect user-switch. If the in-memory userId differs
    // from the incoming one, drop cross-session slices so the prior user's
    // circleMarkers + hidingIds + memory subscriptions don't bleed into
    // the new session. (markers is keyed by userId in MMKV so it's safe
    // to overwrite below either way.)
    const prevUserId = get().userId;
    if (prevUserId && prevUserId !== userId) {
      set({ circleMarkers: [], hidingIds: [] });
      // Dynamic import to avoid module-cycle between marker + memory stores.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useMemorySubscriptionsStore } = require('../features/memory/store/useMemorySubscriptionsStore');
        useMemorySubscriptionsStore.getState().reset();
      } catch (_e) {
        // Subs store not loaded yet (cold start) — nothing to reset.
      }
    }
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
