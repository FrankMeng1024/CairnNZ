# v409 Research C — 竞品离线 GPS 记录做法调研

**Researcher**: Agent C (独立调研员)
**Date**: 2026-07-06
**Scope**: Strava / Komoot / AllTrails / Gaia GPS / Runkeeper 五家 iOS 离线 GPS 记录做法,给 Cairn v409 参考
**方法**: curl 直抓官方 help center (JS-render 时 fallback grep) + GLM websearch (`glm_websearch.py --mode tools --tools-model search-std`) + WebFetch。当前机器网络对 reddit.com / duckduckgo.com / web.archive.org / google.com / help.alltrails.com / help.gaiagps.com 均**不可达** (curl timeout / TLS handshake fail / DNS fail),GLM search-pro 余额不足,search-std 返回大量无关中文结果。以下每条 finding 都标注证据强度和 URL。

---

## 证据源汇总表

| 竞品 | 主要证据源 | 抓取状态 |
|------|-----------|----------|
| **Strava** | `support.strava.com/hc/en-us/articles/216917397` (Recording an Activity) | ✅ 抓到原文 |
| **Strava** | `support.strava.com/hc/en-us/articles/216918967` (Troubleshooting GPS Issues) | ✅ 抓到原文 (Android 侧较多,iOS 部分共享) |
| **Runkeeper** | `help.runkeeper.com/en/hc/how-to-get-the-best-gps-results` | ✅ 抓到原文 |
| **Runkeeper** | `help.runkeeper.com/en/hc/understanding-your-iphone-tracking-screen` | ✅ 抓到原文 |
| **Komoot** | `support.komoot.com/hc/en-us/articles/360025155411-Recording-a-tour` | ❌ Cloudflare "Just a moment..." challenge,curl 抓不到内容 |
| **AllTrails** | `help.alltrails.com/hc/en-us/articles/360019243411-Recording-a-track` | ❌ TLS SEC_E_ILLEGAL_MESSAGE,curl 拒握手 |
| **Gaia GPS** | `help.gaiagps.com/hc/en-us` | ❌ DNS + connect timeout |

**降级方案**:Komoot / AllTrails / Gaia 三家所有官方页面本机不可达,以下相关章节的信息来自 **Cairn 团队既有认知 + WebFetch 不可达的说明**;凡不能 100% 证明的地方,明确写 "未找到公开信息"。

**Apple 官方 CoreLocation 文档同样 JS-rendered fetch 失败** (developer.apple.com/documentation/corelocation/...),iOS API 层的行为参考已在 sibling doc `v409-research-A-ios-corelocation.md` 中处理,本文档不重复。

---

## 1. Strava (iOS)

### 1.1 UI 层 — 中断后重开看到什么?

**已知** (来自 `support.strava.com/hc/en-us/articles/216917397`):

- **正常结束流程**:用户在录制过程中 → 按 Finish → 进入 Save Activity 页 → 填写标题/照片/隐私 → 点 "Save Activity" 上传。**只要没点 Finish + Save,activity 不会自动保存到 feed。**
- **强制退出行为**:官方 Recording an Activity 页面**没有明说** kill/crash 后重开的行为。间接证据:同一页写 "if you tap Discard Activity (and then confirm this choice) - there is no way for Strava to recover the activity"——这暗示 **Discard 前的状态是可 recover 的**,即本地有 draft。
- **推测**:社区共识 (Cairn 团队 domain knowledge + iOS Strava 用户经验) 是 Strava 有 "unfinished activity" 恢复机制,重开 App 会看到"是否恢复上次未保存的活动?"提示。**本次调研未能从官方 help center 抓到明文条款证实此推测——Strava 有一篇曾经存在的 "Unfinished Activities" 文章 (`/hc/en-us/articles/216919097-Unfinished-Activities`) 现在 302 到 help home,该 slug 存在说明历史上有过这条,但当前无法拉到内容**。

### 1.2 iOS API 推测

**证据不足直接说**:社区讨论未抓到。基于 Strava 支持的功能倒推:
- **continuous location updates + `allowsBackgroundLocationUpdates`** — 必需。Recording an Activity 明说 "While recording, there is no data usage unless you view the maps ... Otherwise, the app uses GPS while recording",意味着录制期依赖设备 GPS 而不是网络定位。
- **是否 + significant-change / region monitoring** — 未找到公开信息。Strava 用 Apple Watch 或 iPhone Live Activity 做 off-route alert,这暗示他们有背景计算,但**用什么 API 兜底 iOS 杀 App**没有官方声明。

### 1.3 数据储存

**已知** (从 Recording an Activity 页推断):
- "typically about 1MB for two hours of recording"——2h ~1MB,即**约 140 bytes/point** (假设 1s 采样)。这个大小暗示 activity 是二进制或 protobuf,不是 verbose JSON (Cairn 现在 82 bytes/point,已 compact)。
- 本地存储技术栈**未找到公开信息**——Strava 是 native iOS app (Objective-C/Swift),常见做法是 Core Data + SQLite backing,但无官方声明。

### 1.4 上传策略

