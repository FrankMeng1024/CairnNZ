# Debug Logger Spec — Cairn

**Version**: 1.0
**Created**: 2026-05-18
**Status**: Approved (Sprint 55-58 执行依据)
**Source**: 用户审批plan + Phase 1代码探索

---

## 目的

为Cairn项目建立结构化日志基础设施，让真机测试产出**客观、可分析、可对比**的数据，而不是体感评价。

**前提问题**（来自审计）：当前代码"功能完整"是未经真机验证的声明，且没有日志支撑客观验证。

**目标读者**：Frontend Dev（实施埋点）、QA（验证log完整性）、DevOps（分析脚本环境）。

---

## 1. 四层日志架构

| 层 | 名字 | 频率 | 持久化 | 用途 |
|---|---|---|---|---|
| **L1** | 实时console | 立即 | ❌ | 开发期定位bug |
| **L2** | 结构化事件 | 每个event一条 | ✅ JSON | **核心**：偏离/精度/播报/电池/网络 |
| **L3** | 分钟快照 | 每60s一条 | ✅ JSON | 时间序列：电池曲线/采样频率/内存 |
| **L4** | 用户标注 | 用户主动按 | ✅ JSON | 体感钉在GPS+时间戳 |

L2/L3/L4 写入同一个session JSON文件（按时间戳混合排序）。

---

## 2. L2 事件Schema（11类）

每条事件最小公共字段：
```typescript
interface BaseEvent {
  ts: number;          // Unix ms
  session_id: string;  // UUID
  event: string;       // 事件类型
}
```

### 2.1 `gps_fix` — 每次GPS update（raw）
```typescript
{
  ...base,
  event: "gps_fix",
  lat: number,
  lon: number,
  accuracy_m: number,      // expo-location coords.accuracy
  altitude_m: number | null,
  altitude_accuracy_m: number | null,
  speed_mps: number | null,
  heading_deg: number | null,
  raw_or_filtered: "raw"   // 这条是raw的，filtered见kalman_output
}
```

**埋点**：`app/src/store/useTrackingStore.ts` line 109-123 的`watchPositionAsync`callback第一行。

### 2.2 `kalman_output` — Kalman filter输出
```typescript
{
  ...base,
  event: "kalman_output",
  input: { lat, lon, accuracy_m },
  output: { lat, lon },
  gain_lat: number,
  gain_lon: number,
  process_noise: number,
  measurement_noise: number
}
```

**埋点**：`app/src/utils/geo.ts smoothGPSPoint` line 292-338 函数末尾return前。

### 2.3 `deviation_start` / `deviation_end` — 偏离开始/结束
```typescript
// deviation_start
{ ...base, event: "deviation_start", route_id: string, distance_m: number, lat, lon }

// deviation_end
{ ...base, event: "deviation_end", route_id: string, max_distance_m: number, duration_s: number }
```

**埋点**：`app/src/services/routeDeviationService.ts` 偏离状态变化的两个分支。

### 2.4 `broadcast_played` — 每次播报
```typescript
{
  ...base,
  event: "broadcast_played",
  priority: "P0" | "P1" | "P2",
  category: "danger" | "supply" | "junction" | "scenic" | "deviation" | "waypoint" | "weather",
  message: string,
  duration_ms: number,           // TTS播放时长
  trigger_to_play_latency_ms: number,  // 从事件触发到TTS开始的延迟（NFR <2s）
  audio_ducked: boolean,         // 是否压低了背景音乐
  app_state: "active" | "background"
}
```

**埋点**：`app/src/services/broadcastService.ts playBroadcast`函数。

### 2.5 `battery_sample` — 电量样本
```typescript
{
  ...base,
  event: "battery_sample",
  level_pct: number,           // 0-100
  is_charging: boolean,
  battery_state: "unknown" | "unplugged" | "charging" | "full",
  screen_on: boolean,
  app_state: "active" | "background" | "inactive",
  trigger: "timer_60s" | "level_change" | "state_change"
}
```

