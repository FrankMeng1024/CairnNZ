/**
 * markerOfflineEntities — v422
 *
 * 集中注册 marker 相关的 offline entities:
 *   - offlineMarkers:  B 类 (Plant cairn) — 站在地点创造数据, 必须存
 *   - offlineVotes:    A 类 (Like/Report) — **v422 预留骨架, 尚未接入 UI**
 *
 * v422 决策 (2026-07-20):
 *   Like/Report 功能整体尚未接入生产 UI (MapScreen 里 onLike/onReport 目前
 *   只是 session-local toggle + Alert)。等 UI 真接后再启用 offlineVotes,
 *   避免抢 UI 前的 wire 顺序。offlineVotes 的定义/存储 key 已在此保留,
 *   UI 接入时只需在 MapScreen 里调 offlineVotes.saveLocal(...) 即可。
 *
 * 使用:
 *   import { offlineMarkers } from './markerOfflineEntities';
 *   const { localId } = await offlineMarkers.saveLocal({...});
 *
 * Store 层通过 setMarkerCreateAckHandler 把服务器真数据回填本地 placeholder。
 */
import { createOfflineEntity } from './offlineEntity';
import { authenticatedFetch } from './apiService';
import type { MarkerType } from '../data/mockData';
import type { MarkerPermission } from '../store/useMarkerStore';

// ─── B 类: Plant cairn (create marker) ────────────────────────────────────

export interface MarkerCreatePayload {
  type: MarkerType;
  text: string;
  lat: number;
  lng: number;
  alt?: number;
  permission: MarkerPermission;
  approximate: boolean;
  /** v422+: optional location name from Mapbox reverse geocode (max 30 chars).
   *  Content step v3 uses this instead of title. Backend column TBD. */
  location_name?: string | null;
}

export interface MarkerCreateServerResponse {
  id: number | string;
  user_id?: number | string;
  [k: string]: any;
}

/**
 * Store 层设置的 callback:
 *   ack — syncToServer 成功后, 把本地 placeholder id 替换成真 server id
 *          + 更新 authorId + synced=true
 *   fail — 硬失败 (4xx 非 401) 时通知 store, store 决定是否回滚 placeholder
 *          (通常 B 类不回滚, 保留本地 + 标 syncState='failed' 让用户手动重试)
 * 每个 store 实例注册一次 (store 层做)。
 */
let markerCreateAckHandler: ((localId: string, server: MarkerCreateServerResponse) => void) | null = null;
let markerCreateFailHandler: ((localId: string, err: any) => void) | null = null;

export function setMarkerCreateAckHandler(
  ack: (localId: string, server: MarkerCreateServerResponse) => void,
  fail?: (localId: string, err: any) => void,
): void {
  markerCreateAckHandler = ack;
  markerCreateFailHandler = fail ?? null;
}

async function fetchOrThrow(path: string, method: string, body: any): Promise<any> {
  // v423 B4 fix: 加 30s AbortController timeout. 弱网 (NZ 山区 1-2 格) 场景下
  // TCP 半连接 fetch 会挂 90s+ 等 iOS 内核 timeout, 期间 daemon 被 daemonRunning
  // mutex 卡死, pendingSignal 吞掉所有新 drain 触发. 30s 足够正常网络完成,
  // 超时后走 5xx backoff 分支, entry 保留在队列下次再试. Idempotency middleware
  // (client_op_id) 保证重试幂等.
  const ctrl = new AbortController();
  const timeoutHandle = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await authenticatedFetch(path, {
      method,
      body: JSON.stringify(body),
      // offline drain 是后台重试, 401 不 logout
      skipLogoutOn401: true,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  } catch (err: any) {
    // Abort → 标记为可重试 (视为网络错走 backoff)
    if (err?.name === 'AbortError') {
      const wrap: any = new Error('sync timeout');
      wrap.status = 0; // 0 = 网络错, offlineEntity 走 retry 分支
      throw wrap;
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export const offlineMarkers = createOfflineEntity<MarkerCreatePayload, MarkerCreateServerResponse>({
  kind: 'marker_create',
  // v423 B3 fix: per-user storageKey. 户外用户 A 攒了 pending marker 后
  // logout, 若 key 不带 userId 则 B 登录后 daemon 会用 B 的 token 上传 A 的
  // marker, 归属错乱. 现在 A 的队列存 @cairn:offline_markers:v2:A_id,
  // B 只看到自己的空队列. clearMarkersQueueForUser() 提供 logout 清理入口.
  storageKey: () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMarkerStore } = require('../store/useMarkerStore');
      const uid = useMarkerStore.getState().userId;
      return uid ? `@cairn:offline_markers:v2:${uid}` : '';
    } catch {
      return '';
    }
  },
  syncToServer: async (data, localId) => {
    // v423 B2 fix: hydrate 前 daemon 不能上传. 否则 ack handler 里
    // `if (s.userId) storage.setItem(...)` skip 写盘, 且 hydrate 从 MMKV 读
    // 旧数据覆盖内存, 刚 sync 的 marker 蒸发. 抛 5xx 让 entry 保留队列, 等
    // hydrate 后网络/AppState 事件重新触发 drain.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useMarkerStore } = require('../store/useMarkerStore');
      const uid = useMarkerStore.getState().userId;
      if (!uid) {
        const err: any = new Error('store not hydrated');
        err.status = 503;  // 走 backoff 保留
        throw err;
      }
    } catch (e: any) {
      if (e?.status === 503) throw e;
      // require 失败 (circular / lazy load) → 稳妥不上传
      const err: any = new Error('store unavailable');
      err.status = 503;
      throw err;
    }
    return fetchOrThrow('/api/markers', 'POST', { ...data, client_op_id: localId });
  },
  onSyncSuccess: (localId, server) => {
    try { markerCreateAckHandler?.(localId, server); } catch { /* store 崩了不能拖累 daemon */ }
  },
  onSyncFailure: (localId, err) => {
    try { markerCreateFailHandler?.(localId, err); } catch { /* silent */ }
  },
});

/**
 * v423 B3 fix: logout 或 user-switch 时调, 清 current userId 的 queue.
 * 内部靠 discard 每条 entry — 触发 subscribe 通知 UI 更新.
 */
export async function clearMarkersQueueForCurrentUser(): Promise<void> {
  try {
    const pending = await offlineMarkers.listPending();
    for (const entry of pending) {
      await offlineMarkers.discard(entry.localId);
    }
  } catch {
    /* silent — logout flow 不能因 queue clear 失败卡死 */
  }
}

// O1 batch 36: removed voting scaffold (VoteAction, VoteReason, MarkerVotePayload,
// MarkerVoteServerResponse, setMarkerVoteHandlers, offlineVotes, issueNonce,
// markerVoteAckHandler, markerVoteFailHandler) — v422 reserved skeleton, 0 external
// callers confirmed by grep audit.
