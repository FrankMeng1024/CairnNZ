/**
 * useRouteStore — Route management store.
 *
 * Backend-first: all routes live in the DB via /api/routes.
 * No local AsyncStorage persistence — source of truth is the server.
 */
import { create } from 'zustand';
import { generateId } from '../utils/geo';
import {
  fetchRoutes,
  fetchRouteDetail,
  createRoute,
  updateRoute as apiUpdateRoute,
  deleteRoute as apiDeleteRoute,
  incrementRouteRunCount,
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
  // PRD3 E-019 — hero photography. Optional (v1 ships without UI to upload).
  // Stored as URL so backend can host or CDN-deliver. heroPhotoUrl is the
  // single header image; photoCredit is required when heroPhotoUrl is set
  // (NZ photographers get name + Tourism NZ / DOC partnership credit).
  heroPhotoUrl?: string;
  photoCredit?: string;
}

export interface RouteStore {
  routes: Route[];
  activeRouteId: string | null;

  // Load from backend
  loadRoutes: () => Promise<void>;
  // v123: hydrate the FULL route (including points) for a single id.
  // Used by RouteEditor when opening an existing route — the list
  // endpoint omits points for perf, so the in-store route may have
  // points=[]; this fills it in.
  loadRouteDetail: (id: string) => Promise<void>;

  // CRUD
  addRoute: (route: Omit<Route, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'isActive' | 'mutedMarkerIds'>) => Promise<string | null>;
  updateRoute: (id: string, updates: Partial<Route>) => Promise<void>;
  deleteRoute: (id: string) => Promise<void>;

  // Waypoints (local-only until next save)
  addWaypoint: (routeId: string, waypoint: Omit<Waypoint, 'id'>) => void;
  removeWaypoint: (routeId: string, waypointId: string) => void;

  // Navigation
  setActiveRoute: (id: string | null) => void;
  incrementRunCount: (id: string) => Promise<void>;

  // Marker muting (local UI state — not persisted to backend)
  muteMarker: (routeId: string, markerId: string) => void;
  unmuteMarker: (routeId: string, markerId: string) => void;

  // Legacy — kept for compatibility, calls loadRoutes
  hydrate: () => Promise<void>;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useRouteStore = create<RouteStore>((set, get) => ({
  routes: [],
  activeRouteId: null,

  loadRoutes: async () => {
    const routes = await fetchRoutes();
    set({ routes });
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
    // Optimistic local update
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r
      ),
    }));
    // Sync to backend
    const route = get().routes.find(r => r.id === id);
    if (route) {
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
    }
  },

  deleteRoute: async (id) => {
    crashLogger.breadcrumb(`route:delete:start id=${id}`);
    set((s) => ({
      routes: s.routes.filter(r => r.id !== id),
      activeRouteId: s.activeRouteId === id ? null : s.activeRouteId,
    }));
    try {
      await apiDeleteRoute(id);
      crashLogger.breadcrumb(`route:delete:remote-ok id=${id}`);
    } catch (err) {
      crashLogger.breadcrumb(`route:delete:remote-error ${String(err).slice(0, 80)}`);
    }
  },

  addWaypoint: (routeId, waypointData) => {
    const waypoint: Waypoint = { ...waypointData, id: generateId() };
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === routeId
          ? { ...r, waypoints: [...r.waypoints, waypoint], updatedAt: Date.now() }
          : r
      ),
    }));
  },

  removeWaypoint: (routeId, waypointId) => {
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === routeId
          ? { ...r, waypoints: r.waypoints.filter(w => w.id !== waypointId), updatedAt: Date.now() }
          : r
      ),
    }));
  },

  setActiveRoute: (id) => {
    set((s) => ({
      routes: s.routes.map(r => ({ ...r, isActive: r.id === id })),
      activeRouteId: id,
    }));
  },

  incrementRunCount: async (id) => {
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === id
          ? { ...r, runCount: r.runCount + 1, lastRunAt: Date.now(), updatedAt: Date.now() }
          : r
      ),
    }));
    await incrementRouteRunCount(id);
  },

  muteMarker: (routeId, markerId) => {
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === routeId && !r.mutedMarkerIds.includes(markerId)
          ? { ...r, mutedMarkerIds: [...r.mutedMarkerIds, markerId], updatedAt: Date.now() }
          : r
      ),
    }));
  },

  unmuteMarker: (routeId, markerId) => {
    set((s) => ({
      routes: s.routes.map(r =>
        r.id === routeId
          ? { ...r, mutedMarkerIds: r.mutedMarkerIds.filter(id => id !== markerId), updatedAt: Date.now() }
          : r
      ),
    }));
  },

  hydrate: async () => {
    await get().loadRoutes();
  },
}));
