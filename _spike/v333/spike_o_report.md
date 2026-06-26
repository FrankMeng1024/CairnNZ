# Spike O — 低功耗后台被动定位 API 调研

**日期**: 2026-06-25  
**问题**: 用户没开 hiking 时，app 在后台能否"被动记录路径"且**几乎不耗电**？  
**结论**: **能**，但路径精度从 GPS 级（5-15m）降到基站/Wifi 级（100-500m），25m cell 解锁基本失效——只能用作"今天大概走了哪一片"的填充，不能替代 hiking 模式。

---

## 1. API 能力对比表

| API | 触发条件 | 频率/精度 | 后台/被 kill | 耗电 | 权限 |
|---|---|---|---|---|---|
| **iOS SLC** (`startMonitoringSignificantLocationChanges`) | 基站切换 ≈ 500m，或 ~15min | 100-500m，**5-20点/天**（城市更多） | **app 被 kill 也能唤醒**（在 background 重启 app 5-10s） | 接近 0（复用系统已开的基站定位） | `Always` |
| **iOS CLVisit** (`startMonitoringVisits`) | 用户在某点停留 ≥ ~5min 后离开 | 仅"到/离" 2 个点 / POI，~50-100m | 同上，可唤醒被 kill 的 app | 接近 0 | `Always` |
| **Android Fused `PRIORITY_LOW_POWER`** | 主要靠基站/Wifi，无 GPS | ~100m-1km，可配 5-15min interval | 受 Doze + 后台限制；Android 12+ 需 foreground service 才稳定 | < 1% / 天 | `ACCESS_BACKGROUND_LOCATION` |
| **Android Fused `BALANCED`** | Wifi + 偶尔 GPS | ~40-100m，1-2min | 同上 | 2-5% / 天 | 同上 |
| **Android Activity Recognition** | 不定位，只识别 walking/running/driving/still | 状态变化才回调，无坐标 | 跟 Fused 配合用 | < 0.5% / 天 | `ACTIVITY_RECOGNITION` |
| **Cairn 当前**（HikingScreen，`useTrackingStore.ts:940,996`） | `BestForNavigation` + 5m distanceFilter | 1-5s/点，3-10m | foreground service | **5-15% / 小时** | `Always` |

---

## 2. 平台推荐组合

**iOS**（最优）: **SLC + CLVisit 同时开**
- SLC 拿"移动中的稀疏点"（每 500m 一个）；CLVisit 拿"停留点"。两者都是 system-managed，app 被 kill 也会被唤醒到 background 5-10s，足够写一条 record 到 SQLite。Apple 文档明确说"designed to be used with very low power consumption"。

**Android**（最优）: **Fused `PRIORITY_LOW_POWER` (interval=5min) + Activity Recognition Transition API**
- 平时 LOW_POWER 拿基站点；Activity Recognition 检测到 `WALKING/RUNNING` enter 时，**升级**到 `BALANCED` 或主动开 hiking 模式弹通知"想记录吗？"

**业界 hybrid**（transistorsoft `react-native-background-geolocation` 已实现这套）:
- stationary 状态：完全不开 GPS，只用 SLC/Activity Recognition 等待"开始动"信号
- moving 状态：升级到高频 GPS
- 这就是 Strava passive、Moves、Google Timeline 的统一打法。

---

## 3. Cairn 集成可行性

| 方案 | expo-location 直接可做？ | 需要什么 |
|---|---|---|
| **iOS SLC** | **不行**。expo-location v18 的 `startLocationUpdatesAsync` 只暴露 `accuracy/distanceInterval/timeInterval`，**没有 `startMonitoringSignificantLocationChanges` 包装**。 | prebuild + config plugin 包一层 native module，或直接换 `react-native-background-geolocation`（transistorsoft） |
| **iOS CLVisit** | **不行**，同上 | 同上 |
| **Android Fused LOW_POWER** | **半可以**。`Location.Accuracy.Lowest`（~3km）/`Low`（~1km）就是底层映射到 LOW_POWER。已是 managed 范畴。 | 直接用 `Accuracy.Lowest`，把当前 `BestForNavigation`（`useTrackingStore.ts:940,996`）换成动态切换 |
| **Android Activity Recognition** | **不行**，expo 没包 | prebuild + `react-native-activity-recognition` |

**结论**: 要做完整低功耗 passive tracking → 必须 **prebuild 或换 transistorsoft 那个库**。如果只想 Android 端做个 quick win，可以直接调 `Accuracy.Lowest`，但 iOS 端不动等于白做。

---

## 4. 耗电估算

| 模式 | iOS 4h 后台 | Android 4h 后台 |
|---|---|---|
| 当前 hiking on（`BestForNavigation`） | ~25-40% | ~30-50% |
| Hiking off，**SLC + CLVisit / Fused LOW_POWER** | **~1-3%** | **~2-5%** |

降幅 ~**90%+**。Apple SLC 的官方表述就是"negligible additional power"。

---

## 5. 缺点 + 对 25m cell 的影响

- **路径精度从 5-10m → 100-500m**。25m hex cell（v333 当前格子大小）按 SLC 间距 ≈ 500m 算，一个间距能跨 ~20 个 cell——**中间这 19 个 cell 完全看不到**。
- Memory 地图上会看到"稀疏几个 cell + 大段空白"，不能像 hiking 那样画连续轨迹。
- **唯一可行用法**: passive 点不直接喂解锁逻辑，**只用来画"今天我去过的大致区域"**（H3 res=8 或 9，~500m 格），跟 hiking 的 25m 解锁是两套系统。
- 想用 SLC 解锁 25m cell = 不可能，物理上做不到。

---

## 最终回答

**"后台几乎不耗电 + 用户打开 Memory 时路径还在" → 能做到**，但有两个硬约束：
1. **必须 prebuild**（expo-location 不暴露 SLC/CLVisit/Activity Recognition），或换 transistorsoft 库
2. **路径不是"线"，是"几个稀疏点"**——只能填"区域感"，不能填解锁。25m 解锁仍然需要用户主动开 hiking 拿 GPS 级精度。

如果只想 Android quick win，1 天工作量：把 background task 的 `BestForNavigation` 改成 `Accuracy.Lowest` + interval 5min。iOS 端必须 prebuild，工作量 3-5 天 + 一次 EAS build。
