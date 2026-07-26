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
import { authenticatedFetch } from '../services/apiService';
import { debugLogger } from '../services/debugLogger';
import { crashLogger } from '../services/crashLogger';
import type { MarkerType } from '../data/mockData';
// v422: offline-first framework — B 类 (Plant cairn) 用 offlineMarkers entity
import {
  offlineMarkers,
  setMarkerCreateAckHandler,
  clearMarkersQueueForCurrentUser,
  type MarkerCreatePayload,
  type MarkerCreateServerResponse,
} from '../services/markerOfflineEntities';
import type { SyncState } from '../services/offlineEntity';

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
  // O1 batch 40: photoUrls removed — 0 external readers
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
  /** v422: 离线保存状态. 由 offlineMarkers entity 驱动.
   *   - undefined / 'synced': 服务器已确认 (正常状态)
   *   - 'pending': 已存本地, 未同步 (offline queue 里有条目)
   *   - 'syncing': daemon 正在上传该条
   *   - 'failed': 硬失败 (4xx 非 401), 用户需手动重试/删除
   *  UI (MarkerDetail / MarkerCard) 显示 SyncBadge 让用户知晓状态. */
  syncState?: SyncState;
  /** v422: offline placeholder 的 localId. 服务器 ack 后, id 会被替换成
   *   server id, 但 localId 保留以便 UI 追踪历史 + subscribe 匹配. */
  localId?: string;
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
  // O1 batch 36: syncing removed — written in loadFromBackend but 0 external readers.
  /** Sprint 69 STORY-00537: subscribed-friend friend+public marks from
   *  GET /api/circle/markers. Separate from `markers` so Mine path stays
   *  intact; Trails Flags Friends-subtab + Map circle render both read this. */
  circleMarkers: Marker[];
  /** Loading flag for circle fetch — UI uses it for spinner state. */
  loadingCircle: boolean;
  /** R2: Public markers from strangers within the current map viewport.
   *  Loaded via GET /api/markers/public?bbox=. Anonymous (no author).
   *  Shown as blurred stranger pins in the Memory map. */
  publicMarkers: Marker[];
  /** Loading flag for public markers fetch. */
  loadingPublic: boolean;
  /** BUG-009 fix (Sprint 71 post-review round 3): in-flight hide ids.
   *  Set of mark ids whose POST /api/hide is async-running. loadCircleMarkers
   *  post-filters the response to exclude these — closes the GET-vs-POST
   *  hide-race where backend hasn't committed the hidden_items row yet
   *  but the client has already wiped them locally. Cleared on POST
   *  success or failure. */
  hidingIds: ReadonlyArray<string>;
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
  /** R2: load public stranger markers within ~5.5km bbox around center. */
  loadPublicMarkers: (centerLat: number, centerLng: number) => Promise<void>;
}

