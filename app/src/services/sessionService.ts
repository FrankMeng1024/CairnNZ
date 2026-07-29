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
interface TrackPointLike {
  lat: number;
  lng: number;
  alt?: number | null;
  /** Either ISO string (incremental flow) or epoch ms (legacy flow). */
  t?: number;
  timestamp?: string;
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

interface RemoteSession {
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
    const res = await authenticatedFetch(`/api/sessions/${remoteId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.session ?? null;
  } catch {
    return null;
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
  route_points: Array<{ lat: number; lng: number; t: number }>;
  route_points_raw: Array<{ lat: number; lng: number; t: number; acc?: number | null }>;
  memory_points: Array<{ lat: number; lng: number; ts: number }>;
}

interface SaveHikeAtomicResult {
  ok: true;
  session_id: number;
  finalized_at: string;
  memory: { accepted: number; rejected: number };
  idempotent_replay?: boolean;
}

export async function saveHikeAtomic(
  remoteId: number,
  payload: SaveHikeAtomicPayload,
  idempotencyKey: string,
): Promise<SaveHikeAtomicResult> {
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
  const doFetch = () => authenticatedFetch(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  let res: Response;
  let lastNetErrMsg = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await doFetch();
      if (res.ok || res.status >= 400 && res.status < 500) {
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
  if (!body || body.ok !== true || typeof body.session_id !== 'number') {
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
