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
  type MarkerCreatePayload,
  type MarkerCreateServerResponse,
} from '../services/markerOfflineEntities';
import type { SyncState } from '../services/offlineEntity';
import { uuidv4 } from '../services/offlineQueue';
import { tombstoneMarker, isMarkerTombstoned, listMarkerTombstones } from '../services/markerTombstones';
import {
  cairnIdentityKeys,
  cairnMatchesIdentity,
  mergeOwnedCairns,
} from '../features/cairns/cairnIdentity';

// Sprint 6 review C3 (2026-07-30): serialize concurrent hydrate() calls
// so a race between login + focus + nav can't overwrite user A's markers
// with user B's mid-transition. Mirrors the useSessionStore SAF-03 pattern.
let markerHydrateInFlight: Promise<void> | null = null;
let markerHydrateInFlightUserId: string | null = null;
// Sprint 6 round-11 review R11B2: generation counter so clearMarkers
// can invalidate any in-flight hydrate that hasn't yet written to
// state. Pre-fix, logout during a slow hydrate let the hydrate's
// storage-read resurrect the just-cleared markers a few ms later.
let markerHydrateGeneration = 0;
// Circle discovery is account-scoped even though its loading flag lives in
// one global store. Track the initiating viewer and generation separately so
// an older account cannot hold the single-flight guard or publish into the
// next account after logout/switch.
let markerCircleLoadGeneration = 0;
let markerCircleLoadUserId: string | null = null;

export type MarkerPermission = 'personal' | 'group' | 'public';

export interface Marker {
  id: string;
  /** Immutable local business identity. Legacy hydrated rows may omit it. */
  clientCairnId?: string;
  /** Optional server mapping; never replaces clientCairnId. */
  serverCairnId?: string;
  type: MarkerType;
  regionCode: string;      // e.g. 'nz' — frontend concept, not in backend
  lat: number;
  lng: number;
  note: string;            // backend field: text
  authorId: string;        // 'local' for offline; userId for synced
  createdAt: number;       // Unix ms
  /** Last accepted content mutation when the backend supplies it. */
  updatedAt?: number;
  permission: MarkerPermission;
  publicState?: 'not_public' | 'pending' | 'published' | 'rejected' | 'suspended' | 'withdrawn';
  publicationEpoch?: number;
  contentRevision?: number;
  publicSubmissionCode?: string;
  sessionId?: string;      // legacy alias
  originActivityClientId?: string | null;
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
  /** Local-only Debug/Simulator truth. Never enters a production outbox. */
  qaProvenance?: 'simulator_test';
}

/** Exact live Activity identity captured by the initiating UI before any
 * asynchronous marker persistence. The generation prevents an old S1 caller
 * from being mistaken for a newly started Activity that reuses the screen. */
export interface CairnActivityContext {
  ownerUserId: string;
  clientActivityId: string;
  ownerGeneration: string;
}

export type MarkerCreateInput = Omit<Marker, 'id' | 'createdAt'> & {
  activityContext?: CairnActivityContext | null;
};

/** `addMarker` rejects only before local durability. Once the owner-scoped
 * outbox accepts the row, callers always receive this result—even if another
 * account replaced the visible projection while the write awaited. */
export interface MarkerCreateResult {
  state: 'durably-accepted';
  ownerId: string;
  projection: 'current' | 'owner-changed' | 'projection-failed';
  marker: Marker;
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
  updated_at?: string | null;
  /** Sprint 69 STORY-00537: circle endpoint returns user_id (for tier
   *  computation) and author_name (Friend tier only — Public anonymized
   *  server-side per v4 row Q). Optional on /api/markers (own) path. */
  user_id?: number | string;
  author_name?: string | null;
  client_cairn_id?: string | null;
  origin_activity_client_id?: string | null;
  public_state?: Marker['publicState'];
  publication_epoch?: number | string | null;
  content_revision?: number | string | null;
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
    id: row.client_cairn_id || String(row.id),
    clientCairnId: row.client_cairn_id || undefined,
    serverCairnId: String(row.id),
    originActivityClientId: row.origin_activity_client_id ?? null,
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
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : undefined,
    permission: (row.permission as MarkerPermission) || 'personal',
    publicState: row.public_state,
    publicationEpoch: row.publication_epoch == null ? undefined : Number(row.publication_epoch),
    contentRevision: row.content_revision == null ? undefined : Number(row.content_revision),
    synced: true,
    approximate: row.approximate === true || row.approximate === 1 || false,
    publicSnapshot,
    // Sprint 68 STORY-00532: author display name for Friend-tier marks.
    // Sprint 67 backend nulls this for Public marks (anonymized).
    authorName: row.author_name ?? undefined,
  };
}

export type CairnDeleteResult = {
  remoteState: 'not-needed' | 'deleted' | 'queued';
};