**埋点**：新建`app/src/services/batteryMonitor.ts`，每60s poll一次 + `Battery.addBatteryLevelListener` change时触发。

### 2.6 `network_change` — 网络状态切换
```typescript
{
  ...base,
  event: "network_change",
  state: "online" | "offline",
  type: "wifi" | "cellular" | "none" | "unknown",
  is_connected: boolean,
  is_internet_reachable: boolean | null
}
```

**埋点**：新建`app/src/services/networkMonitor.ts`，订阅`expo-network`变化。

### 2.7 `marker_placed` — 用户放marker
```typescript
{
  ...base,
  event: "marker_placed",
  marker_id: string,
  type: "danger" | "scenic" | "supply" | "junction" | "free" | "cairn",
  lat: number,
  lon: number,
  accuracy_m: number,
  text_length: number,         // 不记内容，只记长度
  permission: "personal" | "group" | "public"
}
```

**埋点**：`app/src/store/useMarkerStore.ts addMarker`函数。

### 2.8 `waypoint_arrived` — 到达waypoint
```typescript
{
  ...base,
  event: "waypoint_arrived",
  waypoint_id: string,
  route_id: string,
  distance_at_trigger_m: number,  // 触发时离waypoint多少米
  expected_radius_m: number       // 设定的触发半径（如30m）
}
```

**埋点**：`app/src/services/navigationController.ts` waypoint判定逻辑。

### 2.9 `sos_triggered` — SOS触发链路
```typescript
{
  ...base,
  event: "sos_triggered",
  stage: "longpress_start" | "longpress_complete" | "countdown_start" | "countdown_cancelled" | "sms_sent" | "sms_failed" | "queued_offline",
  contact_count?: number,
  network_state?: "online" | "offline",
  lat?: number,
  lon?: number,
  accuracy_m?: number,
  error_message?: string
}
```

**埋点**：`app/src/services/sosService.ts` 各stage触发点。

### 2.10 `app_state_change` — 前台/后台切换
```typescript
{
  ...base,
  event: "app_state_change",
  from: "active" | "background" | "inactive" | "unknown",
  to: "active" | "background" | "inactive" | "unknown",
  tracking_active: boolean
}
```

**埋点**：`App.tsx`顶层 `AppState.addEventListener`。

### 2.11 `error` — 任何exception
```typescript
{
  ...base,
  event: "error",
  source: string,              // 文件名或service名
  message: string,
  stack: string,
  fatal: boolean
}
```

**埋点**：`app/src/services/debugLogger.ts` 提供`logError(error, source, fatal?)`。在GPS service / API service / SOS service的catch块调用。

---

## 3. L3 分钟快照Schema

```typescript
{
  ts: number,
  session_id: string,
  event: "minute_snapshot",
  minute_index: number,         // 0,1,2,... 从session开始算

  // GPS质量
  gps_points_count: number,
  gps_avg_accuracy_m: number,
  gps_max_accuracy_m: number,
  gps_p95_accuracy_m: number,
  gps_lost_seconds: number,     // 这分钟里没GPS fix的累计秒数

  // 电池
  battery_start_pct: number,
  battery_end_pct: number,
  battery_drop_pct: number,
  is_charging_any: boolean,

  // 屏幕/前后台
  screen_on_seconds: number,
  in_background_seconds: number,

  // 事件计数
  broadcasts_played_count: number,
  deviations_count: number,
  errors_count: number,

  // 网络
  network_state_end: "online" | "offline",
  network_changes_count: number,

  // 系统
  memory_mb: number | null      // 如果可拿（iOS需要原生模块，可先null）
}
```

**埋点**：新建`app/src/services/sessionRecorder.ts`，`setInterval(60000)` + 计算窗口内统计。

---

## 4. L4 用户标注Schema

