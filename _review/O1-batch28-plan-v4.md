# O1 batch 28 修复方案 v4 (最终确认版)

用户 2026-07-26 澄清: **测试向 sim-walker,不担心污染,只要 GPS 数据像真的**。

## 6 个 bug 最终方案

### Bug 1 — Remember-me (SecureStore + toggle off 清)
- 新 `credentialsStore.ts` 复用 tokenStore Platform.OS 模式
- Native: expo-secure-store + `AFTER_FIRST_UNLOCK`
- Web: localStorage
- toggle on → save {email, password}; toggle off → clear
- 失败静默 breadcrumb + 不阻断登录
- **不做 AsyncStorage migration** (batch 24 后无老明文)

### Bug 2 — Memory 渲染顺序
- MemoryMap 加 `renderReady` state
- `MapView.onDidFinishLoadingMap` → setReady(true)
- Blue dot + FogLayer gated on renderReady → 一次出现
- 不改 R-round lastWatcherFix 逻辑 (避免 iOS 双 watcher 12s timeout)

### Bug 3 — sim-walker 参数 + subdivide (用户方案)

**参数**:
- `DEFAULT_STEP_CONFIG.step_m = 50` (屏幕每 tick 跳 50m)
- `DEFAULT_STEP_CONFIG.emit_ms = 200` (每 200ms 一 tick)
- **屏幕视觉 = 250 m/s**
- UI 标签 "拖动走 · 50m/0.2s (真步伐 1m/s)"

**subdivide 算法** (`gpsInjector.tick`):
```
每 200ms tick:
  currentPos = lastPos + 50m 沿 bearing
  distance = 50m
  step_count = 50 (每秒 1 点,50m 距离 = 50 个点)
  for i in 1..step_count:
    interpolated = lastPos + (i/step_count) * (currentPos - lastPos)
    ts_i = lastSimTs + i * 1000ms  # 每点 +1s
    jitter + alt drift
    write to store with ts_i
  lastSimTs += step_count * 1000  # 累加 50s 模拟时间
```

**用户明确**: 
- 不担心 memory 污染 (测试环境)
- ts 我模拟就好,不必贴挂钟
- Discard 不需要清 memory (加 setting 让用户选)
- ⟲/↶ 行为: **⟲ 定位** 时 lastSimTs 保持累加 (不重置);**↶ undo** 时 lastSimTs = trackPoints[last].t + 1000ms

**关键代码点**:
- gpsInjector: 每 tick 循环插值 → **一次 batch push** (subagent PERF-01: 避免 3x re-render)
- useTrackingStore.__simwalkerAddTrackPoint: 接受 `timestamp` 参数,所有内部 `t=` 改用 `timestamp ?? Date.now()`
- 加 `sessionHadSimInput: boolean` 到 useTrackingStore (供 log 区分)

**Session finalize**:
- endedAt = 最后 trackPoint.t (模拟时间)
- duration_s = endedAt - startedAt (**跨 domain: startedAt 挂钟 vs endedAt 模拟**)
- **用户接受此结果** (测试向,不给用户看)

**Backend schema**: 已确认不校验 t <= end_time (subagent V2-01)

### Bug 4 — Stop 弹窗 2 button
- 现 3 button 改成 2 button:
  - **左**: `放弃` (Discard) — 中性灰
  - **右**: `保存` (Save & End) — accent 主色
- Tap scrim → 继续 (原 Resume 行为,无学习成本)
- **无二次确认**

**discardHike 逻辑** (合并到 useTrackingStore.discardCurrentSession):
- discardCurrentSession 现有已调 deleteRemoteSession (line 1544-1546)
- 加: `await hikeTrackWriter.discardActiveHike(sessionId)` 清 disk
- **不清 memory_points** (用户明确: 测试向,错就错)
- Nav home

### Bug 5+6 — 加 log 上线诊断
- pendingSyncStore 每 mutation
- saveHikeAtomic response 完整 status
- HikingScreen recovery useEffect 触发条件 log
- 加 `sessionHadSimInput` 到 log context (区分 sim 数据)

### Bug 7 (新增, 用户要求) — Settings 加 unlockOnWalk toggle
- `useMemorySettingsStore`: 加 `unlockOnWalk: boolean` (默认 true)
- Settings Screen "Memory" section 加 toggle:
  - Title: "走路实时解锁记忆" / "Unlock memory while walking"
  - Description: "关闭后,只有保存 hike/run 时才解锁 memory 区域"
- ForegroundUnlockManager 检查此 flag,false 时跳过 recordPoint
- flushHikingToMemory (save hike 时) 不受影响

---

## 实现顺序 (5 独立 commit + typecheck 每步)

1. **batch 28.1**: Bug 5+6 log (最小风险)
2. **batch 28.2**: Bug 2 MemoryMap renderReady
3. **batch 28.3**: Bug 4 Stop 弹窗 2 button + Discard 合并
4. **batch 28.4**: Bug 1 SecureStore credentialsStore + AuthScreen
5. **batch 28.5**: Bug 3 sim-walker subdivide + Bug 7 unlockOnWalk toggle

每步:
- typecheck (client)
- node -c (若涉及 backend, 本 batch 只 log 涉及)
- commit
- 下一步

---

## v4 变化 (相对 v3)

- Bug 3 参数: 5m/500ms → 50m/200ms (250m/s 屏幕)
- Bug 3 subdivide: 3 点/tick → **50 点/tick** (每秒 1 点密度)
- Bug 3 batch push: 单次 store update (避免 3x re-render, subagent PERF-01)
- Bug 3 sessionHadSimInput flag 加入
- Bug 3 duration_s cross-domain: 用户明确接受
- Bug 4 discardHike 合并到 discardCurrentSession
- Bug 4 memory_points 不清 (用户明确)
- 新增 Bug 7: unlockOnWalk toggle setting
- Bug 5+6 log 加 sessionHadSimInput context

---

## v3 subagent 抓的漏洞状态

- ✅ REG-01 __simwalkerAddTrackPoint 内部 t: v4 明确改所有 t=timestamp
- ✅ CROSS-01 memory_points 泄漏: 用户接受 (测试向) + 加 unlockOnWalk toggle
- ✅ BOUND-01/02 ⟲/↶ 语义: v4 明确 (⟲ 保持累加,↶ = last.t + 1000)
- ✅ CROSS-02 log 污染: sessionHadSimInput flag
- ✅ BOUND-03 duration_s cross-domain: 用户接受
- ✅ PERF-01 batch API: v4 明确单次 store update
- ✅ TEST-05 emit_ms 加速: 200ms 已是 clamp 边界
- ✅ R3-01/02/03 (subdivide 问题): 用户接受
- ✅ R4-01 double deleteRemoteSession: v4 合并到 discardCurrentSession
- ✅ R4-02 memory_points 清: 用户明确不清 + 加 setting
- ✅ R5-01 sim-taint flag: 用 sessionHadSimInput
- ⚠️ PERF-02 log flood: 5min sim 生成 ~15000 event (50 emit/s × 300s). debugLogger ring buffer 1000 会溢出 → 加 sim mode 时 debugLogger.log 频率降低 (每 10 点 1 log)

## v4 可实现性

subagent 双 review + 用户澄清后,v4 所有已知漏洞都有处理方案。**开始实现**。
