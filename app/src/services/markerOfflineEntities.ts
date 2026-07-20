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
  const res = await authenticatedFetch(path, {
    method,
    body: JSON.stringify(body),
    // offline drain 是后台重试, 401 不 logout
    skipLogoutOn401: true,
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
}

export const offlineMarkers = createOfflineEntity<MarkerCreatePayload, MarkerCreateServerResponse>({
  kind: 'marker_create',
  storageKey: '@cairn:offline_markers:v1',
  syncToServer: async (data, localId) => {
    return fetchOrThrow('/api/markers', 'POST', { ...data, client_op_id: localId });
  },
  onSyncSuccess: (localId, server) => {
    try { markerCreateAckHandler?.(localId, server); } catch { /* store 崩了不能拖累 daemon */ }
  },
  onSyncFailure: (localId, err) => {
    try { markerCreateFailHandler?.(localId, err); } catch { /* silent */ }
  },
});

// ─── A 类预留: Like / Report (marker vote) ────────────────────────────────
//
// v422: 尚未接入 UI。当 MapScreen 真接 vote 时, 步骤:
//   1. UI 层: 用户点 Like → 立即前端 +1 (乐观) → 调 offlineVotes.saveLocal({...})
//   2. 注册 handlers: setMarkerVoteHandlers(ack, fail)
//      - ack: 用服务器计数覆盖前端本地估算 (通常无变化)
//      - fail: 硬失败时前端回滚 -1
//   3. UI 用 offlineVotes.subscribe 订阅 pending 数量, 加 tiny amber dot 提示
//
// 现阶段 offlineVotes 已 export 但 handlers 未注册, 调用 saveLocal 不会
// 破坏任何东西 (最多写一条本地记录), 但也不会被 UI 消费。安全预留。

export type VoteAction = 'like' | 'report';
export type VoteReason = 'fake_ad' | 'info_mismatch' | 'dislike';

export interface MarkerVotePayload {
  markerId: string;
  action: VoteAction;
  reason?: VoteReason | null;
  userPos: { lat: number; lng: number; accuracy?: number | null };
  clientTs: number;
}

export interface MarkerVoteServerResponse {
  helpful_count: number;
  report_count: number;
  status: 'healthy' | 'suspicious' | 'hidden';
  [k: string]: any;
}

let markerVoteAckHandler:
  | ((localId: string, data: MarkerVotePayload, server: MarkerVoteServerResponse) => void)
  | null = null;
let markerVoteFailHandler:
  | ((localId: string, data: MarkerVotePayload, err: any) => void)
  | null = null;

export function setMarkerVoteHandlers(
  ack: (localId: string, data: MarkerVotePayload, server: MarkerVoteServerResponse) => void,
  fail: (localId: string, data: MarkerVotePayload, err: any) => void,
): void {
  markerVoteAckHandler = ack;
  markerVoteFailHandler = fail;
}

async function issueNonce(markerId: string): Promise<string | null> {
  try {
    const res = await authenticatedFetch(`/api/markers/${markerId}/interact-nonce`, {
      method: 'GET',
      skipLogoutOn401: true,
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j?.nonce ?? null;
  } catch {
    return null;
  }
}

export const offlineVotes = createOfflineEntity<MarkerVotePayload, MarkerVoteServerResponse>({
  kind: 'marker_vote',
  storageKey: '@cairn:offline_votes:v1',
  syncToServer: async (data, localId) => {
    const nonce = await issueNonce(data.markerId);
    if (!nonce) {
      const err: any = new Error('nonce fetch failed');
      err.status = 503;
      throw err;
    }
    const body = {
      type: data.action,
      reason: data.reason ?? undefined,
      lat: data.userPos.lat,
      lng: data.userPos.lng,
      accuracy: data.userPos.accuracy ?? null,
      client_ts: data.clientTs,
      nonce,
      client_op_id: localId,
    };
    return fetchOrThrow(`/api/markers/${data.markerId}/vote`, 'POST', body);
  },
  onSyncSuccess: (localId, server, data) => {
    try { markerVoteAckHandler?.(localId, data, server); } catch { /* silent */ }
  },
  onSyncFailure: (localId, err, data) => {
    try { markerVoteFailHandler?.(localId, data, err); } catch { /* silent */ }
  },
});

