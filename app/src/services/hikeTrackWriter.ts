/**
 * hikeTrackWriter — v409 独立 hike 磁盘落盘服务
 *
 * Purpose:
 *   - 每次 GPS callback 同步 append 一行 JSONL 到 active/{sid}.jsonl
 *   - stopTracking 时 rename 到 completed/ 目录
 *   - hydrate 时可读 tail 恢复未完成 hike
 *
 * Design decisions (see docs/audit-v404/v409-DESIGN.md §2):
 *   - 纯 append (write mode 'a' 语义),绝不 read-modify-write
 *   - Crash safety: 写中断只丢 1 行,tail-recover 时 skip malformed
 *   - 与 debugLogger 完全解耦(独立目录 cairn-hike-tracks/, 独立 gate)
 *   - 内部 write buffer (~30s 或 50 点) 减少 fsync 频率;但 background 场景
 *     每次 append 直接 fsync 确保 iOS jetsam 后不丢 (少数几行内)
 *
 * JSONL schema per line (~85 bytes):
 *   { "t": 1720260000000, "lat": -36.848461, "lng": 174.763336,
 *     "acc": 8.5, "alt": 42.3, "src": "fg|bg|slc", "conf": 1 }
 *
 * File layout:
 *   {docDir}/cairn-hike-tracks/
 *     ├── active/{sid}.jsonl
 *     ├── completed/{sid}.jsonl
 *     └── meta/{sid}.json  ({ started_at, remote_id, activity_mode, last_ts, total_points, uploaded })
 *
 * Web fallback: getFs() returns null on web → append becomes no-op.
 * Native TaskManager background path (backgroundLocationTask.ts:74) reuses this
 * same file layout via appendDirectlyToHikeTrack().
 */

import type { LocationCoords } from './backgroundLocationTask';

const HIKE_DIR = 'cairn-hike-tracks/';
const ACTIVE_DIR = HIKE_DIR + 'active/';
const COMPLETED_DIR = HIKE_DIR + 'completed/';
const META_DIR = HIKE_DIR + 'meta/';

// Write buffer: flush every N ms or every M points, whichever comes first.
const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_POINT_COUNT = 50;

interface HikePoint {
  t: number;
  lat: number;
  lng: number;
  acc?: number | null;
  alt?: number | null;
  src?: 'fg' | 'bg' | 'slc';
  conf?: number; // 1=high (GPS), 0.5=low (cell/WiFi), 0=gap fill only
}

export interface HikeMeta {
  session_id: string;
  started_at: number;
  ended_at?: number;
  activity_mode: 'hiking' | 'running';
  remote_id?: number;
  last_ts?: number;
  total_points: number;
  uploaded: boolean;
}

