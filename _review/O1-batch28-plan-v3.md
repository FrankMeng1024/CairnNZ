# O1 batch 28 修复方案 v3 (最终版)

用户澄清后重写。用户明确 4 个关键点:
1. Bug 3: **不是 save 时重采样**。sim-walker emit 时直接按人类步伐**切割线段**发点。屏幕视觉快 (5m/500ms=10m/s),但每次 emit **同时插入中间步子** (每 ~1.4m 一个真实 walking step),存到 store 时是真实 walking pace 的 GPS 数据。
2. Bug 4: 只要 **放弃** + **保存** 两个按钮,点外面 = 继续 (scrim tap auto-resume,无学习成本)
3. Bug 1: 不勾 remember 下次不展示密码 (**toggle off → 清 SecureStore**)
4. 6 个 bug **一起修**

---

## Bug 1 — Remember-me (SecureStore + toggle off 清)

**方案**:
- 新文件 `app/src/services/credentialsStore.ts`,复用 `tokenStore.ts` 的 Platform.OS 分支模式:
  - Native: `expo-secure-store` (iOS Keychain / Android Keystore)
  - Web: `localStorage`
- 显式 `keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK`
- **失败静默**: try/catch 所有 async 操作,失败 breadcrumb log,不阻断登录
- Toggle off (rememberMe=false 时点 Sign In) → `deleteItemAsync`

**AuthScreen 改动**:
- hydrate: credentialsStore.load() → { email?, password? } → 都预填
- Sign In 成功:
  - rememberMe=true → credentialsStore.save({email, password})
  - rememberMe=false → credentialsStore.clear()

**不做 AsyncStorage migration** (batch 24 后没老明文数据)

---

## Bug 2 — Memory 位置/地图渲染同步

**方案** (基于 subagent 建议,不动 R-round lastWatcherFix 决策):
- MemoryMap 加 `initialCenter` prop (mount 时 read once,MemoryMap 内部 setCamera 只在 mount 用它)
- MemoryScreen 保持 persistentCoord 每 render 更新逻辑不变
- **修渲染顺序**: MemoryMap 内 mapReady + initialCameraSet 都 true 之后才渲染 blue dot (通过一个 `renderReady` state)

**改动**:
- `app/src/features/memory/components/MemoryMap.tsx`: 加 `renderReady` state,MapView.onDidFinishLoadingMap → setReady,blue dot 组件 gated on renderReady

---

## Bug 3 — sim-walker 参数恢复 + 按人类步伐切割

**用户思路**: 屏幕视觉快 (10m/s),但每次 emit 时**把大步切成人类小步 (1.4m/s)**,一次 emit 生成**多个 GPS 点** (在两次屏幕位置之间的直线上等距插入)。

**参数** (v450 恢复):
- `step_m: 5, emit_ms: 500` (视觉 10m/s)
- 但每 emit 触发时,在 lastPos → currentPos 直线上,按每 **1.4m 一个 walking step** 插值多个 GPS 点

**具体算法**:
```
每 500ms tick:
  新 pos = lastPos + 5m 方向前进
  distance = 5m
  step_count = floor(5 / 1.4) = 3 (取 3 或 4 个)
  for i in 1..step_count:
    interpolated_lat/lng = lastPos + (i/step_count) * (currentPos - lastPos)
    ts_i = lastTs + (i * 1.4 / 1.4)*1000 = lastTs + i*1000 (每 1s 一步)
    jitter + alt drift
    emit(interpolated_pos, ts_i)  // 写入 useTrackingStore.trackPoints
  lastTs = lastTs + step_count*1000  // 模拟时间累加
```

**关键设计**:
- 屏幕视觉 = currentPos (10m/s 移动)
- store 里的 GPS 点 = **多个 1.4m 一个点** (真实 walking data)
- ts 是**模拟时间** (从 startedAt 累加,每步 +1s 步行速度)
- 每 emit 一次给 store 加 3-4 个点 (而不是 1 个)

