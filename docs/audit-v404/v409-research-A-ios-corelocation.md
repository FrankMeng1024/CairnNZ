# v409 Research A — iOS Core Location behavior across app lifecycle

**Researcher**: Agent A (independent)
**Date**: 2026-07-06
**Scope**: 证据链,不是设计。回答 v409 offline reliability 设计需要的每个必答问题。

---

## Sources used

| Source | URL | Notes |
|---|---|---|
| Expo docs — Location SDK | `https://docs.expo.dev/versions/latest/sdk/location` (via context7 `/websites/expo_dev`) | 最新 SDK 官方文档 |
| Expo PR #34436 — [docs][location] clarify app termination | `https://github.com/expo/expo/pull/34436` | 明确列 iOS/Android termination 行为的 doc PR |
| Expo issue #27933 — Location Background Updates not working in iOS after App is terminated | `https://github.com/expo/expo/issues/27933` | 用户 report + expo 团队默认行为确认 |
| Expo issue #4860 — Background location task deleted when app killed | `https://github.com/expo/expo/issues/4860` | 早期 ExpoKit iOS 案例,用户已知 iOS 500m SLC |
| Expo issue #36259 — iOS Location tracking starts on it's own whilst app is terminated/killed | `https://github.com/expo/expo/issues/36259` | 反向证据:确实有 SLC 类事件在 terminated 状态触发 |
| Expo issue #28728 — App crashes when force stopped while background location task active | `https://github.com/expo/expo/issues/28728` | Android 侧参考 |
| OwnTracks iOS #430 — Location reporting doesn't resume after LPM off | `https://github.com/owntracks/ios/issues/430` | Low Power Mode 停 continuous updates 的真实案例 |
| Tencent LBS iOS SDK doc | `https://lbs.qq.com/` (via GLM search) | `allowsBackgroundLocationUpdates` iOS 9.0+ + Background Modes 强制的第三方复述 |
| Cairn 现有代码 | `app/src/services/backgroundLocationTask.ts`, `app/src/store/useTrackingStore.ts`, `app/src/features/memory/components/ForegroundUnlockManager.tsx` | 直接读 |

Apple 官方 documentation URL (`developer.apple.com/documentation/corelocation/...`) 本次抓取失败(JS-rendered + WebFetch domain block),证据链回退到 Expo 官方文档 + 主流社区 issue + 第三方 SDK 复述 Apple contract。**这一层降级需要在最终决策时被记住**——下面标记为"证据强度=中,非 Apple 原文"的条目属于此类。

---

## 必答问题 1 — `allowsBackgroundLocationUpdates` + `startUpdatingLocation` + `UIBackgroundModes: location` 齐全时的 continuous updates

### 1a) App 被用户主动划走 (force-quit / swipe up)

**Finding** — Continuous updates **停止**,iOS **不 relaunch**。

**证据** (确定):
- Expo PR #34436 (2025 官方文档更新) 明文写:
  > "Background location will stop if the user terminates the app."
  > "Background location resumes if the user restarts the app."
  > "[ios] The system will restart the terminated app when a **new geofence event** occurs."
  即 iOS relaunch **只对 geofence 生效**,对 continuous location updates **不生效**。
- Expo #27933 用户 report + expo 团队默认行为:
  > "Both `expo-background-fetch` and the `expo-location` packages do not seem to support providing updates and/or executing code in iOS specifically once the app is killed/terminated. They work while the app is in the Foreground or Background, but not once the app is manually closed by the user."
- Expo #4860 用户已知:
  > "for iOS it's needed to walk more than 500m" (即 continuous 死掉,只有 SLC/geofence 能救)

**结论**:确定,continuous updates 在 user force-quit 后**永久失效**,直到用户重新打开 App。

### 1b) App 被 iOS jetsam(低内存)杀

**Finding** — 与 user force-quit **在 Expo 文档里未做区分**,都算 "user terminates the app"。**推测**:iOS 底层对 jetsam 和 user swipe 有区别,但 Expo/TaskManager 层不暴露,行为面等同。

