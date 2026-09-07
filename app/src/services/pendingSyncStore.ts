/**
 * pendingSyncStore — v412 已 Save 未同步的 hike 持久化
 *
 * 目的:
 *   用户点了 Save 但网络挂了 → 完整 payload (含 raw + snapped + memory) 写磁盘
 *   →  App 冷启 / 网络恢复 → SyncDaemon 自动扫这里, 重试上传, 直到:
 *     - 服务器 200 成功 → removePending
 *     - 用户长按灰卡放弃 → removePending
 *
 * 契约 (v412 design §0.9 铁律 28-35):
 *   - 已点 Save 数据永远不丢, 直到成功 or 用户明确放弃
 *   - 不受 72h 兜底影响 (unfinished backup 才 72h)
 *   - 每 hike 一个文件, 避免并发写冲突
 *
 * 文件布局:
 *   {docDir}/cairn-pending-sync/
 *     └── {localId}.json
 *
 * Web fallback: expo-file-system 在 web 无 documentDirectory → localStorage shim
 * (复用 hikeTrackWriter 相同 pattern)
 */

const PENDING_DIR = 'cairn-pending-sync/';

// O1 batch 28: 每个 mutation 打 breadcrumb,便于诊断 Home page 假 pending
// sync banner + save&end 后错误弹 "上次未完成" 两个 bug 的时机问题。
// 不影响正常路径,只加可观测性。用 lazy-require 避免 circular dep。
function breadcrumb(msg: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cl = require('./crashLogger');
    (cl.crashLogger ?? cl.default)?.breadcrumb?.(msg);
  } catch {/* silent */}
}

export interface PendingHike {
  contractVersion?: 2 | 3;
  localId: string;                 // uuid, hike 结束时生成
  userId: string;                  // 归属用户
  remoteId: number | null;         // 若 hike 开始时也离线, POST /sessions/start 未成 → null
  idempotencyKey: string;          // v4 uuid, 首次生成后不变, retry 用同一个
  // v412 blocker 1 修 (subagent 视角B): 必须存 activityMode, syncDaemon 用它 startSession
  // 而非硬编码 'hiking'. 否则 running 离线 save 变成 hiking session.
  activityMode: 'hiking' | 'running';
  /** Original Activity start time. Added after v412; legacy rows fall back
   * to the first route point/createdAt during reconciliation. */
  startedAt?: number;
  payload: {
    end_time: string;              // ISO 8601
    distance_m: number;
    duration_s: number;
    name: string;
    route_points: Array<{
      lat: number;
      lng: number;
      t: number;
      segment_id?: string;
      segment_start_reason?: PendingSegmentStartReason;
    }>;
    route_points_raw: Array<{
      lat: number;
      lng: number;
      t: number;
      acc?: number | null;
      alt?: number | null;
      segment_id?: string;
      segment_start_reason?: PendingSegmentStartReason;
    }>;
    memory_points: Array<{ lat: number; lng: number; ts: number; cid?: string }>;
  };
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
  /** Complete local Detail projection committed with the sync payload. */
  summary?: {
    startedAt: number;
    endedAt: number;
    distanceM: number;
    durationS: number;
    elevationGainM: number;
    name: string;
    markerIds: string[];
  };
}

type PendingSegmentStartReason = 'start' | 'resume' | 'process-recovery' | 'gps-reacquired' | 'legacy';
const SEGMENT_START_REASONS = new Set<PendingSegmentStartReason>([
  'start', 'resume', 'process-recovery', 'gps-reacquired', 'legacy',
]);

/**
 * 复用 hikeTrackWriter 的 getFs pattern (native = expo-file-system/legacy, web = localStorage shim).
 * 不 import hikeTrackWriter 是为了让 v412 模块独立可 test。
 */