export const useMarkerStore = create<MarkerState>((set, get) => ({
  markers: [],
  userId: null,
  // Sprint 69 STORY-00537: initial empty until first loadCircleMarkers().
  circleMarkers: [],
  loadingCircle: false,
  // R2: initial empty until first loadPublicMarkers().
  publicMarkers: [],
  loadingPublic: false,
  // BUG-009 fix: initial empty set of in-flight hide ids.
  hidingIds: [],

  addMarker: async (data) => {
    // v422 offline-first: 无论在线离线, 走同一条路径
    //   1. 立即生成 local placeholder (localId, synced=false, syncState='pending')
    //   2. offlineMarkers.saveLocal → 存本地 kv + 触发 drain
    //   3. drain 成功后 ackHandler 把 localId → server id, syncState='synced'
    //   4. drain 硬失败 (4xx) → failHandler 标 syncState='failed', 用户手动重试
    //   5. drain 软失败 (5xx/网络) → 保留 pending, 网络恢复时 daemon 再试
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

    // 存 offlineMarkers entity, 拿到 localId (= idempotency key).
    // v423 B1 fix: saveLocal 现在会在 AsyncStorage 满 / hydrate 未完成时 throw.
    // 我们 catch 并向用户报"存不下", 不让 marker 在内存里假成功.
    const payload: MarkerCreatePayload = {
      type: data.type,
      text: data.note,
      lat: data.lat,
      lng: data.lng,
      alt: data.alt,
      permission: data.permission,
      approximate: data.approximate || false,
    };
    let localId: string;
    try {
      const saved = await offlineMarkers.saveLocal(payload);
      localId = saved.localId;
    } catch (err) {
      crashLogger.breadcrumb(`marker:saveLocal_failed err=${String(err).slice(0, 80)}`);
      // 不静默丢: 抛给上层 (PlantScreen commit 会 catch 显示 Alert "Could not plant cairn").
      throw err;
    }

    const marker: Marker = {
      ...data,
      id: localId,       // 前端立即用 localId 作 id, ack 后被替换
      localId,
      createdAt: Date.now(),
      synced: false,
      syncState: 'pending',
      publicSnapshot,
    };
    set((s) => {
      const next = [...s.markers, marker];
      if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
      return { markers: next };
    });

    // v397: log unconditionally at the START so we know addMarker hit this
    // path at all (v396 had no plant_unlock logs in production → either the
    // try block threw early or this entire addMarker was never reached).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('../services/appLog');
      log('v422.addmarker_enter', {
        lat: Number(data.lat.toFixed(5)),
        lng: Number(data.lng.toFixed(5)),
        permission: data.permission,
        type: data.type,
        localId: localId.slice(0, 8),
      });
    } catch {/* never throw on log */}

    // v380: plant-unlocks-memory — when a user plants a mark, also unlock
    // the fog at that point (25m radius, same as walking unlock).
    //
    // v396 真 fix: recordPoint has 12.5m CULL that silently returns if
    // any of the last 32 visited points is within 12.5m. Plant on a
    // partially-explored boundary triggers the cull → fog stays closed.
    // We now directly push a VisitedPoint, bypassing cull. Plant must
    // ALWAYS unlock its own location.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMemoryStore } = require('../features/memory/store/useMemoryStore');
      // v399 真根因 (FogLayer.tsx:160): `if (seg.length < 2) continue` —
      // 单点 segment 在 turf.buffer 前被跳过 (lineString 需要 ≥2 点).
      // v400: single point — FogLayer.tsx:160 now buffers single-point
      // segments via turf.point + buffer. plant 中心严格在 fog hole 圆心.
      const ts = Math.floor(Date.now());
      const cidBase = `plant-${ts}-${Math.floor(Math.random() * 1e9).toString(36)}`;
      const planted = [
        { lat: data.lat, lng: data.lng, ts, cid: `${cidBase}-0`, synced: false },
      ];
      const state = useMemoryStore.getState();
      const newPoints = [...state.points, ...planted];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('../services/appLog');
      log('v422.plant_unlock', {
        lat: Number(data.lat.toFixed(5)),
        lng: Number(data.lng.toFixed(5)),
        points_before: state.points.length,
        points_added: planted.length,
        points_after: newPoints.length,
        geom_v_before: state.geometryVersion,
      });
      useMemoryStore.setState({
        points: newPoints,
        geometryVersion: state.geometryVersion + 1,
        _bucketIndex: null,
        _unsyncedCount: state._unsyncedCount + planted.length,
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useH3VisitedStore } = require('../features/memory/store/useH3VisitedStore');
      for (const p of planted) {
        useH3VisitedStore.getState().addPointToCells(p.lat, p.lng, p.ts);
      }
    } catch (err) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('../services/appLog');
        log('v422.plant_unlock_err', {
          err: String(err && (err as any).message ? (err as any).message : err),
        });
      } catch {/* ignore */}
      console.warn('[addMarker] plant-unlock failed:', err);
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

    // 返回本地 marker. 调用方 (Plant flow) 立即可导航到 MarkerDetail — 那里
    // 通过 offlineMarkers.subscribe 显示 SyncBadge 让用户看到同步进度。
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
    // v423 B3 fix: logout 时也清 offline marker queue. 否则 A logout → B login
    // 后 B 的 auth token 会上传 A 的 pending marker → server 归到 B 名下.
    // 顺序: 先 clear queue (async, 用 current userId), 再 reset state.
    clearMarkersQueueForCurrentUser().catch(() => { /* best-effort */ });
    // BUG-010 fix: also reset cross-session slices so a logout/login
    // doesn't leak prior user's circle data into the new session.
    // BUG-014 fix (round 4): also reset memory subscriptions slice via
    // dynamic require (avoids module cycle). Without this, a logout →
    // login flow that goes clearMarkers → hydrate would skip the
    // user-switch detection in hydrate (prevUserId is null after clear),
    // leaving prior user's subscriptions in-memory until next load().
    set({ markers: [], userId: null, circleMarkers: [], hidingIds: [],
      publicMarkers: [], loadingPublic: false });
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useMemorySubscriptionsStore } = require('../features/memory/store/useMemorySubscriptionsStore');
      useMemorySubscriptionsStore.getState().reset();
    } catch (_e) {
      // Subs store not loaded (e.g. cold-start logout) — nothing to reset.
    }
    try {
      // v413 (4-eye fix C3): reset friend memory cache on logout to prevent
      // prior user's GPS points leaking into next login. Same pattern as subs reset.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { useFriendMemoryStore } = require('../features/memory/store/useFriendMemoryStore');
      useFriendMemoryStore.getState().reset();
    } catch (_e) {
      // Store not loaded yet — nothing to reset.
    }
  },

  getMarkersForRegion: (regionCode) => {
    return get().markers.filter((m) => m.regionCode === regionCode);
  },

  loadFromBackend: async () => {
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
        return { markers: merged };
      });
    } catch {
      // silent
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

  // R2: load public stranger markers within ±0.05° (~5.5km) of center.
  // Single-flight guard mirrors loadCircleMarkers pattern.
  loadPublicMarkers: async (centerLat: number, centerLng: number) => {
    if (get().loadingPublic) return;
    set({ loadingPublic: true });
    const HALF_DEG = 0.05; // ~5.5 km
    const lat1 = centerLat - HALF_DEG;
    const lng1 = centerLng - HALF_DEG;
    const lat2 = centerLat + HALF_DEG;
    const lng2 = centerLng + HALF_DEG;
    try {
      const res = await authenticatedFetch(
        `/api/markers/public?bbox=${lat1},${lng1},${lat2},${lng2}`,
      );
      if (!res.ok) { set({ loadingPublic: false }); return; }
      const data = await res.json();
      const rows: any[] = Array.isArray(data?.markers) ? data.markers : [];
      // Backend returns id, type, lat, lng, created_at (anonymous).
      // Build minimal Marker objects; fields not in response default to ''.
      const publicMarkers: Marker[] = rows.map((row: any) => ({
        id: String(row.id),
        type: row.type ?? 'cairn',
        regionCode: 'nz',
        lat: Number(row.lat),
        lng: Number(row.lng),
        alt: undefined,
        note: '',
        authorId: '',
        permission: 'public' as const,
        createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
        synced: true,
        voiceMemoUri: undefined,
      }));
      set({ publicMarkers, loadingPublic: false });
    } catch {
      set({ loadingPublic: false });
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
      try {
        // v413 (4-eye fix C3): reset friend memory cache on user-switch
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useFriendMemoryStore } = require('../features/memory/store/useFriendMemoryStore');
        useFriendMemoryStore.getState().reset();
      } catch (_e) {
        // Store not loaded yet — nothing to reset.
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
    // 2. Then fetch from backend (async, updates state when done)
    get().loadFromBackend();
  },
}));