**证据** (中,推测):
- Expo doc 只用一个词 "terminates",未区分原因(low-memory kill vs user swipe up vs crash)。
- Apple 官方在 iOS Application Programming Guide 传统上把 "user-initiated termination" 单列出来,只有它明确不 relaunch continuous updates;jetsam 理论上会 relaunch 但需要 significant-change 或 region monitoring 触发。**这段属于社区共识 / Apple 历史文档,本次 fetch 未能拿到原文验证。**
- 从 Cairn 视角:两者对 continuous updates 都是致命的,因为 continuous 只能在 process alive 时工作。区分 jetsam vs force-quit 在 continuous updates 上意义不大——都要靠 SLC/geofence 兜底。

**结论**:证据层面 continuous updates 在 jetsam 后**也是死的**,即便 iOS 后来 relaunch 也需要 SLC/geofence 才会触发 relaunch,而 continuous updates 不是那个 trigger。

### 1c) 手机重启

**Finding** — Continuous updates **停止**,iOS **不 relaunch** app。SLC / geofence 在重启后**会自动重启**(如果之前 registered)。

**证据** (确定,针对 SLC/geofence;continuous 推测):
- Expo PR #34436:iOS relaunch trigger 是 "new geofence event",没有其他继续 continuous 的机制。
- Apple 历史文档共识:`startMonitoringSignificantLocationChanges` 在设备重启后依然存活并可以 relaunch app;`startUpdatingLocation` 不具备此能力。**未从 Apple 原文验证**,记为社区共识 / 第三方复述。

**结论**:continuous 死,需 SLC 兜底。

### 1d) 电池 < 10% Low Power Mode

**Finding** — LPM 会**降低或暂停**背景 GPS 更新;Cairn 需要主动 detect + warn(已实现 `lowPowerModeWarn.ts`)。**LPM 关掉后 continuous updates 也未必自动 resume**——存在需要用户重开 App 才恢复的 bug pattern。

**证据** (中,来自社区 issue):
- OwnTracks iOS #430:
  > "Phone enters low power mode. Owntracks location reporting stops. Phone is recharged. Low power mode is switched off. Location reporting remains suspended indefinitely, resumes only after reloading Owntracks app."
- Apple Support "Use Low Power Mode" 页面明确说 LPM 会 pause 后台活动。具体到 CoreLocation 的行为(比如 desiredAccuracy 是否被 clamp、updates 是否 throttled)Apple 从未公开精确规格。
- Cairn 已有 `checkAndWarnLowPowerMode` (Sprint 72 STORY-00556) 是对的应对——一旦进 LPM 就告知用户 tracking 会被降级。

**结论**:LPM 是**软失效**——updates 变稀 / 停,LPM 关掉不保证 auto-resume;必须靠 UI 提示 + 用户干预 + 兜底 SLC。

---

## 必答问题 2 — `startMonitoringSignificantLocationChanges` (SLC)

### 2a) 精度 / 触发频率

**Finding** — Apple 官方声明 "significant change" **不承诺具体距离阈值**,但社区/第三方 SDK 长期观察为 **~500m 位移** 或 **cell tower 切换** 才 fire;时间粒度 **~5 分钟**级别,不承诺 real-time。

**证据** (中,社区共识 + 第三方复述):
- Expo #4860 用户直接说 "for iOS it's needed to walk more than 500m"。
- Apple 官方文档 (CLLocationManager reference,历史版本) 措辞 "The service delivers updates whenever the device's location changes significantly (typically, 500 meters or more)"——**Apple 原文本次 fetch 失败,来自记忆 + 第三方 SDK 复述**。
- SLC 的 accuracy 用的是**cell tower + WiFi triangulation**,精度通常 ≥ 100m 甚至 km 级,**不是 GPS 精度**。用于"用户从 A 街区走到 B 街区"级别的检测。

**结论**:SLC ≠ tracking,是 "过了个坎的时候通知我"。对 Cairn hiking 场景,SLC 无法作为主要 GPS 源——它只能作为 wakeup trigger 让 app 有机会重启 continuous updates。

