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
import { enqueue, makeOp, retireActivityAppendOps, uuidv4 } from './offlineQueue';

/**
 * A native fetch can remain pending indefinitely after a radio transition.
 * Every Activity mutation therefore owns a real wall-clock deadline. Aborting
 * helps the native transport release resources; the rejecting race is the
 * liveness guarantee even on a fetch implementation that ignores AbortSignal.
 */
export const ACTIVITY_MUTATION_TIMEOUT_MS = 8_000;

async function authenticatedFetchWithDeadline(
  path: string,
  options: RequestInit & { expectedUserId?: string },
  timeoutMs = ACTIVITY_MUTATION_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error: any = new Error('activity_transport_timeout');
      error.code = 'ACTIVITY_TRANSPORT_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      authenticatedFetch(path, { ...options, signal: controller.signal }),
      deadline,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// GPS point shape used by both legacy POST and new incremental flows.
interface TrackPointLike {
  lat: number;
  lng: number;
  alt?: number | null;
  /** Either ISO string (incremental flow) or epoch ms (legacy flow). */
  t?: number;
  timestamp?: string;
  acc?: number | null;
  v_acc?: number | null;
  speed_mps?: number | null;
  course_deg?: number | null;
  raw_ordinal?: number;
  segment_id?: string;
  segment_start_reason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
}

function integerEpoch(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : value;
}

/** Normalize both newly captured and already-persisted pending payloads. */
function normalizeUnavailableSensorValue(value: number | null | undefined): number | null | undefined {
  return value != null && (!Number.isFinite(value) || value < 0) ? null : value;
}

/**
 * Core Location uses negative values (normally -1) for unavailable accuracy,
 * speed and course. Those sentinels are provider metadata, not measurements;
 * convert them to JSON null at every HTTP boundary, including replay of a
 * pending payload captured by an older client.
 */
export function normalizeActivityPointTimestamps<T extends {
  t?: number;
  acc?: number | null;
  v_acc?: number | null;
  speed_mps?: number | null;
  course_deg?: number | null;
}>(points: T[]): T[] {
  return points.map(point => ({
    ...point,
    ...(point.t == null ? {} : { t: integerEpoch(point.t) }),
    ...(!Object.prototype.hasOwnProperty.call(point, 'acc')
      ? {} : { acc: normalizeUnavailableSensorValue(point.acc) }),
    ...(!Object.prototype.hasOwnProperty.call(point, 'v_acc')
      ? {} : { v_acc: normalizeUnavailableSensorValue(point.v_acc) }),
    ...(!Object.prototype.hasOwnProperty.call(point, 'speed_mps')
      ? {} : { speed_mps: normalizeUnavailableSensorValue(point.speed_mps) }),
    ...(!Object.prototype.hasOwnProperty.call(point, 'course_deg')
      ? {} : { course_deg: normalizeUnavailableSensorValue(point.course_deg) }),
  } as T));
}

interface SessionPayload {
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
  client_activity_id?: string | null;
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

// O1: syncSession() removed — legacy all-in-one POST /api/sessions.
// Backend endpoint removed (returns 404). Modern flow uses startSession()
// → appendPoints() → saveHikeAtomic() (v412 atomic transaction).

/**
 * Begin an active session — creates an empty row server-side, returns
 * its id so the client can later append points + finalize.
 */
export async function startSession(
  type: 'hiking' | 'running',
  startTime: string,
  clientActivityId?: string,
  expectedOwnerUserId?: string,
): Promise<number | null> {
  const resolution = await startSessionResolved(type, startTime, clientActivityId, expectedOwnerUserId);
  return resolution.kind === 'started' ? resolution.serverActivityId : null;
}

export function parseRemoteSessionList(value: unknown): RemoteSession[] {
  const sessions = (value as any)?.sessions;
  if (!Array.isArray(sessions)) throw new Error('fetchSessions malformed response');
  for (const session of sessions) {
    if (!session
      || !Number.isInteger(session.id)
      || (session.type !== 'hiking' && session.type !== 'running')
      || typeof session.start_time !== 'string'
      || typeof session.end_time !== 'string'
      || !Number.isFinite(Number(session.distance_m))
      || !Number.isFinite(Number(session.duration_s))
      || (session.client_activity_id != null && typeof session.client_activity_id !== 'string')) {
      throw new Error('fetchSessions malformed session');
    }
  }
  return sessions.map((session: any) => ({
    ...session,
    distance_m: Number(session.distance_m),
    duration_s: Number(session.duration_s),
  })) as RemoteSession[];
}

export interface RemoteUnfinishedActivity {
  id: number;
  clientActivityId: string;
  type: 'hiking' | 'running';
  startedAt: string;
  pointCount: number;
  rawPointCount: number;
}

export type StartSessionResolution =
  | { kind: 'started'; serverActivityId: number; clientActivityId: string | null }
  | {
      kind: 'conflict';
      code: string;
      existing: RemoteUnfinishedActivity | null;
      existingActivities: RemoteUnfinishedActivity[];
    }
  | { kind: 'unavailable'; status: number; code: string | null; retryable: boolean };

function parseRemoteUnfinishedActivity(value: any): RemoteUnfinishedActivity | null {
  if (!value
    || !Number.isInteger(value.id)
    || typeof value.client_activity_id !== 'string'
    || (value.type !== 'hiking' && value.type !== 'running')
    || typeof value.start_time !== 'string') return null;
  return {
    id: value.id,
    clientActivityId: value.client_activity_id,
    type: value.type,
    startedAt: value.start_time,
    pointCount: Number(value.point_count ?? 0),
    rawPointCount: Number(value.raw_point_count ?? 0),
  };
}

/**
 * Start with an explicit singleton result. A network timeout is not a failed
 * local Start: the immutable business ID safely reconciles later. A 409 is
 * different — the server proved that another Activity owns the account slot.
 */
export async function startSessionResolved(
  type: 'hiking' | 'running',
  startTime: string,
  clientActivityId?: string,
  expectedOwnerUserId?: string,
  timeoutMs = 5_000,
): Promise<StartSessionResolution> {
  try {
    const res = await authenticatedFetchWithDeadline('/api/sessions/start', {
      method: 'POST',
      expectedUserId: expectedOwnerUserId,
      headers: clientActivityId ? { 'X-Idempotency-Key': clientActivityId } : undefined,
      body: JSON.stringify({
        type,
        start_time: startTime,
        ...(clientActivityId ? { client_activity_id: clientActivityId, client_op_id: clientActivityId } : {}),
      }),
    }, timeoutMs);
    if (res.status === 409) {
      let body: any = null;
      try { body = await res.json(); } catch { /* malformed conflict */ }
      const existing = parseRemoteUnfinishedActivity(body?.existing_activity);
      const existingActivities = Array.isArray(body?.existing_activities)
        ? body.existing_activities
          .map(parseRemoteUnfinishedActivity)
          .filter((item: RemoteUnfinishedActivity | null): item is RemoteUnfinishedActivity => item !== null)
        : [];
      return {
        kind: 'conflict',
        code: typeof body?.code === 'string' ? body.code : 'UNFINISHED_ACTIVITY_EXISTS',
        existing,
        existingActivities,
      };
    }
    if (!res.ok) {
      let body: any = null;
      try { body = await res.json(); } catch { /* preserve HTTP classification */ }
      return {
        kind: 'unavailable',
        status: res.status,
        code: typeof body?.code === 'string' ? body.code : null,
        retryable: res.status === 408 || res.status === 425 || res.status === 429 || res.status >= 500,
      };
    }
    const data = await res.json();
    if (typeof data?.id !== 'number') {
      return { kind: 'unavailable', status: res.status, code: 'MALFORMED_START_RESPONSE', retryable: false };
    }
    if (clientActivityId && data?.client_activity_id !== clientActivityId) {
      return { kind: 'unavailable', status: res.status, code: 'CLIENT_ACTIVITY_ID_MISMATCH', retryable: false };
    }
    return {
      kind: 'started',
      serverActivityId: data.id,
      clientActivityId: data?.client_activity_id ?? null,
    };
  } catch {
    return { kind: 'unavailable', status: 0, code: 'TRANSPORT_UNAVAILABLE', retryable: true };
  }
}

/** Cancel a stale/late remote shell using the immutable business identity. */
export async function deleteRemoteSessionByClientId(
  clientActivityId: string,
  expectedUserId?: string,
): Promise<boolean> {
  try {
    const res = await authenticatedFetchWithDeadline(
      `/api/sessions/client/${encodeURIComponent(clientActivityId)}`,
      { method: 'DELETE', ...(expectedUserId ? { expectedUserId } : {}) },
    );
    return res.ok || res.status === 404;
  } catch {
    return false;
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
  authority: { userId: string; clientActivityId: string },
): Promise<boolean> {
  if (points.length === 0) return true;
  const normalizedPoints = normalizeActivityPointTimestamps(points);
  const path = `/api/sessions/${remoteId}/append-points`;
  // The server contract is max 500 points. A long foreground interval or a
  // recovered journal can legitimately exceed that; every bounded chunk gets
  // its own stable operation identity and is sent in chronological order.
  const chunks: TrackPointLike[][] = [];
  for (let offset = 0; offset < normalizedPoints.length; offset += 500) {
    chunks.push(normalizedPoints.slice(offset, offset + 500));
  }
  let allAcknowledged = true;
  for (const chunk of chunks) {
    const opId = uuidv4();
    const body = { points: chunk, client_op_id: opId };
    try {
      const res = await authenticatedFetchWithDeadline(path, {
        method: 'PATCH',
        body: JSON.stringify(body),
        expectedUserId: authority.userId,
      });
      if (res.ok) continue;
      allAcknowledged = false;
      // Preserve the exact chunk for retry/diagnosis. The durable queue owns
      // classification of the HTTP outcome; a 400 must never make points vanish.
      await enqueue(makeOp('session_append', path, 'PATCH', { points: chunk }, opId, authority));
    } catch {
      allAcknowledged = false;
      await enqueue(makeOp('session_append', path, 'PATCH', { points: chunk }, opId, authority));
    }
  }
  return allAcknowledged;
}

/**
 * Finalize a session at stop time: write end_time, distance_m,
 * duration_s, (optional) name, and (optional v77) full raw audit track.
 *
 * v78: failures enqueue with idempotency key — even if the user kills
 * the app right after Stop, the next launch's queue drain will finalize.
 *
 * v6.4: now also accepts `route_points` to upload the post-snap clean
 * polyline. The pipeline at stopTracking computes Mapbox-snap on the
 * raw track and writes `route_points` (snap) + `route_points_raw` (raw)
 * in a single PATCH. Falls back to raw-as-route_points if snap fails.
 */
/**
 * finalizeSession — REMOVED in O1 (2026-07-26).
 * v412 saveHikeAtomic (POST /api/sessions/:id/save) 完全取代了旧
 * PATCH /api/sessions/:id 路径。0 call site 保留。若 offlineQueue 里
 * 还有历史 'session_finalize' op,drain 依然会 PATCH 到老 endpoint
 * (若 backend 还保留了 PATCH /:id 就仍能消化;若 backend 也移除该
 * endpoint,drain 会 4xx 后掉 op)。
 */

/**
 * Fetch a single session WITH route_points + flags. Used by the
 * activity-detail view to render the polyline on the map.
 */
export async function fetchSessionDetail(remoteId: number): Promise<RemoteSession | null> {
  try {
    const res = await authenticatedFetchWithDeadline(`/api/sessions/${remoteId}`, {});
    if (!res.ok) return null;
    const data = await res.json();
    return data?.session ?? null;
  } catch {
    return null;
  }
}

export type RenameRemoteSessionResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'not-found' | 'rejected' | 'unavailable' };

/** Rename a completed server Activity without optimistic false success. */
export async function renameRemoteSession(
  remoteId: number,
  name: string,
): Promise<RenameRemoteSessionResult> {
  try {
    const response = await authenticatedFetchWithDeadline(`/api/sessions/${remoteId}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    if (response.status === 404 || response.status === 409) return { ok: false, reason: 'not-found' };
    if (!response.ok) return { ok: false, reason: 'rejected' };
    const body = await response.json();
    const remoteName = typeof body?.session?.name === 'string' ? body.session.name : name;
    return { ok: true, name: remoteName };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * v412: 原子 save-hike 端点封装。
 *
 * 一次请求完成: sessions 表 UPDATE (route_points + raw + finalized_at + 元数据)
 * + memory_points 批量 INSERT, 服务器事务保证要么全成一起要么全不发生。
 *
 * 幂等契约:
 *   idempotencyKey 由 client 生成, retry 用同一个。服务器 middleware cache 或
 *   finalized_at 兜底保证同 key 重试返 200 + idempotent_replay: true。
 *
 * 返回:
 *   { ok: true, session_id, finalized_at, memory, idempotent_replay? }
 *   throw on 网络错误 / 5xx / 4xx (让 caller 走 pendingSyncStore)
 */
interface SaveHikeAtomicPayload {
  end_time: string;
  distance_m: number;
  duration_s: number;
  name: string;
  route_points: Array<{
    lat: number; lng: number; t: number; alt?: number | null; acc?: number | null;
    v_acc?: number | null; speed_mps?: number | null; course_deg?: number | null; raw_ordinal?: number;
    segment_id?: string; segment_start_reason?: string;
  }>;
  route_points_raw: Array<{
    lat: number; lng: number; t: number; alt?: number | null; acc?: number | null;
    v_acc?: number | null; speed_mps?: number | null; course_deg?: number | null; raw_ordinal?: number;
    segment_id?: string; segment_start_reason?: string;
  }>;
  route_points_canonical: Array<{
    lat: number; lng: number; t: number; alt?: number | null; acc?: number | null;
    v_acc?: number | null; speed_mps?: number | null; course_deg?: number | null; raw_ordinal?: number;
    segment_id?: string; segment_start_reason?: string;
  }>;
  memory_points: Array<{
    lat: number; lng: number; ts: number; cid?: string;
    evidence_source?: 'activity_real' | 'passive_real' | 'historical_unknown';
    source_activity_client_id?: string;
    source_segment_id?: string;
    horizontal_accuracy_m?: number;
    continuity_state?: 'accepted' | 'gap' | 'unknown';
  }>;
}

interface SaveHikeAtomicResult {
  ok: true;
  session_id: number;
  client_activity_id: string;
  finalized_at: string;
  memory: { accepted: number; rejected: number };
  idempotent_replay?: boolean;
}

export function normalizeActivitySavePayloadTimestamps(
  payload: SaveHikeAtomicPayload,
): SaveHikeAtomicPayload {
  return {
    ...payload,
    route_points: normalizeActivityPointTimestamps(payload.route_points),
    route_points_raw: normalizeActivityPointTimestamps(payload.route_points_raw),
    route_points_canonical: normalizeActivityPointTimestamps(payload.route_points_canonical),
    memory_points: payload.memory_points.map(point => ({
      ...point,
      ts: integerEpoch(point.ts),
    })),
  };
}

async function performSaveHikeAtomic(
  remoteId: number,
  payload: SaveHikeAtomicPayload,
  idempotencyKey: string,
  clientActivityId: string,
  expectedOwnerUserId?: string,
): Promise<SaveHikeAtomicResult> {
  // Pending payloads created by O39 can contain Core Location's fractional
  // milliseconds. Normalize again on every replay so they recover without a
  // backend relaxation or migration.
  payload = normalizeActivitySavePayloadTimestamps(payload);
  const path = `/api/sessions/${remoteId}/save`;
  // O18 SAF-07 (2026-07-29): user reported "network request failed" on
  // save + direct upload. Log attempt to aliyun BEFORE call so we can
  // correlate v412 failure to request attempt (previously only o7.stop
  // event was uploaded, not what happened inside saveHikeAtomic itself).
  const routePtsN = payload.route_points?.length ?? 0;
  const rawPtsN = payload.route_points_raw?.length ?? 0;
  const memPtsN = payload.memory_points?.length ?? 0;
  const payloadBytes = JSON.stringify(payload).length;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { log } = require('./appLog');
    log('v412.save.attempt', {
      remoteId, idempotencyKey: idempotencyKey.slice(0, 8),
      routePtsN, rawPtsN, memPtsN, payloadBytes,
      nameLen: (payload.name || '').length,
      distance_m: payload.distance_m,
    });
  } catch { /* silent */ }
  // O14 Bug 8 fix: pre-fix, one transient network hiccup (iOS timer paused
  // while backgrounded → fetch timeout, or a 5xx from proxy) marked the
  // whole hike as "pending sync" and the banner stayed on until the next
  // AppState background→active toggle. Add one immediate retry inside
  // saveHikeAtomic so we don't fall into pending on a single flake.
  // Idempotency key stays the same → server treats retry as replay if
  // it did succeed on attempt 1 but the response never came back.
  const doFetch = () => authenticatedFetchWithDeadline(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ ...payload, client_activity_id: clientActivityId }),
    expectedUserId: expectedOwnerUserId,
  });
  let res: Response;
  let lastNetErrMsg = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await doFetch();
      if (res.ok || (res.status >= 400 && res.status < 500
        && res.status !== 408 && res.status !== 425 && res.status !== 429)) {
        // Success or a 4xx that a retry can't fix — break out.
        break;
      }
      // 5xx — retry once if this was attempt 0.
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      // Fall through to !res.ok handling below on attempt 1.
      break;
    } catch (netErr) {
      lastNetErrMsg = String((netErr as any)?.message || netErr).slice(0, 150);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      // Retry exhausted — surface network error. O18 SAF-07: log to aliyun.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { log } = require('./appLog');
        log('v412.save.net_error', {
          remoteId, idempotencyKey: idempotencyKey.slice(0, 8),
          errMsg: lastNetErrMsg, payloadBytes,
        });
      } catch { /* silent */ }
      const err: any = new Error(`saveHikeAtomic network error: ${lastNetErrMsg}`);
      err.status = 0;
      err.cause = netErr;
      throw err;
    }
  }
  // TypeScript: `res` is definitely assigned by the loop above (either the
  // for-loop ran to completion via break, or we already threw).
  res = res!;
  if (!res.ok) {
    // 4xx / 5xx / 网络异常都算失败, 让 caller 决定是否入 pendingSyncStore
    let errBody: any = null;
    try { errBody = await res.json(); } catch { /* ignore */ }
    // O18 SAF-07: log HTTP failure to aliyun with status + body preview.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('./appLog');
      log('v412.save.http_error', {
        remoteId, idempotencyKey: idempotencyKey.slice(0, 8),
        status: res.status, errBody: JSON.stringify(errBody).slice(0, 200),
        payloadBytes,
      });
    } catch { /* silent */ }
    const err: any = new Error(
      `saveHikeAtomic HTTP ${res.status}: ${errBody?.error || 'unknown'}`,
    );
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  const body = await res.json();
  // O17 EDGE_HUNT #22: validate response shape before marking session
  // synced. Pre-O17, a malformed backend reply (missing session_id or
  // ok=false) would still be cast to SaveHikeAtomicResult and the client
  // would call markSynced(remoteId=undefined) → sessions list corrupted.
  // Now: if the reply doesn't match the contract, throw so the retry /
  // pending-sync path takes over.
  if (!body || body.ok !== true || typeof body.session_id !== 'number' || body.client_activity_id !== clientActivityId) {
    // O18 SAF-07: log malformed to aliyun.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { log } = require('./appLog');
      log('v412.save.malformed', {
        remoteId, idempotencyKey: idempotencyKey.slice(0, 8),
        bodyPreview: JSON.stringify(body).slice(0, 200),
      });
    } catch { /* silent */ }
    const err: any = new Error(
      `saveHikeAtomic malformed response: ${JSON.stringify(body).slice(0, 200)}`,
    );
    err.malformed = true;
    throw err;
  }
  // O18 SAF-07: success log too — makes it possible to see full request
  // lifecycle in aliyun (attempt → ok) even without breadcrumb access.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { log } = require('./appLog');
    log('v412.save.ok', {
      remoteId, idempotencyKey: idempotencyKey.slice(0, 8),
      session_id: body.session_id,
      mem_accepted: body.memory?.accepted ?? null,
      mem_rejected: body.memory?.rejected ?? null,
      replay: !!body.idempotent_replay,
    });
  } catch { /* silent */ }
  return body as SaveHikeAtomicResult;
}

const atomicSaveFlights = new Map<string, Promise<SaveHikeAtomicResult>>();

/** One client worker owns an Activity Save even when the UI budget expires. */
export function saveHikeAtomic(
  remoteId: number,
  payload: SaveHikeAtomicPayload,
  idempotencyKey: string,
  clientActivityId: string,
  expectedOwnerUserId?: string,
): Promise<SaveHikeAtomicResult> {
  const flightKey = `${expectedOwnerUserId ?? 'unscoped'}:${clientActivityId}:${idempotencyKey}`;
  const existing = atomicSaveFlights.get(flightKey);
  if (existing) return existing;
  const flight = performSaveHikeAtomic(
    remoteId,
    payload,
    idempotencyKey,
    clientActivityId,
    expectedOwnerUserId,
  )
    .then(async (result) => {
      if (expectedOwnerUserId) {
        await retireActivityAppendOps(expectedOwnerUserId, clientActivityId, result.session_id)
          .catch(() => undefined);
      }
      return result;
    })
    .finally(() => {
      if (atomicSaveFlights.get(flightKey) === flight) atomicSaveFlights.delete(flightKey);
    });
  atomicSaveFlights.set(flightKey, flight);
  return flight;
}


export async function deleteRemoteSession(remoteId: number, expectedUserId?: string): Promise<boolean> {
  try {
    const res = await authenticatedFetchWithDeadline(`/api/sessions/${remoteId}`, {
      method: 'DELETE',
      ...(expectedUserId ? { expectedUserId } : {}),
    });
    return res.ok;
  } catch {
    return false;
  }
}
export async function fetchSessions(): Promise<RemoteSession[]> {
  // Every non-success response is a failed refresh, never an authoritative
  // empty list. This includes expired auth, permission errors, rate limits and
  // schema/route failures; callers retain durable local history and present the
  // actual failure through their owning operation.
  const res = await authenticatedFetchWithDeadline('/api/sessions', {});
  if (!res.ok) {
    throw new Error(`fetchSessions failed ${res.status}`);
  }
  const data = await res.json();
  return parseRemoteSessionList(data);
}
