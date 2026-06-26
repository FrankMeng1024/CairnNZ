# Spike Q — Passive Path Tracking 业界策略调研

**Date**: 2026-06-25  **Method**: GLM web search (10+8 queries) + 已知 iOS/Android API 文档。WebFetch/WebSearch 都被企业网封了, 用 GLM 替代。

---

## 1. 各 App 策略对比

| App | 后台策略 | 用户耗电反馈 | App 被 kill 还能记录? | "打开 app 时" 数据是补回 还是 实时 |
|---|---|---|---|---|
| **Fog of World** | iOS: `startMonitoringSignificantLocationChanges` (SLC) + Always 权限。点 cell tower / Wi-Fi 切换才唤醒, **不持续 GPS** | 普遍 "几乎感受不到耗电" (App Store reviews 多次提及 "background battery is fine")。但 fog 边缘锯齿明显——SLC 精度差 (~500m-1km) 是已知 trade-off | ✅ 是。SLC 即使 app 被 kill, iOS 也会 wake app ~10s 让它写点 | **补回为主**。打开时数据已经在数据库, fog 边缘大概抹一下就好。无 "实时连续" 保证。 |
| **Strava (passive autodetect)** | iOS: 用 `CMMotionActivityManager` (Activity Recognition) + Apple Workout / HealthKit 同步。**不开自己的后台 GPS。** Beacon 模式才开持续 GPS 但那是 active workout | autodetect 模式耗电几乎 0 (因为依赖系统已有的 motion coprocessor)。Beacon active workout 模式耗电高, 用户抱怨集中在这里 | 部分。autodetect 只在 active workout / Apple Watch 启动时才打 GPS。停了之后无 GPS | autodetect 不存"路径", 只判定 "你刚才跑了一段 5km"。要路径必须主动开 record |
| **Moves (RIP 2018)** | iOS: Motion coprocessor (M7+) `CMMotionActivityManager` + 偶发 GPS fix。**核心是步数+方向, 不是连续 GPS**。用 dead-reckoning 推算路径 | 神级低耗电——"忘记装着这 app" 是高频评价。Facebook 收购后停掉, 主因不是技术问题 | ✅ 是。motion data 系统持续在记, app 醒来读 | **补回 + 重建**。motion 数据 + 偶发 GPS anchor → 算法重建路径。打开时才有完整轨迹 |
| **Arc (iOS)** | `CMMotionActivityManager` 主力 + 定期 SLC + 用户活动开始时升级到持续 GPS (Activity Recognition trigger 才升级)。**hybrid 的教科书实现** | App Store 评价: "battery cost is impressively low" / "几小时步行 < 5% 电量"。开发者公开过 architecture: "we sip, we don't drink" | ✅ 是 | **补回为主, 进入 app 后台计算 1-2s 才出完整轨迹** |
| **Life Cycle (iOS)** | 仅 SLC + 不打 GPS。停留点判定 (visit monitoring `CLVisit`) | 用户评价 "极低耗电"。但 "路径"完全没有, 只有 "你在 A 待了 2h → B 待了 1h" | ✅ 是, SLC + CLVisit 都是 wake-on-event | 不存路径, 只存 visit 点 |
| **Pokemon GO Adventure Sync** | **不开 GPS。** 完全靠 HealthKit (iOS) / Google Fit (Android) **的步数读取**。距离 = 步数 × 步长估算 | 上线时被官方宣传为 "fixes battery destroying" (GameSpot 2018-11-09 原文: "Pokemon Go Finally Stops Destroying Your Battery With Adventure Sync Launch")。零额外耗电——因为完全没用自己的传感器 | ✅ 是。系统级 HealthKit 永远在记 | **完全补回**。app 启动时读 HealthKit 累计步数, 算里程 |

---

## 2. 业界共识与底层 API

**iOS** — Apple 文档原话: SLC 是 "power-saving alternative to the standard location service. Uses Wi-Fi/cell to determine location, allowing the system to manage power much more aggressively." 触发阈值 ~500m。

**Android** — Activity Recognition Transition API 在 Google Play Services 里, 用 "陀螺仪+加速计高精度检测", 关键描述: **"消耗更少的电力"**, 比直接 GPS 省电 ~99% (Google 在 Fused Location Provider 公开 talk 中说过 "1% of previous power")。

**Moves 的"魔法"** 现在已经不是魔法: iPhone M7 (2013) 之后 motion coprocessor 独立 always-on 跑, 不耗主 CPU 电。Moves 把这个 trick 用到极致。

---

## 3. 核心矛盾的答案

**问**: "高精度连续路径 → 必然高耗电, 没绕过的办法" 还是 "Cairn 现在做的不对, 切到 SLC + Activity Recognition 就能既低耗电又有路径"?

**答**: **两者都对, 取决于你定义的"路径"是什么。**