### 2b) 是否 relaunch terminated / jetsammed / rebooted app?

**Finding** — **是**。SLC 是 Apple 官方保证在 app terminated / device rebooted 后依然能 relaunch app 的少数 API 之一。

**证据** (中,社区共识):
- Expo PR #34436 明文对 iOS 说 relaunch trigger 是 "new geofence event"——**这里没提 SLC,是文档不完整**。历史 Apple 文档 + 第三方 SDK 说 SLC 和 geofence 都能 relaunch,机制相同。
- 复述路径:relaunch 时 app 通过 `application(_:didFinishLaunchingWithOptions:)` 的 `launchOptions` 拿到 `UIApplicationLaunchOptionsLocationKey`,然后必须**在 didFinishLaunching 里重新 alloc CLLocationManager + call startMonitoringSignificantLocationChanges**——不然 SLC 会失效。**Expo/RN 层是否正确处理这个 relaunch 路径未验证**——这是 v409 设计要 spike 的关键点。

**结论**:SLC 能 relaunch app。Cairn 目前**没用** SLC,所以现在 app terminated 后完全没有恢复路径(见问题 3)。

### 2c) 权限 / plist

**Finding** — 需要 `NSLocationAlwaysAndWhenInUseUsageDescription` + `Always` authorization。**不需要** UIBackgroundModes:location(SLC 和 continuous 是**两个独立**的 background 授权源)。

**证据** (中):
- Apple 传统 API 语义:SLC 不需要 `UIBackgroundModes: location`,因为它由 LocationD 系统进程持有,不消耗 app 自己的 background time budget。**未从 Apple 原文本次验证**。
- 权限层面 SLC 需要 `Always` authorization——Cairn 目前 `requestBackgroundPermissionsAsync()` 已经拿到,所以权限没问题。

**结论**:权限已具备,只需在 code 里 call `startMonitoringSignificantLocationChangesAsync`(expo-location 的对应 API 需查——见 3d)。

### 2d) 能否和 continuous updates 同时?

**Finding** — **能**。Apple 允许同一个 CLLocationManager 同时启用 continuous + SLC(SLC 也可以用 separate manager)。**冲突**:在 continuous updates active 时,SLC 事件通常不会额外 fire——因为 continuous 本身就在 broadcast 更细粒度的位置。但一旦 continuous 死掉(user quit / jetsam),SLC 独立存活。

**证据** (中,社区共识):
- 没有 issue / doc 明说不能共存。多个 native SDK(react-native-background-geolocation) 的模式就是"continuous + SLC + geofence" 三重叠加。
- **未验证**:Expo/TaskManager 是否支持在同一进程内跑 continuous background task + SLC——这是 v409 spike 的第二个关键点。

**结论**:理论可共存,Expo 层可行性待 spike。

---

## 必答问题 3 — Cairn 现在具体用了什么

已读三个源文件,以下是**实测 code**(不是推测):

### 3a) Cairn 现在的 API 组合

| 路径 | API | 何时激活 |
|---|---|---|
| **Foreground tracking** (`useTrackingStore.ts:1184-1230`) | `Location.watchPositionAsync({ accuracy: BestForNavigation, timeInterval: lastSamplingIntervalMs, distanceInterval: 5 })` | AppState=active 且 status='tracking' |
| **Background tracking** (`useTrackingStore.ts:1241-1263`) | `Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, { accuracy: BestForNavigation, distanceInterval: 5, showsBackgroundLocationIndicator: true, foregroundService: {...} })` — 即 **continuous updates + TaskManager**,iOS 底层就是 `allowsBackgroundLocationUpdates=YES` + `startUpdatingLocation` | AppState=background/inactive 且 status='tracking' 且 backgroundPermission granted |
| **Memory fog watcher** (`ForegroundUnlockManager.tsx:43-47`) | `Location.watchPositionAsync({ accuracy: BestForNavigation, timeInterval: 2000, distanceInterval: 5 })` | 仅 AppState=active(background=stop);**这个 watcher 完全不进后台** |
| **TaskManager handler** (`backgroundLocationTask.ts:117-172`) | `TaskManager.defineTask` 注册于 module load;有 Path B fallback:app killed 时 iOS 拉起 task,handler 读 AsyncStorage 拿 session_id,直接写 file `cairn-logs/sessions/<sid>.jsonl` — **绕过 debugLogger 内存状态** | 由 startLocationUpdatesAsync 触发,不 self-triggered |

