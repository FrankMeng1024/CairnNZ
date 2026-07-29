# O1 反馈修复方案 v2（Batch 28）

用户回答后重写。双 subagent 都判 v1 方案不安全，重整。

## 用户新回答摘要

1. **sim-walker 速度**：用户之前发过参数——**v450 是 step_m=5, emit_ms=500** (10m/s 视觉)。我 O1 batch 5 改成 1.4m/1200ms 用户不同意。**恢复 v450 参数**。
2. **Bug 3 duration 语义**：屏幕虚拟快速走，但 save hike 时**计算真人走这些点的 GPS 真实信息**（真实距离/时间/海拔）。**不给用户看**，就是最接近真实的测试用。后期会删。
3. **Bug 5+6**：先加 log 上线，下次 sprint 根因定位后改。
4. **Bug 4 UI**：我先了解现有 UI 风格再考虑。

## 已了解的 UI 风格

Cairn 系统 UI 模式（HikingScreen.StopSummarySheet 为参考）:
- **底部 sheet** (bottom sheet)，scrim 半透明黑 0.55
- **顶部小 handle bar** + 中央 header title (带 accent 色)
- **Card 圆角** + 阴影
- **Actions 横排**（Resume 灰色 left + Save 主色 right）
- **主色 accent**: `Colors.primary` (绿) hiking / `Colors.running` (蓝) running
- Tap scrim = dismiss (等价 Resume)
- 中文/英文按上下文（sim-walker 中文，主流 UI 英文）

## 修方案 v2

### Bug 1 — Remember-me 存密码（改用 SecureStore）

**方案**:
- 用 `expo-secure-store`（已通过 tokenStore.ts 在用）
- **iOS Keychain / Android Keystore 硬件加密** = 不违背 OWASP M2
- **keychainAccessible**: `AFTER_FIRST_UNLOCK`（tokenStore.ts:11-12 注释里明确的坑，AuthScreen 是 splash 后第一屏，device 可能没 unlock，用这个 flag）
- **Web 平台**: Platform.OS==='web' 走 AsyncStorage（Web 只是 dev/QA，非生产）

**改动**:
- 抽出 `app/src/services/credentialsStore.ts`（复用 tokenStore.ts 模式）
- AuthScreen 用 credentialsStore 替换直接的 storage 调用
- **不做 AsyncStorage 老数据 migration**（batch 24 后没人有明文，migration 只能带 email 值意义不大）
- 首次开 app 用户输密码 → 存 SecureStore → 之后每次预填

**失败处理**:
- `setItemAsync` throw：catch 静默 log（storage 失败不阻断登录）
- `getItemAsync` throw：catch fallback 空表单

### Bug 2 — Memory 位置/地图不同步 + 缓存位置

**根因重新分析**（subagent #1 指出 v1 方案会复发 R-round 老 bug）:

用户原话"地图和位置有先后 一次出现" = **渲染顺序**问题，不是 GPS 请求时机问题。

**方案**:
- MemoryScreen 保持用 lastWatcherFix（R-round 决定，别动）
- **修渲染顺序**: MemoryMap 组件加 `initialCenter` prop，用第一次 render 时的 lastWatcherFix，之后不再重新聚焦。地图和蓝点用**同一次 render 的位置**，一起出。
- 若 lastWatcherFix 为 null（真的没缓存也没实时）→ loading state 等 GPS

**改动**:
- `app/src/features/memory/screens/MemoryScreen.tsx`: hoist center coord 到 mount 时 read once
- `app/src/features/memory/components/MemoryMap.tsx`: 用 hoisted center 初始渲染，不 subscribe 变化

**用户"读取上次的位置"疑虑**：这是设计（R-round 明确避免 iOS 双 watcher 12s timeout）。加**UI 提示** "使用最后已知位置" 若 lastWatcherFix 时间戳 > 5min。

### Bug 3 — sim-walker（v450 恢复 + 模拟真实数据）

**方案**:

**Part A - 参数恢复 v450**:
- `DEFAULT_STEP_CONFIG`: `step_m: 5, emit_ms: 500` = 视觉 10m/s
- `JITTER_M_1_SIGMA: 5`（保留）
- UI 标签 "拖动走 · 5m/0.5s"

**Part B - 底层数据真实**:

需要清楚: 用户目的是**测试**（后期删）。GPS 数据要"像真人走一样"，方便 memory point/session card/hike detail 显示合理。

**用户澄清**："模拟真实 这个不是给用户看的" → session.duration **不装模拟时间给用户看**，session.duration = 挂钟时间（实际屏幕跑的分钟数）。

**但**"计算真人走这些点 GPS 真实信息" → **在 save hike atomic 时**，把 GPS 点的 ts **重新采样** 成 walking pace 时间戳。

