/**
 * Session service — sync local sessions to backend.
 * Silent on network failure (offline-first design).
 *
 * v78 #7: every mutating call carries a client_op_id (UUID). On
 * failure, the call is enqueued in offlineQueue for later retry.
 * Server-side dedupes against op_id so multiple attempts don't
 * create duplicate sessions.
 */
import { authenticatedFetch } from './apiService';
import { enqueue, makeOp, uuidv4 } from './offlineQueue';

// GPS point shape used by both legacy POST and new incremental flows.
export interface TrackPointLike {
  lat: number;
  lng: number;
  alt?: number | null;
  /** Either ISO string (incremental flow) or epoch ms (legacy flow). */
  t?: number;
  timestamp?: string;
}

export interface SessionPayload {
  type: 'hiking' | 'running';
  start_time: string;   // ISO date string
  end_time: string;     // ISO date string
  distance_m: number;
  duration_s: number;
  // User-assigned activity name. Optional. When absent, the client will
  // synthesise a "Hike — DD/MM/YYYY" default at display time.
  name?: string | null;
  route_points?: TrackPointLike[];
  /** v77: full audit track (incl. stationary drift + low-accuracy fixes,
   *  exclusive of teleport-rejected). Sent with the legacy all-in-one
   *  POST path; modern incremental flow uses finalizeSession PATCH. */
  route_points_raw?: TrackPointLike[] | null;
  flags?: Array<{ lat: number; lng: number; note: string; timestamp: string }>;
}

export interface RemoteSession {
  id: number;
  user_id: number;
  type: 'hiking' | 'running';
  start_time: string;
  end_time: string;
  distance_m: number;
  duration_s: number;
  // Returned by the backend. May be null on legacy rows or when the
  // user never named the activity. Caller should fall back to a
  // type+date default in that case.
  name?: string | null;
  /** Only present on GET /api/sessions/:id (detail). list endpoint omits. */
  route_points?: TrackPointLike[];
  /** v77: full audit track. Detail endpoint returns it; list omits. */
  route_points_raw?: TrackPointLike[] | null;
  flags?: any[] | null;
  created_at: string;
}

/**
 * POST a completed session to the backend (legacy: all-in-one path).
 * Returns the remote session ID, or null on failure (caller continues with local only).
 */
export async function syncSession(payload: SessionPayload): Promise<number | null> {
  try {
    const res = await authenticatedFetch('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.session?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Begin an active session — creates an empty row server-side, returns
 * its id so the client can later append points + finalize.
 */
export async function startSession(
  type: 'hiking' | 'running',
  startTime: string,
): Promise<number | null> {
  try {
    const res = await authenticatedFetch('/api/sessions/start', {
      method: 'POST',
      body: JSON.stringify({ type, start_time: startTime }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.id === 'number' ? data.id : null;
  } catch {
    return null;
  }
}

/**
 * Append a batch of GPS points to an active session. Used by the
 * incremental backup interval during tracking. On failure, the batch
 * is enqueued for retry — so points aren't lost even if the request
 * fails. Idempotency via client_op_id (server-side dedupe).
 */
export async function appendPoints(
  remoteId: number,
  points: TrackPointLike[],
): Promise<boolean> {
  if (points.length === 0) return true;
  const opId = uuidv4();
  const path = `/api/sessions/${remoteId}/append-points`;
  const body = { points, client_op_id: opId };
  try {
    const res = await authenticatedFetch(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
    // 4xx (other than 401) are bad payloads — don't retry. 5xx + 401
    // and network errors are retryable.
    if (res.status >= 400 && res.status < 500 && res.status !== 401) return false;
    await enqueue(makeOp('session_append', path, 'PATCH', { points }, opId));
    return false;
  } catch {
    await enqueue(makeOp('session_append', path, 'PATCH', { points }, opId));
    return false;
  }
}

/**
 * Finalize a session at stop time: write end_time, distance_m,
 * duration_s, (optional) name, and (optional v77) full raw audit track.
 *
 * v78: failures enqueue with idempotency key — even if the user kills
 * the app right after Stop, the next launch's queue drain will finalize.
 */
export async function finalizeSession(
  remoteId: number,
  fields: {
    end_time?: string;
    distance_m?: number;
    duration_s?: number;
    name?: string | null;
    route_points_raw?: TrackPointLike[] | null;
  },
): Promise<boolean> {
  const opId = uuidv4();
  const path = `/api/sessions/${remoteId}`;
  try {
    const res = await authenticatedFetch(path, {
      method: 'PATCH',
      body: JSON.stringify({ ...fields, client_op_id: opId }),
    });
    if (res.ok) return true;
    if (res.status >= 400 && res.status < 500 && res.status !== 401) return false;
    await enqueue(makeOp('session_finalize', path, 'PATCH', fields, opId));
    return false;
  } catch {
    await enqueue(makeOp('session_finalize', path, 'PATCH', fields, opId));
    return false;
  }
}

/**
 * Fetch a single session WITH route_points + flags. Used by the
 * activity-detail view to render the polyline on the map.
 */
export async function fetchSessionDetail(remoteId: number): Promise<RemoteSession | null> {
  try {
    const res = await authenticatedFetch(`/api/sessions/${remoteId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

/**
 * DELETE the session from the backend.
 * Returns true on success, false on failure (caller continues regardless).
 */
export async function deleteRemoteSession(remoteId: number): Promise<boolean> {
  try {
    const res = await authenticatedFetch(`/api/sessions/${remoteId}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}
export async function fetchSessions(): Promise<RemoteSession[]> {
  try {
    const res = await authenticatedFetch('/api/sessions');
    if (!res.ok) return [];
    const data = await res.json();
    return data?.sessions ?? [];
  } catch {
    return [];
  }
}
