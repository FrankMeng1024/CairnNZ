# Spike P: HealthKit / Health Connect 路径回填可行性

**日期**: 2026-06-25
**问题**: 能否从 iOS HealthKit / Android Health Connect 拉回过去 N 天的步行/跑步路径，零耗电补全 Cairn Memory 地图，不用自建后台 GPS。

---

## 1. iOS HealthKit — 能拉到什么

| 数据类型 | 是否被动记 | 是否含 GPS 路径 |
|---|---|---|
| `HKQuantityTypeIdentifierStepCount`（步数） | ✅ iPhone/Watch 自动记 | ❌ **无 GPS**，只是计数 |
| `HKQuantityTypeIdentifierDistanceWalkingRunning` | ✅ 被动 | ❌ 无路径 |
| `HKWorkoutType` + `HKWorkoutRoute` | ❌ **只有用户主动开 Workout** | ✅ 含 CLLocation 数组（lat/lon/alt/timestamp） |

**结论**: HealthKit 的"被动步数"**完全不带 GPS**。带路径的只有 `HKWorkoutRoute`，而 `HKWorkoutRoute` 只在 Apple Watch Workout app（或第三方 Strava/Nike Run 等写回 HealthKit 的 app）主动开始一次锻炼时才生成。普通走路 iPhone 后台**永远不会**自动生成 workout route。

**接入**: `react-native-health` (Bio-Consc fork 维护) 提供 `getWorkoutRouteSamples({ id: workoutUUID })` 直接返回坐标数组。expo 需 prebuild（非 Expo Go 兼容），Info.plist 加 `NSHealthShareUsageDescription` + HealthKit capability。难度低。

---

## 2. Android Health Connect — 能拉到什么

Google Fit 2026 年底关停，Health Connect 是唯一未来路径。

| 数据类型 | 被动？ | GPS 路径？ |
|---|---|---|
| `StepsRecord` | ✅ Pixel/Samsung Health 自动记 | ❌ 无 |
| `ExerciseSessionRecord` + `ExerciseRoute` | ❌ 需 app 主动写入（Google Fit Workouts/Strava/Samsung Health Workout） | ✅ 含 lat/lon/time/altitude |

**结论**: 与 HealthKit 镜像问题。被动步数无 GPS；路径只附在主动 ExerciseSession 上。Android 14+ 才支持 `ExerciseRoute` 读取，更老设备直接没有。

**接入**: `react-native-health-connect` (matinzd) — Android only，无 Expo Go，需 prebuild + minSdk 26。

---

## 3. 真实覆盖率估算

- **Apple Watch 渗透**: 美国 iPhone 用户约 30% 有 Watch；其中**经常主动开 Workout 的约 40-50%**。粗估全球 iOS 用户中**仅 10-15% 会有可用的 HKWorkoutRoute**。
- **iPhone-only 用户**: 几乎为 0 — iPhone 自身不会自动生成 workout route，只有用户在 Fitness app 主动 "Start Workout" 才会，绝大多数人不会这么做。
- **Android**: Health Connect 普及率更低；ExerciseRoute 需 Android 14 + 主动锻炼 app。覆盖率 < 10%。

**净结果**: **预计 5-15% 用户能拉到任何路径数据**，且这些用户本来就是 fitness power user — 他们的"路径"是 workout 时段，不是日常通勤走路。

---

## 4. 隐私 / 审核风险

- HealthKit/Health Connect 是 Apple/Google 最敏感的权限类别。
- App Store 审核要求 `NSHealthShareUsageDescription` 文案非常具体，**必须说明每一种读取的数据类型的具体用途**；模糊文案（"提升体验"）会被打回。
- 2026 年 Apple 收紧医疗类 App 审核（详情页需标注是否为"受监管医疗设备"），Cairn 不属于此类但权限合理性会被严查。
- 用户首次弹窗会逐项勾选，体感"很重"。Memory 地图补全用作来由，可解释但门槛高。

---

## 5. 核心结论

**❌ 这条路不能解决"打开 Memory 时自动补全过去路径"的需求。**

**原因**:
1. **被动路径不存在** — iOS/Android 系统都不被动记录日常步行 GPS 路径。只记步数。
2. **主动 Workout 覆盖率太低** — 预计 5-15%，且只覆盖"锻炼时段"，不覆盖普通通勤/散步。
3. **审核 + 用户摩擦高** — 拿到的数据少，付出的隐私文案/弹窗代价大。
4. **数据形态不匹配** — Cairn Memory 需要"任意时刻经过哪些地方"，HealthKit/HC 给的是"某次锻炼的路径"，两者语义不同。

**可行的补充用法（不是主用法）**:
- 作为 **opt-in 增强**：用户已经在用 Apple Watch 跑步/骑行，弹一次"导入历史路径"，对 fitness 用户能一次性补 N 个 memory 点。
- 不能作为通用路径回填方案。

**推荐方向**:
- 真正的"过去路径"只能来自:
  - (a) Cairn 自己后台 GPS（耗电、需 Always permission，但唯一覆盖全部用户）
  - (b) Photos 库 EXIF GPS（被动、零耗电、覆盖率取决于用户拍照频率）— **这条路才是 HealthKit 的真正替代品**，建议下一个 spike 调研

---

**接入难度速查（如果决定做 opt-in 增强）**:
- iOS: `react-native-health` + prebuild + HealthKit capability + Info.plist，约 0.5 天
- Android: `react-native-health-connect` + Android 14+ 限制 + prebuild，约 0.5 天
- Expo Go 不可用，必须 dev build / EAS build