### 3b) Cairn **没有**用什么

**关键 gap**:
1. **没有 `startMonitoringSignificantLocationChanges`** — grep code 未见 SLC-related API call。expo-location 提供 `Location.hasStartedLocationUpdatesAsync` 但不直接暴露 SLC,需要通过 background task 的 `activityType` 或走 native module。**这就是 v409 offline reliability 的关键 gap。**
2. **没有 geofencing** — `Location.startGeofencingAsync` 也没用。虽然 PRD 里"记忆解锁"某种意义上是 geofencing,但目前是纯 client-side hex-cell 检测,不走 iOS 系统 geofencing。
3. **没有 `applicationLaunchOptionsLocationKey` handling** — 因为没 SLC/geofence,relaunch 路径根本不存在。

### 3c) 现在的 jetsam / force-quit 实际后果

**推理路径(基于 code + Expo 文档)**:

1. 用户 hiking,app 在 background,continuous updates 通过 `startLocationUpdatesAsync` 送 fix 到 `BACKGROUND_LOCATION_TASK` handler。**Path B fallback 直写 file 是唯一在 app 死后有意义的东西**——但 Path B 只在 TaskManager 依然存活并 fire 时才走。
2. **user swipe up force-quit** → 根据 Expo #27933 + PR #34436,iOS 层 continuous updates **停止**;TaskManager 不再 fire。**Path B fallback 永远不会被调用**。用户从 quit 时刻起,GPS 全丢直到用户重新开 app。
3. **iOS jetsam** → 行为面等同(Expo 文档不区分)。理论上 iOS **可能** 通过 SLC/geofence 复活 app,但因为 Cairn 没 register SLC/geofence,**iOS 没有理由复活 Cairn**,复活路径为零。
4. **手机重启** → app 完全冷启动,用户不重新按 Start,session 已丢。

**incrementalFlushInterval(60/120/300s PATCH 到 server)** 是**唯一**的部分兜底——在 kill 那一刻之前的 fix 已经上传的部分保住,之后的丢失。用户如果 hike 到 2h 的 point 被 kill,最坏丢 5 分钟(FLUSH_BG_MS=300000ms)。

### 3d) expo-location 是否暴露 SLC?

