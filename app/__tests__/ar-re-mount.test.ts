/**
 * v0.2.4 R2-followup — AR exit + re-enter (same process) lifecycle test.
 *
 * 用户具体问: "AR plant → 退出 AR → 再进入 AR 查看, mark 还在原地 + 在地面?"
 * 这跟 cross-session-e2e (process 死) 不一样:
 *   - process 死 → useMarkerStore.hydrate() 重新读 AsyncStorage
 *   - 同 process re-enter → zustand store 不动,但 UnityView unmount/re-mount,
 *     必须发 OnClearAll 清 Unity native side ghost cairn。
 *
 * 反 self-licking: 真 import services/arOverlayLifecycle (UnityAROverlay 真用同函数)。
 */

import {
  createOverlayLifecycle,
  unmountOverlay,
  isOverlayClean,
  markSpawned,
  markBulkSpawnDone,
  isBulkSpawnDone,
} from '../src/services/arOverlayLifecycle';

describe('AR exit + re-enter lifecycle (same process)', () => {
  it('fresh mount: lifecycle is clean', () => {
    const refs = createOverlayLifecycle();
    expect(isOverlayClean(refs)).toBe(true);
  });

  it('after spawning cairns: spawnedIds tracked, dedupe works', () => {
    const refs = createOverlayLifecycle();
    expect(markSpawned(refs, 'cairn-1')).toBe(true);
    expect(markSpawned(refs, 'cairn-2')).toBe(true);
    expect(markSpawned(refs, 'cairn-1')).toBe(false);  // dedupe
    expect(refs.spawnedIds.size).toBe(2);
    expect(isOverlayClean(refs)).toBe(false);
  });

  it('after bulk spawn: bulkSpawned=true, must reset for re-mount', () => {
    const refs = createOverlayLifecycle();
    markBulkSpawnDone(refs);
    expect(isBulkSpawnDone(refs)).toBe(true);
  });

  it('unmount sends OnClearAll to Unity (prevent ghost pillars on re-mount)', () => {
    const refs = createOverlayLifecycle();
    markSpawned(refs, 'cairn-1');
    markBulkSpawnDone(refs);
    refs.lastSentOrigin = { lat: 30.0, lng: 120.0 };
    refs.lastCameraY = 1.5;

    const result = unmountOverlay(refs);
    expect(result.unityMessages).toHaveLength(1);
    expect(result.unityMessages[0]).toEqual({
      gameObject: 'CairnBridge',
      method: 'OnClearAll',
      payload: '',
    });
  });

  it('unmount clears all RN-side state to ensure clean re-mount', () => {
    const refs = createOverlayLifecycle();
    // dirty all fields
    markSpawned(refs, 'cairn-1');
    markSpawned(refs, 'cairn-2');
    markBulkSpawnDone(refs);
    refs.lastSentOrigin = { lat: 30.0, lng: 120.0 };
    refs.emptyMarkerFrameCount = 5;
    refs.rejectionTracker.set('bad-1', { nextRetryAt: 999, attempts: 3 });
    refs.recentPlanes.push({ y: 0, area: 1, t: 100 });
    refs.observedPlaneYs.push({ y: 0, t: 100 });
    refs.lastCameraY = 1.5;
    expect(isOverlayClean(refs)).toBe(false);

    unmountOverlay(refs);
    expect(isOverlayClean(refs)).toBe(true);
  });

  it('re-mount cycle: unmount → fresh state → re-spawn allowed', () => {
    // Session 1
    const refs = createOverlayLifecycle();
    markSpawned(refs, 'cairn-A');
    markSpawned(refs, 'cairn-B');
    markBulkSpawnDone(refs);
    expect(refs.spawnedIds.size).toBe(2);
    expect(isBulkSpawnDone(refs)).toBe(true);

    // exit AR (unmount)
    const unmountResult = unmountOverlay(refs);
    expect(unmountResult.unityMessages[0].method).toBe('OnClearAll');
    expect(isOverlayClean(refs)).toBe(true);

    // re-enter AR (re-mount): in real component, refs are re-created via useRef,
    // but the helper validates the contract — same id should be re-spawnable.
    expect(markSpawned(refs, 'cairn-A')).toBe(true);  // re-spawn after clear OK
    expect(markSpawned(refs, 'cairn-B')).toBe(true);
    expect(markSpawned(refs, 'cairn-A')).toBe(false); // dedupe within session
    expect(refs.spawnedIds.size).toBe(2);
  });

  it('multi-cycle exit/enter: 3 rounds all clean', () => {
    const refs = createOverlayLifecycle();
    for (let i = 1; i <= 3; i++) {
      markSpawned(refs, `cairn-${i}-A`);
      markBulkSpawnDone(refs);
      const r = unmountOverlay(refs);
      expect(r.unityMessages).toHaveLength(1);
      expect(isOverlayClean(refs)).toBe(true);
    }
  });

  it('arrays in-place truncated (not re-assigned) — caller ref holders see change', () => {
    // sub adversarial 抓的: 若 helper 用 refs.x = [] 重赋,inline object literal
    // caller 持有的 ref.current 不会被改回 fresh array → 生产里 array 永远不清。
    // 修法: helper 用 .length = 0 in-place truncate。
    const refs = createOverlayLifecycle();
    refs.recentPlanes.push({ y: 1, area: 1, t: 100 });
    refs.recentPlanes.push({ y: 2, area: 2, t: 200 });
    const recentPlanesRefHolder = refs.recentPlanes;  // simulate component ref.current
    refs.observedPlaneYs.push({ y: 0, t: 100 });
    const observedPlaneYsRefHolder = refs.observedPlaneYs;

    unmountOverlay(refs);

    // Caller ref holder 应该看到 array 已清空 (in-place truncate)
    expect(recentPlanesRefHolder.length).toBe(0);
    expect(observedPlaneYsRefHolder.length).toBe(0);
    // 跟 refs.recentPlanes 是同一个 array (in-place,没重赋)
    expect(refs.recentPlanes).toBe(recentPlanesRefHolder);
    expect(refs.observedPlaneYs).toBe(observedPlaneYsRefHolder);
  });
});
