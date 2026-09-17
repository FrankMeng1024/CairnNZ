/**
 * useRouteStore — Route management store.
 *
 * Offline-first Route store. Geometry is copied locally at creation time;
 * the durable outbox syncs an independent server Route when connectivity
 * returns. Server refreshes are merged without discarding local work.
 */
import { create } from 'zustand';
import {
  fetchRoutes,
  fetchRouteDetail,
  updateRoute as apiUpdateRoute,
  deleteRoute as apiDeleteRoute,
  deleteRouteByClientId,
} from '../services/routeService';
import { crashLogger } from '../services/crashLogger';
import { storage } from './storage';
import { useAppStore } from './useAppStore';
import {
  offlineRoutes,
  setRouteCreateHandlers,
  type OfflineRouteCreatePayload,
} from '../services/routeOfflineEntities';
import type { SyncState } from '../services/offlineEntity';
import {
  cloneActivityRouteReference,
  routeIdentityKeys,
  routeMatchesIdentity,
  type ActivityRouteReference,
  type RouteCreationOrigin,
} from '../features/route/routeContracts';
import {
  isRouteTombstoned,
  listRouteTombstones,
  markRouteRemoteDeletePending,
  markRouteRemoteDeleted,
  tombstoneRoute,
} from '../services/routeTombstones';

// ── Types ───────────────────────────────────────────────────────────────────

export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  label: string;           // e.g. "Hydrate", "Rest stop"
  announceOnArrival: boolean; // TTS broadcast when user reaches this point
  radiusM: number;         // trigger radius in meters (default 30)
}

export interface RoutePoint {
  lat: number;
  lng: number;
  alt?: number | null;
}

// Per-segment classification (Phase 1 of route-rules.md).
// A route is a list of contiguous segments. `road` segments map to
// OSM/DOC roads (snap rate ≥ 0.8), `free` segments don't (snap rate
// < 0.3), `mixed` is the transitional middle band. Classification
// happens lazily after a hike completes — when the field is absent
// the entire route is treated as a single 'free' segment by callers.
type RouteSegmentType = 'road' | 'free' | 'mixed';
interface RouteSegment {
  type: RouteSegmentType;
  // Inclusive [startIndex, endIndex] into the route's points array.
  // Storing indices (not duplicated coords) keeps the route data flat
  // and makes editing trivial — corridor / trim algorithms reference
  // the same source array.
  startIndex: number;
  endIndex: number;
  // Optional snap-success rate from Map Matching when classification ran.
  snapRate?: number;
}

export interface Route {
  id: string;
  name: string;
  description?: string;
  createdAt: number;       // timestamp (ms)
  updatedAt: number;
  points: RoutePoint[];    // the route polyline (current/edited version)
  // Phase 1: original GPS trace, set once at save-as-route and never
  // mutated by edit operations. Edit corridors are computed against
  // this baseline forever (route-rules.md §4.4 "original is forever").
  // Optional during migration — pre-Phase-1 routes have only `points`.
  originalPoints?: RoutePoint[];
  // Phase 1: per-segment classification. Absent on legacy routes;
  // callers should treat absence as a single free segment.
  segments?: RouteSegment[];
  waypoints: Waypoint[];   // interactive points along route
  distanceM: number;       // total route distance in meters
  elevationGainM: number;  // total elevation gain
  runCount: number;        // how many times user completed this route
  lastRunAt?: number;      // timestamp of last completion
  sharedBy?: string;       // friend name if received from a friend
  isActive: boolean;       // currently selected for navigation
  // O1 batch 40: mutedMarkerIds, heroPhotoUrl, photoCredit removed — 0 external readers
  activityMode?: 'hiking' | 'running'; // inherited from the originating session
  // Sprint 69 STORY-00535: visibility tier persisted to backend (added by
  // Sprint 67 migration 018 to routes.permission ENUM). Default 'personal'
  // for legacy routes; new routes saved via the v1 Route create UI default
  // to 'friend' per v4.U binding.
  permission?: 'personal' | 'friend';
  /** Local identity remains stable while the outbox replaces server state. */
  remoteId?: string;
  /** Durable per-owner client identity used across create acknowledgement. */
  clientRouteId?: string;
  syncState?: SyncState;
  syncErrorCode?: string;
  syncErrorMessage?: string;
  /** Minimal local provenance for Activity → independent Route handoff. */
  originActivityClientId?: string;
  originActivityServerId?: number;
  /** True only when the user explicitly chose to reconnect an Activity Gap in the new Route. */
  originActivityGapReconnected?: boolean;
  creationOrigin?: RouteCreationOrigin;
  originGeometryHash?: string;
  createdGeometryHash?: string;
  geometryEditedSinceCreation?: boolean;
  /** Whether provenance has survived a server round trip. */
  originPersistence?: 'pending' | 'durable' | 'legacy-local' | 'unknown';
  /** Server-issued updated_at accepted after a successful mutation. This is
   * persisted so a relaunch cannot replace that acknowledgement with an
   * older cached/list projection. It never uses the device wall clock. */
  acceptedServerUpdatedAt?: number;
}

export type RouteDetailState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
export interface RouteDeleteResult { remoteState: 'not-needed' | 'deleted' | 'queued' }