```typescript
{
  ts: number,
  session_id: string,
  event: "user_annotation",
  tag: "gps_inaccurate" | "deviation_false_positive" | "deviation_missed" | "broadcast_jarring" | "marker_misplaced" | "other",
  lat: number | null,
  lon: number | null,
  accuracy_m: number | null,
  note: string | null           // 可选，用户文字补充
}
```

**UI实现**：

### 4.1 入口：5次tap隐藏Debug Menu
- 位置：`app/src/screens/SettingsScreen.tsx` 底部About区某文字（如"Version 1.0"）
- 5次tap触发：toggle `useSettingsStore.debugMode`

### 4.2 Debug Mode开启后：
- SettingsScreen顶部显示新section "🐛 Debug"
- 包含：
  - Toggle "Debug Logging Enabled"
  - Button "Open Debug Screen"（导航到`DebugScreen.tsx`）
  - Toggle "Show Annotation FAB"

### 4.3 浮动标注按钮 `DebugAnnotationFAB.tsx`
- 仅当`debugMode = true && annotationFabVisible = true`时渲染
- 位置：右下角，Tab Bar上方56px
- 单击：展开6个标注按钮（vertical stack）
- 选一个tag：写入L4事件 + haptic feedback + 1秒"Logged ✓"toast消失
- 不阻塞用户徒步，不打断tracking

### 4.4 Debug Screen `DebugScreen.tsx`
- 列表：最近10个session（按时间倒序）
- 每个session显示：时间 / 时长 / 距离 / 事件数 / 文件大小
- 点进去：可看事件流（debug用，开发期看）
- 顶部按钮：
  - "Export Last Session"
  - "Export All Sessions"
  - "Clear All Logs"（带二次确认）

---

## 5. 埋点位置总表

| 优先级 | 文件 | 函数/位置 | 事件 |
|---|---|---|---|
| P0 | `useTrackingStore.ts` line 109-123 | watchPositionAsync callback | `gps_fix` |
| P0 | `geo.ts` line 292-338 | smoothGPSPoint return前 | `kalman_output` |
| P0 | `routeDeviationService.ts` | 偏离状态切换 | `deviation_start/end` |
| P0 | `broadcastService.ts` | playBroadcast | `broadcast_played` |
| P1 | `useMarkerStore.ts` | addMarker | `marker_placed` |
| P1 | `navigationController.ts` | waypoint判定 | `waypoint_arrived` |
| P1 | `sosService.ts` | 各stage | `sos_triggered` |
| P1 | `App.tsx`顶层 | AppState listener | `app_state_change` |
| P1 | 新建`networkMonitor.ts` | expo-network listener | `network_change` |
| P1 | 新建`batteryMonitor.ts` | poll + listener | `battery_sample` |
| P2 | 新建`sessionRecorder.ts` | setInterval 60s | `minute_snapshot` |
| P2 | 新建`debugLogger.ts` | logError API | `error` |
| P2 | 新建`DebugAnnotationFAB.tsx` | tap callback | `user_annotation` |

---

## 6. 文件清单（新增）

```
app/src/services/
├── debugLogger.ts           // 统一write/flush/rotate接口
├── sessionRecorder.ts       // L3定时器 + 窗口统计
├── batteryMonitor.ts        // expo-battery集成
└── networkMonitor.ts        // expo-network集成

app/src/screens/
└── DebugScreen.tsx          // Debug Menu主屏

app/src/components/
└── DebugAnnotationFAB.tsx   // 浮动标注按钮

app/src/store/
└── (扩展useSettingsStore.ts加 debugMode + annotationFabVisible 字段)

scripts/
├── analyze-session.py       // 主分析脚本
├── ground-truth-static.py   // 静止精度分析
└── compare-sessions.py      // A/B对比

docs/
├── debug-logger-spec.md     // 本文件
├── real-device-test-plan.md // 测试执行清单
├── real-device-baseline-cn.md  // 中国基线（Sprint 59后写）
└── real-device-baseline-nz.md  // NZ基线（TestFlight后写）
```

