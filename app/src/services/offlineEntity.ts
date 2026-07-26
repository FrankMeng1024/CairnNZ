/**
 * offlineEntity — v422 offline-first framework.
 *
 * 抽象 "本地 kv + placeholder + 有网补齐" 模式。
 *
 * 4 类功能分类:
 *   A. 及时反馈类 (Like/Report) — 前端立即变,后端异步补
 *   B. 数据落地类 (Hike/Marker) — 站在地点创造数据,必须存
 *   C. 跟随宿主类 (Memory) — 跟着 session payload 走,无独立离线状态
 *   D. 纯在线类 (Edit/Delete/Route/Auth) — 无网禁用 + 提示
 *
 * 这个工厂只服务 A + B 两类。C 类跟宿主走,D 类用 useOnlineOnly hook。
 *
 * 存储契约:
 *   - 每个 entity 一个 AsyncStorage key (storageKey)
 *   - value = OfflineEntry<T>[] (数组队列)
 *   - localId = 前端 uuid, 作为 idempotency key 传给后端
 *
 * 生命周期:
 *   1. saveLocal(data) → 存本地, 返回 { localId, syncState: 'pending' }
 *   2. 前端立即用本地数据渲染 placeholder + SyncBadge
 *   3. drain() 有网时逐条调 syncToServer(local)
 *   4. 服务器成功 → onSyncSuccess(localId, server) → 前端 replaceLocalWithServer
 *   5. 4xx (非 401) 硬失败 → onSyncFailure(localId, err) → 前端可回滚
 *   6. 5xx / 网络失败 → 保留, exponential backoff, 等下次 drain
 *
 * 与已有 offlineQueue 的关系:
 *   - offlineQueue 是"HTTP 请求队列",存的是 { path, method, body }
 *   - offlineEntity 是"业务实体队列",存的是业务数据本身 + 前端能查询/渲染
 *   - marker_create 从 offlineQueue 迁到 offlineEntity 后, 前端能直接 listPending()
 *     渲染出"本地未同步"的 marker 卡片, 加 SyncBadge
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { crashLogger } from './crashLogger';
import networkMonitor from './networkMonitor';

const MAX_ATTEMPTS = 8;

export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed';

interface OfflineEntry<T> {
  /** 前端生成 uuid, 也作为后端 idempotency key */
  localId: string;
  /** 业务数据本身 */
  data: T;
  savedAt: number;
  syncState: SyncState;
  attempts: number;
  lastTriedAt?: number;
  lastError?: string;
}

interface OfflineEntityConfig<T, Server> {
  /** 类型标识, 用于 log */
  kind: string;
  /**
   * AsyncStorage key. 可以是固定字符串, 或返回 string 的 function (支持 per-user key).
   * v423 B3 fix: marker/session queue 应该分 userId, 否则 logout/login 后前用户
   * 的 pending 会被新用户 auth token 上传, 归属错误.
   */
  storageKey: string | (() => string);
  /**
   * 有网时如何调后端。抛异常会被 catch 走失败分支。
   * 返回值传给 onSyncSuccess。
   */
  syncToServer: (localData: T, localId: string) => Promise<Server>;
  /**
   * 服务器成功后调用, 让 store 把本地 placeholder 替换成真实体。
   * 同时传 data 让 store 能 reconcile 到具体业务对象 (如 A 类 vote 找 markerId)。
   */
  onSyncSuccess?: (localId: string, server: Server, data: T) => void;
  /**
   * 硬失败 (4xx 非 401 表示后端拒了 payload) 时调用。
   * data 传回让 store 决定回滚哪个前端乐观 UI (如 A 类 vote 找到 markerId 撤回 +1)。
   */
  onSyncFailure?: (localId: string, error: any, data: T) => void;
  /**
   * 是否被视为 "auth 错" 需暂停 drain。默认判 401。
   */
  isAuthError?: (error: any) => boolean;
}