const routeCacheKey = (userId: string) => `@cairn:routes:v1:${userId}`;
const routeCacheWriteTails = new Map<string, Promise<void>>();

let routeMutationEpoch = 0;
let listRequestSequence = 0;
const routeMutationRevision = new Map<string, number>();

function revisionKey(userId: string, identity: string): string {
  return `${userId}:${identity}`;
}

function routeWasMutatedSince(
  userId: string,
  identities: string[],
  readEpoch: number,
): boolean {
  return identities.some(identity => (
    (routeMutationRevision.get(revisionKey(userId, identity)) ?? 0) > readEpoch
  ));
}

function bumpRouteRevision(userId: string, route: Pick<Route, 'id' | 'remoteId' | 'clientRouteId'>): number {
  const revision = ++routeMutationEpoch;
  for (const identity of routeIdentityKeys(route)) {
    routeMutationRevision.set(revisionKey(userId, identity), revision);
  }
  return revision;
}

function preserveMutationsAfterRead(
  candidate: Route[],
  current: Route[],
  userId: string,
  readEpoch: number,
): Route[] {
  const emitted = new Set<Route>();
  const currentByIdentity = new Map<string, Route>();
  for (const route of current) {
    for (const identity of routeIdentityKeys(route)) currentByIdentity.set(identity, route);
  }
  const result: Route[] = [];
  for (const route of candidate) {
    const identities = routeIdentityKeys(route);
    if (!routeWasMutatedSince(userId, identities, readEpoch)) {
      result.push(route);
      continue;
    }
    const accepted = identities.map(identity => currentByIdentity.get(identity)).find(Boolean);
    // No current object means a delete accepted after this read started.
    if (accepted && !emitted.has(accepted)) {
      result.push(accepted);
      emitted.add(accepted);
    }
  }
  for (const route of current) {
    if (!routeWasMutatedSince(userId, routeIdentityKeys(route), readEpoch)) continue;
    if (!emitted.has(route) && !result.some(item => routeIdentityKeys(item).some(identity => routeMatchesIdentity(route, identity)))) {
      result.unshift(route);
      emitted.add(route);
    }
  }
  return result;
}

function currentUserId(): string {
  return String(useAppStore.getState().user?.id ?? '');
}