interface WriterState {
  sessionId: string;
  buffer: HikePoint[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  totalPoints: number;
  lastFlushError: string | null;
}

let state: WriterState | null = null;

/**
 * Dynamic import expo-file-system/legacy — same pattern as
 * backgroundLocationTask.ts. Falls back to localStorage-backed shim on
 * web where expo-file-system is not available. Native iOS/Android always
 * uses the real fs.
 *
 * v409 Playwright web coverage: the localStorage shim lets us test disk
 * write / read / listActiveHikes / cache clean on web without shipping
 * anything native-affecting (Platform.OS !== 'web' → real fs unchanged).
 */
async function getFs(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = await import('expo-file-system/legacy');
    if (legacy && legacy.documentDirectory) return legacy;
  } catch {
    /* fallthrough to web shim */
  }
  // Web fallback: localStorage-backed shim. Keyspace: 'cairn-fs://<path>'.
  // Only activated when real fs unavailable (web browser). Native RN always
  // returns the real fs above. Testing-only path.
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const PREFIX = 'cairn-fs://';
    const docDir = PREFIX;
    const shim = {
      documentDirectory: docDir,
      async getInfoAsync(path: string) {
        const raw = window.localStorage.getItem(path);
        // Directory tracking: paths ending in '/' are dirs, tracked as JSON list.
        if (path.endsWith('/')) {
          const dirEntry = window.localStorage.getItem(path + '__dir__');
          return { exists: !!dirEntry, isDirectory: true, uri: path };
        }
        return { exists: raw !== null, isDirectory: false, uri: path, size: raw ? raw.length : 0 };
      },
      async makeDirectoryAsync(path: string, _opts?: { intermediates?: boolean }) {
        if (!path.endsWith('/')) path = path + '/';
        window.localStorage.setItem(path + '__dir__', '1');
      },
      async writeAsStringAsync(path: string, content: string) {
        window.localStorage.setItem(path, content);
        // Track parent directory listing so readDirectoryAsync works
        const parent = path.substring(0, path.lastIndexOf('/') + 1);
        const listKey = parent + '__files__';
        const raw = window.localStorage.getItem(listKey);
        const list: string[] = raw ? JSON.parse(raw) : [];
        const filename = path.substring(parent.length);
        if (!list.includes(filename)) {
          list.push(filename);
          window.localStorage.setItem(listKey, JSON.stringify(list));
        }
      },
      async readAsStringAsync(path: string): Promise<string> {
        const raw = window.localStorage.getItem(path);
        if (raw === null) throw new Error('File not found: ' + path);
        return raw;
      },
      async readDirectoryAsync(path: string): Promise<string[]> {
        if (!path.endsWith('/')) path = path + '/';
        const raw = window.localStorage.getItem(path + '__files__');
        return raw ? JSON.parse(raw) : [];
      },
      async deleteAsync(path: string, _opts?: { idempotent?: boolean }) {
        window.localStorage.removeItem(path);
        // Remove from parent listing
        const parent = path.substring(0, path.lastIndexOf('/') + 1);
        const listKey = parent + '__files__';
        const raw = window.localStorage.getItem(listKey);
        if (raw) {
          const list: string[] = JSON.parse(raw);
          const filename = path.substring(parent.length);
          const idx = list.indexOf(filename);
          if (idx >= 0) {
            list.splice(idx, 1);
            window.localStorage.setItem(listKey, JSON.stringify(list));
          }
        }
      },
      async moveAsync(opts: { from: string; to: string }) {
        const raw = window.localStorage.getItem(opts.from);
        if (raw === null) return;
        await this.writeAsStringAsync(opts.to, raw);
        await this.deleteAsync(opts.from);
      },
    };
    return shim;
  }
  return null;
}

async function ensureDirs(fs: any): Promise<void> {
  for (const d of [HIKE_DIR, ACTIVE_DIR, COMPLETED_DIR, META_DIR]) {
    const path = fs.documentDirectory + d;
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) await fs.makeDirectoryAsync(path, { intermediates: true });
    } catch { /* best effort */ }
  }
}

/**
 * Start writing a new hike track. Called from useTrackingStore.startTracking.
 * Overwrites any prior state — caller must call renameToCompleted() first
 * if a previous session should be preserved.
 */
export async function startHikeTrack(sessionId: string, meta: Omit<HikeMeta, 'session_id' | 'total_points' | 'uploaded' | 'last_ts'>): Promise<void> {
  const fs = await getFs();
  if (!fs) {
    state = { sessionId, buffer: [], flushTimer: null, totalPoints: 0, lastFlushError: 'web-no-fs' };
    return;
  }
  await ensureDirs(fs);
  // Truncate any old file with same sid (rare but idempotent-safe)
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  try {
    const info = await fs.getInfoAsync(activePath);
    if (info.exists) await fs.deleteAsync(activePath, { idempotent: true });
  } catch { /* best effort */ }
  // Write initial meta
  const fullMeta: HikeMeta = {
    session_id: sessionId,
    started_at: meta.started_at,
    activity_mode: meta.activity_mode,
    remote_id: meta.remote_id,
    total_points: 0,
    uploaded: false,
  };
  try {
    await fs.writeAsStringAsync(fs.documentDirectory + META_DIR + sessionId + '.json', JSON.stringify(fullMeta));
  } catch { /* best effort */ }
  state = { sessionId, buffer: [], flushTimer: null, totalPoints: 0, lastFlushError: null };
}

/**
 * v410 fix (fresh audit v4): Resume writing an existing hike track without
 * truncating disk file or resetting meta. Called from UnfinishedSessionBanner
 * onContinue after readActiveHikeTail restored trackPoints to Zustand store.
 *
 * Without this, hikeTrackWriter.state stays null after cold-boot (module-scoped),
 * appendHikePoint early-returns, new GPS points never hit disk. If user kills
 * app twice in a row, second-time recovery loses the mid-section walked between
 * kills. See docs/qa/v409-evidence/fresh-audit-v4.md Op 2 finding.
 */