interface OfflineEntity<T> {
  /** 存一条到本地, 立即返回 localId。前端可用 localId 立即渲染 placeholder。 */
  saveLocal: (data: T) => Promise<{ localId: string; savedAt: number }>;
  /** 列出所有本地未同步 (pending/syncing/failed) 的项。 */
  listPending: () => Promise<OfflineEntry<T>[]>;
  /** 主动触发 drain。networkMonitor + AppState 自动触发, 用户也可 pull-to-refresh。 */
  drain: () => Promise<{ synced: number; failed: number; remaining: number }>;
  /** 用户"放弃"某条 (硬失败后)。删本地条目。 */
  discard: (localId: string) => Promise<void>;
  /** 订阅本 entity 队列变化 (UI 更新 SyncBadge)。 */
  subscribe: (cb: (entries: OfflineEntry<T>[]) => void) => () => void;
  /** 单条状态读 (UI 单卡片用)。 */
  getEntry: (localId: string) => Promise<OfflineEntry<T> | null>;
}

/**
 * UUID v4 (无 crypto dep, 与 offlineQueue.uuidv4 保持一致)。
 */
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 全局 entity 注册表 —— syncDaemon 遍历所有已注册 entity 逐个 drain。
 */
const registry: Set<{ kind: string; drain: () => Promise<any> }> = new Set();

/**
 * 网络恢复 + 前台返回时,drain 所有已注册 entity。
 * 幂等: 多次调用只跑一次串行,pendingSignal 保证跑完立即再跑。
 */
let daemonWired = false;
let daemonRunning = false;
let daemonPendingSignal = false;

async function drainAllEntities(): Promise<void> {
  if (daemonRunning) {
    daemonPendingSignal = true;
    return;
  }
  daemonRunning = true;
  try {
    do {
      daemonPendingSignal = false;
      for (const entity of registry) {
        try {
          await entity.drain();
        } catch (err) {
          crashLogger.breadcrumb(`offlineEntity:daemon:entity_error kind=${entity.kind} err=${String(err).slice(0, 60)}`);
        }
      }
    } while (daemonPendingSignal);
  } finally {
    daemonRunning = false;
  }
}

function wireDaemonOnce(): void {
  if (daemonWired) return;
  daemonWired = true;
  networkMonitor.onChange((s) => {
    if (s.state === 'online') {
      drainAllEntities().catch(() => {});
    }
  });
  AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') {
      drainAllEntities().catch(() => {});
    }
  });
}