async function readRouteCache(userId: string): Promise<Route[]> {
  if (!userId) return [];
  try {
    const raw = await storage.getItem(routeCacheKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistRouteCache(routes: Route[], userId = currentUserId()): Promise<void> {
  if (!userId) return;
  const snapshot = JSON.stringify(routes);
  const previous = routeCacheWriteTails.get(userId) ?? Promise.resolve();
  const write = previous.catch(() => undefined).then(() => (
    storage.setItem(routeCacheKey(userId), snapshot, { strict: true })
  ));
  routeCacheWriteTails.set(userId, write);
  try {
    await write;
  } finally {
    if (routeCacheWriteTails.get(userId) === write) routeCacheWriteTails.delete(userId);
  }
}

function pendingRoute(entry: Awaited<ReturnType<typeof offlineRoutes.listPending>>[number]): Route {
  return {
    ...entry.data.route,
    id: entry.localId,
    clientRouteId: entry.localId,
    createdAt: entry.savedAt,
    updatedAt: entry.savedAt,
    runCount: 0,
    isActive: false,
    syncState: entry.syncState,
    syncErrorCode: entry.lastErrorCode,
    syncErrorMessage: entry.lastError,
    creationOrigin: entry.data.sourceActivity ? 'activity' : 'manual',
    originPersistence: 'pending',
  };
}

let detailRequestSequence = 0;

function explicitServerRouteId(remoteId?: string): string | null {
  return remoteId && /^\d+$/.test(remoteId) ? remoteId : null;
}

async function reconcileRemoteRouteDelete(
  ownerId: string,
  clientRouteId: string,
  remoteId?: string,
): Promise<boolean> {
  try {
    const clientOutcome = await deleteRouteByClientId(clientRouteId);
    if (clientOutcome === 'deleted' || clientOutcome === 'already-absent') {
      await markRouteRemoteDeleted(ownerId, clientRouteId);
      return true;
    }
    const legacyId = explicitServerRouteId(remoteId);
    if (!legacyId) {
      await markRouteRemoteDeletePending(ownerId, clientRouteId, 'CLIENT_DELETE_ENDPOINT_UNSUPPORTED');
      return false;
    }
    const legacyOutcome = await apiDeleteRoute(legacyId);
    if (legacyOutcome === 'deleted' || legacyOutcome === 'already-absent') {
      await markRouteRemoteDeleted(ownerId, clientRouteId);
      return true;
    }
    await markRouteRemoteDeletePending(ownerId, clientRouteId, 'ROUTE_DELETE_OUTCOME_UNKNOWN');
    return false;
  } catch (error: any) {
    await markRouteRemoteDeletePending(
      ownerId,
      clientRouteId,
      typeof error?.code === 'string' ? error.code : 'ROUTE_DELETE_RETRY_REQUIRED',
    );
    return false;
  }
}

interface RouteStore {
  routes: Route[];
  routeOwnerId: string | null;
  /** Personal-library load state. Cached/local Routes remain visible on error. */
  routesLoading: boolean;
  routesLoadError: boolean;
  routeDetailState: Record<string, RouteDetailState>;
  // O1 batch 35: activeRouteId removed — written only in setActiveRoute (dead) + deleteRoute;
  // 0 external readers. routesLoadCompleted removed — only written internally; 0 external readers.
  /** Sprint 69 STORY-00538: subscribed-friend friend+public routes
   *  loaded from GET /api/circle/routes. Stored separately from `routes`
   *  (Mine) so Trails Friends sub-tab can render them without touching
   *  the viewer's own route list. */
  circleRoutes: Route[];
  loadingCircleRoutes: boolean;

  /** Route the user has selected to be guided along during the current
   *  tracking session. `null` = free hike/run (no navigation). Set by
   *  Hiking/Running screens when the user picks a route from the sheet
   *  and starts tracking; cleared on stopTracking or when the user picks
   *  "Free hike". Session-scoped only — not persisted. */
  followingRouteId: string | null;
  setFollowingRoute: (id: string | null) => void;
  activityRouteReference: ActivityRouteReference | null;
  captureActivityRouteReference: (id: string | null) => ActivityRouteReference | null;
  clearActivityRouteReference: () => void;

  // Load from backend
  loadRoutes: () => Promise<void>;
  /** Sprint 69 STORY-00538: load friend routes. */
  loadCircleRoutes: () => Promise<void>;
  // v123: hydrate the FULL route (including points) for a single id.
  // Used by RouteEditor when opening an existing route — the list
  // endpoint omits points for perf, so the in-store route may have
  // points=[]; this fills it in.
  loadRouteDetail: (id: string) => Promise<RouteDetailState>;

  // CRUD
  addRoute: (
    route: Omit<Route, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'isActive'>,
    sourceActivity?: {
      clientActivityId?: string;
      serverActivityId?: number;
      reconnectsActivityGap?: boolean;
    },
  ) => Promise<string | null>;
  updateRoute: (id: string, updates: Partial<Route>) => Promise<void>;
  deleteRoute: (id: string) => Promise<RouteDeleteResult>;
  retryRouteSync: (id: string) => Promise<void>;

  // O1 batch 35: removed addWaypoint, removeWaypoint (0 external callers — waypoint UI not built),
  // setActiveRoute, incrementRunCount, muteMarker, unmuteMarker, hydrate (0 external callers).
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useRouteStore = create<RouteStore>((set, get) => ({
  routes: [],
  routeOwnerId: null,
  // The first list request begins when Trails mounts. Starting in loading
  // prevents an empty-library flash before cache/server truth is known.
  routesLoading: true,
  routesLoadError: false,
  routeDetailState: {},
  // Sprint 69 STORY-00538: initial empty until first loadCircleRoutes().
  circleRoutes: [],
  loadingCircleRoutes: false,
  followingRouteId: null,
  activityRouteReference: null,

  setFollowingRoute: (id) => set({ followingRouteId: id }),
  captureActivityRouteReference: (id) => {
    if (!id) {
      set({ activityRouteReference: null });
      return null;
    }
    const route = get().routes.find(item => routeMatchesIdentity(item, id));
    if (!route || route.points.length < 2) return null;
    const snapshot = cloneActivityRouteReference(route);
    set({ activityRouteReference: snapshot });
    return snapshot;
  },
  clearActivityRouteReference: () => set({ activityRouteReference: null }),

  loadRoutes: async () => {
    const ownerId = currentUserId();
    const requestId = ++listRequestSequence;
    const readEpoch = routeMutationEpoch;
    if (get().routeOwnerId !== ownerId) {
      detailRequestSequence += 1;
      set({
        routes: [],
        routeOwnerId: ownerId || null,
        activityRouteReference: null,
        followingRouteId: null,
        routeDetailState: {},
        routesLoading: true,
        routesLoadError: false,
      });
    } else {
      set({ routesLoading: true, routesLoadError: false });
    }
    const [cached, queued, tombstoneRecords] = await Promise.all([
      readRouteCache(ownerId),
      offlineRoutes.listPending(),
      listRouteTombstones(ownerId),
    ]);
    if (requestId !== listRequestSequence || currentUserId() !== ownerId) return;
    const tombstonedClientIds = new Set(tombstoneRecords.map(item => item.clientRouteId));
    const tombstonedRemoteIds = new Set(tombstoneRecords.map(item => item.remoteId).filter(Boolean) as string[]);
    const hidden = (route: Route) => routeIdentityKeys(route).some(identity => (
      tombstonedClientIds.has(identity) || tombstonedRemoteIds.has(identity)
    ));
    const queuedRoutes = queued.map(pendingRoute).filter(route => !hidden(route));
    const queuedIds = new Set(queuedRoutes.map(route => route.id));
    const cachedLocal = cached.filter(route => !queuedIds.has(route.id) && !hidden(route));
    const durableIdentities = new Set([...queuedRoutes, ...cachedLocal].flatMap(routeIdentityKeys));
    const retainedMemory = get().routes.filter(route => (
      !hidden(route) && !routeIdentityKeys(route).some(identity => durableIdentities.has(identity))
    ));
    const local = preserveMutationsAfterRead(
      [...queuedRoutes, ...cachedLocal, ...retainedMemory],
      get().routes,
      ownerId,
      readEpoch,
    );
    if (requestId === listRequestSequence && currentUserId() === ownerId) set({ routes: local });
    // Reconcile durable local deletes without blocking cached Route use.
    void Promise.all(tombstoneRecords.filter(item => !item.remoteDeleted).map(item => (
      reconcileRemoteRouteDelete(ownerId, item.clientRouteId, item.remoteId)
    )));
    try {
      const remote = await fetchRoutes();
      if (requestId !== listRequestSequence || currentUserId() !== ownerId) return;
      const existingByIdentity = new Map<string, Route>();
      for (const route of get().routes) {
        for (const identity of routeIdentityKeys(route)) existingByIdentity.set(identity, route);
      }
      // List responses intentionally omit heavy geometry. Preserve a detail
      // snapshot already loaded for Route use instead of replacing it with an
      // empty list-row projection during a background refresh.
      const remoteWithLocalDetail: Route[] = remote.filter(route => !hidden(route)).map(route => {
        const existing = routeIdentityKeys(route)
          .map(identity => existingByIdentity.get(identity))
          .find(Boolean);
        if (!existing) return route;
        if (existing.acceptedServerUpdatedAt
          && route.updatedAt < existing.acceptedServerUpdatedAt) {
          return existing;
        }
        const remoteHasDurableOrigin = route.originPersistence === 'durable';
        const mergedRoute: Route = {
          ...existing,
          ...route,
          // Stable local identity survives a fast server acknowledgement and
          // later list refresh. Modern server provenance is authoritative;
          // an old server is labelled local-only rather than silently erased.
          id: existing.id,
          clientRouteId: existing.clientRouteId ?? route.clientRouteId,
          remoteId: route.remoteId ?? route.id,
          originActivityClientId: remoteHasDurableOrigin
            ? route.originActivityClientId
            : existing.originActivityClientId,
          originActivityServerId: remoteHasDurableOrigin
            ? route.originActivityServerId
            : existing.originActivityServerId,
          originActivityGapReconnected: remoteHasDurableOrigin
            ? route.originActivityGapReconnected
            : existing.originActivityGapReconnected,
          creationOrigin: remoteHasDurableOrigin ? route.creationOrigin : existing.creationOrigin,
          originPersistence: remoteHasDurableOrigin
            ? 'durable'
            : (existing.creationOrigin ? 'legacy-local' : 'unknown'),
          ...(route.points.length < 2 && existing.points.length >= 2
            ? {
                points: existing.points.map(point => ({ ...point })),
                originalPoints: existing.originalPoints?.map(point => ({ ...point })),
                segments: existing.segments?.map(segment => ({ ...segment })),
                waypoints: existing.waypoints.map(waypoint => ({ ...waypoint })),
              }
            : {}),
        };
        return mergedRoute;
      });
      const remoteIdentities = new Set(remoteWithLocalDetail.flatMap(routeIdentityKeys));
      const stillLocal = queuedRoutes.filter(route =>
        !routeIdentityKeys(route).some(identity => remoteIdentities.has(identity)));
      const merged = preserveMutationsAfterRead(
        [...stillLocal, ...remoteWithLocalDetail],
        get().routes,
        ownerId,
        readEpoch,
      );
      if (requestId !== listRequestSequence || currentUserId() !== ownerId) return;
      set({ routes: merged, routesLoading: false, routesLoadError: false });
      await persistRouteCache(get().routes, ownerId);
    } catch (err) {
      crashLogger.breadcrumb(`route:load:offline_cache count=${local.length}`);
      if (requestId === listRequestSequence && currentUserId() === ownerId) {
        set({ routesLoading: false, routesLoadError: true });
      }
    }
  },

  // Sprint 69 STORY-00538: load subscribed-friend routes from
  // GET /api/circle/routes. Wire shape (Sprint 67 STORY-00528):
  //   { routes: [{ id, user_id, name, description, points, distance_m,
  //                elevation_gain_m, permission, author_name, ... }] }
  // author_name is null for Public routes (server-side anonymization).
  loadCircleRoutes: async () => {
    set({ loadingCircleRoutes: true });
    try {
      const { authenticatedFetch } = await import('../services/apiService');
      const res = await authenticatedFetch('/api/circle/routes');
      if (!res.ok) { set({ loadingCircleRoutes: false }); return; }
      const data = await res.json();
      const rows: any[] = Array.isArray(data?.routes) ? data.routes : [];
      // Minimal local shape — these routes are read-only in the UI so we
      // don't need full Route field coverage. Use the existing remoteToLocal
      // by importing from routeService.
      const { default: remoteRoutes } = { default: rows.map((r) => ({
        id: String(r.id),
        name: r.name,
        description: r.description ?? undefined,
        createdAt: new Date(r.created_at).getTime(),
        updatedAt: new Date(r.updated_at).getTime(),
        points: Array.isArray(r.points) ? r.points : (typeof r.points === 'string' ? (() => { try { return JSON.parse(r.points); } catch { return []; } })() : []),
        waypoints: [],
        distanceM: r.distance_m,
        elevationGainM: r.elevation_gain_m,
        runCount: r.run_count ?? 0,
        lastRunAt: r.last_run_at ? new Date(r.last_run_at).getTime() : undefined,
        isActive: false,
        permission: r.permission === 'personal' || r.permission === 'friend' ? r.permission : undefined,
        // Author name when friend tier; null on Public per anonymization.
        sharedBy: r.author_name ?? undefined,
      })) };
      set({ circleRoutes: remoteRoutes as Route[], loadingCircleRoutes: false });
    } catch {
      set({ loadingCircleRoutes: false });
    }
  },

  loadRouteDetail: async (id) => {
    const ownerId = currentUserId();
    const requestId = ++detailRequestSequence;
    const readEpoch = routeMutationEpoch;
    const existing = get().routes.find(route => routeMatchesIdentity(route, id));
    const stableId = existing?.id ?? id;
    if (existing && existing.points.length >= 2 && !existing.remoteId) {
      set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: 'ready' } }));
      return 'ready';
    }
    const remoteTarget = existing?.remoteId ?? (/^\d+$/.test(id) ? id : null);
    if (!remoteTarget) {
      set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: existing ? 'ready' : 'not-found' } }));
      return existing ? 'ready' : 'not-found';
    }
    set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: 'loading' } }));
    const readIdentities = Array.from(new Set([
      id,
      stableId,
      remoteTarget,
      ...(existing ? routeIdentityKeys(existing) : []),
    ].filter(Boolean) as string[]));
    try {
      const detail = await fetchRouteDetail(remoteTarget);
      if (requestId !== detailRequestSequence || currentUserId() !== ownerId) return 'idle';
      if (!detail) {
        const fallback = get().routes.find(route => routeMatchesIdentity(route, stableId));
        if (routeWasMutatedSince(ownerId, readIdentities, readEpoch)) {
          const result: RouteDetailState = fallback ? 'ready' : 'not-found';
          set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: result } }));
          return result;
        }
        const result: RouteDetailState = fallback ? 'ready' : 'not-found';
        set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: result } }));
        return result;
      }
      const clientIdentity = existing?.clientRouteId ?? detail.clientRouteId;
      if (clientIdentity && await isRouteTombstoned(ownerId, clientIdentity)) {
        set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: 'not-found' } }));
        return 'not-found';
      }
      if (requestId !== detailRequestSequence || currentUserId() !== ownerId) return 'idle';
      const currentBeforePublish = get().routes.find(route => routeMatchesIdentity(route, stableId));
      const responseIdentities = Array.from(new Set([
        ...readIdentities,
        ...routeIdentityKeys(detail),
        ...(currentBeforePublish ? routeIdentityKeys(currentBeforePublish) : []),
      ]));
      if (routeWasMutatedSince(ownerId, responseIdentities, readEpoch)) {
        const result: RouteDetailState = currentBeforePublish ? 'ready' : 'not-found';
        set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: result } }));
        return result;
      }
      if (currentBeforePublish?.acceptedServerUpdatedAt
        && detail.updatedAt < currentBeforePublish.acceptedServerUpdatedAt) {
        set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: 'ready' } }));
        return 'ready';
      }
      const durableOrigin = detail.originPersistence === 'durable';
      set((state) => {
        if (currentUserId() !== ownerId) return state;
        const current = state.routes.find(route => routeMatchesIdentity(route, stableId));
        const merged: Route = {
          ...(current ?? detail),
          ...detail,
          id: current?.id ?? stableId,
          clientRouteId: current?.clientRouteId ?? detail.clientRouteId,
          remoteId: detail.remoteId ?? remoteTarget,
          creationOrigin: durableOrigin ? detail.creationOrigin : current?.creationOrigin,
          originActivityClientId: durableOrigin ? detail.originActivityClientId : current?.originActivityClientId,
          originActivityServerId: durableOrigin ? detail.originActivityServerId : current?.originActivityServerId,
          originActivityGapReconnected: durableOrigin
            ? detail.originActivityGapReconnected
            : current?.originActivityGapReconnected,
          originPersistence: durableOrigin
            ? 'durable'
            : (current?.creationOrigin ? 'legacy-local' : 'unknown'),
          acceptedServerUpdatedAt: Math.max(
            current?.acceptedServerUpdatedAt ?? 0,
            detail.updatedAt,
          ),
        };
        return {
          routes: current
            ? state.routes.map(route => routeMatchesIdentity(route, stableId) ? merged : route)
            : [merged, ...state.routes],
          routeDetailState: { ...state.routeDetailState, [merged.id]: 'ready' },
        };
      });
      if (requestId !== detailRequestSequence || currentUserId() !== ownerId) return 'idle';
      await persistRouteCache(get().routes, ownerId);
      return 'ready';
    } catch {
      if (requestId !== detailRequestSequence || currentUserId() !== ownerId) return 'idle';
      const fallback = get().routes.find(route => routeMatchesIdentity(route, stableId));
      if (routeWasMutatedSince(ownerId, readIdentities, readEpoch)) {
        const result: RouteDetailState = fallback ? 'ready' : 'not-found';
        set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: result } }));
        return result;
      }
      const result: RouteDetailState = fallback ? 'ready' : 'error';
      set(state => ({ routeDetailState: { ...state.routeDetailState, [stableId]: result } }));
      return result;
    }
  },

  addRoute: async (routeData, sourceActivity) => {
    const ownerId = currentUserId();
    if (!ownerId) throw new Error('route owner unavailable');
    if (get().routeOwnerId && get().routeOwnerId !== ownerId) throw new Error('route owner changed');
    if (!get().routeOwnerId) set({ routeOwnerId: ownerId });
    // Route is a new product object. Copy every nested collection so later
    // Activity enhancement or editor state cannot mutate its geometry.
    const routeSnapshot = {
      ...routeData,
      originActivityClientId: sourceActivity?.clientActivityId ?? routeData.originActivityClientId,
      originActivityServerId: sourceActivity?.serverActivityId ?? routeData.originActivityServerId,
      originActivityGapReconnected: sourceActivity?.reconnectsActivityGap
        ?? routeData.originActivityGapReconnected,
      creationOrigin: sourceActivity ? 'activity' as const : (routeData.creationOrigin ?? 'manual' as const),
      originPersistence: 'pending' as const,
      points: routeData.points.map(point => ({ ...point })),
      originalPoints: routeData.originalPoints?.map(point => ({ ...point })),
      segments: routeData.segments?.map(segment => ({ ...segment })),
      waypoints: routeData.waypoints.map(waypoint => ({ ...waypoint })),
    };
    const payload: OfflineRouteCreatePayload = { userId: ownerId, route: routeSnapshot, sourceActivity };
    const saved = await offlineRoutes.saveLocal(payload, ownerId);
    const route: Route = {
      ...routeSnapshot,
      id: saved.localId,
      clientRouteId: saved.localId,
      createdAt: saved.savedAt,
      updatedAt: saved.savedAt,
      runCount: 0,
      isActive: false,
      syncState: 'pending',
    };
    bumpRouteRevision(ownerId, route);
    set((s) => ({
      // A fast server acknowledgement can arrive between saveLocal() and
      // this continuation. Do not duplicate or downgrade that synced row.
      routes: s.routes.some(existing => existing.id === route.id)
        ? s.routes
        : [route, ...s.routes],
    }));
    await persistRouteCache(get().routes, ownerId);
    return route.id;
  },

  updateRoute: async (id, updates) => {
    const ownerId = currentUserId();
    const mutationStartEpoch = routeMutationEpoch;
    const prevRoute = get().routes.find(route => routeMatchesIdentity(route, id));
    if (!prevRoute) throw new Error('route_not_found');
    const acceptedUpdates: Partial<Route> = { ...updates };
    delete acceptedUpdates.id;
    delete acceptedUpdates.remoteId;
    delete acceptedUpdates.clientRouteId;
    delete acceptedUpdates.creationOrigin;
    delete acceptedUpdates.originActivityClientId;
    delete acceptedUpdates.originActivityServerId;
    delete acceptedUpdates.originGeometryHash;
    delete acceptedUpdates.createdGeometryHash;
    delete acceptedUpdates.originPersistence;
    const nextLocal: Route = {
      ...prevRoute,
      ...acceptedUpdates,
      updatedAt: Date.now(),
      geometryEditedSinceCreation: acceptedUpdates.points
        ? true
        : prevRoute.geometryEditedSinceCreation,
    };
    const clientId = prevRoute.clientRouteId ?? (!prevRoute.remoteId && !/^\d+$/.test(prevRoute.id) ? prevRoute.id : undefined);
    if (clientId) {
      const changed = await offlineRoutes.updateLocal(clientId, data => ({
        ...data,
        route: { ...data.route, ...acceptedUpdates },
      }), ownerId);
      if (changed) {
        if (currentUserId() !== ownerId) throw new Error('route_owner_changed');
        bumpRouteRevision(ownerId, nextLocal);
        set(state => ({
          routes: state.routes.map(route => routeMatchesIdentity(route, prevRoute.id)
            ? { ...nextLocal, syncState: 'pending' }
            : route),
        }));
        if (prevRoute.syncState === 'failed') await offlineRoutes.retry(clientId, ownerId);
        await persistRouteCache(get().routes, ownerId);
        return;
      }
    }

    const remoteId = prevRoute.remoteId ?? (/^\d+$/.test(prevRoute.id) ? prevRoute.id : null);
    if (!remoteId) throw new Error('route_remote_identity_unavailable');
    const payload: Parameters<typeof apiUpdateRoute>[1] = {};
    if (acceptedUpdates.name !== undefined) payload.name = acceptedUpdates.name;
    if (acceptedUpdates.description !== undefined) payload.description = acceptedUpdates.description;
    if (acceptedUpdates.points !== undefined) payload.points = acceptedUpdates.points;
    if (acceptedUpdates.waypoints !== undefined) payload.waypoints = acceptedUpdates.waypoints;
    if (acceptedUpdates.distanceM !== undefined) payload.distance_m = acceptedUpdates.distanceM;
    if (acceptedUpdates.elevationGainM !== undefined) payload.elevation_gain_m = acceptedUpdates.elevationGainM;
    if (acceptedUpdates.permission !== undefined) payload.permission = acceptedUpdates.permission;
    const updated = await apiUpdateRoute(remoteId, payload);
    if (!updated) throw new Error('route update was not accepted');
    if (currentUserId() !== ownerId) throw new Error('route_owner_changed');
    const stillCurrent = get().routes.find(route => routeMatchesIdentity(route, prevRoute.id));
    if (!stillCurrent) throw new Error('route_no_longer_available');
    if (routeWasMutatedSince(ownerId, routeIdentityKeys(stillCurrent), mutationStartEpoch)) {
      // Another accepted mutation won while this request was in flight. Its
      // store/cache truth remains authoritative over this older response.
      return;
    }
    bumpRouteRevision(ownerId, {
      id: prevRoute.id,
      clientRouteId: prevRoute.clientRouteId ?? updated.clientRouteId,
      remoteId,
    });
    set(state => ({
      routes: state.routes.map(route => routeMatchesIdentity(route, prevRoute.id)
        ? {
            ...nextLocal,
            ...updated,
            id: prevRoute.id,
            clientRouteId: prevRoute.clientRouteId ?? updated.clientRouteId,
            remoteId,
            syncState: 'synced',
            acceptedServerUpdatedAt: updated.updatedAt,
            creationOrigin: updated.originPersistence === 'durable'
              ? updated.creationOrigin
              : prevRoute.creationOrigin,
            originActivityClientId: updated.originPersistence === 'durable'
              ? updated.originActivityClientId
              : prevRoute.originActivityClientId,
            originActivityServerId: updated.originPersistence === 'durable'
              ? updated.originActivityServerId
              : prevRoute.originActivityServerId,
            originActivityGapReconnected: updated.originPersistence === 'durable'
              ? updated.originActivityGapReconnected
              : prevRoute.originActivityGapReconnected,
            originGeometryHash: updated.originPersistence === 'durable'
              ? updated.originGeometryHash
              : prevRoute.originGeometryHash,
            createdGeometryHash: updated.originPersistence === 'durable'
              ? updated.createdGeometryHash
              : prevRoute.createdGeometryHash,
            originPersistence: updated.originPersistence === 'durable'
              ? 'durable'
              : (prevRoute.originPersistence === 'durable' ? 'durable' : 'legacy-local'),
          }
        : route),
    }));
    await persistRouteCache(get().routes, ownerId);
  },

  deleteRoute: async (id) => {
    crashLogger.breadcrumb(`route:delete:start id=${id}`);
    const before = get().routes.find(route => routeMatchesIdentity(route, id));
    if (!before) throw new Error('route_not_found');
    const ownerId = currentUserId();
    if (!ownerId) throw new Error('route_owner_required');
    const clientId = before.clientRouteId ?? (!before.remoteId && !/^\d+$/.test(before.id) ? before.id : undefined);
    const remoteId = before.remoteId ?? (/^\d+$/.test(before.id) ? before.id : undefined);
    let result: RouteDeleteResult;
    if (clientId) {
      await tombstoneRoute(ownerId, clientId, remoteId);
      bumpRouteRevision(ownerId, before);
      try { await offlineRoutes.discard(clientId, ownerId); } catch { /* tombstone still wins */ }
      if (currentUserId() !== ownerId) throw new Error('route_owner_changed_after_delete');
      set((state) => ({
        routes: state.routes.filter(route => !routeMatchesIdentity(route, before.id)),
        followingRouteId: state.followingRouteId && routeMatchesIdentity(before, state.followingRouteId)
          ? null
          : state.followingRouteId,
      }));
      await persistRouteCache(get().routes, ownerId);
      const remotelyComplete = await reconcileRemoteRouteDelete(ownerId, clientId, remoteId);
      result = remotelyComplete
        ? { remoteState: 'deleted' }
        : { remoteState: 'queued' };
    } else {
      if (!remoteId) throw new Error('route_delete_identity_missing');
      await apiDeleteRoute(remoteId);
      if (currentUserId() !== ownerId) throw new Error('route_owner_changed_after_delete');
      bumpRouteRevision(ownerId, before);
      set(state => ({
        routes: state.routes.filter(route => !routeMatchesIdentity(route, before.id)),
        followingRouteId: state.followingRouteId && routeMatchesIdentity(before, state.followingRouteId)
          ? null
          : state.followingRouteId,
      }));
      await persistRouteCache(get().routes, ownerId);
      result = { remoteState: 'deleted' };
    }
    try {
      const { deleteExtras } = await import('../services/LocalRouteExtras');
      await deleteExtras(id);
      crashLogger.breadcrumb(`route:delete:extras-ok id=${id}`);
    } catch (err) {
      crashLogger.breadcrumb(`route:delete:extras-error ${String(err).slice(0, 80)}`);
    }
    // v16-audit (BUG-V16-01): cancel any active edit FIRST so its
    // sessionWriteChain enqueues a clearSession at the chain's tail
    // (after any pending writes from in-flight commit/trim). Then we
    // can route OUR clearSession through the chain too — this keeps
    // the documented "chain enforces FIFO so the last logical mutation
    // wins" invariant intact. The previous bypass (direct clearSession)
    // could let a queued saveSession resurrect a session record for the
    // just-deleted route.
    try {
      const { useRouteEditStore } = await import('./useRouteEditStore');
      const editState = useRouteEditStore.getState();
      if (editState.routeId === id) {
        editState.cancelEdit();
        crashLogger.breadcrumb(`route:delete:edit-cancelled id=${id}`);
      }
    } catch (err) {
      crashLogger.breadcrumb(`route:delete:edit-cancel-error ${String(err).slice(0, 80)}`);
    }
    try {
      const { loadSession, clearSession } = await import('../services/EditSessionPersistence');
      const { chainSessionWrite } = await import('./useRouteEditStore');
      const session = await loadSession();
      if (session && session.routeId === id) {
        // v16-audit (BUG-V16-01): route through sessionWriteChain so we
        // don't bypass the FIFO ordering. After the cancelEdit above,
        // any in-flight in-store writes have been enqueued; this lands
        // last so the final state is "cleared".
        await chainSessionWrite(() => clearSession());
        crashLogger.breadcrumb(`route:delete:session-cleared id=${id}`);
      }
    } catch (err) {
      crashLogger.breadcrumb(`route:delete:session-error ${String(err).slice(0, 80)}`);
    }
    return result;
  },
  retryRouteSync: async (id) => {
    const route = get().routes.find(item => item.id === id);
    if (!route || route.syncState !== 'failed') return;
    const queued = await offlineRoutes.retry(id);
    if (!queued) return;
    bumpRouteRevision(currentUserId(), route);
    set(state => ({
      routes: state.routes.map(item =>
        item.id === id
          ? { ...item, syncState: 'pending', syncErrorCode: undefined, syncErrorMessage: undefined }
          : item),
    }));
    await persistRouteCache(get().routes);
  },
  // O1 batch 35: removed addWaypoint, removeWaypoint, setActiveRoute,
  // incrementRunCount, muteMarker, unmuteMarker, hydrate — all had 0 external
  // callers. No UI for waypoints/muting; run count incremented server-side
  // via RunningScreen finish flow; hydrate was legacy alias for loadRoutes.
}));

