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
  localId: string;                 // uuid, hike 结束时生成
  userId: string;                  // 归属用户
  remoteId: number | null;         // 若 hike 开始时也离线, POST /sessions/start 未成 → null
  idempotencyKey: string;          // v4 uuid, 首次生成后不变, retry 用同一个
  // v412 blocker 1 修 (subagent 视角B): 必须存 activityMode, syncDaemon 用它 startSession
  // 而非硬编码 'hiking'. 否则 running 离线 save 变成 hiking session.
  activityMode: 'hiking' | 'running';
  payload: {
    end_time: string;              // ISO 8601
    distance_m: number;
    duration_s: number;
    name: string;
    route_points: Array<{ lat: number; lng: number; t: number }>;
    route_points_raw: Array<{ lat: number; lng: number; t: number; acc?: number | null }>;
    memory_points: Array<{ lat: number; lng: number; ts: number }>;
  };
  createdAt: number;
  lastAttemptAt: number | null;
  attemptCount: number;
}

/**
 * 复用 hikeTrackWriter 的 getFs pattern (native = expo-file-system/legacy, web = localStorage shim).
 * 不 import hikeTrackWriter 是为了让 v412 模块独立可 test。
 */
async function getFs(): Promise<any | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy = await import('expo-file-system/legacy');
    if (legacy && legacy.documentDirectory) return legacy;
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

export async function savePending(hike: PendingHike): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  await ensureDir(fs);
  const path = fs.documentDirectory + PENDING_DIR + hike.localId + '.json';
  await fs.writeAsStringAsync(path, JSON.stringify(hike));
  breadcrumb(`pendingSync:save localId=${hike.localId} remoteId=${hike.remoteId ?? 'null'} pts=${hike.payload?.route_points?.length ?? 0}`);
}

export async function listPending(): Promise<PendingHike[]> {
  const fs = await getFs();
  if (!fs) return [];
  await ensureDir(fs);
  const dir = fs.documentDirectory + PENDING_DIR;
  const filenames: string[] = await fs.readDirectoryAsync(dir);
  const hikes: PendingHike[] = [];
  for (const fn of filenames) {
    if (!fn.endsWith('.json')) continue;
    try {
      const raw = await fs.readAsStringAsync(dir + fn);
      const hike = JSON.parse(raw) as PendingHike;
      // basic sanity check
      if (hike && typeof hike.localId === 'string' && hike.payload) {
        hikes.push(hike);
      }
    } catch {
      /* skip malformed */
    }
  }
  // 按 createdAt 升序: 老的先重试
  hikes.sort((a, b) => a.createdAt - b.createdAt);
  breadcrumb(`pendingSync:list count=${hikes.length}${hikes.length > 0 ? ' localIds=' + hikes.map(h => h.localId.slice(0, 8)).join(',') : ''}`);
  return hikes;
}

export async function removePending(localId: string): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  const path = fs.documentDirectory + PENDING_DIR + localId + '.json';
  try {
    await fs.deleteAsync(path, { idempotent: true });
    breadcrumb(`pendingSync:remove localId=${localId}`);
  } catch {
    /* file might not exist; that's fine */
  }
}

export async function markAttempt(localId: string): Promise<void> {
  const fs = await getFs();
  if (!fs) return;
  const path = fs.documentDirectory + PENDING_DIR + localId + '.json';
  try {
    const raw = await fs.readAsStringAsync(path);
    const hike = JSON.parse(raw) as PendingHike;
    hike.lastAttemptAt = Date.now();
    hike.attemptCount = (hike.attemptCount || 0) + 1;
    await fs.writeAsStringAsync(path, JSON.stringify(hike));
    breadcrumb(`pendingSync:attempt localId=${localId} n=${hike.attemptCount}`);
  } catch {
    /* silent — race with removePending is OK */
  }
}

export async function updateRemoteId(localId: string, remoteId: number | null): Promise<void> {
  // R96 修补 A.3: 允许 remoteId = null。原签名只接受 number 用于"补 remoteId
  // (原本 null 现在有了)"; 现在也用于"清 remoteId" —— syncDaemon 拿到
  // SESSION_NOT_FOUND_RESYNC 后调 updateRemoteId(id, null) 让 pending 走
  // startSession + saveHikeAtomic 重传路径,避免死指针无限 404。
  const fs = await getFs();
  if (!fs) return;
  const path = fs.documentDirectory + PENDING_DIR + localId + '.json';
  try {
    const raw = await fs.readAsStringAsync(path);
    const hike = JSON.parse(raw) as PendingHike;
    hike.remoteId = remoteId;
    await fs.writeAsStringAsync(path, JSON.stringify(hike));
    breadcrumb(`pendingSync:updateRemoteId localId=${localId} remoteId=${remoteId ?? 'null'}`);
  } catch {
    /* silent */
  }
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
  const fs = await getFs();
  if (!fs) return false;
  const path = fs.documentDirectory + PENDING_DIR + localId + '.json';
  try {
    const raw = await fs.readAsStringAsync(path);
    const hike = JSON.parse(raw) as PendingHike;
    hike.remoteId = null;
    // 生成新 idempotency key (UUID v4 简化实现:32 hex + 4 dash)
    // 不引 uuid 包避免 bundle 增大;crypto.randomUUID 在 hermes/RN 上不一定有,
    // 退回到 Math.random 拼接(碰撞几率 ~2^-100,可接受)。
    const rand = (n: number) => Math.random().toString(16).slice(2, 2 + n).padEnd(n, '0');
    hike.idempotencyKey = `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`;
    await fs.writeAsStringAsync(path, JSON.stringify(hike));
    breadcrumb(`pendingSync:resetForResync localId=${localId} newKey=${hike.idempotencyKey.slice(0, 8)}`);
    return true;
  } catch {
    return false;
  }
}