export function createOfflineEntity<T, Server = unknown>(
  config: OfflineEntityConfig<T, Server>,
): OfflineEntity<T> {
  wireDaemonOnce();

  const { kind, syncToServer, onSyncSuccess, onSyncFailure } = config;
  const resolveKey = (): string =>
    typeof config.storageKey === 'function' ? config.storageKey() : config.storageKey;
  const isAuthError = config.isAuthError ?? ((err: any) => err?.status === 401 || err === 401);

  const listeners: Array<(entries: OfflineEntry<T>[]) => void> = [];
  let draining = false;
  // v423 C2 fix: read-modify-write mutex 序列化 saveLocal / drain 内部所有的
  // "读→改→写"块. 之前 drain 慢 (30s timeout) 期间用户 plant, saveLocal read
  // 到磁盘老快照 push 新 entry write; drain 结束 write(remaining) 用 drain
  // 开头 read 的 remaining 覆盖磁盘, 抹掉了 saveLocal 期间新增的 entry.
  let writeLock: Promise<void> = Promise.resolve();
  async function withLock<R>(fn: () => Promise<R>): Promise<R> {
    const prev = writeLock;
    let release: () => void = () => {};
    writeLock = new Promise<void>((r) => { release = r; });
    try {
      await prev;
      return await fn();
    } finally {
      release();
    }
  }

  async function read(): Promise<OfflineEntry<T>[]> {
    const key = resolveKey();
    // v423 B3 fix: 若 storageKey resolver 返回 empty (userId 未 hydrate),
    // 不读磁盘 (避免读到 'undefined' 后缀的错误 key).
    if (!key || key.endsWith(':')) return [];
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function write(entries: OfflineEntry<T>[]): Promise<void> {
    const key = resolveKey();
    if (!key || key.endsWith(':')) {
      // v423 B1 fix: 无有效 storageKey (未 hydrate) → 抛异常让上层知道
      // saveLocal 失败, 而不是静默丢. addMarker 会 catch 并回滚 UI.
      throw new Error('storage_key_unavailable');
    }
    try {
      await AsyncStorage.setItem(key, JSON.stringify(entries));
    } catch (err) {
      crashLogger.breadcrumb(`offlineEntity:write_failed kind=${kind} err=${String(err).slice(0, 60)}`);
      // v423 B1 fix: 写盘失败 rethrow, 上层能感知. 之前静默 breadcrumb + emit
      // 会造成 saveLocal 假成功, marker 只存内存不进队列, 重启就丢.
      throw err;
    }
    emit(entries);
  }

  function emit(entries: OfflineEntry<T>[]): void {
    for (const l of listeners) {
      try { l(entries); } catch { /* ignore */ }
    }
  }

  async function saveLocal(data: T): Promise<{ localId: string; savedAt: number }> {
    const localId = uuidv4();
    const savedAt = Date.now();
    const entry: OfflineEntry<T> = {
      localId,
      data,
      savedAt,
      syncState: 'pending',
      attempts: 0,
    };
    // v423 C2 fix: read-modify-write 包 withLock, 防止与 drain 的 write(remaining)
    // 并发覆盖. 若锁内 write throw (B1), 让异常传出让 addMarker catch.
    await withLock(async () => {
      const q = await read();
      q.push(entry);
      await write(q);
      crashLogger.breadcrumb(`offlineEntity:save kind=${kind} localId=${localId.slice(0, 8)} size=${q.length}`);
    });

    // 触发一次 drain (若在线立即上传)
    drainAllEntities().catch(() => {});
    return { localId, savedAt };
  }

  async function listPending(): Promise<OfflineEntry<T>[]> {
    return read();
  }

  async function getEntry(localId: string): Promise<OfflineEntry<T> | null> {
    const q = await read();
    return q.find((e) => e.localId === localId) ?? null;
  }

  async function discard(localId: string): Promise<void> {
    await withLock(async () => {
      const q = await read();
      const next = q.filter((e) => e.localId !== localId);
      await write(next);
      crashLogger.breadcrumb(`offlineEntity:discard kind=${kind} localId=${localId.slice(0, 8)}`);
    });
  }

  async function drain(): Promise<{ synced: number; failed: number; remaining: number }> {
    if (draining) return { synced: 0, failed: 0, remaining: 0 };
    draining = true;
    let synced = 0;
    let failed = 0;
    try {
      // v423 C2 fix: read 也走 lock, 保证与 saveLocal/write 序列化 快照一致.
      const q = await withLock(async () => read());
      if (q.length === 0) return { synced: 0, failed: 0, remaining: 0 };
      crashLogger.breadcrumb(`offlineEntity:drain_start kind=${kind} size=${q.length}`);

      // v423 C3 fix: 用 Map 追踪 entry 处理结果, 避免 emit 中间态用 indexOf 拼错.
      // 三种结果: 'keep' (backoff/5xx) / 'drop' (成功/4xx硬失败) / 'stopped' (401).
      const results = new Map<string, 'keep' | 'drop'>();
      let stopped = false;

      for (const entry of q) {
        if (stopped) {
          results.set(entry.localId, 'keep');
          continue;
        }
        // Exponential backoff
        const backoffMs = Math.min(5_000 * Math.pow(2, entry.attempts), 30 * 60_000);
        if (entry.lastTriedAt && Date.now() - entry.lastTriedAt < backoffMs) {
          results.set(entry.localId, 'keep');
          continue;
        }
        try {
          entry.syncState = 'syncing';
          // v423 C3 fix: 中间态 emit 用 map 生成稳定 shape, 不用 indexOf.
          // 该 emit 只影响订阅者 UI, 不写盘.
          emit(q.map((e) => e.localId === entry.localId ? entry : e));

          const server = await syncToServer(entry.data, entry.localId);
          synced += 1;
          crashLogger.breadcrumb(`offlineEntity:synced kind=${kind} localId=${entry.localId.slice(0, 8)}`);
          try { onSyncSuccess?.(entry.localId, server, entry.data); } catch (e) {
            crashLogger.breadcrumb(`offlineEntity:onSyncSuccess_threw kind=${kind} err=${String(e).slice(0, 60)}`);
          }
          results.set(entry.localId, 'drop');
        } catch (err: any) {
          entry.attempts += 1;
          entry.lastTriedAt = Date.now();
          entry.lastError = String(err?.message ?? err).slice(0, 120);

          if (isAuthError(err)) {
            entry.syncState = 'failed';
            results.set(entry.localId, 'keep');
            stopped = true;
            crashLogger.breadcrumb(`offlineEntity:auth_stop kind=${kind}`);
            continue;
          }

          const status = err?.status;
          if (typeof status === 'number' && status >= 400 && status < 500) {
            failed += 1;
            entry.syncState = 'failed';
            crashLogger.breadcrumb(`offlineEntity:hard_fail kind=${kind} status=${status} localId=${entry.localId.slice(0, 8)}`);
            try { onSyncFailure?.(entry.localId, err, entry.data); } catch (e) {
              crashLogger.breadcrumb(`offlineEntity:onSyncFailure_threw kind=${kind} err=${String(e).slice(0, 60)}`);
            }
            results.set(entry.localId, 'drop');
            continue;
          }

          if (entry.attempts >= MAX_ATTEMPTS) {
            failed += 1;
            entry.syncState = 'failed';
            crashLogger.breadcrumb(`offlineEntity:exhausted kind=${kind} localId=${entry.localId.slice(0, 8)}`);
            try { onSyncFailure?.(entry.localId, err, entry.data); } catch { /* ignore */ }
            results.set(entry.localId, 'drop');
            continue;
          }
          entry.syncState = 'pending';
          results.set(entry.localId, 'keep');
        }
      }

      // v423 C2 fix: 关键 —— 在锁内 re-read 磁盘, 合并 saveLocal 期间新增的
      // entry (drain 中 syncToServer 可能耗时 30s, 期间 saveLocal 会写盘).
      // 只处理本轮 quipped 的 localId; 新条目直接保留.
      const remaining = await withLock(async () => {
        const fresh = await read();
        const kept = fresh.filter((e) => {
          const r = results.get(e.localId);
          // 未处理的 (新加入的) 保留; keep 也保留; drop 删除.
          return r !== 'drop';
        });
        // 用本轮更新过的 entry 覆盖 (attempts / lastTriedAt / syncState)
        const merged = kept.map((e) => {
          const processedEntry = q.find((qe) => qe.localId === e.localId);
          return processedEntry && results.get(e.localId) === 'keep' ? processedEntry : e;
        });
        await write(merged);
        return merged;
      });
      crashLogger.breadcrumb(`offlineEntity:drain_end kind=${kind} synced=${synced} failed=${failed} remaining=${remaining.length}`);
      return { synced, failed, remaining: remaining.length };
    } finally {
      draining = false;
    }
  }

  function subscribe(cb: (entries: OfflineEntry<T>[]) => void): () => void {
    listeners.push(cb);
    // 立即推一次当前状态
    read().then((entries) => {
      try { cb(entries); } catch { /* ignore */ }
    }).catch(() => { /* O1: swallow read errors, subscriber gets no snapshot */ });
    return () => {
      const idx = listeners.indexOf(cb);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  const entity: OfflineEntity<T> = {
    saveLocal,
    listPending,
    drain,
    discard,
    subscribe,
    getEntry,
  };

  registry.add({ kind, drain });
  return entity;
}
