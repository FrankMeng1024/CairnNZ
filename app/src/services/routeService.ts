/**
 * Route service — CRUD routes on backend.
 * Read failures are surfaced to the store so it can retain the local cache.
 */
import { authenticatedFetch } from './apiService';
import type { Route, RoutePoint, Waypoint } from '../store/useRouteStore';

export type RouteDeleteOutcome = 'deleted' | 'already-absent' | 'unsupported';

const ROUTE_MUTATION_TIMEOUT_MS = 15_000;

async function mutationRequest(
  path: string,
  options: RequestInit,
  timeoutMs = ROUTE_MUTATION_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      const error: any = new Error('Route request timed out; the server outcome is not yet known.');
      error.code = 'ROUTE_REQUEST_TIMEOUT';
      error.outcomeUnknown = true;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      authenticatedFetch(path, { ...options, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function responseBody(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

function routeDeleteError(status: number, body: any, outcomeUnknown = false): Error {
  const error: any = new Error(body?.error ?? `Route delete failed (${status})`);
  error.status = status;
  error.code = body?.code ?? (outcomeUnknown ? 'ROUTE_DELETE_OUTCOME_UNKNOWN' : `HTTP_${status}`);
  error.outcomeUnknown = outcomeUnknown;
  return error;
}

interface RoutePayload {
  client_route_id?: string;
  name: string;
  description?: string;
  points: RoutePoint[];
  waypoints?: Waypoint[];
  distance_m: number;
  elevation_gain_m: number;
  // Sprint 69 STORY-00535: visibility tier ('personal' | 'friend'). Backend
  // rejects 'public' from clients via Sprint 67 H1.
  permission?: 'personal' | 'friend';
  source_activity_client_id?: string;
  source_session_id?: number;
  origin_gap_reconnected?: boolean;
}

interface RemoteRoute {
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
  client_route_id?: string | null;
  creation_origin?: 'activity' | 'manual' | null;
  source_activity_client_id?: string | null;
  source_session_id?: number | null;
  origin_geometry_hash?: string | null;
  created_geometry_hash?: string | null;
  geometry_edited_since_creation?: number | boolean;
  origin_gap_reconnected?: number | boolean;
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
    clientRouteId: r.client_route_id ?? undefined,
    remoteId: String(r.id),
    creationOrigin: r.creation_origin ?? 'legacy_unknown',
    originActivityClientId: r.source_activity_client_id ?? undefined,
    originActivityServerId: r.source_session_id ?? undefined,
    originGeometryHash: r.origin_geometry_hash ?? undefined,
    createdGeometryHash: r.created_geometry_hash ?? undefined,
    geometryEditedSinceCreation: Boolean(r.geometry_edited_since_creation),
    originActivityGapReconnected: Boolean(r.origin_gap_reconnected),
    originPersistence: r.creation_origin ? 'durable' : 'unknown',
  };
}

export async function fetchRoutes(): Promise<Route[]> {
  const res = await authenticatedFetch('/api/routes');
  if (!res.ok) throw new Error(`Route fetch failed (${res.status})`);
  const data = await res.json();
  return (data?.routes ?? []).map(remoteToLocal);
}

// v123: GET /api/routes/:id returns the full route including points + waypoints
// (the list endpoint omits these for performance). Use this when opening
// RouteEditor / route detail.
export async function fetchRouteDetail(id: string): Promise<Route | null> {
  const res = await authenticatedFetch(`/api/routes/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Route fetch failed (${res.status})`);
  const data = await res.json();
  return data?.route ? remoteToLocal(data.route) : null;
}

export async function createRoute(
  payload: RoutePayload,
  idempotencyKey?: string,
): Promise<Route | null> {
  const request = (body: RoutePayload, key?: string) => authenticatedFetch('/api/routes', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: key ? { 'X-Idempotency-Key': key } : undefined,
    });
  let res = await request(payload);
  let body: any = null;
  if (!res.ok) {
    try { body = await res.json(); } catch { /* non-JSON response */ }
    const rejectedFields = new Set((body?.details ?? []).map((detail: any) => detail?.field));
    const oldBackend = res.status === 400
      && (rejectedFields.has('client_route_id') || rejectedFields.has('origin_gap_reconnected'));
    if (oldBackend) {
      const {
        client_route_id: _clientRouteId,
        origin_gap_reconnected: _gap,
        ...legacyPayload
      } = payload;
      // Compatibility only. The legacy backend can still create the Route but
      // cannot durably round-trip the new provenance fields. Its existing
      // idempotency key protects retry duplication for an unchanged payload.
      res = await request(legacyPayload, idempotencyKey ?? payload.client_route_id);
      body = null;
    }
  }
  if (!res.ok) {
    try { body = body ?? await res.json(); } catch { /* non-JSON response */ }
    const error = new Error(body?.error ?? `Route create failed (${res.status})`);
    (error as any).code = body?.code ?? `HTTP_${res.status}`;
    (error as any).status = res.status;
    throw error;
  }
  const data = await res.json();
  return data?.route ? remoteToLocal(data.route) : null;
}

export async function updateRoute(
  id: string,
  payload: Partial<RoutePayload>
): Promise<Route | null> {
  const res = await mutationRequest(`/api/routes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const error: any = new Error(`Route update failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return data?.route ? remoteToLocal(data.route) : null;
}

export async function deleteRoute(id: string): Promise<RouteDeleteOutcome> {
  const res = await mutationRequest(`/api/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const body = await responseBody(res);
  if (res.ok) return 'deleted';
  if (res.status === 404 && body?.code === 'ROUTE_NOT_FOUND'
    && String(body?.route_id) === String(id)) {
    return 'already-absent';
  }
  // A generic proxy/router 404 is not proof that the owned Route is gone.
  throw routeDeleteError(res.status, body, res.status === 404);
}

export async function deleteRouteByClientId(clientRouteId: string): Promise<RouteDeleteOutcome> {
  const res = await mutationRequest(`/api/routes/client/${encodeURIComponent(clientRouteId)}`, {
    method: 'DELETE',
  });
  const body = await responseBody(res);
  if (res.ok) {
    if (body?.ok !== true || String(body?.client_route_id) !== clientRouteId
      || typeof body?.deleted !== 'boolean') {
      throw routeDeleteError(res.status, body, true);
    }
    return body.deleted ? 'deleted' : 'already-absent';
  }
  if (res.status === 404) {
    if (body?.code === 'ROUTE_CLIENT_NOT_FOUND'
      && String(body?.client_route_id) === clientRouteId) {
      return 'already-absent';
    }
    // Old backends and generic routers commonly answer an unknown endpoint
    // with an unstructured 404. The caller may fall back only when it already
    // owns a real server Route id; this service never guesses one.
    return 'unsupported';
  }
  throw routeDeleteError(res.status, body);
}

// O1 batch 36: incrementRouteRunCount removed — last caller (useRouteStore.incrementRunCount)
// was removed in batch 35; 0 external callers remain.
