# O1 反馈修复方案（Batch 28）

用户 2026-07-26 拿到 O1 OTA 后真机反馈 6 个 bug。按"接入点 1: 修改前 review 方案"先出方案，再 subagent 双验，再动手写。

## Bug 1 — Remember-me 密码没存

**用户原话**: "每次重开 app 点了 remember 密码都没存 下次又要填 以前对的"

**根因**: O1 batch 24 (R23#1) 我把 Remember-me 改成"只存 email 不存 password"（因为存明文触发 OWASP M2）。用户不接受 UX 降级。

**方案**: 用 `expo-secure-store` 加密存 password（iOS Keychain / Android Keystore），不走 AsyncStorage。tokenStore.ts 已在用 SecureStore 存 JWT，复用同套。

**改动**:
- `app/src/screens/AuthScreen.tsx`: 
  - `REMEMBER_ME_KEY` 从 AsyncStorage 迁到 SecureStore
  - hydrate: SecureStore.getItemAsync → 拿 { email, password } → 都预填
  - persist: SecureStore.setItemAsync({email, password})
  - unmount: 若用户取消 remember-me 勾选 → deleteItemAsync
- 保留 silent migration: 若 AsyncStorage 有老 { email, password } 明文数据 → 迁到 SecureStore → 删 AsyncStorage 老 key

**为什么这个 OK 不是 OWASP M2**:
- iOS Keychain / Android Keystore 硬件加密
- 越狱/root 也拿不到（需 device passcode）
- 备份提取需 device 解锁
- Web 端（Playwright）SecureStore 降级到 localStorage — 但 Web 是 dev/QA 用途，不是生产

## Bug 2 — Memory 位置/地图不同步 + 用了缓存位置

**用户原话**: "memory 里当前位置和地图出现时间不一样 有先后 应该都是loading里处理完的 一次出现。而且memory有记录读取上次的位置，而不是真正的目前位置"

**根因**: 
1. MemoryScreen 先显示地图，蓝点后 pop up → 顺序渲染 race
2. MemoryScreen 用 `useMemoryStore.setLastWatcherFix` 缓存的最后一次 GPS，不是当前真实位置

**方案**:
- MemoryScreen: mount 时先 request 一次 fresh GPS → 拿到位置后再一起渲染地图 + 蓝点
- 在 loading 状态里等 fresh GPS（超时 5s → fallback lastWatcherFix + 显示 "使用缓存位置" 提示）
- 地图 + 蓝点用同一 `location` state，同一渲染批次

**改动**:
- `app/src/features/memory/screens/MemoryScreen.tsx`:
  - 加 `initialLocation` useState，从 fresh GPS 拿
  - loading state 等 initialLocation 或 5s timeout
  - 地图 initialCameraCenter + 蓝点位置都用 initialLocation

## Bug 3 — sim-walker 速度慢（产品需求）

**用户原话**: "1.4太慢了。1200也太慢了 基本上走不动 我期待的是 我屏幕上可以按照之前给你的参数 很快移动 但是你底层要和真实走路一样模拟距离海拔等"

**能做到吗**：能。方案 B。

**方案**:
1. **屏幕视觉快**: `emit_ms=200ms`, `step_m=3m` → 屏幕每秒走 15m（很流畅）
2. **底层时间模拟真实**: emit ts 不用 `Date.now()`，而是**模拟时间累加器**
   - `simTimeOffsetMs`: 每 tick 增加 `stepM / REAL_WALK_SPEED(1.4m/s) * 1000` ms
   - emit ts = `simStartMs + simTimeOffsetMs`
   - 存到 useTrackingStore 的 `t` 是模拟时间 → session duration 计算真实

**效果**:
- 屏幕: 15m/s 视觉（1s 走 15 米）
- 存的数据: 3m/2.1s = 1.4m/s 真实步速 → session.duration ≈ 1.4m/s * distance
- Memory point CULL (12.5m 一点) 按真实距离触发
- Elevation gain 累积按真实海拔漂移

**改动**:
- `app/src/dev/simWalker/gpsInjector.ts`:
  - constructor 初始化 `simStartMs = Date.now()`, `simTimeOffsetMs = 0`
  - tick: `simTimeOffsetMs += (stepM / 1.4) * 1000`
  - emit ts = `simStartMs + simTimeOffsetMs` (替换 `Date.now()`)
  - `lastCoordinateTime` 同用模拟时间
  - `DEFAULT_STEP_CONFIG`: step_m 1.4→3, emit_ms 1200→200
  - UI 标签 `拖动走 · 1.4m/1.2s` → `拖动走 · 3m/200ms(真实 1.4m/s)`

**边界考虑**:
- 重新 start hiking 时 simStartMs 重置为 startedAt
- 用户暂停/继续 sim-walker（strength=0）→ simTimeOffsetMs 不加（不动）
- session.endTime 用最后一 emit 的模拟 ts

## Bug 4 — Stop 弹窗缺放弃/退出 + 排版丑

**用户原话**: "stop里只有 resume 和 save&end，其中 resume 应该就是 end 并且是放弃这次的意思 因为点其他地方自动 resume 了 但是我们缺少一个退出的地方 然后弹窗的内部排版步行 很明显很丑"

**根因分析**:
- 当前 stop 按钮弹窗有 2 选项: Resume / Save & End
- 用户实际想要 3 选项: **继续 / 放弃这次 / 保存并结束**
- "resume" 语义混乱: 用户点其他地方自动 resume，那这个 button 应该是"放弃"
- 排版丑: 需要重新 review UI

**方案**:
- 3 button 弹窗:
  - **继续 hiking** (Continue) — 关弹窗回 tracking 状态
  - **放弃这次** (Discard) — 弃 session，回 home，不保存
  - **保存并结束** (Save & End) — 现有行为
- 排版重做: 明显分组 (Continue 主色 | Discard 危险色 | Save 主色)

**改动**:
- `app/src/screens/HikingScreen.tsx`: 找 stop 弹窗 → 加 Discard button + UI 排版
- Discard action: 清 session state + nav home 不写 session

## Bug 5 — Save&end 错弹"上次未完成" + loading route 卡

**用户原话**: "点save&end 后 弹出了 上次hike未完成，这个明显不正确。这里的弹窗出现了时机的问题。 保存的t那条 显示 loading route 一直是这样"

**根因分析**:
- Save & End 触发 session finalize + navigate home
- HikingScreen mount 时会检查 "有没有 unfinishedSession" → 弹 recoveryModal
- 时机问题: session save 完成前 → HikingScreen 又 mount → 看到自己刚 save 的 session → 认为是"上次未完成"
- Loading route 卡: session card 加载路径 preview 时永远转圈 = 缺 error 兜底 or preview 数据未 write

**方案**:
- Recovery modal 触发条件收紧: **只查 `syncState=='pending'` 且 `finalized_at IS NULL` 的 session**。刚 save 的 session finalized_at 已写 → 不匹配
- Loading route 修: 检查 route preview 组件是否等 API,加 timeout + fallback empty state

**改动**:
- HikingScreen recovery modal 触发条件加严
- MapHistoryScreen (activities list) route preview loading state 加 timeout

## Bug 6 — Home 假 pending sync

**用户原话**: "现在有网的 但是home page展示 1 hike pending sync 并且也没有去同步，注意我是有网的。并且这条也不存在没sync 因为t已经生成了"

**根因分析**:
- Home 页 "1 hike pending sync" 来自 pendingSyncStore 或 useSessionStore
- 有网未同步 = SyncDaemon 没 fire 或 payload 无效循环重试
- t 已生成 = session finalize 成功但 pendingSyncStore 里还留有老 op
- **可能与 Bug 5 关联**: save&end 走的路径写了个 pending op 但没消化

**方案**:
- 查 pendingSyncStore 里 op 的实际 kind + retry 次数
- 若 SyncDaemon 停了: 恢复触发
- 若 op 已过时 (session 已 sync): 清老 op
- 加 Home 页手动 "重试" 按钮 (点了触发 drain)

**改动**:
- 需先 debug 定位: pendingSyncStore 里到底是啥 op
- 若 batch 24 offlineQueue race fix 相关: 检查 drainStartIds 逻辑是否过滤掉了正常 op

## 4-eyes 接入点 1 结束标志

**上面 6 个 bug 方案打好后**:
- subagent #1 review 找漏洞
- subagent #2 review 找漏洞（不同角度）
- 用户审

**审通过才动手写代码**。
