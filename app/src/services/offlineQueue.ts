/**
 * Offline write queue — v78 #7.
 *
 * Persists failed mutating API calls (session start/finalize/append,
 * marker create) to AsyncStorage so they're not lost when the user
 * goes underground / off-network mid-hike. Drains automatically on:
 *   • App returning to foreground
 *   • Network coming back online
 *   • Each successful direct mutation (piggybacks the active socket)
 *
 * Idempotency is enforced by a client-side UUID (`opId`) that the
 * backend dedupes against an `idempotency_keys` table. So even if the
 * client retries 5 times after a transient 500/timeout, only the first
 * accepted call mutates state.
 *
 * Failure handling:
 *   - Network error → keep in queue, increment attempts
 *   - 401 → retain as auth-required for a later authenticated wake
 *   - 4xx other than 401 → retain as action-required; never erase evidence
 *   - 5xx → keep in queue, exponential backoff
 *
 * Out of scope (deliberate):
 *   - Queue size cap — the on-disk JSON blob is bounded by user reality
 *     (one hike / one off-network burst). If it grows beyond a few KB
 *     we'll add capping later.
 *   - Conflict resolution — the dedupe key is the opId, not a CRDT.
 *     If the user finalizes the same session twice with different end
 *     times (impossible by UI), the first wins. Fine.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authenticatedFetch } from './apiService';
import { crashLogger } from './crashLogger';

const STORAGE_KEY = '@cairn:offline_queue:v1';
type OfflineOpKind =
  | 'session_append'
  | 'session_finalize'
  | 'marker_create';

interface OfflineOp {
  /** Client-generated UUID — server dedupes against this. */
  opId: string;
  kind: OfflineOpKind;
  /** API path (without base). */
  path: string;
  /** HTTP method. */
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Request body (object — JSON-stringified at send time). */
  body: any;
  attempts: number;
  /** Epoch ms when the op was first enqueued. */
  enqueuedAt: number;
  /** Epoch ms of last failed attempt (used for backoff). */
  lastTriedAt?: number;
  /** Last error message (best-effort, for diagnostics only). */
  lastError?: string;
  /** Retry policy derived from the actual last response. */
  failureKind?: 'retryable' | 'auth_required' | 'action_required';
  /** Immutable account owner. Unowned legacy rows are retained but never sent. */
  userId?: string;
  /** Stable Activity UUID; numeric session IDs are not business identity. */
  clientActivityId?: string;
}

// ── Storage primitives ─────────────────────────────────────────────────────

async function readQueue(): Promise<OfflineOp[]> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('offline_queue_non_array');
    return parsed;
  } catch (error) {
    if (raw) {
      await AsyncStorage.setItem(`${STORAGE_KEY}:quarantine:${Date.now()}`, raw).catch(() => undefined);
    }
    crashLogger.breadcrumb(`offlineQueue:read:corrupt ${String(error).slice(0, 80)}`);
    throw new Error('offline_queue_corrupt');
  }
}

