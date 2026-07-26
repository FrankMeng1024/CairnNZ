/**
 * Route service — CRUD routes on backend.
 * Silent on network failure (offline-first design).
 */
import { authenticatedFetch } from './apiService';
import type { Route, RoutePoint, Waypoint } from '../store/useRouteStore';

export interface RoutePayload {
  name: string;
  description?: string;
  points: RoutePoint[];
  waypoints?: Waypoint[];
  distance_m: number;
  elevation_gain_m: number;
  // Sprint 69 STORY-00535: visibility tier ('personal' | 'friend'). Backend
  // rejects 'public' from clients via Sprint 67 H1.
  permission?: 'personal' | 'friend';
}

export interface RemoteRoute {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  points?: RoutePoint[];
  waypoints?: Waypoint[];
  distance_m: number;
  elevation_gain_m: number;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  /** Sprint 67 migration 018 added the column; Sprint 67 STORY-00528 wires
   *  Route.findByUser / findByIdAndUser to return it. */
  permission?: 'personal' | 'friend' | 'public';
}

function remoteToLocal(r: RemoteRoute): Route {
  return {
    id: String(r.id),
    name: r.name,
    description: r.description ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    points: r.points ?? [],
    waypoints: r.waypoints ?? [],
    distanceM: r.distance_m,
    elevationGainM: r.elevation_gain_m,
    runCount: r.run_count,
    lastRunAt: r.last_run_at ? new Date(r.last_run_at).getTime() : undefined,
    isActive: false,
    // Sprint 69 STORY-00535: collapse server 'public' → undefined for local
    // type narrowing (clients should never see Public routes via /api/routes
    // because that endpoint scopes to the viewer's own; /api/circle/routes
    // is the only path Public routes traverse — see Story-538).
    permission: r.permission === 'public' ? undefined : r.permission,
  };
}

export async function fetchRoutes(): Promise<Route[]> {
  try {
    const res = await authenticatedFetch('/api/routes');
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.routes ?? []).map(remoteToLocal);
  } catch {
    return [];
  }
}

// v123: GET /api/routes/:id returns the full route including points + waypoints
// (the list endpoint omits these for performance). Use this when opening
// RouteEditor / route detail.
export async function fetchRouteDetail(id: string): Promise<Route | null> {
  try {
    const res = await authenticatedFetch(`/api/routes/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.route ? remoteToLocal(data.route) : null;
  } catch {
    return null;
  }
}

export async function createRoute(payload: RoutePayload): Promise<Route | null> {
  try {
    const res = await authenticatedFetch('/api/routes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.route ? remoteToLocal(data.route) : null;
  } catch {
    return null;
  }
}

export async function updateRoute(
  id: string,
  payload: Partial<RoutePayload>
): Promise<Route | null> {
  try {
    const res = await authenticatedFetch(`/api/routes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.route ? remoteToLocal(data.route) : null;
  } catch {
    return null;
  }
}

export async function deleteRoute(id: string): Promise<boolean> {
  try {
    const res = await authenticatedFetch(`/api/routes/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// O1 batch 36: incrementRouteRunCount removed — last caller (useRouteStore.incrementRunCount)
// was removed in batch 35; 0 external callers remain.