具体做法（**新的想法**）:
1. sim-walker 每 500ms emit 一个点，ts 就是 Date.now()（保持不变）
2. **在 useTrackingStore.stopTracking → v412Payload 组装时**，若 debugMode + simWalker 参与过 → 对 `route_points`/`route_points_raw` 的 ts 做**重采样**：
   - 保持点数不变
   - 保持位置不变
   - ts 序列改成从 startedAt 开始，每点间隔 = `distance / 1.4m/s` 秒
3. `distance_m` = 依真实 GPS 距离累加（保留）
4. `duration_s` = **两个字段** 都不动（挂钟）
5. `elevation_gain_m` = 累积（本来就是真实）

**只在 save 时重采样 ts**，屏幕上看到的和 session.duration 都是挂钟。**server 拿到的是"真人走"数据**。

**改动**:
- `app/src/store/useTrackingStore.ts` `stopTracking` 里 v412Payload 组装前，加 `resampleGpsTsForSimWalker(points)` helper。判断: 若 `debugMode && simWalkerActive` 一直未熄灭过 → 重采样。
- helper 新文件: `app/src/dev/simWalker/resampleGpsForSave.ts`
- `gpsInjector.ts`: DEFAULT 参数恢复 v450

**边界**:
- 若 hike 一半开一半关 sim-walker：太复杂，先不管（sim-walker 是 dev-only）
- 若模拟点非常多（1h 屏幕 = 10*3600m = 36km 距离 → 真人走 7h+）：session.startedAt 是真实值，session.endTime 若重采样了 = 未来时间。**不改 endTime**（保持挂钟）→ session 时间线仍完整。route_points ts 从 startedAt 起等间隔铺开，可能超出 endTime → server 接受吗？看 saveHikeAtomic schema：

需查 backend 是否校验 route_points[i].t <= endTime。**若校验必修**。若不校验则安全。

### Bug 4 — Stop 弹窗 3 button（保持 Cairn 底部 sheet 风格）

**方案**:

现有 StopSummarySheet 已经是底部 sheet + scrim。**保持这个风格**，只加一个 button。

**新 3 button 布局**（横排一行）:
- **左**：`放弃` (Discard) — 中性灰，二次确认弹窗（避免误点）
- **中**：`继续` (Resume) — 灰色（原 Cancel 位置，语义清晰化）
- **右**：`保存` (Save & End) — accent 主色

Tap scrim = 继续（保留自动 Resume）。

**Discard action** 完整 5 步（subagent #1 指出必修，v430 orphan bug 复发风险）:
1. `hikeTrackWriter.discardActiveHike(sessionId)`
2. 若有 `remoteId` → `deleteRemoteSession(remoteId)`
3. `useTrackingStore.discardCurrentSession()`
4. 清 `pendingSyncStore` 里同 sessionId 的 op
5. 清 `hikeTracksCache` 里的 memory_points
6. Nav back Home

**二次确认**: 点 Discard → alert 弹 "Discard this hike? Data will be lost." → Confirm 后走 5 步。

**改动**:
- `app/src/screens/HikingScreen.tsx` StopSummarySheet actions 3 button
- 新 discardHike helper（复用 recoveryModal.onDiscard 逻辑）

**排版丑修**:
- header 加 icon + 分组明确
- memoryBanner 保留
- 3 button 有等宽间距

### Bug 5+6 — 先加 log 不修（用户拍板）

**方案**:
- 加 100% log 覆盖 pendingSyncStore + saveHikeAtomic response + recovery modal 触发条件
- 不改现有逻辑
- 下次 sprint 收到 log 后定位根因再修

**加的 log**:
- `pendingSyncStore.enqueue/drain/clear` 每次 mutation
- `saveHikeAtomic response` 完整 status + body preview
- `HikingScreen recovery useEffect` 触发时的 listActiveHikes result

**改动**:
- `app/src/services/pendingSyncStore.ts`: log 每个 mutation
- `app/src/store/useTrackingStore.ts` saveHikeAtomic 分支加详细 log
- `app/src/screens/HikingScreen.tsx` recovery useEffect log

---

## 4-eyes 接入点 1 - Round 2

v2 方案再走 subagent 双 review。上次找出的问题都在 v2 补上了：

- Bug 1 SecureStore keychainAccessible + Web fallback ✅
- Bug 2 不做 fresh GPS 请求，只修渲染顺序 ✅
- Bug 3 ts 重采样在 save 时做，不改 gpsInjector 时间累加器 ✅
- Bug 4 Discard 完整 5 步 + iOS 风格底部 sheet ✅
- Bug 5+6 只加 log 不改 ✅