async function getFs(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imported = require('expo-file-system/legacy');
    const legacy = imported?.documentDirectory ? imported : imported?.default;
    if (legacy?.documentDirectory) return legacy;
  } catch {
    /* fallthrough to web shim */
  }
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    const PREFIX = 'cairn-fs://';
    const docDir = PREFIX;
    return {
      documentDirectory: docDir,
      async getInfoAsync(path: string) {
        const raw = window.localStorage.getItem(path);
        if (path.endsWith('/')) {
          const dirEntry = window.localStorage.getItem(path + '__dir__');
          return { exists: !!dirEntry, isDirectory: true, uri: path };
        }
        return { exists: raw !== null, isDirectory: false, uri: path, size: raw ? raw.length : 0 };
      },
      async makeDirectoryAsync(path: string) {
        if (!path.endsWith('/')) path = path + '/';
        window.localStorage.setItem(path + '__dir__', '1');
      },
      async writeAsStringAsync(path: string, content: string) {
        window.localStorage.setItem(path, content);
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
      async readAsStringAsync(path: string) {
        const raw = window.localStorage.getItem(path);
        if (raw === null) throw new Error(`File not found: ${path}`);
        return raw;
      },
      async deleteAsync(path: string, opts?: { idempotent?: boolean }) {
        const existed = window.localStorage.getItem(path) !== null;
        window.localStorage.removeItem(path);
        if (existed) {
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
        }
        if (!existed && !opts?.idempotent) throw new Error(`File not found: ${path}`);
      },
      async readDirectoryAsync(path: string) {
        if (!path.endsWith('/')) path = path + '/';
        const listKey = path + '__files__';
        const raw = window.localStorage.getItem(listKey);
        return raw ? JSON.parse(raw) : [];
      },
      async moveAsync(opts: { from: string; to: string }) {
        const raw = window.localStorage.getItem(opts.from);
        if (raw === null) throw new Error(`File not found: ${opts.from}`);
        await this.writeAsStringAsync(opts.to, raw);
        await this.deleteAsync(opts.from);
      },
    };
  }
  return null;
}

async function ensureDir(fs: any) {
  const path = fs.documentDirectory + PENDING_DIR;
  const info = await fs.getInfoAsync(path);
  if (!info.exists) {
    await fs.makeDirectoryAsync(path, { intermediates: true });
  }
}

interface PendingEnvelope {
  format: 'cairn-pending-activity';
  version: 3;
  generation: number;
  checksum: string;
  payload: PendingHike;
}

let mutationTail: Promise<void> = Promise.resolve();
async function withMutation<T>(operation: () => Promise<T>): Promise<T> {
  const prior = mutationTail.catch(() => undefined);
  let release: () => void = () => undefined;
  mutationTail = new Promise<void>((resolve) => { release = resolve; });
  await prior;
  try { return await operation(); } finally { release(); }
}

function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function isValidPending(hike: any): hike is PendingHike {
  const validPoint = (point: any): boolean => !!point
    && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    && Number.isFinite(point.t) && point.t > 0
    && (point.segment_id == null || (
      typeof point.segment_id === 'string'
      && point.segment_id.length >= 1
      && point.segment_id.length <= 80
    ))
    && (point.segment_start_reason == null || SEGMENT_START_REASONS.has(point.segment_start_reason));
  const validMemoryPoint = (point: any): boolean => !!point
    && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90
    && Number.isFinite(point.lng) && point.lng >= -180 && point.lng <= 180
    && Number.isFinite(point.ts) && point.ts > 0;
  const validSummary = (summary: any): boolean => summary == null || (
    Number.isFinite(summary.startedAt)
    && Number.isFinite(summary.endedAt)
    && summary.endedAt >= summary.startedAt
    && Number.isFinite(summary.distanceM) && summary.distanceM >= 0
    && Number.isFinite(summary.durationS) && summary.durationS >= 0
    && Number.isFinite(summary.elevationGainM)
    && typeof summary.name === 'string'
    && Array.isArray(summary.markerIds)
    && summary.markerIds.every((id: any) => typeof id === 'string')
  );
  return !!hike
    && typeof hike.localId === 'string'
    && typeof hike.userId === 'string'
    && typeof hike.idempotencyKey === 'string'
    && (hike.activityMode === 'hiking' || hike.activityMode === 'running')
    && !!hike.payload
    && Array.isArray(hike.payload.route_points)
    && hike.payload.route_points.every(validPoint)
    && Array.isArray(hike.payload.route_points_raw)
    && hike.payload.route_points_raw.every(validPoint)
    && Array.isArray(hike.payload.memory_points)
    && hike.payload.memory_points.every(validMemoryPoint)
    && validSummary(hike.summary);
}

function candidatePaths(basePath: string): string[] {
  return [basePath, `${basePath}.next`, `${basePath}.bak`];
}