export async function resumeHikeTrack(sessionId: string): Promise<{ resumed: boolean; totalPoints: number }> {
  const fs = await getFs();
  if (!fs) {
    state = { sessionId, buffer: [], flushTimer: null, totalPoints: 0, lastFlushError: 'web-no-fs' };
    return { resumed: true, totalPoints: 0 };
  }
  // Read existing meta to preserve total_points count
  let existingTotal = 0;
  try {
    const metaRaw = await fs.readAsStringAsync(fs.documentDirectory + META_DIR + sessionId + '.json');
    const meta: HikeMeta = JSON.parse(metaRaw);
    existingTotal = meta.total_points ?? 0;
  } catch { /* meta absent — start fresh count but don't fail */ }
  state = { sessionId, buffer: [], flushTimer: null, totalPoints: existingTotal, lastFlushError: null };
  return { resumed: true, totalPoints: existingTotal };
}

/**
 * Append one GPS point. Buffered — flushed to disk every 30s or every
 * 50 points, whichever comes first. Sync call, non-blocking.
 *
 * NOTE: Only appends if there is an active state (startHikeTrack called).
 * If state is null (e.g. background task fired before session start), the
 * point is dropped here — background task path handles JS-dead case by
 * writing directly via appendDirectlyToHikeTrack.
 */
export function appendHikePoint(point: HikePoint): void {
  if (!state) return;
  state.buffer.push(point);
  state.totalPoints++;
  if (state.buffer.length >= FLUSH_POINT_COUNT) {
    void flushBuffer();
  } else if (!state.flushTimer) {
    state.flushTimer = setTimeout(() => { void flushBuffer(); }, FLUSH_INTERVAL_MS);
  }
}

// O1 R1: mutex — flushBuffer 有多个 caller (30s timer, 50pts trigger,
// stopTracking, background AppState). 无 mutex 时并发 flush 会 truncate
// 已经写入的数据 (concurrent read-existing 拿旧 file,write 用旧+空 覆盖)。
// O6 fix: 老的 mutex 是 "check-then-set-null" pattern, 会有 race: A 完成
// null-reset 之后, B 和 C 恰在同一 microtask tick 唤醒,但如果 B 的
// IIFE 首个 await 之前又来了新点, C 看到 buffer 有内容再启一个 IIFE →
// 两个 IIFE 并发写文件 truncate。改成 chain-serialization: 每次调用把
// 自己接到上一个的 tail, 保证不管多少个 caller 都串行执行。
let flushChainTail: Promise<void> = Promise.resolve();

async function flushBuffer(): Promise<void> {
  // 排到 chain 尾部,保证前一个 flush 结束才开始。空-buffer 情况在
  // IIFE 内部 early return,占极短时间,不影响吞吐。
  const next = flushChainTail.then(async () => {
    if (!state) return;
    const s = state; // narrow for TS
    if (s.flushTimer) {
      clearTimeout(s.flushTimer);
      s.flushTimer = null;
    }
    if (s.buffer.length === 0) return;
    const toWrite = s.buffer;
    s.buffer = [];
    const fs = await getFs();
    if (!fs) return;
    const activePath = fs.documentDirectory + ACTIVE_DIR + s.sessionId + '.jsonl';
    const lines = toWrite.map(p => JSON.stringify(p)).join('\n') + '\n';
    try {
      // expo-file-system/legacy doesn't have native append; use read+write.
      // For crash safety we chunk the read to avoid holding entire file if huge.
      // 30s buffer × 1h = ~120 flushes, each concat writes O(file_size).
      // For 1h/3600pts file (~350KB), each write is 350KB × 120 = manageable.
      let existing = '';
      try {
        const info = await fs.getInfoAsync(activePath);
        if (info.exists) existing = await fs.readAsStringAsync(activePath);
      } catch { /* best effort */ }
      await fs.writeAsStringAsync(activePath, existing + lines);
      // Update meta
      const metaPath = fs.documentDirectory + META_DIR + s.sessionId + '.json';
      try {
        const metaRaw = await fs.readAsStringAsync(metaPath);
        const meta: HikeMeta = JSON.parse(metaRaw);
        meta.total_points = s.totalPoints;
        meta.last_ts = toWrite[toWrite.length - 1]?.t;
        await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
      } catch { /* best effort */ }
      s.lastFlushError = null;
    } catch (e) {
      s.lastFlushError = String(e).slice(0, 80);
      // Re-buffer for next attempt (don't drop)
      s.buffer = toWrite.concat(s.buffer);
    }
  });
  // 用 catch 屏蔽 chain 里单次失败,避免一次抛错把整条 chain 变成
  // rejected → 后续 flush 全部秒抛。
  flushChainTail = next.catch(() => {});
  await next;
}