---

## 7. 依赖

新增npm包：

```json
{
  "expo-battery": "~9.0.0",          // 电量监控
  "expo-network": "~7.0.0",          // 网络状态
  "expo-file-system": "~17.0.0",     // 写本地JSON
  "expo-sharing": "~12.0.0"          // AirDrop/Email export
}
```

**注意**：
- `expo-battery`官方unmaintained但仍工作，无替代品
- `expo-file-system`项目已有则跳过
- 这些都是Expo官方包，EAS Build兼容

---

## 8. 持久化与导出

### 8.1 文件结构
```
{documentDirectory}/cairn-logs/sessions/
├── {session_id_1}.json     // 一个session一个文件
├── {session_id_2}.json
└── ...
```

### 8.2 写入策略
- **buffer机制**：内存buffer累积事件，达到100条 OR 30秒超时 → flush到文件（`writeAsStringAsync`追加）
- **session结束**：自动flush + dump session metadata（开始时间/结束时间/事件总数）到文件头
- **崩溃恢复**：每次flush是原子操作（写tmp+rename），崩溃时最多丢buffer里的100条
- **格式**：JSONL（每行一个JSON对象，方便流式分析）

### 8.3 文件rotate
- 保留最近10个session
- 超过自动删除最老（按mtime排序）
- 单文件上限：50MB（罕见，但防失控）

### 8.4 导出
- DebugScreen "Export"按钮 → `expo-sharing.shareAsync(filePath)` → 系统share sheet
- 可选目标：AirDrop / Email / Files App / 第三方云盘
- TestFlight众测时另加"Upload to Backend"选项（需backend新增`/api/debug-sessions/upload`）

### 8.5 大小预估
- 单事件JSONL平均180字节
- 2小时session：约5,000个gps_fix + 5,000个kalman_output + 杂事件1,000个 ≈ 11,000条 ≈ 2MB
- gzip后约300KB（适合上传backend或邮件）

---

## 9. Ground Truth基线方法

### 9.1 方法A — 静止精度（必做）
- 站在已知坐标点（家门口GPS地图标定）40分钟
- 跑`scripts/ground-truth-static.py`：
  - 输入：session JSON
  - 算：GPS散布的均值/标准差/P95、accuracy字段诚实度
  - 输出：散布图 + "实测精度N米 vs 报告精度M米"报告

### 9.2 方法B — 双手机对比（推荐）
- iPhone跑Cairn + 另手机跑AllTrails / Strava
- 同时记录同一段路（30分钟）
- 导出GPX → Python `geopandas`比较两条轨迹偏差

### 9.3 方法C — DOC GPX对比（境外测试时做）
- 走Tongariro某段，LINZ官方GPX作ground truth
- TestFlight众测阶段执行

---

## 10. 分析脚本输出（NFR对照模板）

`scripts/analyze-session.py`输出格式：