async function readCandidate(fs: any, path: string): Promise<{ hike: PendingHike; generation: number } | null> {
  const info = await fs.getInfoAsync(path);
  if (!info.exists) return null;
  const raw = await fs.readAsStringAsync(path);
  const parsed = JSON.parse(raw);
  if (parsed?.format === 'cairn-pending-activity' && parsed?.version === 3) {
    const envelope = parsed as PendingEnvelope;
    const encodedPayload = JSON.stringify(envelope.payload);
    if (!Number.isSafeInteger(envelope.generation) || envelope.generation < 1) return null;
    if (envelope.checksum !== checksum(encodedPayload) || !isValidPending(envelope.payload)) return null;
    return { hike: envelope.payload, generation: envelope.generation };
  }
  // Backward-compatible v2/plain payload. It is promoted to a verified v3
  // snapshot on its first mutation/list reconciliation.
  return isValidPending(parsed) ? { hike: parsed, generation: 0 } : null;
}

async function readBest(fs: any, basePath: string): Promise<{ hike: PendingHike; generation: number } | null> {
  let best: { hike: PendingHike; generation: number } | null = null;
  let anyCandidate = false;
  for (const path of candidatePaths(basePath)) {
    try {
      const info = await fs.getInfoAsync(path);
      if (!info.exists) continue;
      anyCandidate = true;
      const candidate = await readCandidate(fs, path);
      if (candidate && (!best || candidate.generation > best.generation)) best = candidate;
    } catch { /* another valid generation may still exist */ }
  }
  if (!best && anyCandidate) throw new Error(`pending_activity_corrupt:${basePath}`);
  return best;
}

async function writeVerified(fs: any, basePath: string, hike: PendingHike, generation: number): Promise<void> {
  const payload = { ...hike, contractVersion: 3 as const };
  const encodedPayload = JSON.stringify(payload);
  const encodedEnvelope = JSON.stringify({
    format: 'cairn-pending-activity',
    version: 3,
    generation,
    checksum: checksum(encodedPayload),
    payload,
  } satisfies PendingEnvelope);
  const nextPath = `${basePath}.next`;
  const backupPath = `${basePath}.bak`;
  await fs.writeAsStringAsync(nextPath, encodedEnvelope);
  const staged = await readCandidate(fs, nextPath);
  if (!staged || staged.generation !== generation) throw new Error('pending_activity_stage_verify_failed');
  await fs.deleteAsync(backupPath, { idempotent: true });
  const current = await fs.getInfoAsync(basePath);
  if (current.exists) await fs.moveAsync({ from: basePath, to: backupPath });
  await fs.moveAsync({ from: nextPath, to: basePath });
  const committed = await readCandidate(fs, basePath);
  if (!committed || committed.generation !== generation) throw new Error('pending_activity_commit_verify_failed');
  await fs.deleteAsync(backupPath, { idempotent: true });
}

function basePathFor(fs: any, localId: string): string {
  return fs.documentDirectory + PENDING_DIR + localId + '.json';
}

export async function savePending(hike: PendingHike): Promise<void> {
  if (!isValidPending(hike)) throw new Error('pending_activity_invalid');
  await withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('pending_activity_storage_unavailable');
    await ensureDir(fs);
    const basePath = basePathFor(fs, hike.localId);
    const prior = await readBest(fs, basePath);
    const merged = !hike.summary && prior?.hike.summary
      ? { ...hike, summary: prior.hike.summary }
      : hike;
    await writeVerified(fs, basePath, merged, (prior?.generation ?? 0) + 1);
  });
  breadcrumb(`pendingSync:save localId=${hike.localId} remoteId=${hike.remoteId ?? 'null'} pts=${hike.payload?.route_points?.length ?? 0}`);
}