/**
 * Rename active file to completed and mark meta.uploaded=false initially.
 * Called from useTrackingStore.stopTracking.
 */
export async function renameToCompleted(sessionId: string, endedAt: number, remoteId?: number): Promise<void> {
  await flushBuffer();
  const fs = await getFs();
  if (!fs) { state = null; return; }
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  const completedPath = fs.documentDirectory + COMPLETED_DIR + sessionId + '.jsonl';
  try {
    const info = await fs.getInfoAsync(activePath);
    if (info.exists) {
      await fs.moveAsync({ from: activePath, to: completedPath });
    }
  } catch { /* best effort */ }
  // Update meta
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  try {
    const metaRaw = await fs.readAsStringAsync(metaPath);
    const meta: HikeMeta = JSON.parse(metaRaw);
    meta.ended_at = endedAt;
    if (remoteId !== undefined) meta.remote_id = remoteId;
    await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
  } catch { /* best effort */ }
  state = null;
}

/**
 * List all in-progress (active) hikes. Used at hydrate to detect
 * pendingSessionResume. Each entry is a HikeMeta.
 */
export async function listActiveHikes(): Promise<HikeMeta[]> {
  const fs = await getFs();
  if (!fs) return [];
  const activeDir = fs.documentDirectory + ACTIVE_DIR;
  try {
    const info = await fs.getInfoAsync(activeDir);
    if (!info.exists) return [];
    const files = await fs.readDirectoryAsync(activeDir);
    const metas: HikeMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sid = f.replace('.jsonl', '');
      try {
        const metaRaw = await fs.readAsStringAsync(fs.documentDirectory + META_DIR + sid + '.json');
        metas.push(JSON.parse(metaRaw));
      } catch { /* skip malformed */ }
    }
    return metas.sort((a, b) => b.started_at - a.started_at);
  } catch {
    return [];
  }
}

/**
 * Read the tail of an active hike's JSONL file. Skips malformed lines.
 * Used for hydrate replay (Sprint 72 STORY-00551 real implementation).
 */
export async function readActiveHikeTail(sessionId: string): Promise<HikePoint[]> {
  const fs = await getFs();
  if (!fs) return [];
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  try {
    const info = await fs.getInfoAsync(activePath);
    if (!info.exists) return [];
    const content = await fs.readAsStringAsync(activePath);
    const lines = content.split('\n');
    const points: HikePoint[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line);
        if (typeof p.lat === 'number' && typeof p.lng === 'number' && typeof p.t === 'number') {
          points.push(p);
        }
      } catch { /* skip malformed */ }
    }
    return points;
  } catch {
    return [];
  }
}

/**
 * Discard an unfinished hike (user tapped Dismiss in ResumeBanner
 * or Discard in the stop sheet).
 *
 * O14 Bug 2 fix: pre-fix, this only deleted the JSONL + meta on
 * disk. Module-scoped `state` was left with sessionId + non-empty
 * buffer + a live flushTimer. 30s later the timer fired, flushBuffer
 * ran, and it recreated the JSONL from the buffer — resurrecting
 * the file we just deleted. The user then saw "unfinished hike"
 * pop up on the next Hike-screen mount, even though they Discarded.
 * Fix: first clear the in-memory state (cancel timer, drop buffer,
 * null out `state`), then await any in-flight flush chain to drain,
 * then delete on disk.
 */
export async function discardActiveHike(sessionId: string): Promise<void> {
  // (1) invalidate the module state so any queued flushBuffer becomes a no-op
  if (state && state.sessionId === sessionId) {
    if (state.flushTimer) { clearTimeout(state.flushTimer); state.flushTimer = null; }
    state.buffer = [];
    state = null;
  }
  // (2) wait for any in-flight flush chain tail to drain — it may still
  // be mid-write when we get here (an addTrackPoint 50 lines ago triggered
  // an immediate flush that hasn't returned yet)
  try { await flushChainTail; } catch { /* swallow — chain rejects handled elsewhere */ }
  const fs = await getFs();
  if (!fs) return;
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  try { await fs.deleteAsync(activePath, { idempotent: true }); } catch {}
  try { await fs.deleteAsync(metaPath, { idempotent: true }); } catch {}
}

/**
 * Force flush now — used before app suspension / stopTracking.
 */
export async function flushNow(): Promise<void> {
  await flushBuffer();
}