**副作用处理**:
- **duration_s**: session finalize 时 `Date.now() - startedAt` = **挂钟** (5min sim 就 5min)。但 GPS 点的最后一个 ts 会是 `startedAt + 大量模拟秒`。因此:
  - **session.endedAt** = 最后一个 GPS 点的 ts (模拟时间) — hike detail chart 时间轴 = 真实步行时间
  - **duration_s** = endedAt - startedAt (模拟时间) — 与 hike detail chart 一致
  - **但显示到用户**: 用户看到 session card 上 "1h 20min" (模拟), 但实际他花了 5min 屏幕操作。这是 **sim-walker 的本质** — 用户目的是"最接近真实测试"
- **memory_points ts**: sim-walker 触发 useMemoryStore.recordPoint 时,用同一模拟 ts (walking pace)。attributeMemoryPoints 匹配走 memory_points.ts ∈ [route_points[0].t, route_points[-1].t],都用模拟时间,窗口一致
- **minute_snapshot**: sim-walker 也 emit `gps_fix` 事件到 debugLogger (ts=模拟时间),让 sessionRecorder 收到 → minute_snapshot 里 accuracies/gpsLost 数据完整

**参数 UI**:
- 标签改 "拖动走 · 5m/0.5s (真实步 1.4m/s)"

**改动清单**:
- `app/src/dev/simWalker/gpsInjector.ts`:
  - `DEFAULT_STEP_CONFIG`: step_m=5, emit_ms=500 (恢复 v450)
  - `tick()` 里加 subdivide 逻辑: 每 tick 生成 N=floor(step_m/WALKING_STEP=1.4) 个中间点
  - 每中间点用**模拟时间累加器** `simTimeCursor += 1000ms` (walking_step_time = 1.4m / 1.4m/s = 1s)
  - emit 每中间点到 store + debugLogger
- `app/src/store/useTrackingStore.ts`:
  - `__simwalkerAddTrackPoint` 用参数传入的 timestamp (不 Date.now() 硬编码)
  - `endedAt` 用最后 trackPoint.t 而不是 Date.now()
- `app/src/features/memory/store/useMemoryStore.ts`:
  - `recordPoint` 可选 ts 参数
- sim-walker 加 debugLogger.log gps_fix 事件

**验证** (subagent must_verify_before_impl):
- backend saveHikeAtomic schema: 已确认不校验 t <= end_time (subagent V2-01 结论)
- route_points_raw: 也用模拟 ts (与 route_points 一致)

---

## Bug 4 — Stop 弹窗改 "放弃 + 保存" (点外自动继续)

**方案**:
- StopSummarySheet 底部 sheet 内 2 button 横排:
  - **左**: `放弃` (Discard) — 中性灰 (无危险色,避免过度警告)
  - **右**: `保存` (Save & End) — accent 主色
- Tap scrim → 关弹窗 = 继续 tracking (原 Resume 行为)
- **无二次确认** (用户明确不要"学习成本")

**Discard action** (复用 recoveryModal.onDiscard 完整逻辑):
```typescript
async function discardHike(session, remoteId) {
  breadcrumb('discard:start');
  // 1. Local disk 清 (hikeTrackWriter 里存 memory_points 也一并清)
  await hikeTrackWriter.discardActiveHike(sessionId);
  // 2. Remote delete (若有网 + remoteId)
  if (remoteId) {
    try {
      await deleteRemoteSession(remoteId);
    } catch (err) {
      // silent — 未来 recovery modal 会看到 orphan session 并再问
      breadcrumb(`discard:remote-delete-failed ${err.message}`);
    }
  }
  // 3. Client store
  useTrackingStore.getState().discardCurrentSession();
  // 4. Nav home
  nav.navigate('Home');
}
```

**subagent V2-06/V2-07 处理**:
- step 4 (清 pendingSyncStore): **删除** — save 之前 discard 时 pending 里根本没这个 hike 的 op (只在 saveHikeAtomic 失败时才写),所以是 no-op 且危险 (可能误清其他 op)
- step 5 (清 hikeTracksCache): **删除** — hikeTrackWriter.discardActiveHike 已经处理 disk 目录,重复

