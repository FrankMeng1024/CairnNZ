# Spike N — Cairn 后台 GPS / auto-track 实际策略与耗电

只读分析。结论先行: **当前 auto-track 与 hiking session 用的是同一档 GPS（BestForNavigation），但只在 app foreground 跑；后台真正持续 GPS 仅在 hiking session 启动后才开启。所以"后台 auto-track 一直高耗电"目前并不存在 — 但 foreground 下 auto-track 用了最高档功率，且与 hiking 没有功率分离，这是一个等价红线。**

## 1. GPS 触发点清单

| # | 文件:行 | accuracy | timeInterval | distanceInterval | 前/后台 | 触发条件 |
|---|---|---|---|---|---|---|
| 1 | `app/src/features/memory/components/ForegroundUnlockManager.tsx:36-40, 244` | `BestForNavigation` | 2 000 ms | 5 m | **仅前台** | `foregroundAutoUnlockEnabled`（默认 true）+ 登录 + AppState=active。background → `stop()` |
| 2 | `app/src/store/useTrackingStore.ts:938-943` (foreground watcher) | `BestForNavigation` | `lastSamplingIntervalMs`（默认 3 000 ms，动态） | 5 m | 前台 | hiking session 开始（用户主动） |
| 3 | `app/src/store/useTrackingStore.ts:995-1005` (background TaskManager) | `BestForNavigation` | 同上 | 5 m | **后台** (`UIBackgroundModes:["location"]` + `foregroundService`) | hiking session 启动 + 用户授予 Always 权限 |
| 4 | `app/src/services/backgroundLocationTask.ts:117` (TaskManager handler) | 由 #3 配置驱动 | — | — | 后台 | 仅在 #3 active 时才有 fix 流入 |
| 5 | `app/src/features/plant/services/gpsSampler.ts:108-113` | `BestForNavigation` | 250 ms | 0 m | 前台 | 用户主动 "plant"，5s 窗口后必停（`watcherSub.remove()` line 192-194） |
| 6 | `app/src/screens/ARScreenLegacy.tsx:836` | (heading only, `watchHeadingAsync` 路径) | — | — | 前台 | AR 屏幕，非 GPS |

`app.json:26-29` 含 `UIBackgroundModes: ["location", "audio"]`；`app.json:39-47` Android 含 `ACCESS_BACKGROUND_LOCATION`。后台能力开了。

## 2. 后台 GPS 实际状态

- **没有"独立后台 auto-track"模块**。`foregroundAutoUnlockEnabled` 即"地图迷雾随走动清除"，但它的 watcher (FGUM) 在 AppState `background` 时显式 `stop()`（`ForegroundUnlockManager.tsx:282-302`）。
- 真后台 GPS 唯一入口 = `activateBackgroundSource()`（`useTrackingStore.ts:988-1010`），**只有用户主动 startTracking 进入 hiking session 才会调用**。session 停 → `stopLocationUpdatesAsync`（line 519, 836, 879, 1015）。
- 无 SLC (Significant Location Change) 模式；无 geofence；无低功耗后台档。

## 3. 耗电估算（每天后台 20h 假设）

`BestForNavigation` 在 iOS = 持续 GNSS chip + 加速度计 + 磁力 fusion，典型 ~75 mA。

- **若后台真在跑 hiking session 20h**: 75 mA × 20 h ≈ **1 500 mAh/天** — iPhone 15 电池 ~3 350 mAh，等于一天烧掉 45%，红线确认。
- **当前实际**（FGUM 后台已 stop, hiking 用户主动停）: 后台 0 mA / 天，仅 foreground 时 #1 + #2 同时跑（重复订阅同一档）。
- **未分离的隐患**: hiking session 与"散步顺便清雾"用同一份 `BestForNavigation` + 5m distanceInterval，散步场景 200 mA·h（2h foreground）也不划算。

## 4. 当前是否已有"低功耗后台"策略

**没有**。证据:
- 全仓搜 `Balanced`, `Low`, `Lowest`, `LocationAccuracy.Low`, `startMonitoringSignificantLocationChanges`: 零命中
- FGUM `WATCH_OPTIONS` 写死 `BestForNavigation`（`ForegroundUnlockManager.tsx:37`），无低功耗分支
- `lastSamplingIntervalMs` 动态调（`useTrackingStore.ts:411-421`）但 accuracy 档位从不降级

## 结论给产品

1. **后台一直 GPS = 仅在 hiking session 时**；auto-track（FGUM）后台时已被 stop，**当前没有"后台 auto-track 持续耗电"问题**。
2. **真正的红线**: foreground auto-track 与 hiking 同档（BestForNavigation + 2s + 5m），用户开着 app 散步时电耗等同导航。需要为 auto-track 引入独立低功耗档（建议 `Balanced` + 10s + 50m）。
3. **未来若把 auto-track 推到后台**（产品方向暗示），必须先实现 SLC 或低功耗档，否则 1 500 mAh/天 直接超用户耐受。

## Key file:line refs
- `app/app.json:26-29` (iOS UIBackgroundModes)
- `app/src/features/memory/components/ForegroundUnlockManager.tsx:36-40` (auto-track WATCH_OPTIONS — BestForNavigation)
- `app/src/features/memory/components/ForegroundUnlockManager.tsx:289-302` (后台时 stop)
- `app/src/store/useTrackingStore.ts:938-943` (hiking foreground watcher)
- `app/src/store/useTrackingStore.ts:995-1005` (hiking background TaskManager)
- `app/src/services/backgroundLocationTask.ts:23, 117` (TaskManager 注册)