async function writeQueue(ops: OfflineOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch (err) {
    crashLogger.breadcrumb(`offlineQueue:write:failed ${String(err).slice(0, 80)}`);
    throw err;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a fresh OfflineOp. Caller assigns opId so the same call can
 * carry the same idempotency key when retried directly (in-process)
 * before being enqueued.
 */
export function makeOp(
  kind: OfflineOpKind,
  path: string,
  method: OfflineOp['method'],
  body: any,
  opId: string,
  authority: { userId: string; clientActivityId?: string },
): OfflineOp {
  if (!authority?.userId || authority.userId === 'guest') throw new Error('offline_operation_owner_required');
  return {
    opId,
    kind,
    path,
    method,
    body,
    attempts: 0,
    enqueuedAt: Date.now(),
    userId: authority.userId,
    clientActivityId: authority.clientActivityId,
  };
}

/**
 * Push a new op onto the queue. Idempotent on opId — re-enqueueing the
 * same opId is a no-op, the existing entry's `attempts` is bumped.
 *
 * v409 fix #8: If body is a session_append with too many points
 * (> ~512 KB estimated payload), automatically chunk into smaller ops
 * each with a distinct opId. This keeps individual retries fast and
 * prevents server 413 payload-too-large errors.
 */
const CHUNK_SIZE_BYTES = 512 * 1024;
const SESSION_APPEND_MAX_POINTS = 500;

function estimatePayloadBytes(body: any): number {
  try { return JSON.stringify(body).length; } catch { return 0; }
}

// UUID v4 fallback (no crypto dep on some RN versions).
function makeChunkOpId(baseOpId: string, idx: number): string {
  return `${baseOpId}-chunk-${idx}`;
}

function normalizeAppendPoint(point: any): any {
  if (!point || typeof point !== 'object') return point;
  const normalized = { ...point };
  for (const key of ['acc', 'v_acc', 'speed_mps', 'course_deg']) {
    const value = normalized[key];
    if (value != null && (!Number.isFinite(value) || value < 0)) normalized[key] = null;
  }
  if (normalized.t != null && Number.isFinite(normalized.t)) normalized.t = Math.floor(normalized.t);
  return normalized;
}

/** Repair legacy queued batches before dispatch without changing their order. */
function normalizeAndChunkAppend(op: OfflineOp): OfflineOp[] {
  if (op.kind !== 'session_append' || !Array.isArray(op.body?.points)) return [op];
  const points = op.body.points.map(normalizeAppendPoint);
  const bytes = estimatePayloadBytes({ ...op.body, points });
  const byteBound = bytes > CHUNK_SIZE_BYTES
    ? Math.max(1, Math.floor(points.length * (CHUNK_SIZE_BYTES / bytes) * 0.9))
    : SESSION_APPEND_MAX_POINTS;
  const pointsPerChunk = Math.min(SESSION_APPEND_MAX_POINTS, byteBound);
  if (points.length <= pointsPerChunk) {
    const changed = JSON.stringify(points) !== JSON.stringify(op.body.points);
    return [{
      ...op,
      body: { ...op.body, points },
      ...(changed ? {
        attempts: 0,
        lastTriedAt: undefined,
        lastError: undefined,
        failureKind: undefined,
      } : {}),
    }];
  }
  const chunks: OfflineOp[] = [];
  for (let offset = 0, index = 0; offset < points.length; offset += pointsPerChunk, index += 1) {
    chunks.push({
      ...op,
      opId: makeChunkOpId(op.opId, index),
      body: { ...op.body, points: points.slice(offset, offset + pointsPerChunk) },
      attempts: 0,
      lastTriedAt: undefined,
      lastError: undefined,
      failureKind: undefined,
    });
  }
  return chunks;
}

// O1 (2026-07-26) race fix: enqueue 是 read-modify-write,并发调用
// (session_append 网络失败 catch + AppState 触发 + user action 各路径
// 同时打进来) 会 read stale queue → 各自 write → 后写覆盖前写,op 丢失
// = GPS 轨迹永久丢一段。用 Promise chain 串行化 enqueue,同时 drain
// 也走同一 chain 保证 enqueue vs drain 也不并发。参照
// offlineEntity.ts:177 withLock 模式。
let opChain: Promise<void> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = opChain.then(fn, fn);
  // 让 chain 不因单次失败断掉;下一个 enqueue 仍能继续。
  opChain = next.then(() => undefined, () => undefined);
  return next;
}

async function enqueueImpl(op: OfflineOp): Promise<void> {
  if (!op.userId || op.userId === 'guest') throw new Error('offline_operation_owner_required');
  // Enforce both server bounds when first queued. The same migration also
  // runs during drain so operations written by older OTAs recover in place.
  if (op.kind === 'session_append' && op.body?.points && Array.isArray(op.body.points)) {
    const chunks = normalizeAndChunkAppend(op);
    if (chunks.length > 1) {
      const q = await readQueue();
      for (const chunkOp of chunks) {
        const duplicate = q.find(o => o.opId === chunkOp.opId || (
          o.userId === chunkOp.userId
          && o.clientActivityId === chunkOp.clientActivityId
          && o.kind === chunkOp.kind
          && o.path === chunkOp.path
          && JSON.stringify(o.body) === JSON.stringify(chunkOp.body)
        ));
        if (!duplicate) q.push(chunkOp);
      }
      await writeQueue(q);
      crashLogger.breadcrumb(`offlineQueue:enqueue:chunked kind=${op.kind} chunks=${chunks.length} size=${q.length}`);
      return;
    }
    [op] = chunks;
  }
  const q = await readQueue();
  const existing = q.find(o => o.opId === op.opId);
  if (existing) {
    existing.attempts += 1;
    existing.lastTriedAt = Date.now();
  } else {
    const equivalent = q.find(o => o.userId === op.userId
      && o.clientActivityId === op.clientActivityId
      && o.kind === op.kind
      && o.path === op.path
      && JSON.stringify(o.body) === JSON.stringify(op.body));
    if (!equivalent) q.push(op);
  }
  await writeQueue(q);
  crashLogger.breadcrumb(`offlineQueue:enqueue kind=${op.kind} size=${q.length}`);
}

export async function enqueue(op: OfflineOp): Promise<void> {
  return serialize(() => enqueueImpl(op));
}

/**
 * Try to send each queued op. Committed operations are not deleted merely
 * for exhausting retries or receiving a client error; permanent failures
 * remain inspectable while unrelated entries continue draining.
 */
let draining = false;
let pendingDrainOwner: string | null = null;
export async function drain(expectedOwnerUserId: string): Promise<void> {
  if (!expectedOwnerUserId || expectedOwnerUserId === 'guest') return;
  if (draining) {
    // Coalesce same-owner wakes and retain a different owner's wake. A fast
    // account switch must not leave B's queue asleep behind A's old flight.
    pendingDrainOwner = expectedOwnerUserId;
    return;
  }
  draining = true;
  try {
    let q = (await readQueue()).flatMap(normalizeAndChunkAppend);
    if (q.length === 0) return;
    await writeQueue(q);
    crashLogger.breadcrumb(`offlineQueue:drain:start size=${q.length}`);
    // O1 (2026-07-26) race fix: 记录 drain 开始时的 opId 集合。drain 循环
    // 里可能 await 每个 op 的 fetch (数秒),期间 enqueue 会串行加新 op 进 queue。
    // 老代码 writeQueue(remaining) 直接覆盖 = 新加的 op 被抹掉 (GPS 轨迹丢)。
    // 现在: drain 尾部 serialize + re-read + 保留 drain 期间新增的 op。
    const drainStartIds = new Set(q.map((o) => o.opId));
    const remaining: OfflineOp[] = [];
    for (const op of q) {
      if (!op.userId) {
        op.failureKind = 'action_required';
        op.lastError = 'legacy_owner_unresolved';
        remaining.push(op);
        continue;
      }
      if (op.userId !== expectedOwnerUserId) {
        remaining.push(op);
        continue;
      }
      if (op.failureKind === 'action_required') {
        remaining.push(op);
        continue;
      }
      // v409 fix #7: Exponential backoff (previous was attempts^2 * 5s
      // which is slow to catch up. Now min(2^attempts * 5s, 30min) with
      // 30min ceiling matching debate recommendation).
      const backoffMs = Math.min(5_000 * Math.pow(2, op.attempts), 30 * 60_000);
      if (op.lastTriedAt && Date.now() - op.lastTriedAt < backoffMs) {
        remaining.push(op);
        continue;
      }
      try {
        const res = await authenticatedFetch(op.path, {
          method: op.method,
          body: JSON.stringify({ ...op.body, client_op_id: op.opId }),
          // 401 should NOT logout — this is a background retry, the
          // user might have a valid session that hasn't loaded yet.
          skipLogoutOn401: true,
          expectedUserId: expectedOwnerUserId,
        });
        let liveOwnerUserId = '';
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          liveOwnerUserId = String(require('../store/useAppStore').useAppStore.getState().user?.id ?? '');
        } catch { /* fail closed below */ }
        if (liveOwnerUserId !== expectedOwnerUserId) {
          // The request used A's captured authority, but its acknowledgement
          // arrived after B took over. Retain the idempotent op for A's next
          // authenticated drain instead of letting B's lifecycle consume it.
          remaining.push(op);
          pendingDrainOwner = liveOwnerUserId || pendingDrainOwner;
          continue;
        }
        if (res.ok) {
          // success — drop entry
          crashLogger.breadcrumb(`offlineQueue:sent kind=${op.kind} attempts=${op.attempts}`);
          continue;
        }
        if (res.status === 401) {
          op.attempts += 1;
          op.lastTriedAt = Date.now();
          op.lastError = `401`;
          op.failureKind = 'auth_required';
          remaining.push(op);
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          let responseCode = '';
          try { responseCode = String((await res.json())?.code ?? ''); } catch { /* no structured body */ }
          if (res.status === 404 && responseCode === 'SESSION_NOT_FOUND_RESYNC'
            && op.kind === 'session_append' && op.clientActivityId) {
            try {
              // A full pending atomic Save supersedes incremental append chunks.
              // Dropping them is safe only after matching exact owner+Activity.
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const { listPending } = require('./pendingSyncStore');
              const pending = await listPending();
              if (pending.some((item: any) => item.userId === op.userId
                && item.localId === op.clientActivityId)) {
                crashLogger.breadcrumb(`offlineQueue:append_superseded activity=${op.clientActivityId.slice(0, 8)}`);
                continue;
              }
            } catch { /* retain below if authority cannot be proven */ }
          }
          op.attempts += 1;
          op.lastTriedAt = Date.now();
          op.lastError = `status=${res.status}`;
          op.failureKind = 'action_required';
          remaining.push(op);
          crashLogger.breadcrumb(`offlineQueue:action_required kind=${op.kind} status=${res.status}`);
          continue;
        }
        // 5xx or unknown — keep, backoff
        op.attempts += 1;
        op.lastTriedAt = Date.now();
        op.lastError = `status=${res.status}`;
        op.failureKind = 'retryable';
        remaining.push(op);
      } catch (err) {
        // network error — keep, backoff
        op.attempts += 1;
        op.lastTriedAt = Date.now();
        op.lastError = String(err).slice(0, 80);
        op.failureKind = 'retryable';
        remaining.push(op);
      }
    }
    await serialize(async () => {
      const latest = await readQueue();
      // 保留 drain 期间新加的 op (drainStartIds 里没有的) + drain 判定要 retain 的 op
      const remainingIds = new Set(remaining.map((o) => o.opId));
      const merged = [
        ...latest.filter((o) => !drainStartIds.has(o.opId)),
        ...remaining,
      ];
      // 去重: 若 latest 里有和 remaining 同 opId (enqueue 期间对同 op bump attempts),
      // remaining 版本胜出 (attempts 已更新)
      const seen = new Set<string>();
      const deduped = merged.filter((o) => {
        if (seen.has(o.opId)) return false;
        seen.add(o.opId);
        return true;
      });
      void remainingIds;
      await writeQueue(deduped);
    });
    crashLogger.breadcrumb(`offlineQueue:drain:end remaining=${remaining.length}`);
  } finally {
    draining = false;
    const nextOwner = pendingDrainOwner;
    pendingDrainOwner = null;
    if (nextOwner && nextOwner !== 'guest') {
      void drain(nextOwner);
    }
  }
}

/** Remove obsolete incremental chunks only after the full atomic Save ACKs. */
export async function retireActivityAppendOps(
  userId: string,
  clientActivityId: string,
  remoteId?: number,
): Promise<void> {
  if (!userId || !clientActivityId) return;
  await serialize(async () => {
    const queue = await readQueue();
    const remotePathPrefix = remoteId == null ? null : `/api/sessions/${remoteId}/append-points`;
    const next = queue.filter(op => !(
      op.kind === 'session_append'
      && op.userId === userId
      && (op.clientActivityId === clientActivityId
        || (!!remotePathPrefix && !op.clientActivityId && op.path === remotePathPrefix))
    ));
    if (next.length !== queue.length) await writeQueue(next);
  });
}

/**
 * Generate a UUID v4 (string). Self-contained — no extra dep.
 * RFC 4122 §4.4 (random) compliant for our purposes (collision-free
 * for the realistic queue depth of dozens of ops).
 */
export function uuidv4(): string {
  // Math.random is fine here — we're not signing tokens, just dedup keys.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
