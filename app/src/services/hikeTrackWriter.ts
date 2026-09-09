/**
 * hikeTrackWriter — v409 独立 hike 磁盘落盘服务
 *
 * Purpose:
 *   - every accepted GPS callback awaits one verified journal replacement
 *   - stopTracking 时 rename 到 completed/ 目录
 *   - hydrate 时可读 tail 恢复未完成 hike
 *
 * Design decisions (see docs/review/free-activity-final):
 *   - verified two-snapshot replacement because Expo FileSystem has no append
 *   - Crash safety: recovery selects the most complete valid active/next/bak snapshot
 *   - 与 debugLogger 完全解耦(独立目录 cairn-hike-tracks/, 独立 gate)
 *   - every accepted point commits immediately; there is no long-lived buffer
 *
 * JSONL schema per line (~85 bytes):
 *   { "t": 1720260000000, "lat": -36.848461, "lng": 174.763336,
 *     "acc": 8.5, "alt": 42.3, "src": "fg|bg|slc|sim", "conf": 1 }
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

const HIKE_DIR = 'cairn-hike-tracks/';
const ACTIVE_DIR = HIKE_DIR + 'active/';
const COMPLETED_DIR = HIKE_DIR + 'completed/';
const META_DIR = HIKE_DIR + 'meta/';

// Commit policy: flush every accepted point. The former timer/count buffer
// routinely lost an accepted foreground tail on abrupt process death.

export interface HikePoint {
  t: number;
  lat: number;
  lng: number;
  acc?: number | null;
  alt?: number | null;
  speed?: number | null;
  src?: 'fg' | 'bg' | 'slc' | 'sim';
  conf?: number; // 1=high (GPS), 0.5=low (cell/WiFi), 0=gap fill only
  clientActivityId: string;
  ownerGeneration: string;
  segmentId: string;
  segmentStartReason?: 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
}

export interface HikeMeta {
  session_id: string;
  started_at: number;
  ended_at?: number;
  activity_mode: 'hiking' | 'running';
  user_id?: string;
  owner_generation?: string;
  remote_id?: number;
  last_ts?: number;
  total_points: number;
  uploaded: boolean;
  /** Local-only provider identity used to restore Simulator Activities. */
  location_source?: 'real' | 'simulator';
}

interface WriterState {
  sessionId: string;
  buffer: HikePoint[];
  totalPoints: number;
  lastFlushError: string | null;
}

let state: WriterState | null = null;
let durableWriteTail: Promise<void> = Promise.resolve();

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

function activeCandidates(basePath: string): string[] {
  return [basePath, `${basePath}.next`, `${basePath}.bak`];
}

const truncationPath = (basePath: string) => `${basePath}.truncate.json`;

function isSaneStoredCoordinate(point: any): boolean {
  return Number.isFinite(point?.t)
    && point.t > 0
    && Number.isFinite(point?.lat)
    && point.lat >= -90
    && point.lat <= 90
    && Number.isFinite(point?.lng)
    && point.lng >= -180
    && point.lng <= 180;
}

async function readBestSnapshot(fs: any, basePath: string): Promise<string> {
  let maximumLines: number | null = null;
  try {
    const raw = await fs.readAsStringAsync(truncationPath(basePath));
    const value = Number(JSON.parse(raw)?.maximumLines);
    if (Number.isInteger(value) && value >= 0) maximumLines = value;
  } catch { /* no pending crash-safe truncation */ }
  let best = '';
  let bestLines = -1;
  for (const path of activeCandidates(basePath)) {
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) continue;
      const value = await fs.readAsStringAsync(path);
      const valid: string[] = [];
      for (const line of value.split('\n')) {
        if (!line.trim()) continue;
        try {
          const point = JSON.parse(line);
          if (!isSaneStoredCoordinate(point)) break;
          valid.push(line);
        } catch { break; }
      }
      const bounded = maximumLines === null ? valid : valid.slice(0, maximumLines);
      const validLines = bounded.length;
      if (validLines > bestLines) {
        best = bounded.length > 0 ? `${bounded.join('\n')}\n` : '';
        bestLines = validLines;
      }
    } catch { /* try the next crash-recovery candidate */ }
  }
  return best;
}

