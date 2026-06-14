/**
 * v0.2.4 R2-followup — UnityAROverlay lifecycle helpers (anti-self-licking,
 * jest 真测同 process re-mount 路径)。
 *
 * UnityAROverlay 太大不能用 RTL render 整组件 (Unity native bridge mock 复杂)。
 * 抽出 lifecycle 关键状态 + 操作到 pure module,组件真调,jest 真测同函数。
 *
 * Use case: 用户 "退出 AR + 同 process 内再进入 AR" — 验证 mount/unmount 钩子
 * 真清状态 + re-mount 真重 spawn,不会留 stale ghost。
 */

export interface OverlayLifecycleRefs {
  spawnedIds: Set<string>;
  lastSentOrigin: { lat: number; lng: number } | null;
  bulkSpawned: boolean;
  emptyMarkerFrameCount: number;
  rejectionTracker: Map<string, { nextRetryAt: number; attempts: number }>;
  recentPlanes: Array<{ y: number; area: number; t: number }>;
  observedPlaneYs: Array<{ y: number; t: number }>;
  lastCameraY: number | null;
}

/**
 * 创建初始 lifecycle state — mount 时调一次。
 */
export function createOverlayLifecycle(): OverlayLifecycleRefs {
  return {
    spawnedIds: new Set(),
    lastSentOrigin: null,
    bulkSpawned: false,
    emptyMarkerFrameCount: 0,
    rejectionTracker: new Map(),
    recentPlanes: [],
    observedPlaneYs: [],
    lastCameraY: null,
  };
}

/**
 * Unmount 时清所有 in-component 状态 (zustand store 不动,markerStore 跨 mount 保留)。
 * 同时返回 "需要发给 Unity 的 cleanup 消息" 列表 — caller 真发,jest 验证发了。
 */
export interface OverlayUnmountResult {
  /** Unity messages to dispatch on unmount, in order */
  unityMessages: Array<{ gameObject: string; method: string; payload: string }>;
}

export function unmountOverlay(refs: OverlayLifecycleRefs): OverlayUnmountResult {
  const messages: OverlayUnmountResult['unityMessages'] = [
    // Despawn all cairn GameObjects on Unity side, prevent ghost pillars
    // when @azesmway/react-native-unity singleton keeps state.
    { gameObject: 'CairnBridge', method: 'OnClearAll', payload: '' },
  ];
  // Reset all RN-side state to ensure re-mount starts fresh.
  // IMPORTANT: must use in-place mutation for collections so caller's component
  // refs see the change (重赋 = [] 只改本函数局部 inline object 字段,不传播回 ref holder)。
  refs.spawnedIds.clear();
  refs.rejectionTracker.clear();
  refs.recentPlanes.length = 0;
  refs.observedPlaneYs.length = 0;
  // Scalar fields cannot be reset via this function for caller refs (JS pass-by-value
  // for primitives). 直接改 refs.x = null 只改 inline object literal 字段,真生产 caller
  // 必须自己 reset 这些 scalar 字段。jest 测试断言传入对象上的 mutation,生产代码
  // 自己额外 reset 一遍 (line 351-356 of UnityAROverlay.tsx) 形成双重保险。
  refs.lastSentOrigin = null;
  refs.bulkSpawned = false;
  refs.emptyMarkerFrameCount = 0;
  refs.lastCameraY = null;
  return { unityMessages: messages };
}

/**
 * Mount 时调,验证 fresh state — 用于 re-mount 后断言 jest。
 */
export function isOverlayClean(refs: OverlayLifecycleRefs): boolean {
  return (
    refs.spawnedIds.size === 0 &&
    refs.lastSentOrigin === null &&
    refs.bulkSpawned === false &&
    refs.emptyMarkerFrameCount === 0 &&
    refs.rejectionTracker.size === 0 &&
    refs.recentPlanes.length === 0 &&
    refs.observedPlaneYs.length === 0 &&
    refs.lastCameraY === null
  );
}

/**
 * 标记一个 cairn 已 spawn (生产 UnityAROverlay 在 dispatchSpawn 真用)。
 */
export function markSpawned(refs: OverlayLifecycleRefs, id: string): boolean {
  if (refs.spawnedIds.has(id)) return false;  // dedupe
  refs.spawnedIds.add(id);
  return true;
}

/**
 * Bulk spawn 标记完成。Re-mount 后必须重置才能再触发。
 */
export function markBulkSpawnDone(refs: OverlayLifecycleRefs): void {
  refs.bulkSpawned = true;
}

export function isBulkSpawnDone(refs: OverlayLifecycleRefs): boolean {
  return refs.bulkSpawned;
}