**subagent V2-08 处理 (deleteRemoteSession 失败)**:
- 现方案 breadcrumb + silent。**不塞 pending delete-op** (Cairn 无此机制)
- 未来 orphan session 会被 recovery modal 抓到 (backend session finalized_at=NULL) — 用户看到再选择怎么办

**改动**:
- `app/src/screens/HikingScreen.tsx` StopSummarySheet actions:
  - 删 Resume button
  - 加 Discard button (左, 中性灰)
  - Save & End 保持右, accent
  - scrim tap 仍 dismiss = auto-resume
- 抽出 `discardHike()` helper (复用 v430 recoveryModal.onDiscard 逻辑)

---

## Bug 5+6 — 加 log 上线诊断 (不改逻辑)

**方案** (用户明确):
- 只加 log,不改现有 recovery/pendingSync 逻辑
- 下个 batch 拿到真机 log 后再修根因

**加的 log**:
1. `pendingSyncStore` 每个 mutation:
   - `savePending`: log { localId, sessionId, remoteId, retryCount }
   - `removePending`: log { localId }
   - `updatePending`: log { localId, updates }
   - `listPending` 每次读: log { count }
2. `useTrackingStore.stopTracking` saveHikeAtomic 分支:
   - Response status + body preview (前 200 字符)
   - v412Success 分支决策日志
   - pendingSyncStore.savePending 触发原因
3. `HikingScreen` recovery useEffect:
   - listActiveHikes 返回结果 (sessionId + startedAt)
   - modal 弹出决策
4. `SyncDaemon` (若存在) drain 触发条件 + 结果

**subagent V2 冲突提醒**: 若同 batch 也做 Bug 3 改 stopTracking payload,log 拿到的是重采样后的数据不是真实用户操作。**用户选择一起修**,所以 log 需要**清楚区分**是不是 sim-walker 生成的 payload:
- 加 `debugMode + simWalker.active` state 到 log context
- 未来分析时 filter 掉 sim-walker 数据

**改动**:
- `app/src/services/pendingSyncStore.ts`: 每 mutation 加 log
- `app/src/store/useTrackingStore.ts`: saveHikeAtomic 分支加 log
- `app/src/screens/HikingScreen.tsx` recovery useEffect: 加 log

---

## 修复顺序 (一起修但内部次序)

1. **Bug 5+6 log** (最小风险,先上)
2. **Bug 2 渲染顺序** (纯 UI)
3. **Bug 4 Stop 弹窗** (UI + Discard 逻辑)
4. **Bug 1 SecureStore** (新文件 + AuthScreen 改)
5. **Bug 3 sim-walker 参数 + subdivide** (最大改动,最后)

每步:
- typecheck (client) + node -c (backend if 涉及)
- commit
- 下一步

---

## 4-eyes round 3

v3 再走一次 subagent review。上次 V2 的 12 个漏洞:
- Bug 3 memory_points ts + minute_snapshot data: ✅ v3 全一起处理 (walking pace ts 到所有下游)
- Bug 3 duration/hike detail 露馅: ✅ 用户接受 (sim-walker 本质就是模拟真实,不给普通用户看)
- Bug 3 backend schema: ✅ 已验证不校验 t<=end_time
- Bug 4 二次确认破风格: ✅ 用户明确无二次确认
- Bug 4 pendingSyncStore/hikeTracksCache 无 API: ✅ 删这两步
- Bug 4 deleteRemoteSession 失败: ✅ silent + 未来 recovery 兜底
- Bug 1 keychainAccessibility: ✅ 显式 AFTER_FIRST_UNLOCK
- Bug 1 Web fallback: ✅ 复用 tokenStore Platform.OS 模式
- Bug 2 hoist read once freeze: ✅ 改成 MemoryMap 内部 renderReady 逻辑,不动 persistentCoord

**v3 是否 safe_to_implement?** — 再 subagent review 一次确认。