// ─── v422 offline-first ack handlers ─────────────────────────────────────
//
// 在 store 定义完之后注册, 保证 useMarkerStore.getState() 可用. Module load
// 时执行一次, 之后 offlineMarkers.drain() 成功时会回调这里.
//
// ack: 服务器接受了 marker → 用 server id/authorId 替换 local placeholder
// fail: 4xx 硬失败 → 标 syncState='failed', 让 UI 显示 Retry badge
//
// 注意: 本 handler 不能抛异常, 抛会拖累 offlineEntity daemon. 全部 try/catch。

setMarkerCreateAckHandler(
  (localId, server: MarkerCreateServerResponse) => {
    try {
      const serverAuthorId =
        server.user_id != null ? String(server.user_id) : undefined;
      useMarkerStore.setState((s) => {
        const next = s.markers.map((m) => {
          if (m.localId !== localId && m.id !== localId) return m;
          return {
            ...m,
            id: String(server.id),
            authorId: serverAuthorId ?? m.authorId,
            synced: true,
            syncState: 'synced' as SyncState,
          };
        });
        if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
        return { markers: next };
      });
      crashLogger.breadcrumb(`marker:ack localId=${localId.slice(0, 8)} serverId=${server.id}`);
    } catch (err) {
      crashLogger.breadcrumb(`marker:ack_threw ${String(err).slice(0, 60)}`);
    }
  },
  (localId, err) => {
    try {
      useMarkerStore.setState((s) => {
        const next = s.markers.map((m) => {
          if (m.localId !== localId && m.id !== localId) return m;
          return { ...m, syncState: 'failed' as SyncState };
        });
        if (s.userId) storage.setItem(storageKey(s.userId), JSON.stringify(next));
        return { markers: next };
      });
      crashLogger.breadcrumb(`marker:fail localId=${localId.slice(0, 8)} err=${String(err?.status ?? err).slice(0, 40)}`);
    } catch (e) {
      crashLogger.breadcrumb(`marker:fail_threw ${String(e).slice(0, 60)}`);
    }
  },
);