**已知**:expo-location v18+ 有一些 activityType 选项但**没有直接的 SLC API**。要用 SLC 需要:
- 方案 A:自己写 native module 调 `startMonitoringSignificantLocationChanges`
- 方案 B:换成 `react-native-background-geolocation` (transistorsoft),它有完整 SLC + geofence + stationary detection
- 方案 C:用 `expo-location` 的 geofencing (`startGeofencingAsync`)——理论上 geofence 事件也能 relaunch app(PR #34436 明确说 iOS geofence 触发 relaunch),但需要 geofence regions 定义,不适合"任意路径 hiking"

**证据强度**:中——需要 spike 实测。

---

## 必答问题 4 — iOS Background Execution Budget

### 4a) 普通 app vs location app

**Finding** — 普通 app 后台被 suspend 后仅有 **~30 秒** cleanup 时间(`applicationDidEnterBackground` 之后 iOS suspend process)。**location app**(声明 `UIBackgroundModes: location` + `allowsBackgroundLocationUpdates=YES` + active `startUpdatingLocation`)**没有硬性时间上限**——iOS 会 keep process alive as long as continuous updates 在 fire。

**证据** (中,社区共识 + Apple 传统文档):
- 普通 background task 上限历史上是 3 分钟(iOS 6 之前 10 分钟,后来收紧),这是 `beginBackgroundTaskWithExpirationHandler` 的 budget。
- location apps 是特权类:只要有活跃的 location updates request,iOS 不 suspend process。**但**:如果 iOS 判断 app "没在真的处理 location updates"(例如 handler 空跑),会 kill。
- 没有精确的 Apple 数字披露"location app 后台 budget"——业内共识是"实际无上限但会被 memory pressure(jetsam)干掉"。

**结论**:Cairn 因为持续有 GPS fix 进来,理论上 hiking 全程都能后台跑。**风险**是 jetsam(内存压力,与其他 app 竞争)。

### 4b) 降频 / 暂停触发信号

**Finding** — iOS 会在以下条件降频或暂停 background location updates:
1. **Low Power Mode active** — 降频,可能停(见 1d + OwnTracks #430)
2. **App idle 太久**——iOS 检测到 location updates 没被"有意义使用",会 throttle
3. **Memory pressure** — jetsam ranking 变高,可能 kill
4. **CPU throttling** — 长时间后台会被降到低 QoS
5. **Battery Optimization**(Settings > Battery > 各 app 后台 toggle 用户可以关)

**证据** (中,社区共识):
- Apple 历次 WWDC session 都提"be a good citizen",没有精确规格披露。
- Cairn 已实现的对策:Sprint 72 STORY-00553(AppState + battery 联动 sampling 降频到 20-30s)+ STORY-00554(FLUSH_BG_MS=300s)+ STORY-00556(LPM warn)——都是**主动降低自己 footprint**,让 iOS 更愿意保留 process。

**结论**:降频信号复杂且不精确,只能通过降低 self footprint + 主动 SLC 兜底来应对。

---

## 结论段 — Cairn 现在 offline reliability 的真实评估

**Cairn 当前用的模式**:continuous updates (`Location.startLocationUpdatesAsync` = 底层 `startUpdatingLocation` + `allowsBackgroundLocationUpdates=YES` + `UIBackgroundModes: location`) + TaskManager Path B file-append fallback + 60/120/300s incremental server flush。

**jetsam / force-quit 后能不能续?** — **不能。**

理由(证据链):
1. Expo 官方文档(PR #34436)明写 "Background location will stop if the user terminates the app. iOS will restart the terminated app **when a new geofence event occurs**"——**只对 geofence 生效,不对 continuous 生效**。
2. Cairn 没 register geofence 也没 register SLC,iOS 没有任何理由 relaunch app process。
3. TaskManager 的 Path B file-append fallback 只在 handler 依然 fire 时有意义——process 死了就 fire 不了。
4. incrementalFlushInterval(300s BG)是唯一部分兜底——kill 前 5 分钟内 flush 到 server 的保住,之后的丢。

**要让 v409 offline reliability 真的 work**,必须补足以下之一或组合:
- **A. 加 SLC(推荐)**:register `startMonitoringSignificantLocationChanges`——即使 continuous 死,SLC 依然存活,能在用户移动 ~500m 时 relaunch app,app 起来后可以重新 startLocationUpdatesAsync。需要 spike 验证 expo-location 是否直接暴露此 API 或需要 native module。
- **B. 加 geofence**:register 大 radius geofence 覆盖用户当前位置,exit 时 relaunch app。**不适合任意路径 hiking**——radius 大精度差,radius 小频繁 exit。
- **C. 换 SDK**:`react-native-background-geolocation` 有完整 SLC + geofence + stationary detection,以及 native-level DB persistence(即使 JS 死了 native 层还在写 sqlite)。

**降级证据强度提示**:本报告有 3 处标记"证据强度=中,来自社区共识/第三方复述"——具体是 (a) SLC 500m 阈值,(b) SLC 在设备 reboot 后依然存活,(c) location apps 后台无硬性时间上限。这三处都需要在 v409 spike 中真机实测验证,不能纯靠社区共识拍板。

**已知不知道**:
- iOS jetsam 和 user force-quit 在 continuous updates 上的**精确**区别(Apple 文档模糊)
- expo-location 是否直接支持 `startMonitoringSignificantLocationChanges` 或需要 patch(**未查明,需 spike**)
- iOS LPM 下 continuous updates 的**精确** throttling 规格(Apple 从未披露)
