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
 *   - 401 → stop draining (would just loop), wait for next foreground
 *   - 4xx other than 401 → assume bad input, drop entry (log breadcrumb)
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
import { AppState, type AppStateStatus } from 'react-native';
import { authenticatedFetch } from './apiService';
import { crashLogger } from './crashLogger';
import networkMonitor from './networkMonitor';

const STORAGE_KEY = '@cairn:offline_queue:v1';
const MAX_ATTEMPTS = 8; // ~beyond this, drop with a breadcrumb

export type OfflineOpKind =
  | 'session_append'
  | 'session_finalize'
  | 'marker_create';

export interface OfflineOp {
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
}

// ── Storage primitives ─────────────────────────────────────────────────────

async function readQueue(): Promise<OfflineOp[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(ops: OfflineOp[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch (err) {
    crashLogger.breadcrumb(`offlineQueue:write:failed ${String(err).slice(0, 80)}`);
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
): OfflineOp {
  return {
    opId,
    kind,
    path,
    method,
    body,
    attempts: 0,
    enqueuedAt: Date.now(),
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

function estimatePayloadBytes(body: any): number {
  try { return JSON.stringify(body).length; } catch { return 0; }
}

// UUID v4 fallback (no crypto dep on some RN versions).
function makeChunkOpId(baseOpId: string, idx: number): string {
  return `${baseOpId}-chunk-${idx}`;
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
  // v409 fix #8: chunk session_append if payload too large.
  if (op.kind === 'session_append' && op.body?.points && Array.isArray(op.body.points)) {
    const bytes = estimatePayloadBytes(op.body);
    if (bytes > CHUNK_SIZE_BYTES) {
      const points = op.body.points as any[];
      // Estimate points per chunk based on avg size
      const pointsPerChunk = Math.max(1, Math.floor(points.length * (CHUNK_SIZE_BYTES / bytes) * 0.9));
      const q = await readQueue();
      let idx = 0;
      for (let i = 0; i < points.length; i += pointsPerChunk) {
        const slice = points.slice(i, i + pointsPerChunk);
        const chunkOp: OfflineOp = {
          ...op,
          opId: makeChunkOpId(op.opId, idx),
          body: { ...op.body, points: slice },
          attempts: 0,
          enqueuedAt: Date.now(),
        };
        if (!q.find(o => o.opId === chunkOp.opId)) q.push(chunkOp);
        idx++;
      }
      await writeQueue(q);
      crashLogger.breadcrumb(`offlineQueue:enqueue:chunked kind=${op.kind} chunks=${idx} bytes=${bytes} size=${q.length}`);
      return;
    }
  }
  const q = await readQueue();
  const existing = q.find(o => o.opId === op.opId);
  if (existing) {
    existing.attempts += 1;
    existing.lastTriedAt = Date.now();
  } else {
    q.push(op);
  }
  await writeQueue(q);
  crashLogger.breadcrumb(`offlineQueue:enqueue kind=${op.kind} size=${q.length}`);
}

export async function enqueue(op: OfflineOp): Promise<void> {
  return serialize(() => enqueueImpl(op));
}

/**
 * Try to send each queued op. Stops on 401 (auth) so we don't loop
 * forever on a stale token. Drops 4xx (other) entries — bad payload
 * isn't going to fix itself. Keeps 5xx + network errors for retry.
 */
let draining = false;
export async function drain(): Promise<void> {
  if (draining) return; // re-entrancy guard — concurrent triggers (foreground + online) coalesce
  draining = true;
  try {
    let q = await readQueue();
    if (q.length === 0) return;
    crashLogger.breadcrumb(`offlineQueue:drain:start size=${q.length}`);
    // O1 (2026-07-26) race fix: 记录 drain 开始时的 opId 集合。drain 循环
    // 里可能 await 每个 op 的 fetch (数秒),期间 enqueue 会串行加新 op 进 queue。
    // 老代码 writeQueue(remaining) 直接覆盖 = 新加的 op 被抹掉 (GPS 轨迹丢)。
    // 现在: drain 尾部 serialize + re-read + 保留 drain 期间新增的 op。
    const drainStartIds = new Set(q.map((o) => o.opId));
    const remaining: OfflineOp[] = [];
    let stopped = false;
    for (const op of q) {
      if (stopped) {
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
        });
        if (res.ok) {
          // success — drop entry
          crashLogger.breadcrumb(`offlineQueue:sent kind=${op.kind} attempts=${op.attempts}`);
          continue;
        }
        if (res.status === 401) {
          // stop the drain — token's bad, retry later
          op.attempts += 1;
          op.lastTriedAt = Date.now();
          op.lastError = `401`;
          remaining.push(op);
          stopped = true;
          continue;
        }
        if (res.status >= 400 && res.status < 500) {
          // client error — payload is invalid, don't retry forever
          crashLogger.breadcrumb(`offlineQueue:drop kind=${op.kind} status=${res.status}`);
          continue;
        }
        // 5xx or unknown — keep, backoff
        op.attempts += 1;
        op.lastTriedAt = Date.now();
        op.lastError = `status=${res.status}`;
        if (op.attempts >= MAX_ATTEMPTS) {
          crashLogger.breadcrumb(`offlineQueue:exhausted kind=${op.kind}`);
          continue; // drop
        }
        remaining.push(op);
      } catch (err) {
        // network error — keep, backoff
        op.attempts += 1;
        op.lastTriedAt = Date.now();
        op.lastError = String(err).slice(0, 80);
        if (op.attempts >= MAX_ATTEMPTS) {
          crashLogger.breadcrumb(`offlineQueue:exhausted kind=${op.kind}`);
          continue;
        }
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
  }
}

/**
 * Wire AppState + networkMonitor triggers. Call once at app startup.
 * Returns an unsubscribe (unused in practice — wire-once).
 */
export function subscribeOfflineQueueDrains(): () => void {
  // Network coming back online → drain
  const offNet = networkMonitor.onChange((s) => {
    if (s.state === 'online') {
      drain().catch(() => { /* swallow */ });
    }
  });
  // App returning to foreground → drain (covers the "brief background"
  // metro case where networkMonitor may not fire because the OS suspended
  // it; but AppState always fires).
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') {
      drain().catch(() => { /* swallow */ });
    }
  });
  return () => {
    offNet();
    try { sub.remove(); } catch { /* ignore */ }
  };
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

/**
 * v409: expose queue read/clear for Playwright web replay + hydrate cold
 * start replay. Read is const-safe (returns a copy).
 */
export async function readQueueSnapshot(): Promise<OfflineOp[]> {
  const q = await readQueue();
  return q.map(o => ({ ...o }));
}

export async function clearQueue(): Promise<void> {
  await writeQueue([]);
}