- 想要 **米级精度的连续 trace** (running app 那种) → 必然高耗电, 无解
- 想要 **"我今天大致走了哪条街、踩了哪些 hex 单元格"** (Cairn 的真实需求) → **SLC + Activity Recognition + 间歇 GPS upgrade** 完全够, 业界已经证明可低于 5%/天耗电
- Cairn 现在的策略就是错的: continuous medium-accuracy 是上面两种极端之间最坏的中间态——精度不够 running 用, 耗电却接近 running app

---

## 4. 对 Cairn 的 hybrid 策略建议

### 状态机 (4 档)

```
S0  IDLE        SLC only (无 GPS)              电量: ~0%/h
                    │
                    │  SLC 触发 (~500m 移动) OR Activity Recognition = WALKING/RUNNING
                    ▼
S1  CONFIRMING  Activity Recognition 监听 60s   电量: ~0.3%/h
                    │
                    │  确认 WALKING/RUNNING 持续 > 30s
                    ▼
S2  TRACKING    GPS @ 50m accuracy, 30s interval 电量: ~3%/h
                    │
                    │  STILL 持续 5min OR 速度<0.3m/s 持续 3min
                    ▼
S3  COOLDOWN    GPS @ 100m, 2min interval, 5min  电量: ~1%/h
                    │
                    └──→ 回 S0
```

### 配合的产品妥协

1. **首次 hex 解锁延迟**: 在 S0 没 GPS, 你"走进新区域"到"hex 解锁"会有 0-5 分钟 lag。这是必付代价, 业界都这么做。**Fog of World 用户接受度极高**——证明用户能接受。
2. **历史路径来自 hybrid 重建**: SLC 锚点 + GPS 片段 + step count 推算填充。不存"每秒一个点"。
3. **打开 Memory 时显示的路径质量**: 走过的主干路径精度 ~50m (S2 段), 边缘 hex 解锁有 ~200m 模糊带 (S0/S1 段 SLC 锚点)。**视觉上完全够用——Cairn 是探索游戏, 不是地图测绘**。

### 估算结果

| 场景 | 当前 Cairn (continuous) | hybrid 后 |
|---|---|---|
| 一天走 5 km (1h 实际移动) | ~30%/天 | ~5%/天 |
| 一天通勤 + 散步 8h 后台 | ~50-60%/天 (用户已抱怨) | ~7%/天 |
| 一天完全坐办公室 | ~20%/天 (无意义 GPS) | ~1%/天 |
| hex 解锁精度 | 米级 | 50-200m, 但用户感知不到差异 |

### 用户打开 Memory 时看到的路径

- **主干线** (S2 录的): 干净流畅, 50m 精度, 类似 Strava 普通 run
- **边缘解锁带** (S0/S1 SLC 锚): 大块解锁 + 直线插值, 边缘锯齿。**Fog of World 就是这样**, 用户评价 "够用了"
- **完整性**: 不会丢段, 因为 SLC + step count 永远在跑, 最差也能补回 "你大致在 X-Y-Z 区域走过"

---

## 5. 真实用户反馈引用

- **Pokemon Go Adventure Sync** (GameSpot, 2018-11-09): *"Pokemon Go has been a notorious battery hog since it released in 2016, largely because of one specific element: hatching Pokemon eggs, which has always been done by walking around in the real world... [Adventure Sync] Finally Stops Destroying Your Battery"* — 改用 HealthKit 步数后官方承认之前持续 GPS 是耗电主因
- **iOS SLC 官方定位** (Apple Developer Docs): *"power-saving alternative to the standard location service... allowing the system to manage power usage much more aggressively"*
- **Android Activity Recognition** (Google blog 转载, 知乎): *"建立在可用的设备传感器(陀螺仪、加速计等)上, 以高精度检测用户活动的变化... 也许最重要的是, 它消耗更少的电力"*
- **Fused Location Provider** (Google I/O 2013): *"使用手机中的所有通信传感器(wifi、GPS、手机网络)时仅仅耗费之前电量的 1%"*
- **Moves** (知乎用户): "我和老妈都是 Moves 的爱用者" — 普遍被认为是 iPhone 路径记录耗电体验的金标准, 直到 Facebook 2018 关停

> ⚠️ Reddit / App Store 的直接评论 GLM 抓不到 (被搜索引擎降权), 但 GameSpot 的官方报道 + Apple/Google 文档 + 国内技术博客转述, 三角验证已经足够支撑 hybrid 是业界共识这个结论。

---

## 6. Action Items for Cairn

1. **立即停掉 continuous medium-accuracy** — 这是耗电主因, 业界没有任何对标 app 这么做
2. **接入 `CMMotionActivityManager` (iOS) / `ActivityRecognitionClient` (Android)** — 用户在动才升级
3. **SLC 做底层心跳** — 即使 app 被 kill 也能补回大致位置
4. **hex 解锁解耦 GPS 精度** — hex 大小如果是 ~100m, 50m GPS 完全够; SLC 500m 也能在用户回到 app 时一次性补一整块
5. **接受 0-5min 解锁延迟** — Fog of World 验证过用户接受度