setRouteCreateHandlers(
  async (localId, server, data, ownerId) => {
    if (currentUserId() !== ownerId) return;
    if (await isRouteTombstoned(ownerId, localId)) {
      const acknowledgedRemoteId = explicitServerRouteId(server.remoteId ?? server.id);
      await tombstoneRoute(ownerId, localId, acknowledgedRemoteId ?? undefined);
      await reconcileRemoteRouteDelete(ownerId, localId, acknowledgedRemoteId ?? undefined);
      return;
    }
    const latestEntry = await offlineRoutes.getEntry(localId);
    const latestData = latestEntry?.data ?? data;
    const supersededWhileSyncing = Boolean(latestEntry && JSON.stringify(latestData.route) !== JSON.stringify(data.route));
    if (currentUserId() !== ownerId) return;
    bumpRouteRevision(ownerId, {
      id: localId,
      clientRouteId: server.clientRouteId ?? localId,
      remoteId: server.remoteId ?? server.id,
    });
    useRouteStore.setState(state => {
      const existing = state.routes.find(route => routeMatchesIdentity(route, localId));
      const durableOrigin = server.originPersistence === 'durable';
      const base: Route = existing ?? {
        ...latestData.route,
        id: localId,
        clientRouteId: localId,
        createdAt: server.createdAt ?? Date.now(),
        updatedAt: server.updatedAt ?? Date.now(),
        runCount: server.runCount ?? 0,
        isActive: false,
      };
      const synced: Route = {
        ...base,
        ...(supersededWhileSyncing ? {} : server),
        // Keep the local identity stable for an already-open detail/editor.
        id: localId,
        clientRouteId: server.clientRouteId ?? existing?.clientRouteId ?? localId,
        remoteId: server.remoteId ?? server.id,
        syncState: supersededWhileSyncing ? 'pending' : 'synced',
        acceptedServerUpdatedAt: supersededWhileSyncing
          ? existing?.acceptedServerUpdatedAt
          : server.updatedAt,
        syncErrorCode: undefined,
        syncErrorMessage: undefined,
        isActive: existing?.isActive ?? false,
        creationOrigin: durableOrigin
          ? server.creationOrigin
          : (existing?.creationOrigin ?? (latestData.sourceActivity ? 'activity' : 'manual')),
        originActivityClientId: durableOrigin
          ? server.originActivityClientId
          : (existing?.originActivityClientId ?? latestData.sourceActivity?.clientActivityId),
        originActivityServerId: durableOrigin
          ? server.originActivityServerId
          : (existing?.originActivityServerId ?? latestData.sourceActivity?.serverActivityId),
        originActivityGapReconnected: durableOrigin
          ? server.originActivityGapReconnected
          : (existing?.originActivityGapReconnected ?? latestData.sourceActivity?.reconnectsActivityGap),
        originPersistence: durableOrigin ? 'durable' : 'legacy-local',
      };
      return {
        routes: existing
          ? state.routes.map(route => routeMatchesIdentity(route, localId) ? synced : route)
          : [synced, ...state.routes],
      };
    });
    await persistRouteCache(useRouteStore.getState().routes, ownerId);
  },
  (localId, error: any, ownerId) => {
    if (currentUserId() !== ownerId) return;
    const existing = useRouteStore.getState().routes.find(route => routeMatchesIdentity(route, localId));
    if (existing) bumpRouteRevision(ownerId, existing);
    useRouteStore.setState(state => ({
      routes: state.routes.map(route => route.id === localId
        ? {
            ...route,
            syncState: 'failed',
            syncErrorCode: typeof error?.code === 'string' ? error.code : undefined,
            syncErrorMessage: String(error?.message ?? error).slice(0, 120),
          }
        : route),
    }));
    void persistRouteCache(useRouteStore.getState().routes, ownerId);
  },
);