export async function listPending(): Promise<PendingHike[]> {
  return withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('pending_activity_storage_unavailable');
    await ensureDir(fs);
    const dir = fs.documentDirectory + PENDING_DIR;
    const filenames: string[] = await fs.readDirectoryAsync(dir);
    const localIds = new Set<string>();
    for (const filename of filenames) {
      const match = filename.match(/^(.*)\.json(?:\.next|\.bak)?$/);
      if (match?.[1]) localIds.add(match[1]);
    }
    const hikes: PendingHike[] = [];
    for (const localId of localIds) {
      const basePath = basePathFor(fs, localId);
      const best = await readBest(fs, basePath);
      if (!best) continue;
      let hike = best.hike;
      if (best.generation === 0 || hike.contractVersion !== 3) {
        if (hike.contractVersion !== 2) {
          // A pre-client-identity request may have received a legacy cached ACK.
          // Rotate once while promoting; all later retries retain this identity.
          const rand = (n: number) => Math.random().toString(16).slice(2, 2 + n).padEnd(n, '0');
          hike = { ...hike, idempotencyKey: `${rand(8)}-${rand(4)}-4${rand(3)}-8${rand(3)}-${rand(12)}` };
        }
        await writeVerified(fs, basePath, hike, Math.max(1, best.generation + 1));
        hike = { ...hike, contractVersion: 3 };
      }
      hikes.push(hike);
    }
    hikes.sort((a, b) => a.createdAt - b.createdAt);
    breadcrumb(`pendingSync:list count=${hikes.length}${hikes.length > 0 ? ' localIds=' + hikes.map(h => h.localId.slice(0, 8)).join(',') : ''}`);
    return hikes;
  });
}

export async function removePending(localId: string, expectedUserId: string): Promise<void> {
  if (!expectedUserId || expectedUserId === 'guest') throw new Error('pending_activity_owner_required');
  await withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('pending_activity_storage_unavailable');
    const basePath = basePathFor(fs, localId);
    const current = await readBest(fs, basePath);
    if (current && String(current.hike.userId) !== String(expectedUserId)) {
      throw new Error('pending_activity_owner_mismatch');
    }
    for (const path of candidatePaths(basePath)) await fs.deleteAsync(path, { idempotent: true });
    for (const path of candidatePaths(basePath)) {
      if ((await fs.getInfoAsync(path)).exists) throw new Error('pending_activity_cleanup_incomplete');
    }
  });
  breadcrumb(`pendingSync:remove localId=${localId} owner=${expectedUserId}`);
}

async function mutatePending(localId: string, mutation: (hike: PendingHike) => void): Promise<void> {
  await withMutation(async () => {
    const fs = await getFs();
    if (!fs) throw new Error('pending_activity_storage_unavailable');
    const basePath = basePathFor(fs, localId);
    const current = await readBest(fs, basePath);
    if (!current) throw new Error('pending_activity_missing');
    const next = { ...current.hike };
    mutation(next);
    await writeVerified(fs, basePath, next, current.generation + 1);
  });
}

export async function markAttempt(localId: string): Promise<void> {
  let attempts = 0;
  await mutatePending(localId, (hike) => {
    hike.lastAttemptAt = Date.now();
    hike.attemptCount = (hike.attemptCount || 0) + 1;
    attempts = hike.attemptCount;
  });
  breadcrumb(`pendingSync:attempt localId=${localId} n=${attempts}`);
}

export async function updateRemoteId(localId: string, remoteId: number | null): Promise<void> {
  await mutatePending(localId, (hike) => { hike.remoteId = remoteId; });
  breadcrumb(`pendingSync:updateRemoteId localId=${localId} remoteId=${remoteId ?? 'null'}`);
}

/**
 * R96 修补 A.5 (B1 review): 原子重置 pending 为"未开始 remote"状态。
 * 用在 SESSION_NOT_FOUND_RESYNC 场景:remoteId 是死指针,需要清 null
 * 让下次 drain 重新 startSession + saveHikeAtomic。**同时必须换新
 * idempotencyKey** —— idempotency middleware 用 sha256(userId:opId)
 * 作 cache key,老 key 会命中之前的"404 replay",resync 永远回不了 200。
 * 新 key 让 middleware 认为是全新请求。
 *
 * 返回 true 表示成功清空 + 新 key 已落盘;false 表示 fs 失败,caller
 * 要跳过本轮避免 markAttempt 无脑累加。
 */
export async function resetForResync(localId: string): Promise<boolean> {
  try {
    let newKey = '';
    await mutatePending(localId, (hike) => {
      hike.remoteId = null;
      const rand = (n: number) => Math.random().toString(16).slice(2, 2 + n).padEnd(n, '0');
      newKey = `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`;
      hike.idempotencyKey = newKey;
    });
    breadcrumb(`pendingSync:resetForResync localId=${localId} newKey=${newKey.slice(0, 8)}`);
    return true;
  } catch {
    return false;
  }
}
