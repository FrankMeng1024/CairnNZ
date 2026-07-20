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

export interface OfflineEntry<T> {
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

export interface OfflineEntityConfig<T, Server> {
  /** 类型标识, 用于 log */
  kind: string;
  /** AsyncStorage key */
  storageKey: string;
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

export interface OfflineEntity<T> {
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

export async function drainAllEntities(): Promise<void> {
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

  const { kind, storageKey, syncToServer, onSyncSuccess, onSyncFailure } = config;
  const isAuthError = config.isAuthError ?? ((err: any) => err?.status === 401 || err === 401);

  const listeners: Array<(entries: OfflineEntry<T>[]) => void> = [];
  let draining = false;

  async function read(): Promise<OfflineEntry<T>[]> {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function write(entries: OfflineEntry<T>[]): Promise<void> {
    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(entries));
    } catch (err) {
      crashLogger.breadcrumb(`offlineEntity:write_failed kind=${kind} err=${String(err).slice(0, 60)}`);
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
    const q = await read();
    q.push(entry);
    await write(q);
    crashLogger.breadcrumb(`offlineEntity:save kind=${kind} localId=${localId.slice(0, 8)} size=${q.length}`);

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
    const q = await read();
    const next = q.filter((e) => e.localId !== localId);
    await write(next);
    crashLogger.breadcrumb(`offlineEntity:discard kind=${kind} localId=${localId.slice(0, 8)}`);
  }

  async function drain(): Promise<{ synced: number; failed: number; remaining: number }> {
    if (draining) return { synced: 0, failed: 0, remaining: 0 };
    draining = true;
    let synced = 0;
    let failed = 0;
    try {
      let q = await read();
      if (q.length === 0) return { synced: 0, failed: 0, remaining: 0 };
      crashLogger.breadcrumb(`offlineEntity:drain_start kind=${kind} size=${q.length}`);

      const remaining: OfflineEntry<T>[] = [];
      let stopped = false;

      for (const entry of q) {
        if (stopped) {
          remaining.push(entry);
          continue;
        }
        // Exponential backoff
        const backoffMs = Math.min(5_000 * Math.pow(2, entry.attempts), 30 * 60_000);
        if (entry.lastTriedAt && Date.now() - entry.lastTriedAt < backoffMs) {
          remaining.push(entry);
          continue;
        }
        try {
          entry.syncState = 'syncing';
          // 中间态短暂 emit, 让 UI 显示 syncing spinner
          emit([...remaining, entry, ...q.slice(q.indexOf(entry) + 1)]);

          const server = await syncToServer(entry.data, entry.localId);
          synced += 1;
          crashLogger.breadcrumb(`offlineEntity:synced kind=${kind} localId=${entry.localId.slice(0, 8)}`);
          try { onSyncSuccess?.(entry.localId, server, entry.data); } catch (e) {
            crashLogger.breadcrumb(`offlineEntity:onSyncSuccess_threw kind=${kind} err=${String(e).slice(0, 60)}`);
          }
          // 成功: 不推入 remaining (从队列删)
        } catch (err: any) {
          entry.attempts += 1;
          entry.lastTriedAt = Date.now();
          entry.lastError = String(err?.message ?? err).slice(0, 120);

          if (isAuthError(err)) {
            // 401: 保留, 暂停 drain, 等 token 恢复
            entry.syncState = 'failed';
            remaining.push(entry);
            stopped = true;
            crashLogger.breadcrumb(`offlineEntity:auth_stop kind=${kind}`);
            continue;
          }

          const status = err?.status;
          if (typeof status === 'number' && status >= 400 && status < 500) {
            // 4xx (非 401): 后端拒了 payload, 硬失败, 不重试
            failed += 1;
            entry.syncState = 'failed';
            crashLogger.breadcrumb(`offlineEntity:hard_fail kind=${kind} status=${status} localId=${entry.localId.slice(0, 8)}`);
            try { onSyncFailure?.(entry.localId, err, entry.data); } catch (e) {
              crashLogger.breadcrumb(`offlineEntity:onSyncFailure_threw kind=${kind} err=${String(e).slice(0, 60)}`);
            }
            // 从队列删 (调用方通过 onSyncFailure 回滚前端)
            continue;
          }

          // 5xx / 网络失败: 保留, backoff
          if (entry.attempts >= MAX_ATTEMPTS) {
            failed += 1;
            entry.syncState = 'failed';
            crashLogger.breadcrumb(`offlineEntity:exhausted kind=${kind} localId=${entry.localId.slice(0, 8)}`);
            try { onSyncFailure?.(entry.localId, err, entry.data); } catch { /* ignore */ }
            continue;
          }
          entry.syncState = 'pending';
          remaining.push(entry);
        }
      }
      await write(remaining);
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
    });
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