**已知**:
- "if you can wait for a WIFI connection to sync the activity or view the feed, you can prevent all cellular data usage"——即**手动 defer 到 WiFi 是可选的**,不是默认 WiFi-only。
- 默认行为:点 Save Activity 后**立即上传** ("uploaded to your feed immediately")。
- Retry logic:未找到公开信息,但同一段说 "after it is done syncing" 暗示有异步 sync 队列。

### 1.5 磁盘管理

**已知**:未找到公开信息说用户能看到 activity 本地缓存 size 或清理入口。官方页面里没有 "clear cache" / "storage usage" 类描述。

---

## 2. Komoot (iOS)

**证据状态**:所有 `support.komoot.com/*` 页面被 Cloudflare 挑战拦截,curl 只拿到 "Just a moment..." challenge page (`__cf_chl_tk` token 页面),没有正文。Reddit 和其他社区讨论本机不可达。

**未找到公开信息**:
1. UI 层:App 被 kill 后重开是否 resume tour recording — 无法核实。
2. iOS API:continuous / SLC / region monitoring 组合 — 未找到公开声明。
3. 本地存储:SQLite / Core Data / 文件 — 未找到公开声明。
4. 上传策略:WiFi-only / auto sync / manual — 未找到公开声明。
5. 磁盘管理:Komoot 有离线地图区域下载和管理入口(**已知**,来自 Cairn 团队 domain knowledge + Komoot 常识),但**轨迹**缓存的独立管理入口未证实。

**间接推断** (不作为决策依据,仅供参考):Komoot 在旅行/骑行社区里因"tour recording 可靠"评价较高,如果 iOS 杀 App 就丢数据,不会有这个口碑——**推测**他们做了某种本地持久化 + 后台任务组合。但**本次调研没有一手证据**。

---

## 3. AllTrails (iOS)

**证据状态**:`help.alltrails.com/*` 所有页面 curl TLS 握手失败 (SEC_E_ILLEGAL_MESSAGE)——这类 error 通常是 CDN 拒绝老 TLS client 或 SNI 问题,本机 schannel curl 走不通。WebFetch 也被域名 policy block。

**未找到公开信息**:五个必答问题全部无法从官方渠道核实。

**间接推断**:AllTrails 允许 Pro 用户下载 offline map bundle,证明他们有成熟的本地磁盘管理框架。但**轨迹录制**的具体持久化方式没有官方说明可抓。

---

## 4. Gaia GPS (iOS)

**证据状态**:`help.gaiagps.com` DNS + connect timeout,完全不可达。

**未找到公开信息**:五个必答问题全部无法从官方渠道核实。

**间接推断**:Gaia GPS 是背包/越野社区的重度工具,tracks 是核心功能;社区常识里 Gaia 会保留未结束的 track 并在重开时提示 resume——但**本次调研没抓到一手证据**。

---

## 5. Runkeeper (iOS)

**证据状态**:`help.runkeeper.com` 全部可达 (走 HubSpot CDN,不走 Cloudflare/Zendesk),curl 直接抓到原文。

### 5.1 UI 层 — 中断后重开看到什么?

**已知** (来自 `help.runkeeper.com/en/hc/understanding-your-iphone-tracking-screen`):

- 正常流程:Tracking Screen → Pause → Resume 或 Stop & Save → Review and Save 页(可加 note/photo)→ Save。
- **强制退出行为**:官方文档**没有描述 kill/crash 后重开的自动 resume 行为**。这不代表没有,而是官方 help center 里没写。

### 5.2 iOS API 推测

**已知**:官方 GPS troubleshooting 页 (`how-to-get-the-best-gps-results`) 只提到 Location Services 权限、Airplane Mode、cache 清理这类**用户可操作**的调优,没有描述 App 用什么 CoreLocation API。

**未找到公开信息**:continuous / SLC / region monitoring 组合。

### 5.3 数据储存

**未找到公开信息**。Runkeeper 是 ASICS 旗下的老牌 native iOS app,但没有公开的技术架构文档。

### 5.4 上传策略

**未找到公开信息** — 官方 tracking 页面只写 "save activity",没写上传时机策略。

### 5.5 磁盘管理

**已知**:官方文档提到 "Fix GPS" 功能——用户可以在活动**保存后**用 App 内工具**平滑 GPS 抖动**。这是**后处理**而不是**恢复**,说明 Runkeeper 承认 GPS 数据可能不完美,提供的方案是 smoothing 而不是 re-record。

**未找到公开信息**:活动本地缓存的独立清理入口。

---

## 6. iOS "杀 App 后数据不丢" 的普遍套路 (跨行业共识,不针对某家)

**这一节是社区共识 + Cairn 团队 domain knowledge + 现有 iOS 开发文档常识,不来自本次五家竞品的一手 fetch——请这样定位。**

### 6.1 持久化时机

不能等到用户点 Save 才写盘。iOS 后台运行的 App 随时可能被 jetsam / crash / user swipe 干掉,所以业界共识做法是:
- **每个 GPS callback 触发**都做增量落盘 (append 或 upsert 到 SQLite/JSONL/protobuf file)
- **AppState background 事件**触发 flush + fsync (`file.close()` 或 SQLite `BEGIN IMMEDIATE ... COMMIT`)
- 存 session metadata (start_ts, session_id, "in-progress" flag) 到独立小文件或 UserDefaults,重开时优先读它

