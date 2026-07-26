/**
 * useRouteStore — Route management store.
 *
 * Backend-first: all routes live in the DB via /api/routes.
 * No local AsyncStorage persistence — source of truth is the server.
 */
import { create } from 'zustand';
import {
  fetchRoutes,
  fetchRouteDetail,
  createRoute,
  updateRoute as apiUpdateRoute,
  deleteRoute as apiDeleteRoute,
} from '../services/routeService';
import { crashLogger } from '../services/crashLogger';

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
export type RouteSegmentType = 'road' | 'free' | 'mixed';
export interface RouteSegment {
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
  mutedMarkerIds: string[]; // markers along route that user chose not to broadcast
  activityMode?: 'hiking' | 'running'; // inherited from the originating session
  // PRD3 E-019 — hero photography. Optional (v1 ships without UI to upload).
  // Stored as URL so backend can host or CDN-deliver. heroPhotoUrl is the
  // single header image; photoCredit is required when heroPhotoUrl is set
  // (NZ photographers get name + Tourism NZ / DOC partnership credit).
  heroPhotoUrl?: string;
  photoCredit?: string;
  // Sprint 69 STORY-00535: visibility tier persisted to backend (added by
  // Sprint 67 migration 018 to routes.permission ENUM). Default 'personal'
  // for legacy routes; new routes saved via the v1 Route create UI default
  // to 'friend' per v4.U binding.
  permission?: 'personal' | 'friend';
}

export interface RouteStore {
  routes: Route[];
  // O1 batch 35: activeRouteId removed — written only in setActiveRoute (dead) + deleteRoute;
  // 0 external readers. routesLoadCompleted removed — only written internally; 0 external readers.
  /** Sprint 69 STORY-00538: subscribed-friend friend+public routes
   *  loaded from GET /api/circle/routes. Stored separately from `routes`
   *  (Mine) so Trails Friends sub-tab can render them without touching
   *  the viewer's own route list. */
  circleRoutes: Route[];
  loadingCircleRoutes: boolean;

  // Load from backend
  loadRoutes: () => Promise<void>;
  /** Sprint 69 STORY-00538: load friend routes. */
  loadCircleRoutes: () => Promise<void>;
  // v123: hydrate the FULL route (including points) for a single id.
  // Used by RouteEditor when opening an existing route — the list
  // endpoint omits points for perf, so the in-store route may have
  // points=[]; this fills it in.
  loadRouteDetail: (id: string) => Promise<void>;

  // CRUD
  addRoute: (route: Omit<Route, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'isActive' | 'mutedMarkerIds'>) => Promise<string | null>;
  updateRoute: (id: string, updates: Partial<Route>) => Promise<void>;
  deleteRoute: (id: string) => Promise<void>;

  // O1 batch 35: removed addWaypoint, removeWaypoint (0 external callers — waypoint UI not built),
  // setActiveRoute, incrementRunCount, muteMarker, unmuteMarker, hydrate (0 external callers).
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useRouteStore = create<RouteStore>((set, get) => ({
  routes: [],
  // Sprint 69 STORY-00538: initial empty until first loadCircleRoutes().
  circleRoutes: [],
  loadingCircleRoutes: false,

  loadRoutes: async () => {
    try {
      const routes = await fetchRoutes();
      set({ routes });
    } catch (err) {
      throw err;
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
        mutedMarkerIds: [],
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
    const detail = await fetchRouteDetail(id);
    if (!detail) return;
    set((s) => ({
      routes: s.routes.map(r => r.id === id ? { ...r, ...detail } : r),
    }));
  },

  addRoute: async (routeData) => {
    const created = await createRoute({
      name: routeData.name,
      description: routeData.description,
      points: routeData.points,
      waypoints: routeData.waypoints,
      distance_m: routeData.distanceM,
      elevation_gain_m: routeData.elevationGainM,
      // Sprint 69 STORY-00535: thread permission to backend POST /api/routes.
      // Caller (RouteEditorScreen) defaults to 'friend' per v4.U binding.
      permission: routeData.permission,
    });
    if (!created) return null;
    const route: Route = {
      ...routeData,
      ...created,
      isActive: false,
      mutedMarkerIds: [],
    };
    set((s) => ({ routes: [route, ...s.routes] }));
    return created.id;
  },

  updateRoute: async (id, updates) => {
    // v10-audit (BUG-EH-1): snapshot pre-update state so we can roll
    // back optimistic mutation if backend rejects. Prior code left the
    // store with unsynced data on failure.
    const prevRoute = get().routes.find(r => r.id === id);
    // Optimistic local update
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r
      ),
    }));
    // Sync to backend
    const route = get().routes.find(r => r.id === id);
    if (route) {
      try {
        await apiUpdateRoute(id, {
          name: route.name,
          description: route.description,
          points: route.points,
          waypoints: route.waypoints,
          distance_m: route.distanceM,
          elevation_gain_m: route.elevationGainM,
          ...Object.fromEntries(
            Object.entries(updates).map(([k, v]) => {
              if (k === 'distanceM') return ['distance_m', v];
              if (k === 'elevationGainM') return ['elevation_gain_m', v];
              return [k, v];
            })
          ),
        });
      } catch (err) {
        // v10-audit (BUG-EH-1): roll back optimistic update.
        if (prevRoute) {
          set((s) => ({
            routes: s.routes.map(r => r.id === id ? prevRoute : r),
          }));
        }
        throw err;
      }
    }
  },

  deleteRoute: async (id) => {
    crashLogger.breadcrumb(`route:delete:start id=${id}`);
    // O1 (2026-07-26): 删除 PENDING_PREFIX (@cairn:pending_route_cleanup:v2:)
    // write-only 标记。用户明确说 "删除是毫秒级操作,没理由要 note 也不
    // 需要考虑崩溃"。原设计: setItem 前 + removeItem 后 走 pending 标记,
    // 便于 boot drain 补齐失败的 cascade。但 boot drain 从未实现,标记只
    // 写不读,纯废动作。
    const before = get().routes.find(r => r.id === id);
    let backendOk = false;
    try {
      await apiDeleteRoute(id);
      backendOk = true;
      crashLogger.breadcrumb(`route:delete:remote-ok id=${id}`);
    } catch (err) {
      crashLogger.breadcrumb(`route:delete:remote-error ${String(err).slice(0, 80)}`);
    }
    if (!backendOk) {
      return;
    }
    set((s) => ({
      routes: s.routes.filter(r => r.id !== id),
    }));
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
    void before;
    return;
  },
  // O1 batch 35: removed addWaypoint, removeWaypoint, setActiveRoute,
  // incrementRunCount, muteMarker, unmuteMarker, hydrate — all had 0 external
  // callers. No UI for waypoints/muting; run count incremented server-side
  // via RunningScreen finish flow; hydrate was legacy alias for loadRoutes.
}));