export type CairnLibraryCoverage = 'not-loaded' | 'complete' | 'partial' | 'local-only';

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
  /** Server pages for All Cairns. `markers` remains the single local projection. */
  libraryRemoteMarkers: Marker[];
  libraryQuery: string;
  libraryNextCursor: string | null;
  libraryHasMore: boolean;
  libraryCoverage: CairnLibraryCoverage;
  libraryLoading: boolean;
  libraryError: 'unavailable' | 'server-upgrade-required' | null;
  addMarker: (marker: MarkerCreateInput) => Promise<MarkerCreateResult>;
  updateMarker: (id: string, updates: Partial<Omit<Marker, 'id' | 'createdAt'>>) => Promise<void>;
  retryMarkerSync: (id: string) => Promise<void>;
  deleteMarker: (id: string) => Promise<CairnDeleteResult>;
  /** Sprint 68 STORY-00534: hide a foreign mark from this viewer's map.
   *  Optimistic local wipe + POST /api/hide. Idempotent. */
  hideMark: (id: string) => Promise<void>;
  clearMarkers: () => void;
  getMarkersForRegion: (regionCode: string) => Marker[];
  hydrate: (userId: string) => Promise<void>;
  loadFromBackend: () => Promise<void>;
  loadCairnLibrary: (options?: { query?: string; reset?: boolean }) => Promise<void>;
  resetCairnLibrary: () => void;
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
  libraryRemoteMarkers: [],
  libraryQuery: '',
  libraryNextCursor: null,
  libraryHasMore: false,
  libraryCoverage: 'not-loaded',
  libraryLoading: false,
  libraryError: null,

  addMarker: async (data) => {
    const ownerId = String(get().userId ?? '');
    if (!ownerId) throw new Error('marker_owner_required');
    // v422 offline-first: 无论在线离线, 走同一条路径
    //   1. 立即生成 local placeholder (localId, synced=false, syncState='pending')
    //   2. offlineMarkers.saveLocal → 存本地 kv + 触发 drain
    //   3. drain 成功后 ackHandler 把 localId → server id, syncState='synced'
    //   4. drain 硬失败 (4xx) → failHandler 标 syncState='failed', 用户手动重试
    //   5. drain 软失败 (5xx/网络) → 保留 pending, 网络恢复时 daemon 再试
    // 存 offlineMarkers entity, 拿到 localId (= idempotency key).
    // v423 B1 fix: saveLocal 现在会在 AsyncStorage 满 / hydrate 未完成时 throw.
    // 我们 catch 并向用户报"存不下", 不让 marker 在内存里假成功.
    const { activityContext, ...markerData } = data;
    let activeActivityClientId: string | null = data.originActivityClientId ?? data.sessionId ?? null;
    if (activityContext) {
      let exactActivityIsCurrent = false;
      try {
        const { useTrackingStore } = require('./useTrackingStore');
        const tracking = useTrackingStore.getState();
        exactActivityIsCurrent = (
          (tracking.status === 'tracking' || tracking.status === 'paused')
          && tracking.ownerUserId === activityContext.ownerUserId
          && tracking.sessionId === activityContext.clientActivityId
          && tracking.liveOwnerGeneration === activityContext.ownerGeneration
          && ownerId === activityContext.ownerUserId
        );
      } catch { /* an unavailable Activity store cannot authorize provenance */ }
      if (!exactActivityIsCurrent) throw new Error('marker_activity_changed_before_commit');
      activeActivityClientId = activityContext.clientActivityId;
    }
    if (data.qaProvenance === 'simulator_test') {
      let qaWorkspaceAuthorized = false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const settings = require('./useSettingsStore').useSettingsStore.getState();
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const simulator = require('../features/activitySimulator/useActivitySimulatorStore').useActivitySimulatorStore.getState();
        qaWorkspaceAuthorized = settings.debugMode === true && simulator.enabled === true;
      } catch { /* fail closed */ }
      if (!qaWorkspaceAuthorized) throw new Error('simulator_cairn_requires_qa_workspace');
      const localId = uuidv4();
      const marker: Marker = {
        ...markerData,
        id: localId,
        clientCairnId: localId,
        localId,
        originActivityClientId: activeActivityClientId,
        permission: 'personal',
        createdAt: Date.now(),
        synced: false,
        qaProvenance: 'simulator_test',
        publicState: undefined,
      };
      const existing = get().markers;
      const next = [...existing, marker];
      // This is a durable local QA record, not a pending production write.
      await storage.setItem(storageKey(ownerId), JSON.stringify(next));
      if (String(get().userId ?? '') !== ownerId) {
        return { state: 'durably-accepted', ownerId, projection: 'owner-changed', marker };
      }
      set({ markers: next });
      return { state: 'durably-accepted', ownerId, projection: 'current', marker };
    }
    const payload: MarkerCreatePayload = {
      userId: ownerId,
      type: data.type,
      text: data.note,
      lat: data.lat,
      lng: data.lng,
      alt: data.alt,
      permission: data.permission,
      approximate: data.approximate || false,
      originActivityClientId: activeActivityClientId,
    };
    let localId: string;
    try {
      const saved = await offlineMarkers.saveLocal(payload, ownerId);
      localId = saved.localId;
    } catch (err) {
      crashLogger.breadcrumb(`marker:saveLocal_failed err=${String(err).slice(0, 80)}`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const tracking = require('./useTrackingStore').useTrackingStore.getState();
        if (tracking.locationProviderSource === 'simulator') {
          const reason = `Cairn local commit failed: ${String(err).slice(0, 100)}`;
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../features/activitySimulator/useActivitySimulatorStore').useActivitySimulatorStore.getState().setLastFailure(reason);
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../features/activitySimulator/simulatorLog').appendSimulatorLog('ERROR', 'cairn_local_commit_failed', {
            errorCode: String(err).slice(0, 120),
          }, { userId: ownerId, clientActivityId: activeActivityClientId });
        }
      } catch { /* diagnostics cannot replace the real Plant error */ }
      // 不静默丢: 抛给上层 (PlantScreen commit 会 catch 显示 Alert "Could not plant cairn").
      throw err;
    }

    const marker: Marker = {
      ...markerData,
      id: localId,       // 前端立即用 localId 作 id, ack 后被替换
      clientCairnId: localId,
      originActivityClientId: activeActivityClientId,
      localId,
      createdAt: Date.now(),
      synced: false,
      syncState: 'pending',
      publicSnapshot: null,
      publicState: data.permission === 'public' ? 'not_public' : undefined,
    };
    let projection: MarkerCreateResult['projection'] = 'current';
    if (String(get().userId ?? '') !== ownerId) {
      // The durable A-owned outbox row is intentionally retained. A will
      // rebuild its placeholder on its next hydrate; B sees no A projection.
      projection = 'owner-changed';
    } else {
      try {
        set((s) => {
          if (String(s.userId ?? '') !== ownerId) return s;
          // A very fast acknowledgement may already have materialized the
          // same stable client identity. Never append a second placeholder.
          if (s.markers.some(existing => (
            existing.clientCairnId === localId || existing.id === localId
          ))) return s;
          const next = [...s.markers, marker];
          storage.setItem(storageKey(ownerId), JSON.stringify(next));
          return { markers: next };
        });
      } catch (projectionError) {
        projection = 'projection-failed';
        crashLogger.breadcrumb(`marker:projection_failed err=${String(projectionError).slice(0, 80)}`);
      }
    }
    try {
      // Local-only simulator diagnostics; never sent through appLog.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const tracking = require('./useTrackingStore').useTrackingStore.getState();
      if (tracking.locationProviderSource === 'simulator') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { appendSimulatorLog } = require('../features/activitySimulator/simulatorLog');
        appendSimulatorLog('CAIRN_COMMIT', 'cairn_local_commit_succeeded', {
          cairnClientIdSuffix: localId.slice(-8),
          originActivitySuffix: activeActivityClientId?.slice(-8) ?? null,
          lat: data.lat,
          lng: data.lng,
          permission: data.permission,
          syncState: 'pending',
        }, { userId: ownerId, clientActivityId: activeActivityClientId });
        if (activeActivityClientId) {
          appendSimulatorLog('CAIRN_ASSOCIATION', 'cairn_activity_association_committed', {
            cairnClientIdSuffix: localId.slice(-8),
            originActivitySuffix: activeActivityClientId.slice(-8),
          }, { userId: ownerId, clientActivityId: activeActivityClientId });
        }
      }
    } catch { /* diagnostics cannot affect the durable Cairn commit */ }

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

    // Debug logger: marker_placed
    try {
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
    } catch { /* diagnostics cannot turn a durable acceptance into failure */ }

    // 返回本地 marker. 调用方 (Plant flow) 立即可导航到 MarkerDetail — 那里
    // 通过 offlineMarkers.subscribe 显示 SyncBadge 让用户看到同步进度。
    return {
      state: 'durably-accepted',
      ownerId,
      projection,
      marker,
    };
  },

  updateMarker: async (id, updates) => {
    const ownerId = String(get().userId ?? '');
    const original = get().markers.find((marker) => cairnMatchesIdentity(marker, id));
    if (!original || !ownerId) throw new Error('cairn_not_found');
    const patchMarker = (marker: Marker, updatedAt: number): Marker => ({ ...marker, ...updates, updatedAt });

    if (original.qaProvenance === 'simulator_test') {
      const acceptedAt = Date.now();
      const next = get().markers.map(marker => cairnMatchesIdentity(marker, id)
        ? { ...patchMarker(marker, acceptedAt), permission: 'personal' as MarkerPermission }
        : marker);
      await storage.setItem(storageKey(ownerId), JSON.stringify(next));
      if (String(get().userId ?? '') !== ownerId) throw new Error('cairn_owner_changed_after_save');
      set({ markers: next });
      return;
    }

    // Sync to backend (text, permission, type are updatable). Backend
    // mirrors the same publicSnapshot-on-first-public logic so a stale
    // local row sync wouldn't reset the server-side snapshot.
    const backendUpdates: Record<string, string> = {};
    if (updates.note !== undefined) backendUpdates.text = updates.note;
    if (updates.permission !== undefined) backendUpdates.permission = updates.permission;
    if (updates.type !== undefined) backendUpdates.type = updates.type;
    if (Object.keys(backendUpdates).length === 0) return;

    const localId = original.clientCairnId ?? original.localId;
    const serverId = original.serverCairnId
      ?? (original.synced && /^\d+$/.test(original.id) ? original.id : undefined);
    const pendingCreateEdit = Boolean(!serverId && localId);

    if (!serverId && localId) {
      const updated = await offlineMarkers.updateLocal(localId, (payload) => ({
        ...payload,
        ...(updates.note !== undefined ? { text: updates.note } : {}),
        ...(updates.permission !== undefined ? { permission: updates.permission } : {}),
        ...(updates.type !== undefined ? { type: updates.type } : {}),
      }), ownerId);
      if (!updated) throw new Error('cairn_pending_update_missing');
    } else {
      if (!serverId) throw new Error('cairn_server_identity_missing');
      const response = await authenticatedFetch(`/api/markers/${encodeURIComponent(serverId)}`, {
        method: 'PUT',
        body: JSON.stringify(backendUpdates),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json().catch(() => null);
      if (result?.public_state) {
        updates.publicState = result.public_state;
        updates.publicationEpoch = Number(result.publication_epoch ?? original.publicationEpoch ?? 0);
        updates.contentRevision = Number(result.content_revision ?? original.contentRevision ?? 1);
        updates.publicSubmissionCode = result.public_submission?.code;
      }
    }

    if (String(get().userId ?? '') !== ownerId) throw new Error('cairn_owner_changed_after_save');
    const acceptedAt = Date.now();
    set((s) => {
      if (String(s.userId ?? '') !== ownerId) return s;
      if (!s.markers.some(marker => cairnMatchesIdentity(marker, id))) return s;
      const next = s.markers.map((marker) => (
        cairnMatchesIdentity(marker, id)
          ? {
              ...patchMarker(marker, acceptedAt),
              ...(pendingCreateEdit ? { synced: false, syncState: 'pending' as SyncState } : {}),
            }
          : marker
      ));
      storage.setItem(storageKey(ownerId), JSON.stringify(next));
      return {
        markers: next,
        libraryRemoteMarkers: s.libraryRemoteMarkers.map(marker => (
          cairnMatchesIdentity(marker, id)
            ? {
                ...patchMarker(marker, acceptedAt),
                ...(pendingCreateEdit ? { synced: false, syncState: 'pending' as SyncState } : {}),
              }
            : marker
        )),
      };
    }
    );
  },

  retryMarkerSync: async (id) => {
    const ownerId = String(get().userId ?? '');
    const marker = get().markers.find((item) => cairnMatchesIdentity(item, id));
    if (marker?.qaProvenance === 'simulator_test') throw new Error('cairn_qa_does_not_sync');
    const localId = marker?.clientCairnId ?? marker?.localId;
    if (!ownerId || !localId) throw new Error('cairn_retry_unavailable');
    const accepted = await offlineMarkers.retry(localId, ownerId);
    if (!accepted) throw new Error('cairn_retry_unavailable');
    set((s) => {
      if (String(s.userId ?? '') !== ownerId) return s;
      const next = s.markers.map((item) => (
        cairnMatchesIdentity(item, id)
          ? { ...item, syncState: 'pending' as SyncState }
          : item
      ));
      storage.setItem(storageKey(ownerId), JSON.stringify(next));
      return { markers: next };
    });
  },

  deleteMarker: async (id) => {
    crashLogger.breadcrumb(`marker:delete:start id=${id}`);
    const current = get().markers.find((marker) => cairnMatchesIdentity(marker, id));
    if (!current) throw new Error('cairn_not_found');
    const clientCairnId = current?.clientCairnId ?? current?.localId;
    const serverCairnId = current?.serverCairnId ?? (current?.synced ? current.id : undefined);
    const ownerId = String(get().userId ?? '');
    if (!ownerId) throw new Error('marker_owner_required');

    if (current.qaProvenance === 'simulator_test') {
      const next = get().markers.filter(marker => !cairnMatchesIdentity(marker, id));
      await storage.setItem(storageKey(ownerId), JSON.stringify(next));
      if (String(get().userId ?? '') !== ownerId) throw new Error('marker_owner_changed_after_delete');
      set({ markers: next });
      return { remoteState: 'not-needed' };
    }

    // Modern Cairns have a durable client identity. Commit the tombstone and
    // cancel a pending create before hiding the object; the sync daemon then
    // retries any unacknowledged server deletion without resurrection.
    if (clientCairnId) {
      await tombstoneMarker(ownerId, clientCairnId);
      let pendingCreateDiscarded = true;
      try {
        await offlineMarkers.discard(clientCairnId, ownerId);
      } catch (discardError) {
        // The durable tombstone remains authoritative. A retained create row
        // may retry, but its acknowledgement path sees the tombstone and
        // removes the server copy instead of resurrecting the Cairn.
        pendingCreateDiscarded = false;
        crashLogger.breadcrumb(`marker:delete:discard-queued ${String(discardError).slice(0, 80)}`);
      }
      if (String(get().userId ?? '') !== ownerId) throw new Error('marker_owner_changed_after_commit');
      set((s) => {
        if (String(s.userId ?? '') !== ownerId) return s;
        const next = s.markers.filter(marker => !cairnMatchesIdentity(marker, id));
        storage.setItem(storageKey(ownerId), JSON.stringify(next));
        return {
          markers: next,
          libraryRemoteMarkers: s.libraryRemoteMarkers.filter(marker => !cairnMatchesIdentity(marker, id)),
        };
      });

      if (!serverCairnId) {
        return { remoteState: pendingCreateDiscarded ? 'not-needed' : 'queued' };
      }
      try {
        let response = await authenticatedFetch(
          `/api/markers/client/${encodeURIComponent(clientCairnId)}`,
          { method: 'DELETE' },
        );
        if (!response.ok && response.status !== 404 && serverCairnId) {
          response = await authenticatedFetch(`/api/markers/${encodeURIComponent(serverCairnId)}`, { method: 'DELETE' });
        }
        const deleted = response.ok || response.status === 404;
        crashLogger.breadcrumb(`marker:delete:remote ok=${deleted} id=${id}`);
        return { remoteState: deleted ? 'deleted' : 'queued' };
      } catch (err) {
        crashLogger.breadcrumb(`marker:delete:remote-error ${String(err).slice(0, 80)}`);
        return { remoteState: 'queued' };
      }
    }

    // A legacy server-only row has no client tombstone that can make an
    // offline delete durable. Require a real acknowledgement before removing
    // it locally so a transient failure cannot become false success.
    if (!serverCairnId) throw new Error('cairn_delete_identity_missing');
    const response = await authenticatedFetch(`/api/markers/${encodeURIComponent(serverCairnId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
    if (String(get().userId ?? '') !== ownerId) throw new Error('marker_owner_changed_after_delete');
    set((s) => {
      if (String(s.userId ?? '') !== ownerId) return s;
      const next = s.markers.filter(marker => !cairnMatchesIdentity(marker, id));
      storage.setItem(storageKey(ownerId), JSON.stringify(next));
      return {
        markers: next,
        libraryRemoteMarkers: s.libraryRemoteMarkers.filter(marker => !cairnMatchesIdentity(marker, id)),
      };
    });
    return { remoteState: 'deleted' };
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
    // Sprint 6 round-11 review R11B2 fix: bump the generation counter
    // so any in-flight hydrate() whose storage-read is still pending
    // sees the mismatch and drops its `set(...)`. Pre-fix, a logout
    // during a slow hydrate resurrected the just-cleared markers when
    // the hydrate's storage-read completed after clearMarkers ran.
    markerHydrateGeneration += 1;
    markerCircleLoadGeneration += 1;
    markerCircleLoadUserId = null;
    // Logout/user switch hides this user's data but deliberately preserves
    // its user-scoped cache and committed outbox for a later matching login.
    // BUG-010 fix: also reset cross-session slices so a logout/login
    // doesn't leak prior user's circle data into the new session.
    // BUG-014 fix (round 4): also reset memory subscriptions slice via
    // dynamic require (avoids module cycle). Without this, a logout →
    // login flow that goes clearMarkers → hydrate would skip the
    // user-switch detection in hydrate (prevUserId is null after clear),
    // leaving prior user's subscriptions in-memory until next load().
    set({
      markers: [],
      userId: null,
      circleMarkers: [],
      loadingCircle: false,
      hidingIds: [],
      publicMarkers: [],
      loadingPublic: false,
      libraryRemoteMarkers: [],
      libraryQuery: '',
      libraryNextCursor: null,
      libraryHasMore: false,
      libraryCoverage: 'not-loaded',
      libraryLoading: false,
      libraryError: null,
    });
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
    // Sprint 6 review NB1 fix (2026-07-30): capture the userId at call
    // time so a stale response arriving AFTER a rapid A→B user switch
    // cannot write A's server markers under B's MMKV key. Pre-fix, this
    // was the exact leak the C3 mutex was supposed to close, but the
    // mutex only serialised hydrate() — loadFromBackend was fire-and-
    // forget and outlived the mutex window.
    const capturedUserId = get().userId;
    // The guest/null slots contain local cold-boot fallback data only. This
    // method owns the authenticated endpoint, so enforce its account
    // prerequisite here for hydrate and every future caller.
    if (!capturedUserId || capturedUserId === 'guest') return;
    try {
      const res = await authenticatedFetch('/api/markers');
      if (!res.ok) return;
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      const tombstones = new Set(await listMarkerTombstones(String(capturedUserId ?? '')));
      const serverMarkers: Marker[] = rows.map(fromBackend)
        .filter(marker => !cairnIdentityKeys(marker).some(id => tombstones.has(id)));

      // If the user changed while the fetch was in flight, drop the
      // response on the floor. The new user's hydrate will fetch its
      // own markers.
      if (get().userId !== capturedUserId) return;

      set((s) => {
        // Second guard inside the setState (belt + suspenders — Zustand
        // is synchronous but we want to be sure the check is atomic
        // with the write).
        if (s.userId !== capturedUserId) return { markers: s.markers };
        const merged = mergeOwnedCairns(s.markers, serverMarkers, tombstones);
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
    const capturedUserId = String(get().userId ?? '');
    if (!capturedUserId) {
      set({ loadingCircle: false });
      return;
    }
    if (get().loadingCircle && markerCircleLoadUserId === capturedUserId) return;
    const generationAtStart = markerCircleLoadGeneration + 1;
    markerCircleLoadGeneration = generationAtStart;
    markerCircleLoadUserId = capturedUserId;
    const stillOwnsLoad = () => (
      markerCircleLoadGeneration === generationAtStart
      && String(get().userId ?? '') === capturedUserId
    );
    const hidingSnapshot = new Set(get().hidingIds);
    set({ loadingCircle: true });
    try {
      // The client never downloads a catalogue of undiscovered friend Cairns.
      // Ask the server to derive eligible encounters from authoritative real
      // Memory evidence, then fetch only the resulting read-authorized facts.
      await authenticatedFetch('/api/friend-content/encounters/verify', {
        method: 'POST',
        body: JSON.stringify({}),
      }).catch(() => null);
      if (!stillOwnsLoad()) return;
      const res = await authenticatedFetch('/api/circle/markers');
      if (!res.ok) return;
      const data = await res.json();
      if (!stillOwnsLoad()) return;
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
      set((state) => (
        markerCircleLoadGeneration === generationAtStart
        && String(state.userId ?? '') === capturedUserId
          ? { circleMarkers: circle }
          : {}
      ));
    } catch {
      // The current generation's loading state is cleared in finally. Older
      // generations must not touch a newer account's request state.
    } finally {
      if (markerCircleLoadGeneration === generationAtStart) {
        markerCircleLoadUserId = null;
        set({ loadingCircle: false });
      }
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
      if (!res.ok) { set({ publicMarkers: [], loadingPublic: false }); return; }
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

  loadCairnLibrary: async (options) => {
    const capturedUserId = String(get().userId ?? '');
    if (!capturedUserId || get().libraryLoading) return;
    const query = String(options?.query ?? get().libraryQuery).trim();
    const reset = options?.reset ?? query !== get().libraryQuery;
    const cursor = reset ? null : get().libraryNextCursor;
    if (!reset && !get().libraryHasMore && get().libraryCoverage !== 'not-loaded') return;
    set({
      libraryLoading: true,
      libraryQuery: query,
      libraryError: null,
      ...(reset ? {
        libraryRemoteMarkers: [],
        libraryNextCursor: null,
        libraryHasMore: false,
        libraryCoverage: 'not-loaded' as CairnLibraryCoverage,
      } : {}),
    });
    const params = ['limit=40'];
    if (query) params.push(`q=${encodeURIComponent(query)}`);
    if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
    try {
      const response = await authenticatedFetch(`/api/markers/library?${params.join('&')}`);
      if (String(get().userId ?? '') !== capturedUserId) return;
      if (response.status === 404) {
        await get().loadFromBackend();
        if (String(get().userId ?? '') !== capturedUserId) return;
        set({
          libraryLoading: false,
          libraryCoverage: 'partial',
          libraryError: 'server-upgrade-required',
          libraryHasMore: false,
          libraryNextCursor: null,
        });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rows: unknown[] = Array.isArray(payload?.markers) ? payload.markers : [];
      const tombstones = new Set(await listMarkerTombstones(capturedUserId));
      const page = rows.map(row => fromBackend(row as Parameters<typeof fromBackend>[0]));
      if (String(get().userId ?? '') !== capturedUserId) return;
      set((s) => {
        if (String(s.userId ?? '') !== capturedUserId || s.libraryQuery !== query) return s;
        const remote = mergeOwnedCairns(reset ? [] : s.libraryRemoteMarkers, page, tombstones);
        // A downloaded library page joins the same owner-scoped projection
        // used by map, Activity links, and Own Cairn Detail. Persisting the
        // merge makes viewed history available offline and ensures a row
        // never opens a second, library-only representation of the Cairn.
        const markers = mergeOwnedCairns(s.markers, page, tombstones);
        storage.setItem(storageKey(capturedUserId), JSON.stringify(markers));
        const hasMore = Boolean(payload?.has_more && payload?.next_cursor);
        return {
          markers,
          libraryRemoteMarkers: remote,
          libraryNextCursor: hasMore ? String(payload.next_cursor) : null,
          libraryHasMore: hasMore,
          libraryCoverage: hasMore ? 'partial' : 'complete',
          libraryLoading: false,
          libraryError: null,
        };
      });
    } catch {
      if (String(get().userId ?? '') !== capturedUserId) return;
      set((s) => ({
        libraryLoading: false,
        libraryCoverage: s.libraryRemoteMarkers.length > 0 ? 'partial' : 'local-only',
        libraryError: 'unavailable',
      }));
    }
  },

  resetCairnLibrary: () => set({
    libraryRemoteMarkers: [],
    libraryQuery: '',
    libraryNextCursor: null,
    libraryHasMore: false,
    libraryCoverage: 'not-loaded',
    libraryLoading: false,
    libraryError: null,
  }),

  hydrate: async (userId: string) => {
    crashLogger.breadcrumb(`marker_hydrate:start user_id=${userId}`);
    // Sprint 6 review C3 fix (2026-07-30): apply the same mutex pattern
    // useSessionStore added in SAF-03 so overlapping hydrate calls (login
    // + focus + nav all firing near-simultaneously) can't cross-pollute
    // users. Without this, a rapid A→B→A user switch could leave marker
    // state in a mixed order where the last write wins but the effect of
    // an earlier hydrate arrived after the later one, leaking user B's
    // markers into user A's view.
    if (markerHydrateInFlight) {
      const sameUser = markerHydrateInFlightUserId === userId;
      crashLogger.breadcrumb(`marker_hydrate:mutex_wait same_user=${sameUser}`);
      await markerHydrateInFlight.catch(() => {});
      if (sameUser) {
        crashLogger.breadcrumb('marker_hydrate:mutex_same_user_return');
        return;
      }
    }
    const run = (async () => {
      // Sprint 6 round-11 R11B2: snapshot the generation counter at
      // start. If clearMarkers bumps it before we finish, drop our
      // storage-read result rather than resurrecting stale data.
      const genAtStart = markerHydrateGeneration;
      // BUG-010 fix: detect user-switch. If the in-memory userId differs
      // from the incoming one, drop cross-session slices so the prior user's
      // circleMarkers + hidingIds + memory subscriptions don't bleed into
      // the new session. (markers is keyed by userId in MMKV so it's safe
      // to overwrite below either way.)
      const prevUserId = get().userId;
      if (prevUserId && prevUserId !== userId) {
        markerCircleLoadGeneration += 1;
        markerCircleLoadUserId = null;
        set({
          circleMarkers: [],
          loadingCircle: false,
          hidingIds: [],
          libraryRemoteMarkers: [],
          libraryQuery: '',
          libraryNextCursor: null,
          libraryHasMore: false,
          libraryCoverage: 'not-loaded',
          libraryLoading: false,
          libraryError: null,
        });
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
      // O17 F-STO-06: opportunistically remove old 'cairn_markers' (pre-v0.2.6)
      // legacy key. Stored a few KB per user; harmless dead data, but reclaims
      // AsyncStorage budget on TestFlight installs upgraded across schema bump.
      void storage.removeItem('cairn_markers').catch(() => {});
      const raw = await storage.getItem(key);
      const tombstones = new Set(await listMarkerTombstones(userId));
      // Re-check userId in case a newer hydrate raced ahead — only apply
      // if we're still the current target user.
      if (get().userId !== undefined && get().userId !== userId && markerHydrateInFlightUserId !== userId) {
        return;
      }
      // Sprint 6 round-11 R11B2: if clearMarkers bumped the generation
      // while our storage-read was in flight, drop our result so we
      // don't resurrect just-cleared data.
      if (markerHydrateGeneration !== genAtStart) {
        return;
      }
      if (raw) {
        try {
          const parsed: Marker[] = JSON.parse(raw);
          const markers = parsed.filter(marker => (
            !cairnIdentityKeys(marker).some(id => tombstones.has(id))
          ));
          crashLogger.breadcrumb(`marker_hydrate:parsed count=${markers.length}`);
          if (markers.length !== parsed.length) {
            await storage.setItem(key, JSON.stringify(markers));
          }
          set({ markers, userId });
        } catch (parseErr: any) {
          crashLogger.breadcrumb(`marker_hydrate:parse_fail ${String(parseErr?.message || parseErr).slice(0, 60)}`);
          storage.removeItem(key);
          set({ markers: [], userId });
        }
      } else {
        crashLogger.breadcrumb('marker_hydrate:no_cache');
        set({ markers: [], userId });
      }
      // The business outbox is itself committed Cairn product data. Rebuild
      // any missing placeholder before network hydration so a process death
      // can never leave a durable create row with no Cairn visible in-product.
      try {
        const pending = await offlineMarkers.listPending();
        const visiblePending: Marker[] = [];
        for (const entry of pending) {
          if (tombstones.has(entry.localId)) continue;
          const data = entry.data;
          visiblePending.push({
            id: entry.localId,
            clientCairnId: entry.localId,
            localId: entry.localId,
            type: data.type,
            regionCode: 'nz',
            lat: data.lat,
            lng: data.lng,
            alt: data.alt,
            note: data.text || '',
            authorId: userId,
            createdAt: entry.savedAt,
            permission: data.permission,
            approximate: data.approximate,
            originActivityClientId: data.originActivityClientId ?? null,
            synced: false,
            syncState: entry.syncState,
          });
        }
        if (visiblePending.length > 0) {
          const current = get().markers;
          const existing = new Set(current.map(marker => marker.clientCairnId ?? marker.id));
          const merged = [...current, ...visiblePending.filter(marker => !existing.has(marker.id))];
          await storage.setItem(key, JSON.stringify(merged));
          set({ markers: merged, userId });
        }
      } catch (outboxError) {
        crashLogger.breadcrumb(`marker_hydrate:outbox_rebuild_failed ${String(outboxError).slice(0, 80)}`);
      }
      // Cold boot may receive its initial online event before this owner-scoped
      // outbox exists in memory. Wake it after reconstruction as well.
      crashLogger.breadcrumb(`marker_hydrate:outbox_wake user_id=${userId}`);
      void offlineMarkers.drain().catch(() => {});
      // 2. Then fetch from backend (async, updates state when done)
      get().loadFromBackend();
    })();
    markerHydrateInFlight = run;
    markerHydrateInFlightUserId = userId;
    try {
      await run;
      crashLogger.breadcrumb(`marker_hydrate:done user_id=${userId}`);
    } catch (runErr: any) {
      crashLogger.breadcrumb(`marker_hydrate:catch ${String(runErr?.message || runErr).slice(0, 80)}`);
      throw runErr;
    } finally {
      if (markerHydrateInFlight === run) {
        markerHydrateInFlight = null;
        markerHydrateInFlightUserId = null;
      }
    }
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
  async (localId, server: MarkerCreateServerResponse, data, ownerId) => {
    try {
      if (!ownerId) throw new Error('marker_ack_owner_missing');
      // Never use the account that happens to be active when a response
      // resolves.  The owner was captured in the durable outbox entry.
      if (String(useMarkerStore.getState().userId ?? '') !== ownerId) {
        throw new Error('marker_ack_owner_not_current');
      }
      if (await isMarkerTombstoned(ownerId, localId)) {
        const deleted = await authenticatedFetch(`/api/markers/${server.id}`, { method: 'DELETE' });
        if (!deleted.ok && deleted.status !== 404) throw new Error('marker_tombstone_reconciliation_failed');
        return;
      }
      const serverAuthorId =
        server.user_id != null ? String(server.user_id) : undefined;
      const latestEntry = await offlineMarkers.getEntry(localId);
      const latestData = latestEntry?.data ?? data;
      const supersededWhileSyncing = Boolean(latestEntry && (
        latestData.text !== data.text
        || latestData.type !== data.type
        || latestData.permission !== data.permission
      ));
      const snapshot = useMarkerStore.getState();
      const existing = snapshot.markers.find(m => m.localId === localId || m.id === localId);
      const acknowledged: Marker = existing
        ? {
            ...existing,
            id: existing.clientCairnId ?? localId,
            clientCairnId: existing.clientCairnId ?? localId,
            serverCairnId: String(server.id),
            authorId: serverAuthorId ?? existing.authorId,
            synced: !supersededWhileSyncing,
            syncState: (supersededWhileSyncing ? 'pending' : 'synced') as SyncState,
            publicState: server.public_state ?? server.public_submission?.state ?? existing.publicState,
            publicationEpoch: server.publication_epoch == null ? existing.publicationEpoch : Number(server.publication_epoch),
            contentRevision: server.content_revision == null ? existing.contentRevision : Number(server.content_revision),
            publicSubmissionCode: server.public_submission?.code ?? existing.publicSubmissionCode,
          }
        : {
            id: localId,
            clientCairnId: localId,
            serverCairnId: String(server.id),
            localId,
            type: latestData.type,
            regionCode: 'nz',
            lat: data.lat,
            lng: data.lng,
            alt: data.alt,
            note: latestData.text,
            authorId: serverAuthorId ?? ownerId,
            createdAt: Date.now(),
            permission: latestData.permission,
            approximate: latestData.approximate,
            originActivityClientId: latestData.originActivityClientId ?? null,
            synced: !supersededWhileSyncing,
            syncState: (supersededWhileSyncing ? 'pending' : 'synced') as SyncState,
            publicSnapshot: null,
            publicState: server.public_state ?? server.public_submission?.state,
            publicationEpoch: server.publication_epoch == null ? undefined : Number(server.publication_epoch),
            contentRevision: server.content_revision == null ? undefined : Number(server.content_revision),
            publicSubmissionCode: server.public_submission?.code,
          };
      const next = existing
        ? snapshot.markers.map((m) => {
          if (m.localId !== localId && m.id !== localId) return m;
          return acknowledged;
        })
        : [...snapshot.markers, acknowledged];
      await storage.setItem(storageKey(ownerId), JSON.stringify(next));
      if (String(useMarkerStore.getState().userId ?? '') !== ownerId) throw new Error('marker_ack_owner_changed');
      useMarkerStore.setState({ markers: next });
      crashLogger.breadcrumb(`marker:ack localId=${localId.slice(0, 8)} serverId=${server.id}`);
    } catch (err) {
      crashLogger.breadcrumb(`marker:ack_threw ${String(err).slice(0, 60)}`);
      throw err;
    }
  },

  (localId, err, ownerId) => {
    try {
      useMarkerStore.setState((s) => {
        if (String(s.userId ?? '') !== ownerId) return s;
        const next = s.markers.map((m) => {
          if (m.localId !== localId && m.id !== localId) return m;
          return { ...m, syncState: 'failed' as SyncState };
        });
        storage.setItem(storageKey(ownerId), JSON.stringify(next));
        return { markers: next };
      });
      crashLogger.breadcrumb(`marker:fail localId=${localId.slice(0, 8)} err=${String(err?.status ?? err).slice(0, 40)}`);
    } catch (e) {
      crashLogger.breadcrumb(`marker:fail_threw ${String(e).slice(0, 60)}`);
    }
  },
);