/**
 * expo-file-system has no append primitive. This two-snapshot transaction
 * keeps the previous complete journal until the replacement has been written
 * and verified. Recovery accepts active, .next, or .bak after a process death
 * and selects the snapshot containing the most complete valid prefix.
 */
async function appendSnapshot(fs: any, basePath: string, lines: string): Promise<void> {
  const run = durableWriteTail.then(async () => {
    const existing = await readBestSnapshot(fs, basePath);
    const nextPath = `${basePath}.next`;
    const backupPath = `${basePath}.bak`;
    const replacement = existing + lines;
    await fs.writeAsStringAsync(nextPath, replacement);
    const verified = await fs.readAsStringAsync(nextPath);
    if (verified !== replacement) throw new Error('activity_journal_verification_failed');
    try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
    try {
      const current = await fs.getInfoAsync(basePath);
      if (current.exists) await fs.moveAsync({ from: basePath, to: backupPath });
    } catch { /* active may already be in .bak after a prior interrupted commit */ }
    await fs.moveAsync({ from: nextPath, to: basePath });
    try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
    try { await fs.deleteAsync(truncationPath(basePath), { idempotent: true }); } catch {}
  });
  durableWriteTail = run.catch(() => {});
  await run;
}

async function replaceSnapshotWithPrefix(fs: any, basePath: string, replacement: string, maximumLines: number): Promise<void> {
  const run = durableWriteTail.then(async () => {
    const nextPath = `${basePath}.next`;
    const backupPath = `${basePath}.bak`;
    // This cap is committed first. If iOS kills the process during the swap,
    // recovery bounds every old/new candidate to the corrected Activity tail.
    await fs.writeAsStringAsync(truncationPath(basePath), JSON.stringify({ maximumLines }));
    await fs.writeAsStringAsync(nextPath, replacement);
    const verified = await fs.readAsStringAsync(nextPath);
    if (verified !== replacement) throw new Error('activity_journal_truncation_verification_failed');
    try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
    try {
      const current = await fs.getInfoAsync(basePath);
      if (current.exists) await fs.moveAsync({ from: basePath, to: backupPath });
    } catch { /* active may already have moved before a process interruption */ }
    await fs.moveAsync({ from: nextPath, to: basePath });
    try { await fs.deleteAsync(backupPath, { idempotent: true }); } catch {}
    await fs.deleteAsync(truncationPath(basePath), { idempotent: true });
  });
  durableWriteTail = run.catch(() => {});
  await run;
}

/**
 * Start writing a new hike track. Called from useTrackingStore.startTracking.
 * Overwrites any prior state — caller must call renameToCompleted() first
 * if a previous session should be preserved.
 */
export async function startHikeTrack(sessionId: string, meta: Omit<HikeMeta, 'session_id' | 'total_points' | 'uploaded' | 'last_ts'>): Promise<void> {
  const fs = await getFs();
  if (!fs) {
    state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: 'web-no-fs' };
    return;
  }
  await ensureDirs(fs);
  // Truncate every crash-recovery snapshot with the same immutable id.
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  for (const path of activeCandidates(activePath)) {
    try {
      const info = await fs.getInfoAsync(path);
      if (info.exists) await fs.deleteAsync(path, { idempotent: true });
    } catch { /* best effort */ }
  }
  try { await fs.deleteAsync(truncationPath(activePath), { idempotent: true }); } catch {}
  // Write initial meta
  const fullMeta: HikeMeta = {
    session_id: sessionId,
    started_at: meta.started_at,
    activity_mode: meta.activity_mode,
    user_id: meta.user_id,
    owner_generation: meta.owner_generation,
    remote_id: meta.remote_id,
    total_points: 0,
    uploaded: false,
  };
  await fs.writeAsStringAsync(
    fs.documentDirectory + META_DIR + sessionId + '.json',
    JSON.stringify(fullMeta),
  );
  // The empty anchor makes a just-started Activity discoverable even if the
  // process dies before CoreLocation delivers its first acceptable sample.
  await fs.writeAsStringAsync(activePath, '');
  state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: null };
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
    state = { sessionId, buffer: [], totalPoints: 0, lastFlushError: 'web-no-fs' };
    return { resumed: true, totalPoints: 0 };
  }
  // Read existing meta to preserve total_points count
  let existingTotal = 0;
  try {
    const metaRaw = await fs.readAsStringAsync(fs.documentDirectory + META_DIR + sessionId + '.json');
    const meta: HikeMeta = JSON.parse(metaRaw);
    existingTotal = meta.total_points ?? 0;
  } catch { /* meta absent — start fresh count but don't fail */ }
  state = { sessionId, buffer: [], totalPoints: existingTotal, lastFlushError: null };
  return { resumed: true, totalPoints: existingTotal };
}

