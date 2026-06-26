# Spike S — Settings "后台记录" 开关真实行为

**结论先行**: **用户的担心不成立**。当前代码里 **没有真正的"后台 passive 记录"路径**。Settings 那两个开关只在 App 前台时影响 GPS,App 切后台时 GPS watcher 被强制 stop。用户描述的"放后台也能解锁 memory"在当前代码上**做不到**——除非用户主动点了 Hiking/Running。

---

## 1. Settings 里的两个相关开关

文件: `app/src/components/settings/MemorySettingsSection.tsx`

| Switch | UI 文本 | Store key | 默认 |
|---|---|---|---|
| `foregroundAutoUnlockEnabled` (toggle) | "Clear fog while the app is open" + hint "**We never track in the background.**" | `cairn:memorySettings:v2` AsyncStorage | `true` |
| `recordMode` (segmented) | "Whenever app is open" / "Only during Hiking/Running" | 同上 | `'always'` |

存储: `app/src/features/memory/store/useMemorySettingsStore.ts:21` (`STORAGE_KEY = 'cairn:memorySettings:v2'`, persist via `storage.setItem` L60-62).

**注意**: hint 文案明说 "We never track in the background" — 这是产品对用户的承诺,代码也确实是这样实现的。

---

## 2. 开关 = true 时 GPS 启动链路

唯一订阅者: `app/src/features/memory/components/ForegroundUnlockManager.tsx`

- L36-40 `WATCH_OPTIONS`: `accuracy: BestForNavigation`, `timeInterval: 2000ms`, `distanceInterval: 5m`
- L244 `Location.watchPositionAsync(WATCH_OPTIONS, ...)` — **foreground only**, 不是 `startLocationUpdatesAsync`
- L289-305 `handleAppState`: state === `'background'` → `stop()` (L298) + flush — **watcher 显式停掉**
- L307 启动条件: `AppState.currentState === 'active' | 'inactive' | 'unknown'` — background 直接不启动
- L254-257 即使 watcher 在跑,也会根据 `recordMode === 'session-only' && !sessionActive` 提前 return,不调 `processReading`

**没有任何路径让 Settings 开关本身去调 `Location.startLocationUpdatesAsync` 或 `TaskManager.defineTask`。**

---

## 3. 真正的后台 GPS 路径(仅 hiking 用)

文件: `app/src/store/useTrackingStore.ts` + `app/src/services/backgroundLocationTask.ts`

- `backgroundLocationTask.ts:23` `BACKGROUND_LOCATION_TASK = 'cairn-background-location'`
- `backgroundLocationTask.ts:117` `TaskManager.defineTask(...)` — 接 native GPS 回调
- `useTrackingStore.ts:988-1010` `activateBackgroundSource()` 调 `startLocationUpdatesAsync` (accuracy BestForNavigation, distanceInterval 5m, `foregroundService` notification)
- **所有 11 个调用点**(L317, 350, 362, 375, 380, 429, 519, 656, 686, 836, 879)**都在 `status === 'tracking'` 守卫之下** — 即必须先 `startTracking()`(用户点 Hiking/Running)
- L302 `set({ status: 'tracking' })` 只在 startTracking 流程里被设
- 没有任何代码用 `recordMode === 'always'` 去触发 `activateBackgroundSource` 或 `registerBackgroundTask` 启动

---

## 4. 数据落地

前台 watcher 的 GPS 点(`ForegroundUnlockManager.tsx:259-265`)→ `processReading()` → `unlockEngine` → `useMemoryStore` + `useH3VisitedStore` → `memoryPersistence` / `h3Persistence` (AsyncStorage) + `memorySync` (server push). 全部 in-memory + AsyncStorage,无 sqlite,无单独 raster file。

后台 hiking 时(TaskManager 路径)→ `backgroundLocationTask.ts:74` `appendDirectlyToSessionFile` → JSONL 写到 `documentDirectory/cairn-logs/sessions/<sid>.jsonl` (仅 debug session,不直接进 useH3VisitedStore — 那条路径要等 app 回前台 `drainBackgroundLocations()`).

---

## 5. 耗电对比表

| 场景 | GPS API | accuracy | interval | App state | 耗电(估) |
|---|---|---|---|---|---|
| Hiking (开 session) 前台 | `watchPositionAsync` | BestForNavigation | 2s / 5m | active | ~120 mAh/h |
| Hiking (开 session) 后台/锁屏 | `startLocationUpdatesAsync` + TaskManager | BestForNavigation | 2s / 5m + foregroundService notification | background | ~80–120 mAh/h(iOS CoreLocation Continuous,持续) |
| **Settings 开关 = ON, recordMode=always, 不开 hiking, App 在后台** | **无 GPS** (watcher 已 stop L298) | — | — | background | **~0 mAh/h** |
| Settings 开关 = ON, App 前台逛 | `watchPositionAsync` | BestForNavigation | 2s / 5m | active | ~80–100 mAh/h(屏幕+JS+GPS) |
| Settings 开关 = OFF | 完全无 watcher | — | — | any | 0 |

iPhone 15 3349 mAh:hiking 后台 16h ≈ 1280–1920 mAh ≈ **38–57%** 电量(这是真实成本,但只在用户主动 startTracking 后才发生)。Settings 开但不 hiking,后台 16h ≈ **0%**。

---

## 6. 用户原话的解释

> "settings 开启了 + 手机放后台 + 不点击 hiking → app 也会去记录路线"

**当前代码层面这不会发生**。可能的来源:

1. 用户记忆混淆 — 实际是开了 hiking 然后切后台
2. 历史版本曾有过(git log 没查),被某次 OTA(可能是 v322 ForegroundUnlockManager 迁移)移除了
3. 产品意图存在过但从未真正实现 — UI hint "We never track in the background" 明确否认了 passive 后台路径

---

## 关键 file:line 索引

- 开关 UI: `components/settings/MemorySettingsSection.tsx:60-91`
- 开关存储: `features/memory/store/useMemorySettingsStore.ts:21, 47-58, 60-62`
- 前台 watcher 启动: `features/memory/components/ForegroundUnlockManager.tsx:36-40, 244`
- 前台 watcher 后台时 stop: `ForegroundUnlockManager.tsx:289-305` (L298 stop)
- 后台 TaskManager 定义: `services/backgroundLocationTask.ts:23, 117-172`
- 后台 GPS 启动(仅 hiking): `store/useTrackingStore.ts:988-1010`
- 所有 activate 调用点均在 status==='tracking' 守卫下: `useTrackingStore.ts:300-321, 317, 350, 362, 375, 380, 429, 519, 656, 686`