### 6.2 重开检测机制

- App 启动时读 session metadata → 如果有 "in-progress" 记录 + 时间戳在合理窗口 (通常 24h 内) → prompt 用户 "resume" or "discard"
- **区分 iOS relaunch vs 用户主动开** — Expo TaskManager 有 `TaskManager.isTaskRegisteredAsync`,原生 iOS 用 `application:didFinishLaunchingWithOptions:` 里检查 `UIApplicationLaunchOptionsLocationKey` (由 CoreLocation SLC/region 触发)

### 6.3 iOS 杀 App 后继续录的三种业界套路

1. **`allowsBackgroundLocationUpdates + startUpdatingLocation`** — user force-quit 后就死,依赖用户重开
2. **+ `startMonitoringSignificantLocationChanges` (SLC)** — 500m 或 5min 触发一次,系统重启 / user force-quit 后**依然存活**,可以 relaunch App 到 background 状态跑短代码 (~10s CPU time)
3. **+ region monitoring / geofence** — 精确点触发,更省电但要预先注册区域

**Strava/Komoot/AllTrails/Gaia/Runkeeper 具体用哪些组合,本次调研没有一家有官方声明**。

### 6.4 磁盘管理

- **业界共识**:活动本地缓存 = 已 upload 的可自动清 + 未 upload 的必须保留 + user manual clear 入口 (通常在 Settings > Storage)。
- **五家竞品是否遵守这个模式**:未找到公开信息。Komoot 的**离线地图**明确有管理入口 (**已知**),但**轨迹**没证实。

---

## Cairn 可借鉴的 3 条

以下三条**都是可从本次五家竞品的公开行为归纳出的模式**,不需要 iOS 私有 API,也不需要 EAS build 重新配置:

### 借鉴 1 — 显式 "unfinished activity" 恢复 UI + 提示,不要静默丢

**依据**:Strava 明写 "if you tap Discard Activity ... there is no way for Strava to recover the activity",反过来讲**没 Discard 之前的状态是可恢复的**——说明 Strava 有 draft state + 重开时恢复 UI,即便他们不公开机制。

Cairn 现状 (从 `v409-research-B-storage.md` 读):session in-progress 状态存在 `useSessionStore` + AsyncStorage,但**没有明确的重开 resume prompt UI**。用户如果 iOS 杀 App,重开看到的是启动到主页,session 数据是否保留取决于 store rehydrate 逻辑——**这是可以低成本改进的点**:AppState active 事件里检测 in-progress session 且距 start_ts < 24h,显示一个 "Continue hike?" bottom sheet。

### 借鉴 2 — 上传策略给用户选择权 (auto vs WiFi-only),而不是全自动或全手动

**依据**:Strava 明写默认 "uploaded to your feed immediately" 但**在同一段落**提供 "wait for a WIFI connection" 作为**用户主动选项**。这是"默认自动 + 可选延迟"的 hybrid 模式——不像有些 App 强制 WiFi-only(数据孤岛)或强制 auto(耗流量)。

Cairn 现状:`telemetryUploader.ts` 是自动 flush,没有用户可见的 "sync only on WiFi" toggle。**低成本改进**:Settings 里加一个开关,默认 auto,用户可切 WiFi-only,配合 `NetInfo` 检测 connection type。

### 借鉴 3 — 保存后的 GPS 后处理,不追求实时完美

**依据**:Runkeeper 有 "Fix GPS" 后处理工具,承认活动录完之后 GPS 可能有 drift/spike,提供 App 内 smoothing 而不是要求用户 re-record。这是**降低现场负担 + 保住用户信任**的组合拳。

Cairn 现状:v402 引入 hike-save snap-to-road (从 recent commit),这已经在做类似的事情。可以借鉴的是**给用户一个可见的入口** ("修正轨迹"按钮) + 保留原始+修正后两份,而不是仅在 save 时静默应用。这样即便 snap 出错,用户可以看到原始数据。

---

## 附录:未能核实的关键问题清单

以下问题**本次调研没有一手证据**,需要下一步实机测试或找到可达的社区讨论:

1. Strava iOS "unfinished activity" 恢复的**具体触发条件** (时间窗口?是否要求 activity 已有 > 0 GPS 点?)
2. Komoot / AllTrails / Gaia 三家**任何**离线录制细节
3. 五家中**是否有人**用 significant-change / region monitoring 兜底 continuous updates
4. 五家的**本地存储技术栈** (SQLite? Core Data? Realm? 自定义文件?)
5. 五家的**磁盘配额和自动清理策略**

**建议**:如果 v409 决策需要这些数据,下一步应当是 (a) 在**能访问 Reddit / 官方社区论坛**的网络环境重跑 curl 抓取,或 (b) 直接实机装 5 家 App 做**离线 kill 测试** — 这比继续网络 fetch 高效。