```
=== Session abc-123 Analysis Report ===
Date: 2026-05-25 09:14
Duration: 2h 15min  Distance: 8.3km  Mode: hiking
Device: iPhone 13 Pro / iOS 17.4

[GPS Quality]
  Total points: 4823
  Avg accuracy: 6.8m
  P95 accuracy: 18.2m
  Points with accuracy>20m: 12% (clustered in 2 segments — likely canyons)
  GPS lost periods: 0
  NFR target (开阔地<10m): 7.4m avg ✅

[Kalman Filter]
  Avg jitter reduction: 3.1m → 1.8m (42%)
  Max correction: 12.4m
  
[Battery Consumption]
  Drop: 16.3% over 135min = 7.2%/h
  NFR target (徒步<8%/h): ✅
  Charging during session: false
  
[Background Tracking]
  Total background time: 87 minutes
  Background GPS points: 3120 (continuous, no gaps)
  ✅ 后台tracking正常工作
  
[Route Deviation]
  Total deviations: 5
  Avg distance: 67m  Max: 134m
  False positives (user marked via L4): 3 ⚠️
  True positives: 2
  
[Broadcasts]
  Total: 23 (P0:2, P1:15, P2:6)
  Avg trigger→TTS latency: 1.4s
  NFR target (<2s): ✅
  
[Network]
  Total offline duration: 96min (71% of session)
  Offline GPS points recorded: 3450
  Network changes: 4
  
[User Annotations] (4 total)
  - 09:23:14 "gps_inaccurate" @ -45.0312, 168.6629  
    → Verified: accuracy was 24m at that moment ✓
  - 09:47:02 "deviation_false_positive" @ -45.0290, 168.6580
    → Confirmed: deviation #2 had distance=52m for only 8s, likely GPS drift

[Critical Issues]
  ❌ 3 false positive deviations triggered unnecessary broadcasts (12% FP rate)
     → Recommendation: increase deviation_duration_threshold from instant to 15s
  ⚠️ 2 segments with consistently bad GPS (>20m) — Kalman didn't compensate enough
     → Recommendation: review Kalman process_noise tuning for high-accuracy points

[NFR Compliance Summary]
  ✅ GPS精度（开阔地<10m）
  ✅ 电池消耗（徒步<8%/h）
  ✅ 播报延迟（<2s）
  ✅ 后台tracking连续
  ⚠️ 偏离检测误报率（12%）—— 建议优化
```

这是**取代体感的客观答案**。

---

## 11. 隐私与安全

- **默认OFF**：debugMode默认false，普通用户感知不到
- **不上传**：日志默认仅本地，用户主动export才离开设备
- **不含PII**：marker文本不记内容只记长度；联系人不记内容只记count
- **session_id随机UUID**：与用户ID解耦
- **TestFlight众测时**：明确告知"Debug session会包含GPS轨迹"，需用户opt-in才能export

---

## 12. 验收标准（Sprint 55-58交付）

### Sprint 55 完成时
- [ ] `debugLogger.ts` + buffer机制 + JSONL写入
- [ ] 4个核心P0埋点（gps_fix / kalman_output / deviation / broadcast）
- [ ] 跑1次10分钟session能产出完整JSON文件 ≥ 500条事件

### Sprint 56 完成时
- [ ] `expo-battery` + `expo-network`集成
- [ ] `startLocationUpdatesAsync`后台tracking启用，PRD2 NFR"锁屏继续记录"实现
- [ ] geo.ts动态采样率终于工作
- [ ] 1小时session包含battery_sample / network_change / app_state_change事件
- [ ] 锁屏10分钟后再打开，session轨迹连续无断点

### Sprint 57 完成时
- [ ] L3分钟快照写入
- [ ] DebugScreen + 5次tap入口
- [ ] DebugAnnotationFAB + 6个tag按钮
- [ ] Export流程通AirDrop到Mac成功

### Sprint 58 完成时
- [ ] `analyze-session.py`输出完整NFR对照报告
- [ ] `ground-truth-static.py`输出散布图+精度对比
- [ ] `compare-sessions.py`能对比fix前后

---

## 13. 风险

| 风险 | 应对 |
|---|---|
| `expo-battery`unmaintained未来失效 | 准备native模块fallback计划，记录在backlog |
| 后台tracking被iOS杀进程 | UIBackgroundModes已配，但需真机验证；做好"backgrounded killed"事件捕捉 |
| 日志写入影响电池 | buffer批量flush + JSONL减少JSON.stringify调用 |
| TestFlight用户不配合开debug | 提供清晰tutorial，给愿意配合的用户发感谢 |
| GFW导致session export失败（如果走backend） | 默认走AirDrop/Email，backend上传只在境外可用 |

---

## 文档维护

- Schema变更走CR流程
- 新增event类型需更新本文 + analyze-session.py对应处理
- 真机测试发现日志gap → backlog → 下个Sprint补