/**
 * Append one GPS point and return only after its verified journal replacement.
 *
 * NOTE: Only appends if there is an active state (startHikeTrack called).
 * If state is null (e.g. background task fired before session start), the
 * point is dropped here — background task path handles JS-dead case by
 * writing directly via appendDirectlyToHikeTrack.
 */
export function appendHikePoint(point: HikePoint): Promise<void> {
  if (!state || state.sessionId !== point.clientActivityId) return Promise.resolve();
  state.buffer.push(point);
  state.totalPoints++;
  // A foreground point is not accepted by the Activity store until this
  // promise resolves. Flush every accepted point so process death cannot
  // routinely lose a timer-sized tail. The serialized snapshot writer keeps
  // concurrent foreground/background commits from overwriting each other.
  return flushBuffer();
}

// O1 R1: mutex — flushBuffer has multiple callers (point, stop, AppState,
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
    if (s.buffer.length === 0) return;
    const toWrite = s.buffer;
    s.buffer = [];
    const fs = await getFs();
    if (!fs) return;
    const activePath = fs.documentDirectory + ACTIVE_DIR + s.sessionId + '.jsonl';
    const lines = toWrite.map(p => JSON.stringify(p)).join('\n') + '\n';
    try {
      await appendSnapshot(fs, activePath, lines);
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
      throw e;
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
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  // Detect whether a JSONL exists before updating its paired metadata.
  // Initialization failures or legacy zero-point sessions can have only meta.
  let activeExisted = false;
  try {
    await durableWriteTail.catch(() => {});
    const snapshot = await readBestSnapshot(fs, activePath);
    if (snapshot) {
      await fs.writeAsStringAsync(completedPath, snapshot);
      for (const candidate of activeCandidates(activePath)) {
        try { await fs.deleteAsync(candidate, { idempotent: true }); } catch {}
      }
      try { await fs.deleteAsync(truncationPath(activePath), { idempotent: true }); } catch {}
      activeExisted = true;
    }
  } catch { /* best effort */ }
  if (activeExisted) {
    // Update meta with ended_at and remote_id so recovery does not surface it.
    try {
      const metaRaw = await fs.readAsStringAsync(metaPath);
      const meta: HikeMeta = JSON.parse(metaRaw);
      meta.ended_at = endedAt;
      if (remoteId !== undefined) meta.remote_id = remoteId;
      await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
    } catch { /* best effort */ }
  } else {
    // No completed JSONL means meta has no counterpart; delete the orphan.
    try {
      await fs.deleteAsync(metaPath, { idempotent: true });
    } catch { /* best effort */ }
  }
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
    const sessionIds = new Set<string>();
    for (const f of files) {
      const match = f.match(/^(.*)\.jsonl(?:\.next|\.bak)?$/);
      if (match?.[1]) sessionIds.add(match[1]);
    }
    for (const sid of sessionIds) {
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
    await durableWriteTail.catch(() => {});
    const content = await readBestSnapshot(fs, activePath);
    if (!content) return [];
    const lines = content.split('\n');
    const points: HikePoint[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const p = JSON.parse(line);
        // New canonical records are explicit. Valid legacy foreground rows
        // remain recoverable as one legacy segment. Debug/background rows in
        // the incompatible {ts,lon} schema are deliberately not reinterpreted.
        if (!isSaneStoredCoordinate(p)) break;
        if (typeof p.clientActivityId === 'string' && p.clientActivityId !== sessionId) break;
        {
          points.push({
            ...p,
            clientActivityId: typeof p.clientActivityId === 'string' ? p.clientActivityId : sessionId,
            ownerGeneration: typeof p.ownerGeneration === 'string' ? p.ownerGeneration : 'legacy',
            segmentId: typeof p.segmentId === 'string' ? p.segmentId : 'legacy-0',
            ...(typeof p.segmentStartReason === 'string'
              ? { segmentStartReason: p.segmentStartReason }
              : points.length === 0 ? { segmentStartReason: 'legacy' as const } : {}),
          });
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
 * buffer and a delayed flush. The flush could recreate the JSONL after
 * deletion. The writer now commits immediately, but invalidating state and
 * waiting for the in-flight write remains necessary before deleting disk.
 */
export async function discardActiveHike(sessionId: string): Promise<void> {
  // (1) invalidate the module state so any queued flushBuffer becomes a no-op
  if (state && state.sessionId === sessionId) {
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
  await durableWriteTail.catch(() => {});
  for (const candidate of activeCandidates(activePath)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
  await deleteAndVerifyAbsent(fs, truncationPath(activePath));
  await deleteAndVerifyAbsent(fs, metaPath);
}

/**
 * Force flush now — used before app suspension / stopTracking.
 */
export async function flushNow(): Promise<void> {
  await flushBuffer();
}

/**
 * Internal-QA Activity tail correction. The crash marker is written before
 * the verified snapshot swap, so recovery can never select the longer
 * pre-correction `.bak` merely because it contains more valid lines.
 */
export async function truncateActiveHikeTrack(sessionId: string, points: HikePoint[]): Promise<void> {
  if (!state || state.sessionId !== sessionId) throw new Error('activity_journal_not_active');
  await flushBuffer();
  const fs = await getFs();
  if (!fs) {
    state.totalPoints = points.length;
    state.buffer = [];
    return;
  }
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  const replacement = points.length > 0
    ? `${points.map(point => JSON.stringify(point)).join('\n')}\n`
    : '';
  await replaceSnapshotWithPrefix(fs, activePath, replacement, points.length);
  state.totalPoints = points.length;
  state.buffer = [];
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  try {
    const metaRaw = await fs.readAsStringAsync(metaPath);
    const meta: HikeMeta = JSON.parse(metaRaw);
    meta.total_points = points.length;
    meta.last_ts = points[points.length - 1]?.t;
    await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
  } catch {
    // The verified journal is the route authority. A stale advisory count must
    // never turn a successfully committed tail correction into a false failure.
  }
}

/** Persist a late server mapping without changing the client identity. */
export async function updateHikeMeta(
  sessionId: string,
  patch: Partial<Pick<HikeMeta, 'remote_id' | 'owner_generation' | 'user_id'>>,
): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  const path = fs.documentDirectory + META_DIR + sessionId + '.json';
  try {
    const raw = await fs.readAsStringAsync(path);
    await fs.writeAsStringAsync(path, JSON.stringify({ ...JSON.parse(raw), ...patch }));
  } catch { /* recovery remains local even if mapping persistence fails */ }
}

/** Per-Activity heavy-data cleanup after durable server handoff. */
export async function deleteCompletedHikeTrack(sessionId: string): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  await flushChainTail.catch(() => {});
  await deleteAndVerifyAbsent(fs, fs.documentDirectory + COMPLETED_DIR + sessionId + '.jsonl');
  await deleteAndVerifyAbsent(fs, fs.documentDirectory + META_DIR + sessionId + '.json');
}

async function deleteAndVerifyAbsent(fs: any, path: string): Promise<void> {
  await fs.deleteAsync(path, { idempotent: true });
  if ((await fs.getInfoAsync(path)).exists) throw new Error('activity_journal_cleanup_incomplete');
}

/**
 * Prove ownership once before a multi-location cleanup removes the meta file.
 * A missing meta is acceptable only when no Activity journal artifact exists.
 */
export async function assertHikeTrackCleanupOwner(sessionId: string, expectedUserId: string): Promise<void> {
  if (!expectedUserId || expectedUserId === 'guest') throw new Error('activity_journal_owner_required');
  const fs = await getFs();
  if (!fs) return;
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  const completedPath = fs.documentDirectory + COMPLETED_DIR + sessionId + '.jsonl';
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  const artifactPaths = [...activeCandidates(activePath), truncationPath(activePath), completedPath, metaPath];
  const infos = await Promise.all(artifactPaths.map(path => fs.getInfoAsync(path)));
  if (!infos.some(info => info.exists)) return;
  const metaInfo = infos[infos.length - 1];
  if (!metaInfo.exists) throw new Error('activity_journal_owner_unavailable');
  const meta = JSON.parse(await fs.readAsStringAsync(metaPath)) as HikeMeta;
  if (String(meta.user_id ?? '') !== String(expectedUserId)) {
    throw new Error('activity_journal_owner_mismatch');
  }
}

/**
 * ACK cleanup for every heavy Activity-journal location. Ownership metadata
 * is deliberately removed last so a crash/failure after either trace delete
 * can be retried safely on the next launch.
 */
export async function deleteAcknowledgedHikeTrackArtifacts(
  sessionId: string,
  expectedUserId: string,
): Promise<void> {
  if (state && state.sessionId === sessionId) {
    state.buffer = [];
    state = null;
  }
  await flushChainTail.catch(() => {});
  await durableWriteTail.catch(() => {});
  await assertHikeTrackCleanupOwner(sessionId, expectedUserId);
  const fs = await getFs();
  if (!fs) return;
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  for (const candidate of activeCandidates(activePath)) {
    await deleteAndVerifyAbsent(fs, candidate);
  }
  await deleteAndVerifyAbsent(fs, truncationPath(activePath));
  await deleteAndVerifyAbsent(fs, fs.documentDirectory + COMPLETED_DIR + sessionId + '.jsonl');
  await deleteAndVerifyAbsent(fs, fs.documentDirectory + META_DIR + sessionId + '.json');
}

/** Canonical durable entry point used by the headless background task. */
export async function appendBackgroundHikePoints(points: HikePoint[], expectedUserId?: string): Promise<void> {
  if (points.length === 0) return;
  const sessionId = points[0].clientActivityId;
  if (!sessionId || points.some(point => point.clientActivityId !== sessionId)) {
    throw new Error('mixed_activity_background_batch');
  }
  const fs = await getFs();
  if (!fs) return;
  await ensureDirs(fs);
  const metaPath = fs.documentDirectory + META_DIR + sessionId + '.json';
  const meta = JSON.parse(await fs.readAsStringAsync(metaPath)) as HikeMeta;
  if (meta.ended_at) throw new Error('background_activity_already_finalized');
  if (expectedUserId && meta.user_id && meta.user_id !== expectedUserId) {
    throw new Error('stale_background_user');
  }
  if (meta.owner_generation && points.some(point => point.ownerGeneration !== meta.owner_generation)) {
    throw new Error('stale_background_owner_generation');
  }
  const activePath = fs.documentDirectory + ACTIVE_DIR + sessionId + '.jsonl';
  const lines = points.map(point => JSON.stringify(point)).join('\n') + '\n';
  await appendSnapshot(fs, activePath, lines);
  meta.total_points = (meta.total_points ?? 0) + points.length;
  meta.last_ts = points[points.length - 1].t;
  await fs.writeAsStringAsync(metaPath, JSON.stringify(meta));
}
